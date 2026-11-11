# Online Admin Design

## Intent

Provide a development-phase `/admin` page for managing online tables. The owner can see all live tables, including unlisted tables, and remove a table that should no longer exist. Keep the server API boundary suitable for adding RBAC later.

## Goals

- Make the page available at `/admin` on the Cloudflare-hosted web app.
- Show each table's name, ID, listed/unlisted state, current play state, and seats.
- Allow removal of an individual table after a confirmation step; removal disconnects its clients and removes both its lobby entry and Durable Object state.
- Make errors and empty/loading states clear.

## Non-goals

- No login, token, authorization, or RBAC in this development-phase version, per the user's choice.
- No global settings editor yet; keep the page organized so a settings section can be added later.
- Do not expose private hands or other game state beyond the existing table summary.

## Approaches

1. **Open `/admin` with dedicated admin API routes (chosen).** Simple for the current development phase. Keep mutations behind explicit `/api/admin/...` routes and isolate the table deletion operation so RBAC can protect these routes later.
2. **Shared admin token.** Protects mutations now but requires secret configuration and a token-entry flow the user does not want during this phase.
3. **Cloudflare Access.** Provides identity-based protection, but requires additional Cloudflare Access setup and is deferred until RBAC work.

## Design

- Detect `/admin` by pathname in the client root and render a standalone admin page; keep existing hash-based solo and online-table routing unchanged.
- Add a dedicated admin API to list every table summary (listed and unlisted) and delete a validated table ID. Admin summaries include a `listed` flag; the existing `TableSummary` remains unchanged for the public lobby.
- Route deletion through the table Durable Object so connected sockets are closed and stored state and alarms are cleared consistently with table expiry; remove the lobby row as part of the operation.
- Keep the admin API under its own route prefix, without authorization for now. Later RBAC can guard this boundary without changing table lifecycle behavior.
- Admin lists only summaries, not hands or player secrets.

## Constraints and security posture

The unauthenticated `/admin` page and API are intentionally development-only. Do not describe them as production-secure. Add RBAC before treating the deployment as a public production service.

## Open to implementation

Use the existing React/Vite client, Worker routes, Durable Objects, shared `TableSummary`, styles, and workspace scripts. Add focused server and client tests for list visibility, deletion lifecycle, and page behavior. Record the user-facing capability in `CHANGES.md` and update the online multiplayer roadmap in `TODO.md` if its status changes.
