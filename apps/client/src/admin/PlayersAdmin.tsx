import { useCallback, useEffect, useState } from "react";

export type AdminUser = { id: string; email: string; displayName: string; createdAt: number; admin: boolean; bootstrapAdmin: boolean; blocked: boolean; you: boolean };
export type AdminSignup = { email: string; displayName: string; requestedAt: number };
export type AdminBlocked = { email: string; blockedAt: number };
export type AdminAccounts = { users: AdminUser[]; signups: AdminSignup[]; blocked: AdminBlocked[] };

/** The /api/admin player calls, injectable for tests. Each throws with a short reason when the server refuses. */
export type PlayersAdminApi = {
  load(): Promise<AdminAccounts>;
  setAdmin(accountId: string, admin: boolean): Promise<void>;
  approve(email: string): Promise<{ emailed: boolean }>;
  deny(email: string): Promise<{ emailed: boolean }>;
  block(email: string): Promise<void>;
  unblock(email: string): Promise<void>;
};

export class AdminRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function playersAdminApi(baseUrl: string): PlayersAdminApi {
  const api = baseUrl.replace(/\/+$/, "");
  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${api}${path}`, { credentials: "same-origin", ...init,
      headers: init.body ? { "Content-Type": "application/json" } : {} });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: unknown };
      throw new AdminRequestError(response.status, typeof body.error === "string" ? body.error : "failed");
    }
    return response;
  }
  const post = (path: string, email: string) => send(path, { method: "POST", body: JSON.stringify({ email }) });
  return {
    load: async () => await (await send("/api/admin/accounts")).json() as AdminAccounts,
    setAdmin: async (id, admin) => { await send(`/api/admin/users/${encodeURIComponent(id)}/admin`, { method: admin ? "PUT" : "DELETE" }); },
    approve: async (email) => await (await post("/api/admin/signups/approve", email)).json() as { emailed: boolean },
    deny: async (email) => await (await post("/api/admin/signups/deny", email)).json() as { emailed: boolean },
    block: async (email) => { await post("/api/admin/blocked", email); },
    unblock: async (email) => { await send(`/api/admin/blocked/${encodeURIComponent(email)}`, { method: "DELETE" }); }
  };
}

const day = (time: number) => new Date(time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function reason(error: unknown): string {
  if (!(error instanceof AdminRequestError)) return "Check the service and try again.";
  if (error.code === "self") return "You can't do that to your own account.";
  if (error.code === "bootstrap-admin") return "That admin is set in the deployment (BENCHMARK_ADMIN_ACCOUNT_IDS) and can't be changed here.";
  if (error.code === "not-found") return "It has already changed. The list is refreshed.";
  return "Check the service and try again.";
}

/** /admin's Players section: new players waiting for approval, every account with its admin role, and blocked addresses. */
export function PlayersAdmin({ api, onDenied }: { api: PlayersAdminApi; onDenied?(status: 401 | 403): void }) {
  const [data, setData] = useState<AdminAccounts>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [blockEmail, setBlockEmail] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await api.load());
    } catch (failure) {
      if (failure instanceof AdminRequestError && (failure.status === 401 || failure.status === 403)) { onDenied?.(failure.status); return; }
      setError("Couldn't load the players. Check the service and try again.");
    }
  }, [api, onDenied]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function act(action: () => Promise<string | undefined>, failed: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const done = await action();
      if (done) setNotice(done);
    } catch (failure) {
      setError(`${failed} ${reason(failure)}`);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const mailed = (emailed: boolean, yes: string, no: string) => emailed ? yes : no;

  if (!data) return <section className="admin-section" aria-label="Players"><h2>Players</h2>
    {error ? <p className="error-message admin-message" role="alert">{error}</p> : <p className="quiet-copy" role="status">Loading players…</p>}
  </section>;

  return <section className="admin-section" aria-label="Players">
    <h2>Players</h2>
    <section aria-label="Waiting for approval">
      <h3>Waiting for approval{data.signups.length ? ` (${data.signups.length})` : ""}</h3>
      {data.signups.length === 0 ? <p className="quiet-copy">No one is waiting.</p> : <ul className="admin-rows">
        {data.signups.map((signup) => <li className="admin-row" key={signup.email}>
          <span><strong>{signup.displayName}</strong> <span className="quiet-copy">{signup.email} · asked {day(signup.requestedAt)}</span></span>
          <span className="admin-actions">
            <button className="primary-button" type="button" disabled={busy} aria-label={`Approve ${signup.email}`}
              onClick={() => { void act(async () => mailed((await api.approve(signup.email)).emailed, `Approved ${signup.email} and sent a sign-in link.`, `Approved ${signup.email}, but the email didn't go out. They can ask for a link again.`), `Couldn't approve ${signup.email}.`); }}>Approve</button>
            <button className="secondary-button" type="button" disabled={busy} aria-label={`Deny ${signup.email}`}
              onClick={() => { void act(async () => mailed((await api.deny(signup.email)).emailed, `Denied ${signup.email} and let them know.`, `Denied ${signup.email}, but the email didn't go out.`), `Couldn't deny ${signup.email}.`, `Deny ${signup.email}? They get an email saying their request was declined.`); }}>Deny</button>
            <button className="admin-remove" type="button" disabled={busy} aria-label={`Block ${signup.email}`}
              onClick={() => { void act(async () => { await api.block(signup.email); return `Blocked ${signup.email}.`; }, `Couldn't block ${signup.email}.`, `Block ${signup.email}? They get no email, now or later.`); }}>Block</button>
          </span>
        </li>)}
      </ul>}
    </section>
    <section aria-label="Accounts">
      <h3>Accounts ({data.users.length})</h3>
      <ul className="admin-rows">
        {data.users.map((user) => <li className="admin-row" key={user.id}>
          <span><strong>{user.displayName}</strong>{user.you ? " (you)" : ""} <span className="quiet-copy">{user.email} · joined {day(user.createdAt)}</span>
            {user.admin ? <span className="admin-badge">{user.bootstrapAdmin ? "Admin (deployment)" : "Admin"}</span> : null}
            {user.blocked ? <span className="admin-badge admin-playing">Blocked</span> : null}</span>
          <span className="admin-actions">
            {user.admin
              ? <button className="secondary-button" type="button" disabled={busy || user.you || user.bootstrapAdmin} aria-label={`Remove admin from ${user.email}`}
                title={user.bootstrapAdmin ? "Set in the deployment; change BENCHMARK_ADMIN_ACCOUNT_IDS to remove." : user.you ? "You can't remove your own admin rights." : undefined}
                onClick={() => { void act(async () => { await api.setAdmin(user.id, false); return `${user.displayName} is no longer an admin.`; }, `Couldn't change ${user.email}.`, `Remove admin rights from ${user.displayName}?`); }}>Remove admin</button>
              : <button className="secondary-button" type="button" disabled={busy || user.blocked} aria-label={`Make ${user.email} an admin`}
                onClick={() => { void act(async () => { await api.setAdmin(user.id, true); return `${user.displayName} is now an admin.`; }, `Couldn't change ${user.email}.`, `Make ${user.displayName} an admin? They can then manage players, tables and benchmarks.`); }}>Make admin</button>}
            {user.blocked || user.you || user.bootstrapAdmin ? null : <button className="admin-remove" type="button" disabled={busy} aria-label={`Block ${user.email}`}
              onClick={() => { void act(async () => { await api.block(user.email); return `Blocked ${user.email} and signed them out.`; }, `Couldn't block ${user.email}.`, `Block ${user.email}? They are signed out everywhere and can't sign in again.`); }}>Block</button>}
          </span>
        </li>)}
      </ul>
    </section>
    <section aria-label="Blocked addresses">
      <h3>Blocked addresses</h3>
      <form className="admin-row" aria-label="Block an address" onSubmit={(event) => {
        event.preventDefault();
        const email = blockEmail.trim().toLowerCase();
        if (!email) return;
        void act(async () => { await api.block(email); setBlockEmail(""); return `Blocked ${email}.`; }, `Couldn't block ${email}.`);
      }}>
        <input type="email" aria-label="Email to block" placeholder="name@example.com" value={blockEmail} onChange={(event) => setBlockEmail(event.target.value)} />
        <button className="admin-remove" type="submit" disabled={busy || !blockEmail.trim()}>Block</button>
      </form>
      {data.blocked.length === 0 ? <p className="quiet-copy">No addresses are blocked.</p> : <ul className="admin-rows">
        {data.blocked.map((entry) => <li className="admin-row" key={entry.email}>
          <span>{entry.email} <span className="quiet-copy">since {day(entry.blockedAt)}</span></span>
          <button className="secondary-button" type="button" disabled={busy} aria-label={`Unblock ${entry.email}`}
            onClick={() => { void act(async () => { await api.unblock(entry.email); return `Unblocked ${entry.email}.`; }, `Couldn't unblock ${entry.email}.`); }}>Unblock</button>
        </li>)}
      </ul>}
    </section>
    {error ? <p className="error-message admin-message" role="alert">{error}</p> : null}
    {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
  </section>;
}
