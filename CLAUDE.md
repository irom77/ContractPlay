# ContractPlay guidance for Claude

- Read `README.md` for project scope and `TODO.md` for current progress before making changes.
- Keep `packages/core` platform-neutral and use the shared core for bridge rules and state transitions.
- Keep game state immutable and validate actions before recording them.
- Add focused tests for implemented behavior; use configured workspace commands and do not claim unrun checks passed.
- Update `TODO.md` as roadmap status changes and record completed user-visible work in `CHANGES.md`.
- Keep implementation plans under `docs/superpowers/plans/` and keep docs aligned with the code.
- Keep the UI previews (`#/mocks`, `apps/client/src/mocks/`) current: when a change adds or alters a screen or game state, add or update its preview screen and test expectation, and keep the README preview table in step.
