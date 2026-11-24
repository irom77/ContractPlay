# Email Magic-Link Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let online players register or sign in by email and carry their table identity and recent online hand history across devices.

**Architecture:** The Worker owns D1-backed accounts, one-time magic links, sessions, and online hand history. A mailer interface isolates delivery-provider configuration. Authenticated HTTP and WebSocket requests resolve to a stable account player ID, while the table Durable Object remains authoritative for live seats and uses a uniquely seated linked guest identity when needed to preserve an existing seat.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Durable Objects, Wrangler SQL migrations, React, Vitest, Web Crypto.

**Spec:** `docs/superpowers/specs/2026-11-14-email-magic-link-auth-design.md`

## Global Constraints

- Keep solo play and online guest play available without an account.
- D1 is authoritative for account and authentication records. Durable Objects remain authoritative for live table state; there is no cross-store transaction.
- Preserve the existing guest hello flow and player ID derivation. A linked guest keeps the player ID derived from its existing secret so current seats remain attached; new accounts receive a cryptographically random stable player ID. An account may have multiple linked player IDs.
- Keep raw magic-link tokens and session credentials out of D1; persist only cryptographic hashes. Use opaque, HttpOnly, Secure, SameSite=Lax session cookies scoped to the app origin.
- Return the same response for an email address whether or not it has an account. Rate-limit requests and token redemption, and expire unused tokens and sessions.
- Do not expose email addresses, secrets, token hashes, or session data in table views, lobby listings, or logs.
- Online imported history is an unverified personal archive and has no effect on table state or duplicate standings. Retain at most 25 recent online hands.
- Keep `packages/core` and other platform-neutral packages free of UI, browser, host, and database imports.
- Cloudflare Email Service is conditional on a paid plan and onboarded sending domain; otherwise configure a transactional email provider behind the mailer interface.

## Review Focus

- A known and unknown email receive indistinguishable magic-link request responses; pin in `apps/server/src/auth.test.ts`.
- An expired, used, or concurrently redeemed token cannot create a session; pin in `apps/server/src/auth.test.ts`.
- Malformed and oversized auth/history request bodies fail safely without partial account/history writes; pin in the owning server tests.
- When exactly one linked guest identity is seated it is reused; when multiple are seated the account is rejected with identity conflict; pin in `apps/server/src/table-object.test.ts`.
- Imported history is schema/size bounded, idempotent by hand ID, and capped at 25 without becoming competitive data; pin in `apps/server/src/hand-history.test.ts`.

---

## File Structure

- Create `apps/server/migrations/0001_auth.sql` for account, guest-identity link, magic-link, session, and online-hand tables and indexes.
- Create `apps/server/migrations/0002_auth_rate_limits.sql` for durable magic-link request and redemption throttles.
- Create focused server modules `apps/server/src/auth.ts`, `apps/server/src/auth-store.ts`, `apps/server/src/mailer.ts`, and `apps/server/src/hand-history.ts`; keep route dispatch in `apps/server/src/index.ts` and Worker bindings in `apps/server/src/env.d.ts` / `apps/server/wrangler.jsonc`.
- Modify `apps/server/src/table-object.ts` only at the WebSocket identity boundary; retain table transition and game rules in their current modules.
- Add client auth and history API modules under `apps/client/src/online/`, then update `Lobby.tsx`, `connection.ts`, and `OnlineTable.tsx` at the current name gate, socket setup, and completed-hand save points.
- Add focused server and client tests alongside the existing test files; update `README.md`, `TODO.md`, and `CHANGES.md` when the feature ships.

### Task 1: D1 schema, bindings, and account store

**Files:**
- Create: `apps/server/migrations/0001_auth.sql`
- Create: `apps/server/src/auth-store.ts`
- Modify: `apps/server/src/env.d.ts`
- Modify: `apps/server/wrangler.jsonc`
- Test: `apps/server/src/auth-store.test.ts`

**Interfaces:**
- Produces `AuthStore` operations for account lookup/create, guest identity linking, magic-link insertion/conditional consumption, session insertion/lookup/revocation, and bounded hand-history persistence. All SQL is parameterized and only token/session hashes are stored.

