# SDD ledger — plan: docs/superpowers/plans/2026-11-25-bot-benchmark-leaderboards.md

## Setup
- Workspace: `/tmp/bridgelab-bot-benchmarks`, branch `feat/bot-benchmark-leaderboards`.
- Base commit: `8e9e778e4a9e001fe8320b78576fa76e85a4429f`.
- Plan and design spec copied from the planning checkout; spec is the binding authority.
- Read README.md and TODO.md. Existing roadmap shows online table and duplicate session support; bot benchmark orchestration and protected admin auth are not yet implemented.

## Pre-flight conflict scan
| Tasks / scope | Shared file or interface | Producer → consumer check | Finding and ruling |
|---|---|---|---|
| 1 ↔ 2 | `BenchmarkProfileSnapshot`, rating output | Task 1 creates pure domain API; Task 2 consumes it | Consistent; Task 2 must depend on exported stable IDs/versioned snapshots. |
| 1 ↔ 3 | profile snapshots and deterministic rotations | Task 1 produces; Task 3 uses in orchestration | Consistent; keep IDs and seat assignments platform-neutral. |
| 1 ↔ 4 | rating-period API | Task 1 produces; Task 4 aggregates and commits | Consistent; Task 4 must retain raw result data and calibration version. |
| 1 ↔ 6 | eligibility and rating fields | Task 1 produces; Task 6 displays | Consistent; distinguish provisional values from eligible leaderboard entries. |
| 2 ↔ 3 | `index.ts`, `env.d.ts`, `wrangler.jsonc` | Task 2 adds API/store bindings; Task 3 adds coordinator and scheduler bindings | Shared registration files; serialize these tasks and integrate without overwriting. |
| 2 ↔ 4 | migration 0006 and `benchmark-store.ts` | Task 2 creates base schema/store; Task 4 extends replay/rating persistence | Consistent if Task 4 uses additive migration edits and preserves Task 2 invariants. |
| 3 ↔ 4 | `benchmark-object.ts`, `session-object.ts`, `table-object.ts` | Task 3 creates jobs and completion signals; Task 4 consumes events to persist facts/ratings | Consistent; sequence Task 4 after coordinator integration. |
| 3 ↔ 5 | `lobby-object.ts`, `table-object.ts`, `index.ts`, `env.d.ts`, `wrangler.jsonc` | Task 3 marks benchmark execution; Task 5 adds read-only projection | Shared server files; sequence to avoid concurrency conflicts. |
| 5 ↔ 6 | online Lobby and observer/leaderboard UI | Task 5 provides observer + benchmark listings; Task 6 adds leaderboard/admin UI | Shared client surface; integrate serially. |
| Task 1 internal | package files/tests | tests exercise APIs implemented by same task | Consistent; workspace glob must be checked. |
| Task 2 internal | migration/store/routes/env | tests and implementation target same schema/routes | Consistent; existing auth model/config need inspection before final route shape. |
| Task 3 internal | coordinator/table/session/scheduler | one-unit alarm and retry tests map to coordinator behavior | Consistent; existing table alarms bound bot work. |
| Task 4 internal | persisted replay/results/rating calibration | result tests cover replay and idempotency; calibration documents transform | Potential risk: plan says preserve replay while also rolling retention; spec requires retention policy. Ruling: implement explicit documented bounded retention without deleting data needed for ratings/history. |
| Task 5 internal | projection/protocol/server/client | spectator tests cover redaction and read-only contract | Consistent; maintain centralized projection boundary. |
| Task 6 internal | admin/public UI/docs | UI tests and docs reflect implemented flows | Consistent; docs must label any unsupported behavior as planned. |

## Rulings
- Keep tasks sequential because the plan has shared server and client integration files, despite independent domain work at Task 1.
- Do not publish/push until full workspace release checks pass; production push is a deployment side effect.
