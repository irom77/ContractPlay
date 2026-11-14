import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import migration from "../migrations/0001_auth.sql?raw";
import rateMigration from "../migrations/0002_auth_rate_limits.sql?raw";
import worker from "./index.js";
import { AuthStore } from "./auth-store.js";

const origin = "https://bridge.example";
const store = new AuthStore(env.DB);
let sent: { to: string; text: string }[];
let failMail: boolean;
let duringSend: (() => Promise<void>) | undefined;
const settings = () => ({ ...env, AUTH_PUBLIC_ORIGIN: origin, AUTH_EMAIL_FROM: "signin@example.org",
  EMAIL: { async send(message: { to: string; text: string }) {
    sent.push(message);
    await duringSend?.();
    if (failMail) throw new Error("provider failed");
    return { messageId: "test" };
  } }
});
const call = (path: string, init: RequestInit = {}, config = settings()) => worker.fetch(new Request(`${config.AUTH_PUBLIC_ORIGIN}${path}`, init), config as Env);
const requestLink = (email = "ann@example.com", extra = {}, ip = "192.0.2.1") => call("/api/auth/magic-link", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": ip },
  body: JSON.stringify({ email, displayName: "Ann", ...extra })
});
const token = (index = sent.length - 1) => new URL(sent[index]!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
const callback = (value = token(), headers = {}) => call(`/api/auth/callback?token=${value}`, { headers: { "CF-Connecting-IP": "192.0.2.2", ...headers } });
const cookie = (response: Response) => response.headers.get("Set-Cookie")!.split(";")[0]!;
const me = (value: string) => call("/api/auth/me", { headers: { Cookie: value } });
async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
}

