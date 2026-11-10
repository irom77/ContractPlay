# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place. Beginner through Expert bots are selectable; Advanced adds third-hand honor-sequence play, and Expert adds Gerber, splinter raises, Reverse Drury, and Lebensohl suit, invitation, and stopper continuations. Switchable hints suggest a call or card with a reason and explain the meaning of calls in common SAYC / 2/1 situations. The table menu has an About dialog, named hand history, and a handover that lets bots finish the current hand. Bots at every level answer partner's forcing bids, compete after a pass before the opening, and bid game with known values. The web app is deployed to GitHub Pages. Next is broader competitive bidding and the remaining SAYC / 2/1 agreements.

## Solo app

- [ ] Implement intermediate through expert strategies and complete SAYC / 2/1 agreements.
  - [ ] Implement distinct SAYC and 2/1 response agreements, including game-forcing 2/1 sequences. (2/1 now uses forcing 1NT with 6–12 HCP in the listed uncontested cases; direct 1M–2-over-1 responses require 13+ HCP, allow three-card major support, and continue to game. Opener can show balanced 18–19 HCP with 2NT after a direct 2/1 response. Further detailed continuations and complete SAYC agreements remain.)
  - [ ] Add intermediate, advanced, and expert bidding/play strategies with distinct tested behavior.
  - [ ] Advance partner's takeout double by strength (jump with 9–11 points, cue-bid with 12+), and act over opponents' preempts and 1NT openings with takeout doubles and natural overcalls.
  - [ ] Extend the game-with-known-values check to contested auctions; simulated deals with 27+ HCP still stop in a partscore just under 3% of the time.
  - [ ] Make the rule classes read auctions relative to the opening bid themselves, so the leading-pass handling in `createBot` is no longer needed.

## Platform delivery

- [ ] Validate signed installers and an iPhone/iPad device or App Store build when platform certificates, developer accounts, and devices are available.

## Online multiplayer

- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer (domain managed by the project owner).
- [ ] Add basic optional voice and video chat for players at a table.
- [ ] Build authenticated/guest sessions, table lifecycle, and server-authoritative actions.
- [ ] Protect private hands and recover live tables after disconnects.
- [ ] Connect lobby/table UI and verify reconnect, stale actions, and duplicate delivery.

## Production readiness

- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
