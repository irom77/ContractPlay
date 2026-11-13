# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The Cloudflare deployment serves the web app and online tables together at https://contractplay.niuk.workers.dev; the old GitHub Pages copy is no longer updated. Next is confirming the deployment with a real game and moving to `bridge.romaniuk.us`; then sign-in, permissions, invitations, and platform validation.

## Platform delivery

- [ ] Validate signed installers when platform certificates and developer accounts are available.
- [ ] On hold: iOS and iPadOS (the CI simulator build is switched off; an iPhone/iPad device or App Store build would follow if resumed).

## Scoring

- [x] Score solo play as rubber bridge by default, with single deals as an option.
- [x] Score online tables as rubber bridge by default (dealer from North, vulnerability from games won, Rubber score in the game menu), with running totals as a choice when creating a table; tables made before this keep running totals.
- [x] Replace the end-of-hand rubber score with a paper-pad scorecard in solo and online play: partnerships either side of a divider, above and below the line, dotted game lines with an arrow to the winner, totals, a breakdown of the last hand's points, a rubber-over summary with next steps, and **Scores** in the game menu.

## Hand records and replays

- [x] Play PBN board sets (several boards or a `ScoreTable`) board by board in solo play, compare the result with the file's field by its `Scoring` method (matchpoints, Butler IMPs, or cross-IMPs), and view the original auction and play after each hand. Research: `docs/research/2026-11-13-hand-record-archives.md`; plan: `docs/superpowers/plans/2026-11-13-pbn-board-sets-vs-field.md`. Code: `packages/core/src/field.ts` (comparison), `packages/pbn/src/pbn.ts` (`ScoreTable`, inheritance, `pbnBoardToRecord`), `packages/persistence` (`BoardSet`, `HandRecord`), `apps/client/src/boardSet.ts`, `apps/client/src/table/FieldResult.tsx`, and the board-set flow in `apps/client/src/App.tsx`.
- [ ] Try board sets with real club files (an ACBL Live for Clubs or BridgeWebs PBN, and one with a `ScoreTable` if a scoring program can write it) in a browser, and fix what they show. So far only tests and a generated sample (`Expert` bots' play, invented field) have been used.
- [ ] Board-set follow-ups from the MVP review: keep a board whose recorded play is illegal (play it without **View original play**) instead of skipping it whole; report skipped boards on the single-board import path too; store the player's seat with a saved hand so its later review compares from that seat, not the current setting; label the way back "Back to the review" when the original play was opened from a saved hand's review.
- [ ] PBN parser tidy-ups: `ScoreTable` warning line numbers drift when a table has blank lines; a bad `Dealer` with `#` inheritance reports two errors; the first table row loses its indent; `{…}` comment lines inside a table are read as rows; single-board import parses the file twice.
- [ ] Board-set test gaps: review of a saved hand with its record (field panel and original play, and returning to the review's place), an East–West player at App level, more IMP-scale boundaries, and an original play that fails partway through replay.
- [ ] Extend hand records beyond the PBN MVP: LIN and USEBIO travellers, Butler-2 and Neuberg comparison, double-dummy par, licensed board sets, and online board sets.
- [ ] Play duplicate between online tables: several tables play the same boards (dealt at random or from an imported board set), and each board's result is compared with the other tables' results by matchpoints or IMPs instead of a file's field, with a running ranking for the session. Needs a session that groups tables, boards released in step, and a scoring view for the session.
- [ ] Keep imported board sets in a library: list each set in Recent hands with its progress (for example "Club Pairs · 3 of 24 played") so any set can be resumed, restarted, or deleted without importing the file again, and several sets can be kept at once. Today only the one active set is kept, and leaving, finishing, or importing another file drops it. Needs a storage limit for this browser's storage and a way to move sets to another device (export, or sign-in).
- [ ] Read PBN `%` comment lines (such as `% PBN 2.1` at the top of a file) without warnings, and write exported PBN with a blank line only between boards, not between tags, so other PBN programs read it board by board.
- [ ] Replay a previously played random deal from recent hands and compare the new result with earlier attempts at the same deal (built on the same board source and comparison scoring as hand records).

## Online multiplayer

- [x] Deploy the online tables to Cloudflare: live at https://contractplay.niuk.workers.dev; the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set, so pushes to `main` deploy automatically.
- [x] Add solo-style bidding, card-play, and call-meaning hints to online tables; suggestions use only the viewer's visible cards and public play.
- [x] Add a UI preview mode at `#/mocks` that steps through realistic lobby, seating, auction, declaring, dummy, defending, and result screens built from real table states, with tests that keep each screen in its state.
- [x] Play forced cards automatically (the only legal card) in solo and online play, with a setting to turn it off, and add Auto play so a bot plays the user's cards for the rest of the deal.
- [x] Add claims (all remaining or a number; humans accept or reject online, robots check with an exact search), a queued next card played when your turn starts, and card backs for hidden hands, with `#/mocks` screens for the claim answer and the queued card.
- [x] Add solo-play screens to `#/mocks`: new deal, auction and declaring against bots, Auto play, claiming, the game menu, settings, recent hands, the rubber result, and hand review.
- [x] Align solo play with online tables: the shared game menu (Take back in it, no Redo), the draggable Auto play banner, and online turn wording.
- [x] Offer Auto play during the auction too (solo and online), and start its banner in the top-right corner, clear of the side seats.
- [x] Gather online table controls into a collapsible game menu: Back to lobby, Take back (your last call or card, with any bot play since), Cancel this hand (host), and Leave the table at any time (a bot finishes the hand).
- [x] Name saved hands after the player's dealt cards (`SKT9_HKQJ32_CA2_D543`) instead of random two-word names.
- [x] Reach the device's recent hands (solo and online alike) from the lobby and the online game menu, and from the solo start screen when no hand is in progress.
- [x] Add a development-only `/admin` page to list and remove listed or unlisted online tables; its open access must be replaced with RBAC before public production use.
- [ ] Repeat the two-window check on the deployed address and confirm the Workers free-plan CPU limit holds for bot decisions (if not, the paid Workers plan is the owner's decision).
- [ ] Offer online play in the desktop and iOS builds (allow the service address in the app's content security policy and add cross-origin access on the service).
- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer. A CNAME at Squarespace will not work; a Workers custom domain needs the zone on Cloudflare. Steps for the owner: add `romaniuk.us` to Cloudflare (Free plan) and check the imported records, especially email (MX, TXT); switch the name servers in Squarespace Domains to the two Cloudflare gives (registration stays at Squarespace); once active, add `bridge.romaniuk.us` under Workers & Pages → `contractplay` → Settings → Domains & Routes → Custom domain. Then record the custom domain in `apps/server` wrangler configuration so deploys keep it.
- [ ] Add sign-in (authentication) so a seat and hand history follow a person across devices.
- [ ] Add permissions (authorization) beyond the current host and seated-player rules.
- [ ] Add invitations to a table.
- [ ] Add basic optional voice and video chat for players at a table.

## Production readiness

- [ ] Add abuse controls for online tables beyond the per-address limits (for example reporting, blocking, rate limits on table actions, and name moderation).
- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
