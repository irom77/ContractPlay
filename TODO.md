# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place. Beginner through Expert bots are selectable; Advanced adds third-hand honor-sequence play, and Expert adds Gerber, splinter raises, Reverse Drury, and Lebensohl suit, invitation, and stopper continuations. Switchable hints suggest a call or card with a reason and explain the meaning of calls in common SAYC / 2/1 situations. Next is broader SAYC / 2/1 bidding and strategy coverage.

## Solo app

- [ ] Add an About item to the menu that displays the current app version.
- [ ] Give played hands randomly generated names and show the date played in the hand history instead of generic labels such as "Hand 1" or "Hand 2".
- [ ] Apply a vibrant green radial gradient to the table background (bright emerald center fading to deeper green edges).
- [ ] Add a faint, centered felt watermark with card suits and a bridge logo (low opacity, non-interactive).
- [ ] Let a human hand control to bots at any point during an active deal and have bots finish the remaining auction and play.
- [ ] Implement intermediate through expert strategies and complete SAYC / 2/1 agreements.
  - [ ] Implement distinct SAYC and 2/1 response agreements, including game-forcing 2/1 sequences. (2/1 now uses forcing 1NT with 6–12 HCP in the listed uncontested cases; direct 1M–2-over-1 responses require 13+ HCP, allow three-card major support, and continue to game. Opener can show balanced 18–19 HCP with 2NT after a direct 2/1 response. Further detailed continuations and complete SAYC agreements remain.)
  - [ ] Add intermediate, advanced, and expert bidding/play strategies with distinct tested behavior.

## Platform delivery

- [ ] Enable GitHub Pages with the Actions source and confirm its first deployment after the workflow reaches `main`.
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
