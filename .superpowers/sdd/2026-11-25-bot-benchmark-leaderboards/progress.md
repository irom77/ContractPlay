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
- Baseline setup: `pnpm install --frozen-lockfile` completed. `pnpm test` passed: 63 client/package test files (1,980 tests) plus 11 server test files (131 tests); Workerd printed a disconnected-pipe diagnostic during server teardown despite exit 0.
- Plan/spec/ledger seed commit: `9bb753588fb39109d874a41ed46cd81467800de5`.
- Ruling: rotation input must support `maxTables` within the existing 2–8 session range; cohorts larger than `4 * maxTables` are split into deterministic bounded batches and profiles not in a batch receive fair seeded byes across the full rotation. This lets a 12-profile cohort fit under a 3-table cap and costs some delay before every profile meets every other profile.
- Ruling: the pure rating API consumes explicit profile-level observations and a required versioned transform; Task 4 owns the bridge-specific conversion from partnership/duplicate raw results into those observations. This keeps Glicko independent of D1 and prevents Task 1 from locking an uncalibrated partnership formula; costs an additional integration contract to define in Task 4.
- Ruling: keep Task 1 rotation domain capable of a single four-profile table (the plan's minimum); Task 3 must satisfy the existing duplicate engine's two-table minimum by generating a distinct mirrored seat assignment in a second table, which may reuse profile versions across tables. This preserves support for small rosters and costs repeated bot workloads per duplicate board.

## Task 1 complete
- Implementation commit: `6585e64b4599c93a189c2d8aa381b2c6307acf06`.
- Independent review: Approved. 37 focused tests and 2,148 workspace tests passed; package build/typecheck and lint passed.
- Updated plan signatures to include `maxTables`, the required versioned score transform, the result wrapper, and the small-cohort mirror requirement. Task 2 will build the benchmark workspace package before server tests.
- Task 1: minor (deferred): baseline Workerd teardown diagnostic and ESLint module-format warning appear despite successful exit; recheck during final release validation.
- Task 3 must persist rotation version/seed/index/assignments and mirror a single-table rotation for small cohorts. Task 4 must attribute profile observations from partnership results, count underlying boards once, and provide calibrated directed observations.

## Task 2 review findings
- **Important: imported replay privacy.** Public replay currently returns imported board facts/actions after every table completes. It must remain private by default; public replay needs source/publication gating. `benchmark-store.ts:getPublicResult`, `benchmark-routes.ts:185`.
- **Important: pause fencing.** Assignment/board setup writes do not require the current job lease and may succeed after pause or lease replacement. Fence coordinator setup writes. Preserve table reports for boards already released before pause: they are immutable facts from work already in flight, and may complete that board; prevent paused jobs from releasing or setting up any subsequent board. Add stale-lease tests and explicit resume behavior.
- **Verification gap.** Two default-parallel `pnpm test` runs hit timing-sensitive timeouts in different existing server tests; the capped two-worker server suite passed 143. Final release checks still need a default concurrency run before any deployment.
- Fix round 1/5 starts at `e4e3f96d498efe07cbe31a127d28abcf4f5586e3`.

## Task 2 complete
- Implementation commit: `e4e3f96d498efe07cbe31a127d28abcf4f5586e3`.
- Review found important gaps in imported replay privacy and pause/claim fencing. Fix commit `b80da3a650a234c716fe7a803d004cbc65d90f33` addressed both; scoped re-review confirmed the public HTTP test hides imported deal/play facts and the lease tests cover stale setup writes, late reports, pause, and fresh-lease resume.
- 15 focused tests passed after the fix; server typecheck and lint passed. Full default-parallel test runs had unrelated timing-sensitive server test timeouts, while `pnpm --filter @contractplay/server test --maxWorkers 2` passed all 143 tests. Final release suite remains required before deployment.
- Task 3 contract: use lease-aware `putTableAssignments`, `putJobBoards`, and `startBoard` with current `{token, now}` claim; pause blocks future board admission, while reports for already admitted boards remain allowed. Generated board replays may be public; imported replay details remain private by default. Engine version must be checked before execution.
- Task 2: fix round 1/5 (2 addressed, 0 open; commits `e4e3f96`..`b80da3a`).
- Task 2: minor (deferred): default-parallel server suite exposes timing-sensitive failures in different pre-existing cases; investigate final verification only if it recurs.
- Task 2: fix round 1/5 (2 addressed, 0 open — imported PBN replay stays private; lease-fenced setup and board admission with allowed late reports — commits `e4e3f96`..`b80da3a`).

## Task 3 rulings before implementation
- Ruling: all-bot benchmark tables have no human who can request the first deal. Add a platform-neutral validated server-triggered deal transition in `packages/table` that is callable only through the benchmark-only server operation, never as a client protocol message. Preserve the regular `reduce` validation flow and do not create a fake human seat; cost if wrong is a table API addition and small implementation rework.
- Ruling: every board admission must be checked with the current job lease before any table can read/deal it. The session object must not expose the next board merely because the duplicate field completed if the job is paused; the coordinator must explicitly admit it. Cost if wrong is coordination changes and possible duplicate board work.
- Ruling: benchmark tables use the existing standard listed table IDs and carry a benchmark marker in metadata; custom 34-character IDs would fail the current WebSocket route's `TABLE_ID` validation and break observer links. Cost if wrong is a minor ID-generation/interface rework.

- Task 3 now runs queued and five-minute scheduled jobs in the singleton benchmark coordinator. Standard listed table IDs, trusted all-bot seating/deals, engine compatibility, exact shared board admission, late results, and one-unit alarms are implemented. The current engine ID is `contractplay-bots-v1`; intervals are positive multiples of five minutes or null for manual-only cohorts.
- Verification: `pnpm typecheck` and `pnpm lint` passed, and Wrangler dry-run bundled all four DO bindings. The 2,019 root tests passed. A default concurrent server run timed out in the pre-existing 100-table lobby test; the isolated `pnpm --filter @contractplay/server test` passed all 152 tests. Six new coordinator tests cover a full two-table, two-board match without observers, a replayed setup checkpoint, cleanup and recovery. See `task-3-report.md` and `task-3-tests.log`.
