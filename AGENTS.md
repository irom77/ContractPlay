# ContractPlay agent guidance

- Read `README.md` for project scope and `TODO.md` for current progress before making changes.
- Keep `packages/core` platform-neutral: no UI, browser, native-host, or database imports.
- Prefer existing shared types and APIs; keep game transitions immutable and validate actions in the core.
- Add or update focused tests when implementing behavior, and use commands defined by the workspace. Until root tooling exists, do not invent passing test commands.
- Update `TODO.md` when roadmap status changes. Add completed user-facing behavior or meaningful project setup to `CHANGES.md`.
- Keep plans in `docs/superpowers/plans/`; update the relevant plan when scope or architecture changes.
- Keep user-facing docs concise and accurate to the current code. Mark planned capabilities as planned.
- Git: commit finished work to `main` and push it directly (feature branches may be merged into `main` locally); no pull request is needed. Pushes to `main` deploy the live site, so run the checks first.
