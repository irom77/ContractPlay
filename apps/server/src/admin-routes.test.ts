import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import authMigration from "../migrations/0001_auth.sql?raw";
import rateMigration from "../migrations/0002_auth_rate_limits.sql?raw";
import adminMigration from "../migrations/0007_admin_accounts.sql?raw";
import { hash, SIGN_IN_REQUESTED } from "./auth.js";
import { AuthStore } from "./auth-store.js";
import worker from "./index.js";

const origin = "https://bridge.example";
const store = new AuthStore(env.DB);
const tokens = { boot: "a".repeat(43), member: "b".repeat(43) };
let sent: { to: string; subject: string; text: string }[];
let bootId: string;
let memberId: string;

const settings = (extra: Record<string, unknown> = {}) => ({ ...env, AUTH_PUBLIC_ORIGIN: origin, AUTH_EMAIL_FROM: "signin@example.org",
  BENCHMARK_ADMIN_ACCOUNT_IDS: bootId,
  EMAIL: { async send(message: { to: string; subject: string; text: string }) { sent.push(message); return { messageId: "test" }; } }, ...extra });
const call = (path: string, init: RequestInit = {}, extra: Record<string, unknown> = {}) => worker.fetch(new Request(`${origin}${path}`,
  { ...init, headers: { Origin: origin, ...init.headers } }), settings(extra) as unknown as Env);
const as = (token: string, path: string, init: RequestInit = {}) => call(path, { ...init, headers: { Cookie: `__Host-contractplay_session=${token}`, ...init.headers } });
const post = (token: string, path: string, body: unknown) => as(token, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
/** Each address may ask once a minute; tests asking again clear that limit first. */
const requestLink = async (email: string, ip = "192.0.2.1") => (await env.DB.prepare("DELETE FROM auth_rate_limits").run(), call("/api/auth/magic-link", {
  method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ email, displayName: "Newcomer" })
}));
const linkIn = (mail: { text: string }) => new URL(mail.text.match(/https?:\/\/\S+/)![0]);
const redeem = (url: URL) => worker.fetch(new Request(url, { headers: { "CF-Connecting-IP": "192.0.2.9" } }), settings() as unknown as Env);

async function signedIn(email: string, name: string, token: string): Promise<string> {
  const account = await store.getOrCreateAccount(email, name, Date.now());
  await env.DB.prepare("INSERT INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)").bind(await hash(token), account.id, Date.now() + 60_000).run();
  return account.id;
}

beforeAll(async () => {
  for (const sql of [authMigration, rateMigration, adminMigration]) await env.DB.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});

