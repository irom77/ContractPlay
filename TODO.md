# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls, and the bidding box shows what a call means before you confirm it. The Cloudflare deployment serves the web app and online tables together at https://contractplay.niuk.workers.dev; the old GitHub Pages copy is no longer updated. Email sign-in, linked seat recovery, account-gated lobby browsing, and personal online hand archives are implemented. Bot benchmark engine, protected benchmark operations, public leaderboard, generated-deal replay, and isolated play against a selected benchmark profile are released: continuous runs are verified on production and the first calibration review is done (2026-11-27). The production site now opens on the account-gated lobby; verify sign-in, real online play, and archive sync on the deployment, then move to `bridge.romaniuk.us`; permissions and invitations remain open.

## Hand records and replays

Solo PBN board sets against the field shipped on 2026-11-13 (see [TODO-archive.md](TODO-archive.md)). Research: `docs/research/2026-11-13-hand-record-archives.md`; plan: `docs/superpowers/plans/2026-11-13-pbn-board-sets-vs-field.md`. Code: `packages/core/src/field.ts` (comparison), `packages/pbn/src/pbn.ts` (`ScoreTable`, inheritance, `pbnBoardToRecord`), `packages/persistence` (`BoardSet`, `HandRecord`), `apps/client/src/boardSet.ts`, `apps/client/src/table/FieldResult.tsx`, and the board-set flow in `apps/client/src/App.tsx`.


## Bots

- [x] Named bots: players' own saved characters that play differently (`docs/superpowers/specs/2026-11-25-bot-traits-design.md`). Parts 1–3 are done: six trait dials with the old aggressiveness presets preserved; own characters in solo with an editor, results and account sync (migration 0005); and own characters at online tables, with owner-only result attribution.
- [ ] Double-dummy card play for bots (Monte Carlo, GIB-style). The bots must not see hidden hands, so the bot deals 20–50 layouts of the unseen cards that fit what it knows (own hand, dummy, cards played, shown-out voids, auction inferences), scores each legal card with `bridge-dds` `SolveBoardPBN`, and plays the best average (tricks, or chance to make/beat the contract). Keep rule-based bidding and opening leads. Needs: `PlayContext` to carry tricks with seats and the auction (`played` is a flat card list today); the solver injected through the core `Solver` interface so `packages/bots` stays platform-neutral (`bridge-dds` is a client-only dependency); solving in a Web Worker with a time budget and a fallback to the rule-based card. Start opt-in (a setting or a level above Expert) for solo only; online bots run in `packages/table` on the Worker, so they wait on the free-plan CPU limit and WASM bundling there.
- [ ] BEN neural-network engine for solo custom bots, opt-in through a "Bot engine" setting (plan: [`docs/superpowers/plans/2026-11-27-ben-bot-engine.md`](docs/superpowers/plans/2026-11-27-ben-bot-engine.md)). BEN (`lorserker/ben`, GPL-3.0) runs unmodified as a separate HTTP service. The Worker proxies `/api/bots/ben/*` for signed-in accounts (secrets `BEN_API_URL`, `BEN_API_KEY`), and the rule bot takes over whenever BEN is slow, down, or answers an illegal call or card. Follow-ups: BEN at online tables, a BEN benchmark profile, and BEN's call explanations. WBridge5 (closed-source, Windows-only, needs the author's permission) and GIB (proprietary to BBO) were ruled out on 2026-11-27.
- [ ] Decide whether to version the benchmark score transform for close cohorts. Live session margins are about a third of the calibration fixture's (75th percentile 2.4 against 5 cross-IMPs a board), so `cross-imp-per-board-10.5-v1` compresses the rating spread and deviations shrink slowly. Refitting to the live cohort would give a scale of 5.0, but it needs a new transform version, and old ratings would not compare with new ones. Also run a 2/1 cohort, which has not run live yet. Evidence: "Live review" in `docs/benchmark-rating-calibration.md`.

## Online multiplayer

- [ ] Let external bots play ContractPlay through a documented API and/or MCP server. Start with a protocol-neutral, authenticated bot identity and explicit table/seat permissions; expose table discovery or creation, joining a seat, receiving only that seat's legal view, submitting validated calls/cards/claims, and observing table updates. Keep action validation and hidden-hand rules in the server/core boundary, with rate limits, disconnect/reconnect behavior, and clear ownership of bot credentials. Define whether MCP wraps the same API or is a separate adapter, then ship a minimal end-to-end bot example and integration guidance.
- [ ] Add a player feedback form for feature requests, improvements, and other suggestions, and collect and display star ratings.
- [ ] Repeat the two-window check on the deployed address and confirm the Workers free-plan CPU limit holds for bot decisions (if not, the paid Workers plan is the owner's decision).
- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer. A CNAME at Squarespace will not work; a Workers custom domain needs the zone on Cloudflare. Steps for the owner: add `romaniuk.us` to Cloudflare (Free plan) and check the imported records, especially email (MX, TXT); switch the name servers in Squarespace Domains to the two Cloudflare gives (registration stays at Squarespace); once active, add `bridge.romaniuk.us` under Workers & Pages → `contractplay` → Settings → Domains & Routes → Custom domain. Then record the custom domain in `apps/server` wrangler configuration so deploys keep it.
- [ ] Verify cross-device seat recovery and archive sync. Live email delivery and sign-in have been confirmed. Follow [the deployment runbook](docs/platform-delivery.md#email-sign-in-prerequisites).
- [ ] Verify a deal replay live. Migration 0003 was applied to production on 2026-11-24 (`GET /api/deals/replay` answers 204 while the archive is empty). Finish online hands, or solo hands against bots; at least a day later, check that an even-numbered hand in the same mode shows the "Replayed deal" notice and, when it ends, the comparison.
- [ ] Add permissions (authorization) beyond the current host and seated-player rules.
- [x] Admin roles, sign-up approval and a block list (plan: [`docs/superpowers/plans/2026-11-27-admin-accounts.md`](docs/superpowers/plans/2026-11-27-admin-accounts.md)). All of `/admin` and `/api/admin/*`, including the online-table removal panel, now needs a signed-in admin; new addresses wait for approval; admins reach `/admin` from the lobby.
- [ ] Apply migration `0007_admin_accounts.sql` to production, then verify live: a new address is held, Approve emails a working link, Deny emails the refusal, and Block signs an account out.
- [ ] Add invitations to a table.
- [ ] Add basic optional voice and video chat for players at a table.

## Production readiness

- [ ] Add abuse controls for online tables beyond the per-address limits (for example reporting, blocking, rate limits on table actions, and name moderation).
- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
- [ ] Harden POST /api/deals/results against D1 write abuse (global daily cap on new solo deals, IPv6 /64 rate key, or a lower limit).
