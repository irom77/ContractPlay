# Forcing continuations implementation plan

Design: [2026-11-10-forcing-continuations-design.md](../specs/2026-11-10-forcing-continuations-design.md)

1. [x] Simulate whole auctions per skill and style and count passes of forcing calls, calls that change after a leading pass, and games missed with 27+ HCP.
2. [x] `packages/bots/src/player.ts`: read the auction from the opening bid in `createBot` unless opener's partner passed first.
3. [x] `packages/bots/src/forcing.ts`: forced continuations, responses with no rule, game with known values, and the strong-opener rebid; call them from `createBot`.
4. [x] `packages/bots/src/forcing.test.ts`: focused tests per situation; update the four older tests that asserted a pass of a forcing or game-going position.
5. [x] Re-run the simulation and record the effect in the design.
6. [x] Update `CHANGES.md`, `TODO.md`, `TODO-archive.md`, and the README.
