import { cleanName, MAX_PLAYER_NAME } from "@contractplay/protocol";
import { AuthStore } from "./auth-store.js";
import type { Account } from "./auth-store.js";
import { configuredMailer, MailDeliveryError } from "./mailer.js";

const LINK_LIFETIME = 15 * 60_000;
const SESSION_LIFETIME = 30 * 24 * 60 * 60_000;
const HOUR = 60 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const GUEST_SECRET = /^[A-Za-z0-9_-]{32,128}$/;
const authHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const genericRequest = () => Response.json({ message: "If the address can receive mail, a sign-in link is on its way." }, { status: 202, headers: authHeaders });
const invalidLink = () => Response.json({ error: "invalid-link" }, { status: 400, headers: authHeaders });

function publicOrigin(env: Env): URL | undefined {
  try {
    const url = new URL(env.AUTH_PUBLIC_ORIGIN ?? "");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && env.AUTH_ALLOW_INSECURE_LOCALHOST === "true"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url;
  } catch { /* An unset or invalid public origin disables authentication. */ }
  return undefined;
}

/** Also used by cookie-authenticated history and WebSocket entry points. */
export function authRequestAllowed(request: Request, env: Env, callback = false): boolean {
  const origin = publicOrigin(env)?.origin;
  if (!origin || new URL(request.url).origin !== origin) return false;
  const suppliedOrigin = request.headers.get("Origin");
  if (suppliedOrigin !== null && suppliedOrigin !== origin) return false;
  if (request.method !== "GET" && request.method !== "HEAD" && suppliedOrigin !== origin) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  // A real emailed link navigates from an external mail site. Fetches must remain same-origin.
  if (site && site !== "same-origin" && site !== "none") {
    return callback && request.method === "GET" && request.headers.get("Sec-Fetch-Mode") === "navigate"
      && request.headers.get("Sec-Fetch-Dest") === "document";
  }
  return true;
}

export async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function credential(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cookieName(env: Env): string {
  return publicOrigin(env)?.protocol === "https:" ? "__Host-contractplay_session" : "contractplay_session";
}

function sessionCredential(request: Request, env: Env): string | undefined {
  const matches = (request.headers.get("Cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName(env)}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(cookieName(env).length + 1);
  return TOKEN.test(value) ? value : undefined;
}

function sessionCookie(env: Env, value: string, expiresAt: number): string {
  const secure = publicOrigin(env)?.protocol === "https:" ? "; Secure" : "";
  return `${cookieName(env)}=${value}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${value ? SESSION_LIFETIME / 1000 : 0}; Expires=${new Date(expiresAt).toUTCString()}`;
}

/** Server-only account authority; callers never take account IDs from the request body. */
export async function authenticatedAccount(request: Request, env: Env): Promise<Account | null> {
  if (!authRequestAllowed(request, env)) return null;
  const value = sessionCredential(request, env);
  return value ? new AuthStore(env.DB).findSession(await hash(value), Date.now()) : null;
}

/** Benchmark administration uses deployed account IDs and the same-origin account session. */
export async function benchmarkAdminAccess(request: Request, env: Env): Promise<"authorized" | "unauthenticated" | "forbidden"> {
  const account = await authenticatedAccount(request, env);
  if (!account) return "unauthenticated";
  const allowlist = env.BENCHMARK_ADMIN_ACCOUNT_IDS?.split(",").map((id) => id.trim()) ?? [];
  return allowlist.includes(account.id) ? "authorized" : "forbidden";
}

async function boundedBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) < 0 || Number(declared) > 4096)) throw new Error("body too large");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(4096);
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (size + value.byteLength > bytes.length) {
      await reader.cancel().catch(() => undefined);
      throw new Error("body too large");
    }
    bytes.set(value, size); size += value.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes.subarray(0, size))); } catch { return undefined; }
}