beforeAll(async () => {
  await env.DB.exec(migration.replace(/\n/g, " "));
  await env.DB.exec(rateMigration.replace(/\n/g, " "));
});
beforeEach(async () => {
  vi.restoreAllMocks();
  sent = []; failMail = false; duringSend = undefined;
  await env.DB.batch(["sessions", "magic_links", "account_player_identities", "accounts"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.prepare("DELETE FROM auth_rate_limits").run();
});

describe("authentication routes", () => {
  it("normalizes emails and returns identical success for known and new accounts", async () => {
    await store.getOrCreateAccount("known@example.com", "Known", Date.now());
    const known = await requestLink(" Known@Example.COM ");
    const fresh = await requestLink(" New@Example.COM ");
    expect(known.status).toBe(202);
    expect(fresh.status).toBe(known.status);
    expect(await fresh.json()).toEqual(await known.json());
    expect(sent.map((mail) => mail.to)).toEqual(["known@example.com", "new@example.com"]);
    expect(sent[0]!.text).toContain(`${origin}/api/auth/callback?token=`);
    expect(await store.findAccountByEmail("new@example.com")).toBeNull();
  });

  it("stores only hashes, links a proven guest, and sets a 30-day secure session", async () => {
    const now = Date.now();
    const secret = "a".repeat(43);
    await requestLink(undefined, { guestSecret: secret, playerId: "untrusted" });
    const rawToken = token();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const link = await env.DB.prepare("SELECT * FROM magic_links").first();
    expect(link?.token_hash).toBe(await hash(rawToken));
    expect(link?.guest_player_id).toBe(await hash(secret));
    expect(Number(link?.expires_at) - now).toBeGreaterThanOrEqual(15 * 60_000);
    expect(Number(link?.expires_at) - now).toBeLessThan(15 * 60_000 + 5_000);
    expect(JSON.stringify(link)).not.toContain(secret);
    const response = await callback();
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`${origin}/#/online`);
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("__Host-contractplay_session=");
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000", "Expires="]) expect(setCookie).toContain(flag);
    expect(setCookie).not.toContain("Domain=");
    const rawSession = cookie(response).split("=")[1]!;
    const session = await env.DB.prepare("SELECT * FROM sessions").first();
    expect(session?.session_hash).toBe(await hash(rawSession));
    expect(Number(session?.expires_at) - now).toBeGreaterThanOrEqual(30 * 24 * 60 * 60_000);
    expect(await (await me(cookie(response))).json()).toEqual({ playerId: await hash(secret), displayName: "Ann" });
  });

  it("registers without guest proof and ignores a caller supplied player ID", async () => {
    await requestLink(undefined, { playerId: "victim" });
    const response = await callback();
    expect(response.status).toBe(303);
    expect(await (await me(cookie(response))).json()).toEqual({ playerId: expect.stringMatching(/^[0-9a-f-]{36}$/), displayName: "Ann" });
  });

  it("rejects malformed, unknown, expired, and replayed tokens without a cookie", async () => {
    for (const invalid of ["bad", "a".repeat(43)]) {
      const response = await callback(invalid);
      expect(response.status).toBe(400); expect(response.headers.has("Set-Cookie")).toBe(false);
    }
    await requestLink();
    const old = token();
    await env.DB.prepare("UPDATE magic_links SET expires_at = ?").bind(Date.now() - 1).run();
    expect((await callback(old)).status).toBe(400);
    await requestLink("other@example.com");
    expect((await callback()).status).toBe(303);
    expect((await callback()).status).toBe(400);
    expect((await env.DB.prepare("SELECT * FROM sessions").all()).results).toHaveLength(1);
  });

  it("rejects concurrent redemption and does not extend sessions on /me", async () => {
    await requestLink();
    const responses = await Promise.all([callback(), callback()]);
    expect(responses.map((r) => r.status).sort()).toEqual([303, 400]);
    const value = cookie(responses.find((r) => r.status === 303)!);
    const before = await env.DB.prepare("SELECT expires_at FROM sessions").first();
    expect((await me(value)).status).toBe(200);
    expect(await env.DB.prepare("SELECT expires_at FROM sessions").first()).toEqual(before);
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind(Date.now() - 1).run();
    expect((await me(value)).status).toBe(401);
  });

  it("signs out only the current device and clears its cookie", async () => {
    await requestLink(); const first = cookie(await callback());
    // Move the durable cooldown forward without sleeping.
    await env.DB.prepare("UPDATE auth_rate_limits SET last_at = 0").run();
    await requestLink(); const second = cookie(await callback());
    const response = await call("/api/auth/sign-out", { method: "POST", headers: { Cookie: first, Origin: origin } });
    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
  });

  it("checks configured origin and CSRF headers but permits email navigation", async () => {
    expect((await call("/api/auth/magic-link", { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
    expect((await call("/api/auth/sign-out", { method: "POST" })).status).toBe(403);
    expect((await call("/api/auth/me", { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    await requestLink();
    expect((await callback(token(), { Origin: "https://evil.example" })).status).toBe(403);
    expect((await callback(token(), { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors" })).status).toBe(403);
    expect((await callback(token(), { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" })).status).toBe(303);
    expect((await worker.fetch(new Request("https://evil.example/api/auth/me"), settings() as Env)).status).toBe(403);
  });

  it("bounds bodies and rejects invalid guest proof without creating links", async () => {
    expect((await call("/api/auth/magic-link", { method: "POST", headers: { Origin: origin }, body: "x".repeat(4097) })).status).toBe(400);
    await requestLink(undefined, { guestSecret: "bad" });
    await requestLink("bad\r\n@example.com");
    expect(sent).toHaveLength(0);
    expect((await env.DB.prepare("SELECT * FROM magic_links").all()).results).toHaveLength(0);
  });

  it("keeps failed and in-flight deliveries unusable and outwardly generic", async () => {
    duringSend = async () => { expect((await callback()).status).toBe(400); };
    const success = await requestLink();
    expect(success.status).toBe(202);
    failMail = true;
    const failure = await requestLink("failed@example.com");
    expect(failure.status).toBe(success.status);
    expect(await failure.json()).toEqual(await success.json());
    expect((await callback()).status).toBe(400);
    expect((await env.DB.prepare("SELECT * FROM sessions").all()).results).toHaveLength(0);
    const failed = await env.DB.prepare("SELECT * FROM magic_links WHERE email = 'failed@example.com'").first();
    expect(sent).toHaveLength(2);
    expect(failed).not.toBeNull();
    expect(failed?.consumed_at).not.toBeNull();
  });

  it("throttles requests per normalized address across IPs with a generic response", async () => {
    const first = await requestLink();
    const repeated = await requestLink(" ANN@example.com ", {}, "192.0.2.99");
    expect(repeated.status).toBe(first.status);
    expect(await repeated.json()).toEqual(await first.json());
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare("UPDATE auth_rate_limits SET last_at = 0").run();
      await requestLink("ann@example.com", {}, `192.0.2.${i + 10}`);
    }
    expect(sent).toHaveLength(3);
  });

  it("throttles requests by IP even with different email addresses", async () => {
    for (let i = 0; i < 11; i++) expect((await requestLink(`ann${i}@example.com`)).status).toBe(202);
    expect(sent).toHaveLength(10);
  });

  it("throttles token guesses by IP before a valid token can redeem", async () => {
    await requestLink();
    for (let i = 0; i < 30; i++) expect((await callback("a".repeat(43))).status).toBe(400);
    expect((await callback()).status).toBe(400);
    expect((await callback(token(), { "CF-Connecting-IP": "192.0.2.9" })).status).toBe(303);
  });

  it("throttles redemption per email across network addresses", async () => {
    await requestLink();
    const raw = token();
    expect((await callback(raw)).status).toBe(303);
    for (let i = 0; i < 9; i++) await callback(raw, { "CF-Connecting-IP": `192.0.2.${i + 10}` });
    await env.DB.prepare("UPDATE auth_rate_limits SET last_at = 0").run();
    await requestLink();
    expect((await callback(token(), { "CF-Connecting-IP": "192.0.2.100" })).status).toBe(400);
  });

  it("requires HTTPS except explicitly enabled localhost and never caches auth responses", async () => {
    const remote = { ...settings(), AUTH_PUBLIC_ORIGIN: "http://bridge.example", AUTH_ALLOW_INSECURE_LOCALHOST: "true" };
    expect((await call("/api/auth/me", {}, remote)).status).toBe(403);
    const local = { ...settings(), AUTH_PUBLIC_ORIGIN: "http://localhost:8787", AUTH_ALLOW_INSECURE_LOCALHOST: "true" };
    await call("/api/auth/magic-link", { method: "POST", headers: { Origin: local.AUTH_PUBLIC_ORIGIN }, body: JSON.stringify({ email: "local@example.com" }) }, local);
    const response = await call(`/api/auth/callback?token=${token()}`, {}, local);
    expect(response.status).toBe(303);
    expect(response.headers.get("Set-Cookie")).not.toContain("Secure");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
