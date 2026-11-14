# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The Cloudflare deployment serves the web app and online tables together at https://contractplay.niuk.workers.dev; the old GitHub Pages copy is no longer updated. Next is confirming the deployment with a real game and moving to `bridge.romaniuk.us`; then sign-in, permissions, and invitations.

## Hand records and replays

Solo PBN board sets against the field shipped on 2026-11-13 (see [TODO-archive.md](TODO-archive.md)). Research: `docs/research/2026-11-13-hand-record-archives.md`; plan: `docs/superpowers/plans/2026-11-13-pbn-board-sets-vs-field.md`. Code: `packages/core/src/field.ts` (comparison), `packages/pbn/src/pbn.ts` (`ScoreTable`, inheritance, `pbnBoardToRecord`), `packages/persistence` (`BoardSet`, `HandRecord`), `apps/client/src/boardSet.ts`, `apps/client/src/table/FieldResult.tsx`, and the board-set flow in `apps/client/src/App.tsx`.

- [ ] Try board sets with more real files in an actual browser (an ACBL Live for Clubs file and one with a `ScoreTable`, if a scoring program can write it), and fix what they show. The public BridgeWebs test-system `regis.pbn` is now an app-import regression fixture and imports 32 boards without skips; a RealBridge "full" export (2026 Platinum Pairs Final) imports all 26 boards with their tables' results as the field.
- [x] Import the common BBO LIN hand-record subset (deal, board number, dealer, vulnerability, auction, and play) from browser and native file pickers. LIN does not provide a full traveller; invalid deals are skipped and unplayable recorded actions are omitted. Covered by parser and app file-selection tests.
- [x] Pair board-numbered USEBIO traveller scores with PBN deals in the browser and native file pickers. Names and pair identifiers are discarded; adjusted percentage rows remain artificial and do not enter raw-score comparison.
- [x] Board-set follow-ups from the MVP review: a board with illegal recorded play stays playable without **View original play**; skipped boards are reported on the single-board import path; saved hands retain the player's seat for comparison; original play opened from a saved-hand review returns with **Back to the review**.
- [x] PBN parser tidy-ups: `ScoreTable` warning line numbers retain blank lines; invalid `Dealer` inheritance reports one error; table row indentation is preserved; brace comments inside tables are not read as rows; single-board import reuses the parsed document.
- [x] Board-set test gaps: saved-hand review covers its field panel, original play, and return position; an East–West saved player is compared from that side at App level; IMP threshold boundaries and a replay failure partway through are covered.
- [ ] Extend hand records beyond the PBN MVP: compute par when no PBN `OptimumScore` is supplied, support licensed board sets, and support online board sets. PBN `OptimumScore` is shown as double-dummy par. Neuberg is applied to PBN matchpoints when a board has fewer scored traveller rows than the fullest board in the set; PBN `Butler-2` datums exclude one high and one low field score.
- [ ] Play duplicate between online tables: several tables play the same boards (dealt at random or from an imported board set), and each board's result is compared with the other tables' results by matchpoints or IMPs instead of a file's field, with a running ranking for the session. Needs a session that groups tables, boards released in step, and a scoring view for the session.
- [x] Write exported PBN as PBN 2.1 lays it out, so other programs read it: no blank lines between tags or sections, and the Play section has one trick per line with each card in its seat's column. Import already reads both layouts.
- [x] Replay a previously played random deal from Recent hands; its completed result is compared with earlier attempts at the same deal in a matchpoint traveller.
- [x] Keep multiple imported board sets in Recent hands with saved progress, resume, restart, delete, a bounded local library, and portable JSON backup export/import.

## Bots

- [ ] Allow players to configure bot aggressiveness levels (Conservative, Normal, Aggressive), alongside skill and bidding style, in solo settings and when creating an online table.

## Online multiplayer

- [ ] Repeat the two-window check on the deployed address and confirm the Workers free-plan CPU limit holds for bot decisions (if not, the paid Workers plan is the owner's decision).
- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer. A CNAME at Squarespace will not work; a Workers custom domain needs the zone on Cloudflare. Steps for the owner: add `romaniuk.us` to Cloudflare (Free plan) and check the imported records, especially email (MX, TXT); switch the name servers in Squarespace Domains to the two Cloudflare gives (registration stays at Squarespace); once active, add `bridge.romaniuk.us` under Workers & Pages → `contractplay` → Settings → Domains & Routes → Custom domain. Then record the custom domain in `apps/server` wrangler configuration so deploys keep it.
- [ ] Add sign-in (authentication) so a seat and hand history follow a person across devices.
- [ ] Add permissions (authorization) beyond the current host and seated-player rules.
- [ ] Add invitations to a table.
- [ ] Add basic optional voice and video chat for players at a table.

## Production readiness

- [ ] Add abuse controls for online tables beyond the per-address limits (for example reporting, blocking, rate limits on table actions, and name moderation).
- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