- [x] **Step 1: Write failing store tests** for unique normalized email, primary player ID creation, multiple linked guest player IDs, conditional unused/unexpired token consumption, session lookup/revocation, and idempotent hand upsert.
- [x] **Step 2: Run the server tests** with `pnpm --filter @contractplay/server test`; confirm the new store tests fail because the schema/store are absent.
- [x] **Step 3: Add the D1 migration and binding.** Define tables and indexes for accounts, account player identities, magic links, sessions, and online hands. Add `DB: D1Database` to `Env` and the D1 binding/migration directory to Wrangler configuration; keep production database identifiers as deployment configuration rather than inventing an ID.
- [x] **Step 4: Implement `AuthStore`** over prepared D1 statements. Use `DB.batch` for account/token/session transitions where atomicity is required; only treat a conditional token update affecting one row as successful.
- [x] **Step 5: Run `pnpm --filter @contractplay/server test`** and confirm the store cases pass.

### Task 2: Magic-link request, delivery, redemption, and session endpoints

**Files:**
- Create: `apps/server/src/auth.ts`
- Create: `apps/server/src/mailer.ts`
- Create: `apps/server/src/auth.test.ts`
- Create: `apps/server/migrations/0002_auth_rate_limits.sql`
- Modify: `apps/server/src/auth-store.ts` (durable throttling and pending-link activation)
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/env.d.ts`
- Modify: `apps/server/wrangler.jsonc`

**Interfaces:**
- `Mailer.sendMagicLink({ to: string, url: string }): Promise<void>` is the provider seam.
- `POST /api/auth/magic-link`, `GET /api/auth/callback?token=…`, `GET /api/auth/me`, and `POST /api/auth/sign-out` are same-origin routes. `GET /api/auth/me` returns only authenticated player ID and display name, never email or credential material.

- [x] **Step 1: Write failing endpoint tests** for email normalization, uniform success body/status for known and unknown addresses, optional guest-secret proof, same-origin callback URL, invalid/expired/replayed token rejection, session cookie flags/expiry, `/me`, and sign-out revocation.
- [x] **Step 2: Run `pnpm --filter @contractplay/server test`** and confirm these route tests fail.
- [x] **Step 3: Implement token and session lifecycle** using Web Crypto random values and SHA-256 hashes, a 15-minute link lifetime, and a 30-day non-sliding session lifetime. Enforce bounded bodies and conservative per-address/IP request and redemption throttles with generic outward responses.
- [x] **Step 4: Implement the mailer adapter.** Support Cloudflare Email Service when its binding and sender prerequisites are configured; otherwise use a configured provider adapter and secret. A send failure must not expose account existence and must leave only a short-lived unusable request record.
- [x] **Step 5: Add the four routes to `index.ts`** with origin validation on callback and cookie-auth routes; set and clear an opaque HttpOnly, Secure, SameSite=Lax app-origin cookie (allow non-Secure only for localhost development).
- [x] **Step 6: Run `pnpm --filter @contractplay/server test`** and confirm endpoint/security cases pass.

### Task 3: Client sign-in and guest upgrade

**Files:**
- Create: `apps/client/src/online/auth.ts`
- Create: `apps/client/src/online/Auth.test.tsx`
- Modify: `apps/client/src/online/Lobby.tsx`
- Modify: `apps/client/src/online/identity.ts`
- Modify: `apps/client/src/online/identity.test.ts`

**Interfaces:**
- `requestMagicLink(email: string, guestSecret?: string): Promise<void>`, `currentAccount(): Promise<AccountSession | null>`, and `signOut(): Promise<void>` use same-origin credentials and expose no raw session credential to JavaScript.
- Guest mode remains the default-compatible path and keeps the existing local identity format.

- [x] **Step 1: Write failing client tests** for choosing guest or email sign-in at the online name gate, sending the current guest secret when upgrading, showing a generic check-email state, handling callback completion/session restoration, and signing out back to guest mode.
- [x] **Step 2: Run the root test suite** with `pnpm test`; confirm only the new auth UI/client tests fail.
- [x] **Step 3: Implement the auth API module and lobby flow.** Keep email out of URL state and local storage; do not replace or delete the guest secret during the pending link flow.
- [x] **Step 4: Restore and display the authenticated player state** from `/api/auth/me`, then allow a signed-in player to sign out without revoking other sessions.
- [x] **Step 5: Run `pnpm test`** and confirm the client auth tests pass.

### Task 4: Authenticated WebSocket identity and seat continuity

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/table-object.ts`
- Modify: `apps/server/src/table-object.test.ts`
- Modify: `apps/client/src/online/connection.ts`
- Modify: `apps/client/src/online/connection.test.ts`

