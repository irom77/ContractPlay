# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The Cloudflare deployment serves the web app and online tables together at https://contractplay.niuk.workers.dev; the old GitHub Pages copy is no longer updated. Email sign-in, linked seat recovery, account-gated lobby browsing, and personal online hand archives are implemented. Bot benchmark engine, protected benchmark operations, public leaderboard, generated-deal replay, and isolated play against a selected benchmark profile are implemented in code; continuous-run verification, and initial calibration review remain before release. The production site now opens on the account-gated lobby; verify sign-in, real online play, and archive sync on the deployment, then move to `bridge.romaniuk.us`; permissions and invitations remain open.

## Hand records and replays

Solo PBN board sets against the field shipped on 2026-11-13 (see [TODO-archive.md](TODO-archive.md)). Research: `docs/research/2026-11-13-hand-record-archives.md`; plan: `docs/superpowers/plans/2026-11-13-pbn-board-sets-vs-field.md`. Code: `packages/core/src/field.ts` (comparison), `packages/pbn/src/pbn.ts` (`ScoreTable`, inheritance, `pbnBoardToRecord`), `packages/persistence` (`BoardSet`, `HandRecord`), `apps/client/src/boardSet.ts`, `apps/client/src/table/FieldResult.tsx`, and the board-set flow in `apps/client/src/App.tsx`.


## Bots

- [x] Named bots: players' own saved characters that play differently (`docs/superpowers/specs/2026-11-25-bot-traits-design.md`). Parts 1–3 are done: six trait dials with the old aggressiveness presets preserved; own characters in solo with an editor, results and account sync (migration 0005); and own characters at online tables, with owner-only result attribution.
- [ ] Release continuous bot benchmarks: `0006_bot_benchmarks.sql` was applied and `BENCHMARK_ADMIN_ACCOUNT_IDS` configured in production on 2026-11-26, and the Worker/DO scheduler is deployed. Verified on production on 2026-11-26: the scheduler queues rounds on its own one at a time (round 1 at 16:25, round 2 at 16:55 UTC), the benchmark admin API refuses signed-out requests (401) and signed-in accounts outside the allowlist (403), generated boards have public replays, and an imported PBN job (test profiles, retired afterwards) kept its tables unlisted and unwatchable, published scores only (`private-import`, no replay, no cards in any public endpoint) and showed deal and play to the admin only. Remaining: review rating calibration after at least one full 12-round rotation. Task implementation and local tests are in `docs/superpowers/plans/2026-11-25-bot-benchmark-leaderboards.md`; live operation is not yet verified.

## Table

- [ ] Add a Fanned/Line setting for how hands are spread. Both layouts are implemented: `TableView`'s `handLayout` prop (default `"fan"`, from `apps/client/src/table/handLayout.ts`) sets a `hand-layout-*` class, the fan rules in `styles.css` are scoped under `.hand-layout-fan`, and the line rules are the unscoped base. Remaining: a remembered setting in solo Settings and the online table menu, passed to every `TableView`.

## Online multiplayer

- [ ] Let external bots play ContractPlay through a documented API and/or MCP server. Start with a protocol-neutral, authenticated bot identity and explicit table/seat permissions; expose table discovery or creation, joining a seat, receiving only that seat's legal view, submitting validated calls/cards/claims, and observing table updates. Keep action validation and hidden-hand rules in the server/core boundary, with rate limits, disconnect/reconnect behavior, and clear ownership of bot credentials. Define whether MCP wraps the same API or is a separate adapter, then ship a minimal end-to-end bot example and integration guidance.
- [ ] Add a player feedback form for feature requests, improvements, and other suggestions, and collect and display star ratings.
- [ ] Repeat the two-window check on the deployed address and confirm the Workers free-plan CPU limit holds for bot decisions (if not, the paid Workers plan is the owner's decision).
- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer. A CNAME at Squarespace will not work; a Workers custom domain needs the zone on Cloudflare. Steps for the owner: add `romaniuk.us` to Cloudflare (Free plan) and check the imported records, especially email (MX, TXT); switch the name servers in Squarespace Domains to the two Cloudflare gives (registration stays at Squarespace); once active, add `bridge.romaniuk.us` under Workers & Pages → `contractplay` → Settings → Domains & Routes → Custom domain. Then record the custom domain in `apps/server` wrangler configuration so deploys keep it.
- [ ] Verify cross-device seat recovery and archive sync. Live email delivery and sign-in have been confirmed. Follow [the deployment runbook](docs/platform-delivery.md#email-sign-in-prerequisites).
- [ ] Verify a deal replay live. Migration 0003 was applied to production on 2026-11-24 (`GET /api/deals/replay` answers 204 while the archive is empty). Finish online hands, or solo hands against bots; at least a day later, check that an even-numbered hand in the same mode shows the "Replayed deal" notice and, when it ends, the comparison.
- [ ] Add permissions (authorization) beyond the current host and seated-player rules.
- [ ] Protect the legacy online-table removal panel at `/admin` and `/api/admin/tables` with authorization before public production use; email sign-in does not restrict that separate surface. Benchmark operations under `/admin` use the benchmark session allowlist.
- [ ] Add invitations to a table.
- [ ] Add basic optional voice and video chat for players at a table.

## Production readiness

- [ ] Add abuse controls for online tables beyond the per-address limits (for example reporting, blocking, rate limits on table actions, and name moderation).
- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
- [ ] Harden POST /api/deals/results against D1 write abuse (global daily cap on new solo deals, IPv6 /64 rate key, or a lower limit).