async function requestMagicLink(request: Request, env: Env): Promise<Response> {
  const store = new AuthStore(env.DB);
  const now = Date.now();
  if (!await store.admitAuthAttempt(await hash(`request:ip:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`), now, HOUR, 10)) return genericRequest();
  let body: unknown;
  try { body = await boundedBody(request); } catch {
    return Response.json({ error: "bad-request" }, { status: 400, headers: authHeaders });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return genericRequest();
  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  // Deliberately conservative mailbox syntax, with no control characters or header delimiters.
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) return genericRequest();
  const displayName = input.displayName === undefined ? "Player" : cleanName(input.displayName, MAX_PLAYER_NAME);
  if (displayName === undefined || (input.guestSecret !== undefined
    && (typeof input.guestSecret !== "string" || !GUEST_SECRET.test(input.guestSecret)))) return genericRequest();
  if (!await store.admitAuthAttempt(await hash(`request:email:${email}`), now, HOUR, 3, 60_000)) return genericRequest();
  await store.cleanupAuth(now);
  const token = credential();
  const tokenHash = await hash(token);
  await store.insertPendingMagicLink({ tokenHash, email, displayName, expiresAt: now + LINK_LIFETIME,
    ...(typeof input.guestSecret === "string" ? { guestPlayerId: await hash(input.guestSecret) } : {}) }, now);
  const url = new URL("/api/auth/callback", publicOrigin(env)!.origin);
  url.searchParams.set("token", token);
  try {
    await configuredMailer(env).sendMagicLink({ to: email, url: url.toString() });
    await store.activateMagicLink(tokenHash);
  } catch (error) {
    // Only log safe diagnostics. Never include recipient, link, provider body, or credentials.
    console.error("Magic-link email delivery failed", error instanceof MailDeliveryError
      ? { reason: error.reason, ...(error.status ? { status: error.status } : {}) }
      : { reason: "transport" });
    /* A pending record stays unusable until expiry. Never expose provider failures. */
  }
  return genericRequest();
}

async function redeem(request: Request, env: Env): Promise<Response> {
  const store = new AuthStore(env.DB);
  const now = Date.now();
  if (!await store.admitAuthAttempt(await hash(`redeem:ip:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`), now, LINK_LIFETIME, 30)) return invalidLink();
  const values = new URL(request.url).searchParams.getAll("token");
  const token = values[0];
  if (values.length !== 1 || !token || !TOKEN.test(token)) return invalidLink();
  const tokenHash = await hash(token);
  const email = await store.magicLinkEmail(tokenHash);
  if (!email || !await store.admitAuthAttempt(await hash(`redeem:email:${email}`), now, LINK_LIFETIME, 10)) return invalidLink();
  const session = credential();
  const expiresAt = now + SESSION_LIFETIME;
  const account = await store.redeemMagicLink({ tokenHash, sessionHash: await hash(session), now, sessionExpiresAt: expiresAt });
  if (!account) return invalidLink();
  return new Response(null, { status: 303, headers: { ...authHeaders,
    "Set-Cookie": sessionCookie(env, session, expiresAt), Location: `${publicOrigin(env)!.origin}/#/online` } });
}

/** Renames the session's own account; seats pick up the new name when the player next connects to a table. */
async function rename(request: Request, env: Env): Promise<Response> {
  const account = await authenticatedAccount(request, env);
  if (!account) return Response.json({ error: "unauthenticated" }, { status: 401, headers: authHeaders });
  let body: unknown;
  try { body = await boundedBody(request); } catch { body = undefined; }
  const displayName = body && typeof body === "object" && !Array.isArray(body)
    ? cleanName((body as Record<string, unknown>).displayName, MAX_PLAYER_NAME) : undefined;
  if (displayName === undefined) return Response.json({ error: "invalid-name" }, { status: 400, headers: authHeaders });
  await new AuthStore(env.DB).updateDisplayName(account.id, displayName);
  return Response.json({ playerId: account.primaryPlayerId, displayName }, { headers: authHeaders });
}

export async function authRoute(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!authRequestAllowed(request, env, path === "/api/auth/callback")) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: authHeaders });
  }
  const routes: Record<string, string> = { "/api/auth/magic-link": "POST", "/api/auth/callback": "GET", "/api/auth/me": "GET", "/api/auth/name": "POST", "/api/auth/sign-out": "POST" };
  if (!routes[path]) return Response.json({ error: "not-found" }, { status: 404, headers: authHeaders });
  if (request.method !== routes[path]) return new Response(null, { status: 405, headers: { ...authHeaders, Allow: routes[path] } });
  try {
    if (path === "/api/auth/magic-link") return await requestMagicLink(request, env);
    if (path === "/api/auth/callback") return await redeem(request, env);
    if (path === "/api/auth/me") {
      const account = await authenticatedAccount(request, env);
      return account ? Response.json({ playerId: account.primaryPlayerId, displayName: account.displayName }, { headers: authHeaders })
        : Response.json({ error: "unauthenticated" }, { status: 401, headers: authHeaders });
    }
    if (path === "/api/auth/name") return await rename(request, env);
    const session = sessionCredential(request, env);
    if (session) await new AuthStore(env.DB).revokeSession(await hash(session), Date.now());
    return new Response(null, { status: 204, headers: { ...authHeaders, "Set-Cookie": sessionCookie(env, "", 0) } });
  } catch {
    // Database errors can embed credential or address data; never log or serialize them.
    if (path === "/api/auth/magic-link") return genericRequest();
    if (path === "/api/auth/callback") return invalidLink();
    return Response.json({ error: "unavailable" }, { status: 503, headers: authHeaders });
  }
}