beforeEach(async () => {
  sent = [];
  await env.DB.batch(["account_admins", "blocked_emails", "signup_requests", "sessions", "magic_links", "account_player_identities", "accounts", "auth_rate_limits"]
    .map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  bootId = await signedIn("boot@example.com", "Boot", tokens.boot);
  memberId = await signedIn("member@example.com", "Member", tokens.member);
});

describe("sign-up approval", () => {
  it("holds a new address without mail, answering exactly as for a known one", async () => {
    const fresh = await requestLink("new@example.com");
    const known = await requestLink("member@example.com", "192.0.2.2");
    expect(fresh.status).toBe(202);
    expect(await fresh.json()).toEqual({ message: SIGN_IN_REQUESTED });
    expect(await known.json()).toEqual({ message: SIGN_IN_REQUESTED });
    expect(sent.map((mail) => mail.to)).toEqual(["member@example.com"]);
    expect(await store.listPendingSignups()).toEqual([expect.objectContaining({ email: "new@example.com", displayName: "Newcomer" })]);
  });

  it("sends new addresses links straight away when approval is off", async () => {
    await call("/api/auth/magic-link", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ email: "new@example.com" }) }, { AUTH_SIGNUP_APPROVAL: "off" });
    expect(sent.map((mail) => mail.to)).toEqual(["new@example.com"]);
  });

  it("emails a working link on approval, and links straight away on later requests", async () => {
    await requestLink("new@example.com");
    const approved = await post(tokens.boot, "/api/admin/signups/approve", { email: "New@Example.com" });
    expect(await approved.json()).toEqual({ emailed: true });
    expect(sent.map((mail) => mail.to)).toEqual(["new@example.com"]);
    const response = await redeem(linkIn(sent[0]!));
    expect(response.status).toBe(303);
    expect((await store.findAccountByEmail("new@example.com"))?.displayName).toBe("Newcomer");
    expect(await store.listPendingSignups()).toEqual([]);
    await requestLink("new@example.com", "192.0.2.3");
    expect(sent).toHaveLength(2);
    expect((await post(tokens.boot, "/api/admin/signups/approve", { email: "new@example.com" })).status).toBe(404);
  });

  it("emails a refusal on deny and queues the address again if it asks again", async () => {
    await requestLink("new@example.com");
    expect(await (await post(tokens.boot, "/api/admin/signups/deny", { email: "new@example.com" })).json()).toEqual({ emailed: true });
    expect(sent).toEqual([expect.objectContaining({ to: "new@example.com", subject: "Your ContractPlay request" })]);
    expect(sent[0]!.text).not.toMatch(/https?:\/\//);
    expect(await store.listPendingSignups()).toEqual([]);
    await requestLink("new@example.com", "192.0.2.3");
    expect(await store.listPendingSignups()).toHaveLength(1);
  });
});

describe("sign-up requests in a stranger's name", () => {
  it("keep the first name, and an approval link never links a guest seat", async () => {
    await requestLink("new@example.com");
    await env.DB.prepare("DELETE FROM auth_rate_limits").run();
    await call("/api/auth/magic-link", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.5" },
      body: JSON.stringify({ email: "new@example.com", displayName: "Impostor", guestSecret: "g".repeat(43) }) });
    expect(await store.listPendingSignups()).toEqual([expect.objectContaining({ displayName: "Newcomer" })]);
    await post(tokens.boot, "/api/admin/signups/approve", { email: "new@example.com" });
    const links = await env.DB.prepare("SELECT guest_player_id FROM magic_links WHERE email = ?").bind("new@example.com").all();
    expect(links.results).toEqual([{ guest_player_id: null }]);
  });

  it("answer before any per-address work runs, so timing reveals nothing", async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (work: Promise<unknown>) => { pending.push(work); }, passThroughOnException() {} } as unknown as ExecutionContext;
    const ask = (email: string, ip: string) => worker.fetch(new Request(`${origin}/api/auth/magic-link`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ email }) }), settings() as unknown as Env, ctx);
    for (const [email, ip] of [["member@example.com", "192.0.2.6"], ["stranger@example.com", "192.0.2.7"]] as const) {
      const response = await ask(email, ip);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ message: SIGN_IN_REQUESTED });
    }
    expect(pending).toHaveLength(2);
    await Promise.all(pending);
    expect(sent.map((mail) => mail.to)).toEqual(["member@example.com"]);
    expect((await store.listPendingSignups()).map((signup) => signup.email)).toEqual(["stranger@example.com"]);
  });
});