**Implementation notes:** Shared protocol version 7 supports account hello with a captured `expectedPlayerId`, checked against the session identity at every upgrade/reconnect, and terminal `identity-conflict` / `account-changed`; dedicated `table-object.test.ts` covers the Worker-to-table identity boundary. The connection accepts either a guest `Identity` or restored `AccountSession`; OnlineTable account restoration/conflict messaging is handed off to its next integration task.

**Interfaces:**
- Authenticated WebSocket requests are resolved by the Worker from the session cookie and forwarded internally with a verified account identity; clients cannot supply account IDs as authority.
- The table object accepts either the existing guest hello or a verified internal account identity and resolves to the uniquely seated linked player ID when present. Authenticated hello must include the captured primary player ID as a mismatch guard; changed or absent sessions and missing/mismatched expectations produce terminal `account-changed` before seat access.

- [x] **Step 1: Write failing table identity tests** for new account identity, one linked seated guest identity, no linked identity seated, and multiple linked identities seated (explicit identity conflict without taking control of either seat).
- [x] **Step 2: Write failing connection tests** confirming guest hello remains unchanged and authenticated sockets omit the guest secret while using same-origin cookies.
- [x] **Step 3: Run `pnpm --filter @contractplay/server test`** and the client tests through `pnpm test`; confirm the new cases fail.
- [x] **Step 4: Resolve sessions before WebSocket forwarding** and pass a signed/verified internal identity to the table object. Ensure the internal identity cannot be forged by a public request header or query parameter.
- [x] **Step 5: Implement table identity resolution** with a D1 lookup for linked identities and existing table seat state; return a clear protocol-level conflict response if more than one linked ID is seated. Preserve guest-secret hashing and reconnect semantics.
- [x] **Step 6: Run `pnpm test`** and confirm both guest and account reconnect/seat cases pass.

### Task 5: Account-owned online hand history

**Files:**
- Create: `apps/server/src/hand-history.ts`
- Create: `apps/server/src/hand-history.test.ts`
- Create: `apps/client/src/online/handHistory.ts`
- Create: `apps/client/src/online/handHistory.test.ts`
- Modify: `apps/client/src/online/OnlineTable.tsx`
- Modify: `apps/client/src/online/Lobby.tsx`

**Interfaces:**
- `GET /api/account/online-hands`, `POST /api/account/online-hands/import`, and `PUT /api/account/online-hands/:handId` derive account ownership exclusively from the session.
- Every history request carries the captured account's `X-Expected-Player-ID`; the Worker rejects a missing or mismatched value with `409 account-changed` before reading or writing archives. This detects cookies changed by another tab and never authorizes an account.
- Client history sync merges canonical remote hands with the local 25 most recent online hands by stable hand ID; imported records are marked as user-imported and are never submitted as competitive results. Solo history, guest online history, and each account online cache have independent 25-hand limits. Switching accounts preserves other-owner cached uploads without importing them. Recent Hands sorts newest-first and shows one entry per stable hand ID while retaining account-specific retry copies.

