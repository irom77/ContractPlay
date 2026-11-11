# Online Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an open development-phase `/admin` page that lists all online tables and can remove a table completely.

**Architecture:** Add dedicated `/api/admin/tables` and `/api/admin/tables/:id` routes in the Worker. The lobby supplies all stored table summaries, while a table Durable Object performs full deletion, closing sockets and clearing alarms and state. The React root checks the pathname for `/admin` before its existing hash routing.

**Tech Stack:** React, TypeScript, Cloudflare Workers and Durable Objects, Vite, existing `TableSummary` API.

**Spec:** `docs/superpowers/specs/2026-11-11-online-admin-design.md`

## Global Constraints

- Keep `packages/core` platform-neutral.
- Keep the admin page and API unauthenticated only for the current development phase; keep admin API routes isolated for future RBAC.
- Return summaries only; do not expose hands or player secrets.
- Keep existing solo and online hash routes unchanged.
- Update `CHANGES.md` for the user-facing feature.

## Review Focus

- Unlisted tables must be visible to admins while remaining absent from the public lobby.
- Invalid or absent table IDs must not delete another table.
- Deleting a live table must close connected clients and clear Durable Object state and its alarm.
- API failures and an empty table list must not appear as a successful deletion or a broken page.
- Direct navigation to `/admin` must work without changing normal hash routes.

### Task 1: Admin table APIs and deletion lifecycle

**Files:**
- Modify: `apps/server/src/lobby-object.ts`
- Modify: `apps/server/src/table-object.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- `LobbyObject.listAll(): Promise<(TableSummary & { listed: boolean })[]>` returns summaries from both `listed:` and `unlisted:` storage entries, with a visibility flag.
- `DELETE https://table/_admin/delete` on the table Durable Object closes open sockets, clears the alarm and storage, and returns 204 if a table existed or 404 otherwise.
- `GET /api/admin/tables` returns `{ tables: TableSummary[] }`.
- `DELETE /api/admin/tables/:id` returns 204 when removed, 404 for a valid but missing ID, 400 for an invalid ID, and 405 for other methods.

- [x] Add `listAll()` and cover both lobby prefixes while leaving the existing public `list()` behavior unchanged.
- [x] Add an explicit Durable Object deletion method that closes sockets and uses the existing lobby-first expiry cleanup.
- [x] Add the admin API routes, validate table IDs with the existing ID rules, and invoke deletion through the corresponding table stub.
- [x] Run `pnpm --filter @contractplay/server typecheck`.

### Task 2: `/admin` page

**Files:**
- Create: `apps/client/src/admin/Admin.tsx`
- Modify: `apps/client/src/Root.tsx`
- Modify: `apps/client/src/styles.css`

**Interfaces:**
- `Admin({ baseUrl }: { baseUrl: string })` fetches the admin table list and renders refresh, table status/seats, and confirmed removal controls.
- The client uses `GET /api/admin/tables` and `DELETE /api/admin/tables/:id` on `baseUrl`.

- [x] Render `Admin` on exact pathname `/admin` when online service configuration is available; preserve all existing route behavior elsewhere.
- [x] Show all fields from the design, clear loading/empty/error states, and ask for confirmation before deletion.
- [x] Add responsive styling consistent with the existing green table/lobby presentation.
- [x] Run the client typecheck/build command defined by its package scripts.

### Task 3: Documentation and integrated verification

**Files:**
- Modify: `CHANGES.md`
- Modify: `TODO.md` only if roadmap status changes.
- Modify: this plan to mark completed steps.

- [x] Document the development-phase admin table management feature and its open access posture.
- [x] Confirm roadmap status and update it for the new admin capability.
- [x] Run `pnpm web:verify`, `pnpm lint`, and inspect `git diff --check`.
