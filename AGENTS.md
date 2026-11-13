# ContractPlay agent guidance

- Read `README.md` for project scope and `TODO.md` for current progress before making changes.
- Keep `packages/core` platform-neutral: no UI, browser, native-host, or database imports.
- Prefer existing shared types and APIs; keep game transitions immutable and validate actions in the core.
- Add or update focused tests when implementing behavior, and use commands defined by the workspace. Until root tooling exists, do not invent passing test commands.
- Update `TODO.md` when roadmap status changes. Add completed user-facing behavior or meaningful project setup to `CHANGES.md`.
- Keep plans in `docs/superpowers/plans/`; update the relevant plan when scope or architecture changes.
- Keep user-facing docs concise and accurate to the current code. Mark planned capabilities as planned.
- Git: commit finished work to `main` and push it directly (feature branches may be merged into `main` locally); no pull request is needed. Pushes to `main` deploy the live site, so run the checks first.
- Refresh the README screenshots (`docs/screenshots/bidding.png`, `play.png`, `hints.png`) when a change visibly alters the table they show (bidding box, status card, seats, cards, hints, or table controls). Take them from the live site or `pnpm web:dev` at a 960×600 viewport with device scale 2 (1920×1200 PNG): `#/mocks/17` (Solo: your call against bots) for bidding, `#/mocks/18` (Solo: declaring against bots) for play, and `#/mocks/17` again with Hints switched on and North's 1♠ clicked for hints. Hide the preview bar (×) and its small `N/28` button first, and update the images' alt text if what they show changes.