describe("blocked addresses", () => {
  it("get no mail, lose their links and sessions, and can be unblocked", async () => {
    await call("/api/auth/magic-link", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ email: "member@example.com" }) });
    const link = linkIn(sent[0]!);
    expect((await post(tokens.boot, "/api/admin/blocked", { email: "member@example.com" })).status).toBe(204);
    expect((await as(tokens.member, "/api/auth/me")).status).toBe(401);
    expect((await redeem(link)).status).toBe(400);
    await requestLink("member@example.com", "192.0.2.2");
    expect(sent).toHaveLength(1);
    await requestLink("spam@example.com", "192.0.2.3");
    await post(tokens.boot, "/api/admin/blocked", { email: "spam@example.com" });
    expect(await store.listPendingSignups()).toEqual([]);
    const listed = await (await as(tokens.boot, "/api/admin/accounts")).json() as { blocked: { email: string }[]; users: { email: string; blocked: boolean }[] };
    expect(listed.blocked.map((entry) => entry.email).sort()).toEqual(["member@example.com", "spam@example.com"]);
    expect(listed.users.find((user) => user.email === "member@example.com")?.blocked).toBe(true);
    expect((await as(tokens.boot, `/api/admin/blocked/${encodeURIComponent("member@example.com")}`, { method: "DELETE" })).status).toBe(204);
    await requestLink("member@example.com", "192.0.2.4");
    expect(sent).toHaveLength(2);
  });

  it("refuses to block the admin's own address or a bootstrap admin", async () => {
    await store.setGrantedAdmin(memberId, true, Date.now());
    expect((await post(tokens.boot, "/api/admin/blocked", { email: "boot@example.com" })).status).toBe(409);
    expect((await post(tokens.member, "/api/admin/blocked", { email: "boot@example.com" })).status).toBe(409);
    expect((await post(tokens.member, "/api/admin/blocked", { email: "member@example.com" })).status).toBe(409);
  });
});

describe("admin roles", () => {
  it("tells /api/auth/me who is an admin", async () => {
    expect(await (await as(tokens.boot, "/api/auth/me")).json()).toMatchObject({ displayName: "Boot", admin: true });
    expect(await (await as(tokens.member, "/api/auth/me")).json()).toMatchObject({ displayName: "Member", admin: false });
  });

  it("keeps every admin route from non-admins and signed-out visitors", async () => {
    for (const path of ["/api/admin/accounts", "/api/admin/tables", "/api/admin/benchmarks/jobs"]) {
      expect((await as(tokens.member, path)).status).toBe(403);
      expect((await call(path)).status).toBe(401);
    }
    expect((await post(tokens.member, "/api/admin/signups/approve", { email: "x@example.com" })).status).toBe(403);
    expect((await as(tokens.member, "/api/admin/tables/ABC234", { method: "DELETE" })).status).toBe(403);
  });

  it("grants and removes admin rights, but never the admin's own or a bootstrap admin's", async () => {
    const role = (token: string, id: string, method: string) => as(token, `/api/admin/users/${id}/admin`, { method });
    expect((await role(tokens.boot, memberId, "PUT")).status).toBe(204);
    expect(await (await as(tokens.member, "/api/auth/me")).json()).toMatchObject({ admin: true });
    const listed = await (await as(tokens.member, "/api/admin/accounts")).json() as { users: { id: string; admin: boolean; bootstrapAdmin: boolean; you: boolean }[] };
    expect(listed.users.map(({ id, admin, bootstrapAdmin, you }) => ({ id, admin, bootstrapAdmin, you })).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([{ id: bootId, admin: true, bootstrapAdmin: true, you: false }, { id: memberId, admin: true, bootstrapAdmin: false, you: true }].sort((a, b) => a.id.localeCompare(b.id)));
    expect((await role(tokens.member, memberId, "DELETE")).status).toBe(409);
    expect((await role(tokens.member, bootId, "DELETE")).status).toBe(409);
    expect((await role(tokens.boot, memberId, "DELETE")).status).toBe(204);
    expect(await (await as(tokens.member, "/api/auth/me")).json()).toMatchObject({ admin: false });
    expect((await role(tokens.boot, "missing", "PUT")).status).toBe(404);
  });

  it("refuses admin changes from another origin", async () => {
    const response = await worker.fetch(new Request(`${origin}/api/admin/users/${memberId}/admin`, { method: "PUT",
      headers: { Origin: "https://evil.example", Cookie: `__Host-contractplay_session=${tokens.boot}` } }), settings() as unknown as Env);
    expect(response.status).toBe(403);
    expect(await store.isGrantedAdmin(memberId)).toBe(false);
  });
});
