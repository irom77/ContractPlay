# Email magic-link sign-in design

## Intent

Let online players register or sign in with an email address so their online seat identity and recent hand history can follow them between browsers and devices. Keep solo play and online guest play available without an account.

## Goals

- Add email registration and sign-in using short-lived, single-use magic links.
- Back accounts, link tokens, sessions, and account-owned hand records with Cloudflare D1.
- Let an existing guest link their current device identity to an account without losing a seat at an active table, including when the email already has an account.
- Let an account sign in on another device and reclaim its existing online seat through the current reconnect behavior.
- Keep current guest access working, including its existing device-secret behavior.
- Store online completed hands centrally for signed-in players, and import the current browser's online hand history when a guest registers or signs in.
- Keep `packages/core` and other platform-neutral packages free of UI, browser, host, and database imports.

## Non-goals

- Password authentication, social login, email verification for non-authentication purposes, or account profile settings beyond display name.
- Making an account mandatory for solo play or online tables.
- Syncing unfinished games, solo settings, imported board sets, or solo completed hands in the first release. Solo data remains in browser storage; only online hand history is account-owned.
- Full authorization roles, table invitations, or protecting the existing `/admin` API. These remain separate roadmap work and must be addressed before public production use.
- Merging two existing accounts or recovering a guest identity after its device secret is lost.

## Constraints

- Use the existing Cloudflare Worker, table Durable Objects, and same-origin browser deployment.
- Add a D1 database binding and checked-in SQL migrations under `apps/server/migrations/`.
- D1 is authoritative for account and authentication records. Durable Objects remain authoritative for live table state; there is no cross-store transaction.
- Preserve the existing guest hello flow and player ID derivation. A linked guest keeps the player ID derived from its existing secret so current seats remain attached; new accounts receive a cryptographically random stable player ID. An account may have multiple linked player IDs.
- Keep raw magic-link tokens and session credentials out of D1; persist only cryptographic hashes. Use opaque, HttpOnly, Secure, SameSite=Lax session cookies scoped to the app origin.
- Return the same response for an email address whether or not it has an account. Rate-limit requests and token redemption, and expire unused tokens and sessions.
- Do not expose email addresses, secrets, token hashes, or session data in table views, lobby listings, or logs.
- Cloudflare Email Service is currently Beta and general recipient delivery requires Workers Paid plus an onboarded sending domain. Keep delivery behind a mailer interface; choose Cloudflare Email Service when deployment has those prerequisites, otherwise use a configured transactional email provider.

## Approaches

1. **Magic-link accounts in D1 (selected).** Use one-time email links, D1-backed accounts/sessions/history, and the existing table Durable Objects. This matches the requested sign-in method and existing deployment while avoiding password storage.
2. **Hosted identity provider.** Delegate verification, recovery, and account lifecycle to a provider. This reduces authentication code but adds an external identity dependency and does not remove the need to map provider identities to table seats and hand history.
3. **Password accounts in D1.** Keep the full flow in the app but add password hashing, reset, and credential-abuse handling. This was not selected because email links avoid password management and are the requested experience.

## Proposed behavior

### Lobby access policy update (2026-11-14)

- An online lobby visitor must have a restored email account session before table listings, creation controls, recent online hands, or lobby shortcuts are shown. While session lookup is pending, show only the ContractPlay brand; on a missing/failed session, show the email link form without a route back to the lobby.
- This gate applies to lobby browsing. Existing guest identity support remains for direct table links, and solo play remains account-free.
- Do not request the public table list until authentication succeeds. After sign-out, return to the email gate.

### Guest upgrade and sign-in

- The online name gate offers guest continuation and email sign-in/register.
- A guest who starts registration or signs in proves the current guest identity by submitting its device secret with the email request. After consuming the emailed link, the server links that identity to the account. This requires proof of both the email and guest secret; it can add an identity to an existing account without merging D1 accounts.
- The table Durable Object maps an authenticated account to the linked player ID already seated at that table, if exactly one is seated there; otherwise it uses the account's primary player ID. That keeps existing seats intact while allowing new tables to use one stable account identity. If more than one linked identity for the account is already seated at the same table, the connection must fail with a clear identity-conflict response rather than silently gaining control of multiple seats.
- Signing in on a device without a guest secret uses the account's stored primary player ID. If the account has no linked guest identity, registration creates a cryptographically random stable player ID.
- A signed-in player may sign out on the current device; signing out clears its cookie and revokes that D1 session. Other sessions are left intact in this release.
- Display name remains a per-player identity field. A signed-in user can carry the current device's name into the account on first link; account name editing is not part of this design.

