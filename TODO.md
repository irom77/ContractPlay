# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The Cloudflare deployment serves the web app and online tables together at https://contractplay.niuk.workers.dev; the old GitHub Pages copy is no longer updated. Email sign-in, linked seat recovery, account-gated lobby browsing, and personal online hand archives are implemented. The production site now opens on the account-gated lobby; verify sign-in, real online play, and archive sync on the deployment, then move to `bridge.romaniuk.us`; permissions and invitations remain open.

## Hand records and replays

Solo PBN board sets against the field shipped on 2026-11-13 (see [TODO-archive.md](TODO-archive.md)). Research: `docs/research/2026-11-13-hand-record-archives.md`; plan: `docs/superpowers/plans/2026-11-13-pbn-board-sets-vs-field.md`. Code: `packages/core/src/field.ts` (comparison), `packages/pbn/src/pbn.ts` (`ScoreTable`, inheritance, `pbnBoardToRecord`), `packages/persistence` (`BoardSet`, `HandRecord`), `apps/client/src/boardSet.ts`, `apps/client/src/table/FieldResult.tsx`, and the board-set flow in `apps/client/src/App.tsx`.


## Bots

- [x] Allow players to configure bot aggressiveness levels (Conservative, Normal, Aggressive), alongside skill and bidding style, in solo settings and when creating an online table. Plan: `docs/superpowers/plans/2026-11-25-bot-aggressiveness.md`.
- [ ] Let players save named bot presets (skill, bidding style, aggressiveness) and pick one next time: in the browser for solo first, then on the account so presets follow a player across devices and to online tables.

## Online multiplayer

- [x] Wait for every present human to confirm before dealing the next online hand, and open each new hand (solo and online) with a shuffle-and-deal animation.
- [ ] Add a player feedback form for feature requests, improvements, and other suggestions, and collect and display star ratings.
- [ ] Repeat the two-window check on the deployed address and confirm the Workers free-plan CPU limit holds for bot decisions (if not, the paid Workers plan is the owner's decision).
- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer. A CNAME at Squarespace will not work; a Workers custom domain needs the zone on Cloudflare. Steps for the owner: add `romaniuk.us` to Cloudflare (Free plan) and check the imported records, especially email (MX, TXT); switch the name servers in Squarespace Domains to the two Cloudflare gives (registration stays at Squarespace); once active, add `bridge.romaniuk.us` under Workers & Pages → `contractplay` → Settings → Domains & Routes → Custom domain. Then record the custom domain in `apps/server` wrangler configuration so deploys keep it.
- [x] Add sign-in (authentication) so a seat and hand history follow a person across devices. Email magic links, linked seat recovery, and account-owned online archives pass the workspace release checks; deployment setup and live verification remain below.
- [x] Provision the sign-in D1 database and apply production migrations.
- [x] Verify the Resend sending domain and configure the production Worker with `RESEND_API_KEY` and `signin@romaniuk.us`.
- [ ] Verify cross-device seat recovery and archive sync. Live email delivery and sign-in have been confirmed. Follow [the deployment runbook](docs/platform-delivery.md#email-sign-in-prerequisites).
- [x] Let signed-in players change their account name from the lobby. Verified live on the deployment on 2026-11-24.
- [x] Replay archived deals on every second new hand (solo against bots and online tables), with an anonymous D1 archive and a result comparison against earlier results. Design: `docs/superpowers/specs/2026-11-24-deal-replays-design.md`.
- [ ] Verify a deal replay live. Migration 0003 was applied to production on 2026-11-24 (`GET /api/deals/replay` answers 204 while the archive is empty). Finish online hands, or solo hands against bots; at least a day later, check that an even-numbered hand in the same mode shows the "Replayed deal" notice and, when it ends, the comparison.
- [ ] Add permissions (authorization) beyond the current host and seated-player rules.
- [ ] Protect `/admin` and its API with authorization before public production use; email sign-in does not restrict them.
- [ ] Add invitations to a table.
- [ ] Add basic optional voice and video chat for players at a table.

## Production readiness

- [ ] Add abuse controls for online tables beyond the per-address limits (for example reporting, blocking, rate limits on table actions, and name moderation).
- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
- [ ] Harden POST /api/deals/results against D1 write abuse (global daily cap on new solo deals, IPv6 /64 rate key, or a lower limit).
