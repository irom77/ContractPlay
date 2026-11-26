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
- Independent Task 3 review found cleanup starvation and non-idempotent lobby publication retries. Fixes add a durable fair cleanup cursor with retry backoff and independent per-hand publication markers; the coordinator does not fail a healthy match for a transient lobby update. New regressions cover a delayed cleanup alongside a running job, a ready cleanup beyond 100 delayed entries, and replayed publication without dealing the board twice. Fix review passed.
- Latest verification: all 155 server tests passed with `pnpm --filter @contractplay/server test --maxWorkers 2`; the 9 focused coordinator tests passed; `pnpm typecheck`, `pnpm lint`, Wrangler dry-run, and `git diff --check` passed. Existing Workerd and module-format warnings remain. Root `pnpm test` is still required after all six tasks are complete.
- Task 3 review fix commit pending; status: complete after the fix commit is recorded.

## Task 4 complete
- Added immutable completed-board scorecards and replay sequences, with idempotent duplicate result insertion and public replay access only after every duplicate table reports. Imported board sets remain private to public routes; authenticated admins can read completed imported replays. Jobs persist `board_source` independently of the reusable import row, so deleting the import set does not erase the board facts/replay or accidentally make an imported board public.
- Completed sessions now aggregate per-table cross-IMPs and Matchpoints into one profile observation per session. Mirrored seat appearances are averaged and count each distinct board once. Ratings, observations, session summaries, raw profile metrics, and job completion commit in one D1 batch; retrying completed finalization returns the existing result. Algorithm and score-transform versions define separate rating series; retiring a version preserves its historical result/rating data while excluding it from the live roster.
- Calibration fixture: 144 mirrored eight-board sessions, 2,304 bot hands across all 12 built-in profiles and both SAYC/2/1, with seat/partner rotation. A 72-session fitting set selected `cross-imp-per-board-10.5-v1`; a 72-session held-out set checked it. See `docs/benchmark-rating-calibration.md` and `apps/server/src/fixtures/benchmark-calibration.json`.
- Documented replay retention as 90 days or the newest 10,000 boards, whichever is smaller; scheduled maintenance compacts at most 32 board replays per five-minute scheduled call, and failures are logged without blocking cohort enqueue. Scores and rating history stay retained.
- Added Double Dummy diagnostics with explicit positive defense-tricks-prevented sign semantics. They remain separate from rating inputs.
- Verification: `pnpm --filter @contractplay/server test --maxWorkers 2` passed all 17 files / 162 tests; `pnpm --filter @contractplay/server typecheck` and `pnpm lint` passed. Workerd disconnected-pipe and missing sourcemap diagnostics appeared despite exit 0. Task 4 independent review passed with no findings.
- Privacy/replay boundary: uploaded PBN files and traveller data are discarded by parsing; parsed facts are retained per job. Generated completed replays are public. Imported completed replays require the benchmark-admin route unless a later explicit publication feature is added.

## Task 5 complete
- Added a centralized observer projection that exposes live auction and play while returning empty concealed hands, omitting controls and future-board state, and revealing only the completed current board. Observer sockets use a distinct server-enforced role, count against existing connection limits, do not change player presence/readiness, and accept only safe refresh messages after hello.
- Added benchmark-only Watch navigation from Open tables and an observer-specific client screen with no seating, claim, menu, or gameplay actions. Observer connections reconnect with observer hello; server disconnect/rejoin coverage confirms player state is unchanged. The table lifecycle is independent of watchers.
- Protocol version is 9 to ensure older servers prompt an update when they cannot accept observer hello semantics.
- Verification: protocol/table builds passed; focused protocol/table/client suites passed 7 files / 212 tests; `pnpm --filter @contractplay/server test -- src/table-object.test.ts` ran the server suite and passed all 17 files / 164 tests; `pnpm --filter @contractplay/server typecheck` passed. Workerd emitted a disconnected-pipe diagnostic during the passing test run; a missing-source-map warning also appeared.

## Task 6 implementation checkpoint — final release verification recorded below
- Added benchmark admin profile/cohort/job/PBN controls, public eligible/provisional leaderboard, rolling raw IMP/MP metrics, labeled DDS diagnostics, rating history, replay links, and concealed-until-final step-through replay. Benchmark admin calls use same-origin session cookies; `/admin` legacy table removal remains separately unauthenticated.
- Whole-branch review fixes: observer hello now requires a verified account; imported boards never reveal hands publicly, generated boards reveal only after duplicate-session release; generated replay availability reflects retention. Cohort edits prune retired members. Job round allocation is performed in the server store, guarded by a unique cohort/round index, and stable job IDs make retries idempotent. Admin sends a UUID job ID for each explicit start/retry.
- Selected-profile fetches ignore stale responses after selection changes. Added coverage for cohort edit/retirement, PBN count mismatch, eligible/provisional leaderboard states, replay hand concealment, and stale profile responses.
- Focused verification passed: `pnpm exec vitest run apps/client/src/admin/BenchmarkAdmin.test.tsx apps/client/src/online/BenchmarkPages.test.tsx` (5 tests); `pnpm --filter @contractplay/server exec vitest run src/benchmark-routes.test.ts src/benchmark-results.test.ts src/benchmark-object.test.ts` (15 tests); `pnpm --filter @contractplay/table exec vitest run src/view.test.ts` (13 tests); `pnpm --filter @contractplay/server exec vitest run src/table-object.test.ts -t 'benchmark observers'` (3 tests).
- `pnpm typecheck` passed after observer and fixture typing fixes. `pnpm lint` passed. Build emitted existing bridge-dds module externalization and large-chunk warnings; lint emitted the existing ESLint module-format warning.
- An earlier `pnpm test` attempt timed out under full-suite load and was superseded by the final successful 2,210-test release run below. Task 7 was added after this Task 6 checkpoint.

## Task 7 complete
- Added an explicit practice route from generated, fully released board replay pages. Practice loads through the public released-result endpoint, locates the selected profile's original seat, replaces only that profile with the human, and seats the exact other three assigned bot profiles.
- Practice starts the exact retained deal with its dealer, vulnerability, bidding style, scoring, and complete released field in a memory-only persistence adapter. Completed field scoring uses the chosen profile's partnership orientation, and the banner identifies the benchmark profile and baseline score.
- App guards exclude practice from solo persistence, account hand-history upload, partner-result upload, and online result posting. Imported public replay endpoints return 404; the store exposes a generated result and full field only after all duplicate tables finish and the job completes, and retention expiry removes replay availability.
- Focused verification passed: Root practice route/integration test (1), route/helper/public replay UI tests (11), benchmark store/routes server tests (166). `window.localStorage` stays empty in the practice integration test.
- README, TODO, CHANGES and plan now describe practice as implemented. Production migration/allowlist/scheduler checks remain a release task.
- Final verification passed: `pnpm typecheck`, `pnpm lint`, `pnpm test` (2,210 tests across 87 files), and `pnpm web:verify` (3 web assets verified). Build output retains existing bridge-dds externalization and large-chunk warnings; server tests print the existing Workerd disconnected-pipe and missing-sourcemap diagnostics despite passing.
- Final broad review follow-up requested; deployment migration and `BENCHMARK_ADMIN_ACCOUNT_IDS` remain production prerequisites documented in `TODO.md` and `docs/platform-delivery.md`.