### Magic-link lifecycle

- `POST /api/auth/magic-link` accepts a normalized email and optional guest secret. It returns a generic success response, creates a random token, stores only its hash with a short expiry and unused state, and asks the mailer to send a same-origin callback URL.
- The callback consumes a token once and atomically creates or retrieves the account and creates a hashed, expiring session. An invalid, expired, or already-used token cannot establish a session.
- Successful redemption sets the session cookie and redirects to the online lobby. The client can check the current session through an authenticated endpoint.
- The initial design uses a 15-minute link expiry and 30-day session expiry; sessions are revocable and are not extended indefinitely by activity.
- Email normalization trims surrounding whitespace and lowercases the address before uniqueness checks. Do not silently merge distinct accounts.

### Table identity and account data

- Same-origin WebSocket upgrades carry the session cookie. The Worker resolves it through D1 before forwarding verified account identity to the table Durable Object, which selects the linked seated player ID or primary player ID for the existing reducer. Public identity headers are stripped, and the session cookie is not forwarded. The guest-secret hello remains accepted for unsigned users.
- Authenticated online hand records are written to D1 when a hand completes and listed through an account-scoped API. The existing 25-hand limit remains the retention limit.
- On initial account linking, the browser uploads its saved online hands. The server validates their schema and size, then treats them as a user-imported archive: their original play cannot be independently verified and they do not affect table state or duplicate standings. It merges by stable hand ID, keeps the most recent 25, and returns the canonical account history. Later devices fetch that list and merge it into their existing local Recent Hands display.
- The server must make history writes idempotent so reconnects or repeated completion views do not duplicate a hand.
- All browser uploads, including completion uploads, are marked user-imported and noncompetitive. Existing canonical account records win over retries/imports with the same ID. History deletion currently removes only the browser cache; there is no server DELETE endpoint or tombstone, so syncing restores archived hands.

## Security and failure behavior

- Generate token and session values with `crypto.getRandomValues`; hash them with SHA-256 before persistence. Use parameterized SQL for all values.
- Use conditional token consumption plus D1 batch semantics to ensure a one-time token cannot create multiple sessions. A zero-row consume must fail without creating a session.
- Avoid account enumeration with identical status and response text for known and unknown emails. Rate-limit by normalized email and network address; bound request body sizes.
- A failed mail send leaves only an expiring, unusable request record; permit a retry after a cooldown and clean expired rows opportunistically.
- Account-specific history APIs require a valid session and never accept a caller-supplied account ID as authority.
- Cookie auth and email links require the production app to use HTTPS and a configured public origin. Local development may use an explicit non-secure cookie setting only on localhost.
- D1 creation, migration application, and email sending configuration are deployment prerequisites. The public `workers.dev` deployment may need a configured sender domain or a third-party mail provider before arbitrary users can receive links.

## Implementation choices and deployment follow-up

- The mailer supports Cloudflare's `EMAIL` binding or the Resend HTTPS adapter, with Cloudflare taking precedence and no automatic failure fallback. The deployment owner must choose an eligible provider and approved sender; neither a production sender nor D1 database ID is invented by implementation.
- Durable request limits are 10 per IP per hour and 3 per normalized email per hour, with a one-minute email cooldown. Redemption limits are 30 per IP and 10 per email in a 15-minute window. Responses remain generic when throttled.
- Add authorization for `/admin` as a separate follow-up before treating the service as production ready; account sign-in alone does not protect it.

## Source notes

- Cloudflare D1 setup, migrations, batch atomicity, Email Service requirements, Worker secrets, and Durable Object storage boundaries are summarized with official citations in [`docs/research/2026-11-14-cloudflare-magic-link-auth.md`](../../research/2026-11-14-cloudflare-magic-link-auth.md).
- Existing guest identity is in `apps/client/src/online/identity.ts`; table player IDs are SHA-256 hashes of the device secret in `apps/server/src/table-object.ts`; online history currently uses the shared local `SoloData.completedHands` list.
