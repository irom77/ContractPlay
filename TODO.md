# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The web app is deployed to GitHub Pages. Next is platform validation and online multiplayer.

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
