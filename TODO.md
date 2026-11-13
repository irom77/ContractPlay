# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The Cloudflare deployment serves the web app and online tables together at https://contractplay.niuk.workers.dev; the old GitHub Pages copy is no longer updated. Next is confirming the deployment with a real game and moving to `bridge.romaniuk.us`; then sign-in, permissions, and invitations.

## Hand records and replays

Solo PBN board sets against the field shipped on 2026-11-13 (see [TODO-archive.md](TODO-archive.md)). Research: `docs/research/2026-11-13-hand-record-archives.md`; plan: `docs/superpowers/plans/2026-11-13-pbn-board-sets-vs-field.md`. Code: `packages/core/src/field.ts` (comparison), `packages/pbn/src/pbn.ts` (`ScoreTable`, inheritance, `pbnBoardToRecord`), `packages/persistence` (`BoardSet`, `HandRecord`), `apps/client/src/boardSet.ts`, `apps/client/src/table/FieldResult.tsx`, and the board-set flow in `apps/client/src/App.tsx`.

- [ ] Try board sets with more real files (an ACBL Live for Clubs or BridgeWebs PBN, and one with a `ScoreTable` if a scoring program can write it) in a browser, and fix what they show. A RealBridge "full" export (2026 Platinum Pairs Final) now imports all 26 boards with their tables' results as the field.
- [ ] Board-set follow-ups from the MVP review: keep a board whose recorded play is illegal (play it without **View original play**) instead of skipping it whole; report skipped boards on the single-board import path too; store the player's seat with a saved hand so its later review compares from that seat, not the current setting; label the way back "Back to the review" when the original play was opened from a saved hand's review.
- [ ] PBN parser tidy-ups: `ScoreTable` warning line numbers drift when a table has blank lines; a bad `Dealer` with `#` inheritance reports two errors; the first table row loses its indent; `{…}` comment lines inside a table are read as rows; single-board import parses the file twice.
- [ ] Board-set test gaps: review of a saved hand with its record (field panel and original play, and returning to the review's place), an East–West player at App level, more IMP-scale boundaries, and an original play that fails partway through replay.
- [ ] Extend hand records beyond the PBN MVP: LIN and USEBIO travellers, Butler-2 and Neuberg comparison, double-dummy par, licensed board sets, and online board sets.
- [ ] Play duplicate between online tables: several tables play the same boards (dealt at random or from an imported board set), and each board's result is compared with the other tables' results by matchpoints or IMPs instead of a file's field, with a running ranking for the session. Needs a session that groups tables, boards released in step, and a scoring view for the session.
- [ ] Keep imported board sets in a library: list each set in Recent hands with its progress (for example "Club Pairs · 3 of 24 played") so any set can be resumed, restarted, or deleted without importing the file again, and several sets can be kept at once. Today only the one active set is kept, and leaving, finishing, or importing another file drops it. Needs a storage limit for this browser's storage and a way to move sets to another device (export, or sign-in).
- [ ] Write exported PBN as PBN 2.1 lays it out, so other programs read it: a blank line only between boards (not between tags), and the Play section one trick a line with each card in its seat's column. Import already reads both layouts.
- [ ] Replay a previously played random deal from recent hands and compare the new result with earlier attempts at the same deal (built on the same board source and comparison scoring as hand records).

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
