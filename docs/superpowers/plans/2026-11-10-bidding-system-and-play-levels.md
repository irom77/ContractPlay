# Bidding system layer and play by skill level implementation plan

Design: [2026-11-10-bidding-system-and-play-levels-design.md](../specs/2026-11-10-bidding-system-and-play-levels-design.md)

1. [x] Audit about 250 standard positions per skill and style and simulate whole auctions to find wrong calls and missed games.
2. [x] `packages/bots/src/auction.ts`: auction tokens from the opening bid, `View`, `Eval`, legality.
3. [x] `constructive.ts`, `notrump.ts`, `twos.ts`, `competitive.ts`, `inference.ts`: agreement handlers by subject.
4. [x] `system.ts`: agreed, corrected, and continued stages plus the contested known-values check; call them from `createBot` in `player.ts`.
5. [x] `player.ts`: rule classes drop inert leading passes themselves; remove that handling from `createBot`.
6. [x] `packages/core`: extend `PlayContext` and add `playContextFor`; use it in the client for bot play and hints.
7. [x] `play.ts`: Advanced and Expert card play; wire into the bot classes.
8. [x] Tests: `system.test.ts`, `play.test.ts`, `playContextFor` in `game.test.ts`, hint texts in `hints.test.ts`; update older expectations that the agreements changed.
9. [x] Re-run the audit and both simulations and record the effect in the design.
10. [x] Update `CHANGES.md`, `TODO.md`, `TODO-archive.md`, and the README.
