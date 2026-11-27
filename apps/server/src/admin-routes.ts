import { adminAccess, authRequestAllowed, isBootstrapAdmin, logMailFailure, sendSignInLink } from "./auth.js";
import { AuthStore } from "./auth-store.js";
import { configuredMailer } from "./mailer.js";

/** Player administration on /admin: accounts and admin roles, the sign-up queue, and blocked addresses. */
export const ADMIN_PLAYER_PATHS = ["/api/admin/accounts", "/api/admin/users/", "/api/admin/signups/", "/api/admin/blocked"];

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

export function isAdminPlayerPath(path: string): boolean {
  return ADMIN_PLAYER_PATHS.some((prefix) => path === prefix || (prefix.endsWith("/") ? path.startsWith(prefix) : path.startsWith(`${prefix}/`)));
}

/** Rejects anyone but a signed-in admin, answering 401 or 403; otherwise returns the admin's account. */
export async function requireAdmin(request: Request, env: Env) {
  if (!authRequestAllowed(request, env)) return { denied: json({ error: "forbidden" }, 403) } as const;
  const access = await adminAccess(request, env);
  if (access.status === "authorized") return { account: access.account } as const;
  return { denied: json({ error: access.status }, access.status === "unauthenticated" ? 401 : 403) } as const;
}

async function emailFrom(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.json();
    const email = body && typeof body === "object" ? (body as Record<string, unknown>).email : undefined;
    if (typeof email !== "string") return undefined;
    const normalized = email.trim().toLowerCase();
    return normalized.length <= 254 && EMAIL.test(normalized) ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export async function adminPlayerRoute(request: Request, env: Env): Promise<Response> {
  try {
    const gate = await requireAdmin(request, env);
    if ("denied" in gate) return gate.denied;
    const me = gate.account;
    const store = new AuthStore(env.DB);
    const path = new URL(request.url).pathname;
    const method = request.method;
    const now = Date.now();

    if (path === "/api/admin/accounts") {
      if (method !== "GET") return json({ error: "method-not-allowed" }, 405);
      const [accounts, signups, blocked] = await Promise.all([store.listAccounts(), store.listPendingSignups(), store.listBlocked()]);
      const blockedEmails = new Set(blocked.map((entry) => entry.email));
      return json({
        users: accounts.map((account) => ({ id: account.id, email: account.email, displayName: account.displayName, createdAt: account.createdAt,
          admin: account.grantedAdmin || isBootstrapAdmin(account.id, env), bootstrapAdmin: isBootstrapAdmin(account.id, env),
          blocked: blockedEmails.has(account.email), you: account.id === me.id })),
        signups, blocked
      });
    }

    const role = /^\/api\/admin\/users\/([^/]+)\/admin$/.exec(path);
    if (role) {
      if (method !== "PUT" && method !== "DELETE") return json({ error: "method-not-allowed" }, 405);
      const accountId = decodeURIComponent(role[1]!);
      const target = await store.findAccount(accountId);
      if (!target) return json({ error: "not-found" }, 404);
      if (method === "DELETE") {
        if (isBootstrapAdmin(accountId, env)) return json({ error: "bootstrap-admin" }, 409);
        if (accountId === me.id) return json({ error: "self" }, 409);
      }
      await store.setGrantedAdmin(accountId, method === "PUT", now);
      return new Response(null, { status: 204, headers });
    }

    const signup = /^\/api\/admin\/signups\/(approve|deny)$/.exec(path);
    if (signup) {
      if (method !== "POST") return json({ error: "method-not-allowed" }, 405);
      const email = await emailFrom(request);
      if (!email) return json({ error: "bad-request" }, 400);
      if (signup[1] === "approve") {
        const approved = await store.approveSignup(email, now);
        if (!approved) return json({ error: "not-found" }, 404);
        return json({ emailed: await sendSignInLink(env, approved, now) });
      }
      if (!await store.denySignup(email)) return json({ error: "not-found" }, 404);
      try {
        await configuredMailer(env).sendSignupDenied({ to: email });
        return json({ emailed: true });
      } catch (error) {
        logMailFailure("Sign-up denial email delivery failed", error);
        return json({ emailed: false });
      }
    }

    if (path === "/api/admin/blocked") {
      if (method !== "POST") return json({ error: "method-not-allowed" }, 405);
      const email = await emailFrom(request);
      if (!email) return json({ error: "bad-request" }, 400);
      if (email === me.email) return json({ error: "self" }, 409);
      const target = await store.findAccountByEmail(email);
      if (target && isBootstrapAdmin(target.id, env)) return json({ error: "bootstrap-admin" }, 409);
      await store.blockEmail(email, now);
      return new Response(null, { status: 204, headers });
    }
    const unblock = /^\/api\/admin\/blocked\/([^/]+)$/.exec(path);
    if (unblock) {
      if (method !== "DELETE") return json({ error: "method-not-allowed" }, 405);
      return await store.unblockEmail(decodeURIComponent(unblock[1]!))
        ? new Response(null, { status: 204, headers }) : json({ error: "not-found" }, 404);
    }
    return json({ error: "not-found" }, 404);
  } catch {
    // Database errors can embed addresses; never log or serialize them.
    return json({ error: "unavailable" }, 503);
  }
}
