# ContractPlay guidance for Claude

- Read `README.md` for project scope and `TODO.md` for current progress before making changes.
- Keep `packages/core` platform-neutral and use the shared core for bridge rules and state transitions.
- Keep game state immutable and validate actions before recording them.
- Add focused tests for implemented behavior; use configured workspace commands and do not claim unrun checks passed.
- Update `TODO.md` as roadmap status changes and record completed user-visible work in `CHANGES.md`.
- Keep implementation plans under `docs/superpowers/plans/` and keep docs aligned with the code.
- Keep the UI previews (`#/mocks`, `apps/client/src/mocks/`) current: when a change adds or alters a screen or game state, add or update its preview screen and test expectation, and keep the README preview table in step.
- Refresh the README screenshots (`docs/screenshots/bidding.png`, `play.png`, `hints.png`) when a change visibly alters the table they show (bidding box, status card, seats, cards, hints, or table controls). Take them from the live site or `pnpm web:dev` at a 960×600 viewport with device scale 2 (1920×1200 PNG): `#/mocks/17` (Solo: your call against bots) for bidding, `#/mocks/18` (Solo: declaring against bots) for play, and `#/mocks/17` again with Hints switched on and North's 1♠ clicked for hints. Hide the preview bar (×) and its small `N/28` button first, and update the images' alt text if what they show changes.
