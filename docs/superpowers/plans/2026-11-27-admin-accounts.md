# Admin accounts, block list, and sign-up approval

**Goal:** keep ContractPlay to people the owner knows for now. Admins reach `/admin` from the lobby, manage who is an
admin, block email addresses, and approve or deny new players before any sign-in link is sent to them.

## Decisions

- **Admins.** An account is an admin when its ID is in the `BENCHMARK_ADMIN_ACCOUNT_IDS` Worker secret (bootstrap
  admins, not removable from the page) or in the new `account_admins` table (granted on `/admin`). One check,
  `adminAccess`, replaces `benchmarkAdminAccess` and guards every `/api/admin/*` route, including the legacy
  online-table removal API, which was open before. An admin cannot remove their own admin rights or block their own
  address, so the page cannot lock its last user out.
- **`/api/auth/me`** also answers `admin: true|false`. The lobby's top row shows an **Admin** link to `/admin` for admins.
- **Sign-up approval** is on unless the Worker var `AUTH_SIGNUP_APPROVAL` is `off`. A sign-in request for an address
  with no account and no approval is stored in `signup_requests` and no mail is sent. Existing accounts are unaffected.
  The answer stays the same for every address (no account probing): "If the address can receive mail, a sign-in link
  is on its way. New players get theirs once an admin approves them."
- **Approve** marks the request approved and emails a fresh magic link (usual 15-minute lifetime). Later requests from
  an approved address get links straight away, so an expired link is fixed by asking again.
- **No guest seat on approval.** A queued request keeps its first name and stores no guest identity, since anyone can
  ask in a stranger's name; the approval link signs in without linking a guest seat. A newcomer's guest seat links the
  next time they ask for a link from their own device.
- **Same timing for every address.** After the address and rate-limit checks, the block, approval and mail work runs in
  `ctx.waitUntil`, so the answer returns before anything that differs by address.
- **Deny** removes the request and emails a short "your request was declined" note. Asking again puts the address back
  in the queue (per-address rate limits still apply); **Block** is the permanent answer.
- **Block** adds the address to `blocked_emails`, drops its pending request, and revokes the sessions of its account if
  it has one. Blocked addresses get no mail, and their outstanding links stop working. Unblock removes the entry.

## API (all admin-only, same-origin)

- `GET /api/admin/accounts` → `{ users, signups, blocked }`
- `PUT|DELETE /api/admin/users/{accountId}/admin` → grant or revoke admin
- `POST /api/admin/signups/approve|deny` `{ email }`
- `POST /api/admin/blocked` `{ email }`, `DELETE /api/admin/blocked/{email}`

## Steps

1. Migration `0007_admin_accounts.sql`: `account_admins`, `blocked_emails`, `signup_requests`.
2. Server: `AuthStore` methods, `adminAccess`, gate in `requestMagicLink` and `redeem`, `admin` in `/api/auth/me`,
   `admin-routes.ts`, denial mail in `mailer.ts`, guard `/api/admin/tables`. Tests in `auth.test.ts` and
   `admin-routes.test.ts`.
3. Client: `admin` on `AccountSession`; lobby Admin link; `/admin` gets a Players section (pending requests with
   Approve/Deny/Block, accounts with admin toggles, block list); sign-in confirmation copy. Tests and the benchmark-lobby
   preview (seen as an admin) show the Admin link.
4. Docs: README, TODO, CHANGES, `docs/platform-delivery.md` (apply migration 0007 before deploying).