- [x] **Step 1: Write failing server tests** for unauthenticated rejection, caller-supplied account ID ignored, schema/serialized-size limits, duplicate hand ID idempotency, imported archive marking, and 25-record retention.
- [x] **Step 2: Write failing client tests** for initial guest history import after account link and merge of remote history on another device without duplicating local records.
- [x] **Step 3: Run `pnpm test`** and confirm the history tests fail.
- [x] **Step 4: Implement account-scoped history routes and validation.** Reuse existing saved-hand validation where applicable; bound payload size, preserve provenance, and prune to the newest 25 records.
- [x] **Step 5: Sync at account link, completed online hand save, and Recent Hands load.** Leave solo history and settings in local storage.
- [x] **Step 6: Run `pnpm test`** and confirm history import, idempotence, retention, and merge behavior pass.

### Task 6: Deployment configuration, docs, and release verification

**Files:**
- Modify: `apps/server/wrangler.jsonc`
- Modify: `apps/server/src/env.d.ts`
- Modify: `README.md`
- Modify: `TODO.md`
- Modify: `CHANGES.md`
- Modify: `docs/platform-delivery.md` only if it owns current Worker deployment instructions

**Interfaces:**
- Document required D1 database creation/migration commands using the checked-in Wrangler configuration, public origin, sender configuration, and secret setup. Never put secret values in tracked files.

- [x] **Step 1: Add deployment instructions** for creating/binding D1, applying local and remote migrations, configuring the public origin and mail sender, and setting any provider secrets. Clearly call out Cloudflare Email Service paid-plan/onboarded-domain prerequisites and the fallback provider contract.
- [x] **Step 2: Update user-facing docs and roadmap.** Describe guest and account sign-in accurately, mark sign-in complete only after release-ready behavior is verified, and add the shipped behavior to `CHANGES.md`.
- [x] **Step 3: Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`.** Resolve failures; do not deploy until all configured checks pass.
- [x] **Step 4: Run `pnpm web:verify`** to verify the production web build and generated assets.
- [x] **Step 5: Review the final diff** for raw secrets, account-enumerating responses, public account-ID trust, and changes to platform-neutral packages; then follow repository release instructions for commit and deployment. **Session override:** commit the verified work only; do not push or deploy. Production setup and live verification remain open in `TODO.md`.

## Implementation and release handoff

Tasks 1–5 are implemented and verified with focused tests. Task 5 also required shared saved-hand validation/cache metadata in `packages/persistence`, server route/dependency registration, an App Recent Hands sync hook, and explicit guest context in previews. No platform dependencies were added to the shared packages. All browser history uploads are user-imported and noncompetitive; canonical archives win on duplicate IDs. Deleting history currently clears only browser cache because the specified API has no DELETE endpoint or tombstones.

Task 6 completed configuration documentation and the final workspace checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (1,755 workspace/client + 76 server tests), and `pnpm web:verify` all passed on 2026-11-14. The final diff review found no raw credentials, account-enumerating response changes, public account-ID authority, or new platform imports in shared packages. Production D1 creation/binding/migrations, sender/provider setup, live email delivery, and deployment are separate owner steps in `docs/platform-delivery.md`; no deploy or push is performed in this implementation session. The existing `DB` binding is preserved without an invented production ID. Solo table screenshots are unchanged because this feature changes account/lobby behavior rather than the depicted table states.

The separate `/admin` authorization roadmap item remains a release-readiness issue and must be addressed before presenting the service as production-ready. Authorization and invitations remain open.

## Follow-up: account-gated lobby

The product owner changed lobby access after reviewing the deployed screen: visitors without a restored account session should see only email sign-in, not open tables or lobby actions. Keep direct table-link guest play and solo play available. The Lobby waits for `/api/auth/me`, does not mount `LobbyTables` or fetch listings while signed out, and removes the lobby back action from the unauthenticated email gate. The lobby preview uses a fixed mock account and no history network call. Focused coverage verifies signed-out users cannot see tables or lobby shortcuts and the table API is not called.

After live magic-link sign-in was verified, the product owner noticed that the bare production URL still opened a saved solo hand after sign-out. On the online deployment, the bare URL now opens the account-gated lobby; signed-in players can still enter solo play from its lobby control. The solo route is explicit (`#/solo`) so navigation to Solo play remains stable.
