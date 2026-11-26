# Bot Benchmark Sessions and Profile Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run bounded scheduled duplicate sessions for versioned individual bot profiles, persist replayable outcomes, and publish comparable rankings with live read-only observation.

**Architecture:** Keep bot profile identity, seat rotation, score derivation, and rating math platform-neutral. Use a Cloudflare Durable Object coordinator for bounded resumable execution, D1 for durable roster/job/result/rating history, and existing table/session objects for game transitions. Expose a small admin workflow for cohort/schedule maintenance and a public leaderboard/replay path; protect benchmark administration before enabling it because the existing development admin routes are unauthenticated.

**Tech Stack:** TypeScript workspace packages, Vitest, Cloudflare Workers, Durable Objects, D1/SQLite migrations, React.

**Spec:** `docs/superpowers/specs/2026-11-25-bot-benchmark-leaderboards-design.md`

## Global Constraints

- Keep `packages/core`, `packages/bots`, `packages/protocol`, and `packages/table` platform-neutral.
- Use the existing validated immutable table transition path and the existing alarm-driven bot turn mechanism.
- Persist benchmark records separately from account-owned `bot_results`.
- Keep benchmark jobs bounded, resumable, and idempotent; do not run a full session in one Worker invocation.
- Preserve immutable profile/strategy snapshots, raw results, and rating history across profile retirement and rating-version changes.
- Admin-only PBN imports retain only board number, deal, dealer, and vulnerability with the benchmark result; do not store or publish traveller names, traveller results, or original PBN play.
- Require both at least 20 completed boards and RD below 100 for main leaderboard eligibility; show other profiles as provisional.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm web:verify` before any deployment or push to `main`.

## Review Focus

- A retried coordinator alarm or duplicate board report must not duplicate a result or rating update. Test a restart/retry between board completion and rating-period commit.
- A spectator must never receive concealed hands, bot-private decisions, future boards, or player controls. Test every game phase, including fresh joins mid-hand.
- A new strategy version or retired profile must preserve prior results and ratings while excluding it from future cohort snapshots. Test version changes and retirement.
- Malformed, oversized, or invalid PBN uploads must be rejected without partial jobs; valid PBN board facts must survive replay after source upload removal. Test size/count limits and invalid deals.
- Large cohorts and schedules must stay within configured table/board/job caps and recover from partial table creation. Test caps and rollback/retry paths.

---

## File Map

- `packages/benchmark/` (new): platform-neutral profile, rotation, score aggregation, and rating domain logic.
- `apps/server/migrations/0006_bot_benchmarks.sql` (new): benchmark roster, cohort, job, board/result, and rating snapshot tables.
- `apps/server/src/benchmark-store.ts` (new): bounded D1 persistence and idempotent writes.
- `apps/server/src/benchmark-object.ts` (new): scheduled-job coordinator and bounded alarm processing.
- `apps/server/src/benchmark-routes.ts` (new): admin and public benchmark HTTP API.
- `apps/server/src/index.ts`, `env.d.ts`, `lobby-object.ts`, `table-object.ts`, `session-object.ts`, `wrangler.jsonc`: Worker bindings, schedule dispatch, benchmark table creation, result capture, observer path.
- `packages/table/src/hand.ts` and focused tests (as needed): a platform-neutral, validated transition for server-triggered benchmark deals at all-bot tables; it must not be part of the client message protocol.
- `apps/server/src/benchmark-*.test.ts` (new): store, coordinator, API, and lifecycle tests.
- `apps/client/src/admin/Admin.tsx` and focused admin benchmark components/tests (new/modified): profile/cohort/schedule controls and job health.
- `apps/client/src/online/Lobby.tsx`, `OnlineTable.tsx`, and focused tests: benchmark listing, observer entry, leaderboard and replay navigation.
- `TODO.md`, `CHANGES.md`, `README.md`: roadmap status and user-facing behavior once implementation ships.

## Interfaces

- `BenchmarkProfileId` is a stable string. `BenchmarkProfileSnapshot` contains `{ profileId, version, skill, aggression, biddingStyle, engineVersion }` and is immutable once referenced by a job.
- `createRotation(profiles, seed, roundIndex, maxTables)` returns table seat assignments with exactly four profile snapshots per table and deterministic compass-seat/partner rotation; `maxTables` is validated against the existing 2–8 session limit. Four-to-seven-profile cohorts yield one rotation table, so the coordinator mirrors it for duplicate execution's two-table minimum.
- `ratingPeriodUpdate(ratings, periodResults, algorithmVersion, transform)` returns a versioned result `{ algorithmVersion, scoreTransformVersion, ratings, observations }`; the transform must validate and map raw scores to fractional results. Raw IMP and matchpoint results remain stored independently.
- `BenchmarkStore` owns roster/cohort/job/result/rating D1 operations. `BenchmarkCoordinator` owns claiming one bounded unit of work and scheduling the next alarm.
- Admin routes accept profile/cohort/job configuration only after server-side admin authorization. Public routes return roster status, leaderboard snapshots, and completed replay data with the same hidden-information policy as existing tables.

## Tasks

### Task 1: Platform-neutral benchmark profiles, rotations, and rating calculations

**Files:**
- Create: `packages/benchmark/package.json`, `packages/benchmark/tsconfig.json`, `packages/benchmark/tsconfig.build.json`
- Create: `packages/benchmark/src/index.ts`, `profiles.ts`, `rotation.ts`, `ratings.ts`
- Create: `packages/benchmark/src/profiles.test.ts`, `rotation.test.ts`, `ratings.test.ts`
- Modify: root `pnpm-workspace.yaml` only if workspace package globs do not already include `packages/*`

**Interfaces:**
- Consumes: existing `SkillLevel`, `Aggression`, `TableStyle`, and `Seat` types from core/protocol.
- Produces: the `BenchmarkProfileSnapshot`, `createRotation`, score aggregation, provisional eligibility, and Glicko-2 rating-period APIs specified above.

- [x] **Step 1: Write profile identity tests** covering stable profile IDs, immutable version snapshots, and active/retired roster eligibility.
- [x] **Step 2: Run the focused package tests** with the workspace's existing Vitest setup and confirm the expected missing-module failures.
- [x] **Step 3: Implement platform-neutral profile types and validation** in `profiles.ts`; built-in skill/aggression combinations receive stable IDs, while a changed strategy version receives a distinct identity.
- [x] **Step 4: Write deterministic rotation tests** asserting four unique seats per table, reproducibility for a seed, and balanced seat/partner exposure across a complete rotation cycle.
- [x] **Step 5: Implement bounded deterministic rotation generation** in `rotation.ts`; reject fewer than four profiles and assignments that exceed configured table limits.
- [x] **Step 6: Write rating tests** using published Glicko-2 reference cases plus project cases for initial `{rating: 1500, deviation: 350, volatility: 0.06}`, no-result periods, provisional profiles, and eligibility only at `sampleBoards >= 20 && deviation < 100`.
- [x] **Step 7: Implement versioned Glicko-2 rating periods** in `ratings.ts`; require an explicit validated transform from raw session score to fractional score and preserve raw metrics alongside rating output.
- [x] **Step 8: Build and test the package** with `pnpm --filter @contractplay/benchmark build` and `pnpm --filter @contractplay/benchmark test`.

### Task 2: Benchmark D1 schema, repository, and protected admin boundary

**Files:**
- Create: `apps/server/migrations/0006_bot_benchmarks.sql`
- Create: `apps/server/src/benchmark-store.ts`, `apps/server/src/benchmark-store.test.ts`, `apps/server/src/benchmark-routes.ts`, `apps/server/src/benchmark-routes.test.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/src/env.d.ts`, `apps/server/src/auth.ts`, `apps/server/wrangler.jsonc`

**Interfaces:**
- Consumes: `BenchmarkProfileSnapshot` and rating-period output from Task 1; `authenticatedAccount` and `AuthStore` patterns from existing auth routes.
- Produces: `BenchmarkStore` methods for roster, cohort snapshots, job claims, board/result insertion, and rating snapshots; `/api/admin/benchmarks/*` and public `/api/benchmarks/*` routes.

- [x] **Step 1: Write schema/store tests** for immutable profile versions, retirement, cohort snapshotting, idempotent board result keys, rating history, and bounded list queries.
- [x] **Step 2: Add migration 0006** creating separate benchmark profile/version, cohort, job, table assignment, board/result, and rating snapshot tables with uniqueness constraints and indexes for status/time queries.
- [x] **Step 3: Implement `BenchmarkStore`** with atomic/idempotent D1 operations and explicit schema, rotation, score-transform, and rating algorithm versions.
- [x] **Step 4: Add server-side admin authorization** for benchmark routes using authenticated accounts and a deployment-configured account-ID allowlist; return 401 for unauthenticated requests and 403 for signed-in non-admins. Never accept an admin identity from request data.
- [x] **Step 5: Implement validated route handlers** for profile/cohort CRUD, bounded PBN upload parsing (board facts only), job start/pause/resume/cancel, and public leaderboard/result reads.
- [x] **Step 6: Register environment types and route dispatch** without changing the existing table/session public API.
- [x] **Step 7: Build the benchmark dependency and run focused server tests** with `pnpm --filter @contractplay/benchmark build` and `pnpm --filter @contractplay/server test -- benchmark-store benchmark-routes`; ensure a clean checkout builds the domain package before server tests and confirm invalid input, unauthorized calls, and retries are handled as specified.

### Task 3: Scheduled bounded coordinator and bot-only duplicate execution

**Files:**
- Create: `apps/server/src/benchmark-object.ts`, `apps/server/src/benchmark-object.test.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/src/env.d.ts`, `apps/server/src/wrangler.jsonc`, `apps/server/src/lobby-object.ts`, `apps/server/src/table-object.ts`, `apps/server/src/session-object.ts`

**Interfaces:**
- Consumes: `BenchmarkStore`, profile snapshots, and `createRotation` from Tasks 1–2; existing table/session creation and alarm-driven bot actions.
- Produces: a `BenchmarkObject` Durable Object with `enqueue`, `pause`, `resume`, `cancel`, `status`, and bounded `alarm` processing. Every external side effect is keyed by a persisted job/round/table/board ID.

- [x] **Step 1: Write coordinator and table-transition tests** for one-unit-per-alarm progress, retry-safe table/session creation, pause/resume/cancel, cap enforcement, recovery after partial creation, and trusted all-bot deal starts.
- [x] **Step 2: Add the `BenchmarkObject` Durable Object and binding**; alarms claim or advance at most one bounded unit, then persist progress before arming the next alarm.
- [x] **Step 3: Add scheduled-event dispatch** to enqueue due configured jobs and route all execution through the coordinator object; check every five minutes and accept cohort intervals in five-minute increments.
- [x] **Step 4: Extend lobby/table setup with internal benchmark-only operations** that seat the four assigned profiles through the validated transition path before the first hand and store only their immutable profile/version IDs in table/session metadata. Add a trusted all-bot deal-start transition that is unavailable in client protocol messages.
- [x] **Step 5: Reuse existing duplicate sessions** so every comparison round shares exact boards; rotate profile seats/partners by stored seed and assignment, using generated deals by default and parsed PBN facts when configured.
- [x] **Step 6: Persist completion progress idempotently** from finished table hands; admit each board using the current job lease, and release the next board only after existing duplicate-session synchronization confirms all tables completed and the coordinator authorizes that board.
- [x] **Step 7: Add lifecycle cleanup** for failed setup, cancellation, and completed sessions without deleting retained result/replay records.
- [x] **Step 8: Verify coordinator and existing server suites** with `pnpm --filter @contractplay/server test`.

### Task 4: Replayable immutable results and calibrated rating updates

**Files:**
- Modify: `apps/server/migrations/0006_bot_benchmarks.sql`, `apps/server/src/benchmark-store.ts`, `apps/server/src/benchmark-object.ts`, `apps/server/src/session-object.ts`, `apps/server/src/table-object.ts`
- Create: `apps/server/src/benchmark-results.test.ts`, `apps/server/src/benchmark-rating-calibration.test.ts`

**Interfaces:**
- Consumes: completed session standings and profile assignments from Task 3; rating engine from Task 1.
- Produces: immutable per-board replay records, per-session raw Matchpoints/cross-IMPs, derived diagnostics, and versioned rating-period snapshots.

- [ ] **Step 1: Write result/replay tests** asserting persisted auction/play reconstructs the completed deal, duplicate reports are no-ops, and concealed deal facts are absent from unfinished public result responses.
- [ ] **Step 2: Persist board facts and public event sequence** (deal metadata, auction, plays, contract, tricks, NS/EW score, assignments) separately from derived session/rating summaries.
- [ ] **Step 3: Build a deterministic simulation fixture for rating calibration** across mirrored seat/partner rotations; compare observed ΔIMP distributions and document the selected ΔIMP-to-score scale before allowing non-provisional publication.
- [ ] **Step 4: Aggregate one rating-period observation per profile from completed rotated sessions** so duplicate boards are not treated as independent 1v1 games; include sample-board count and preserve raw IMP/MP metrics.
- [ ] **Step 5: Commit ratings idempotently by job and algorithm version**; retries must return the existing rating snapshot, while a new algorithm version creates a new history series.
- [ ] **Step 6: Test retirement/version migration and replay retention** so retired IDs remain historically queryable and replay data obeys the configured rolling retention policy.

### Task 5: Safe read-only live observation and Open tables integration

**Files:**
- Modify: `packages/table/src/view.ts`, `packages/table/src/view.test.ts`, `packages/protocol/src/index.ts`, `apps/server/src/table-object.ts`, `apps/server/src/lobby-object.ts`, `apps/client/src/online/Lobby.tsx`, `apps/client/src/online/OnlineTable.tsx`
- Create: focused spectator tests under `packages/table/src` and `apps/server/src`, plus client tests under `apps/client/src/online`

**Interfaces:**
- Consumes: benchmark table metadata and existing `viewFor` redaction boundary.
- Produces: optional `observer: true` on the existing `hello` message; a spectator-specific read-only table view/event stream with auction, played cards, and empty hidden hands; benchmark badge/status in Open tables; observer navigation that cannot issue player actions.

- [ ] **Step 1: Write redaction tests** for observers joining during auction/play and assert no concealed hands, bot-private state, future-board deal, seat controls, or action messages are present.
- [ ] **Step 2: Add a centralized spectator projection** in the table package or its existing view boundary; expose only bids and played cards appropriate to a live observer.
- [ ] **Step 3: Add observer connection role and enforce server-side read-only behavior** in `TableObject`; reject all game-changing client messages from spectator sockets and apply existing socket/IP limits.
- [ ] **Step 4: Mark benchmark entries in lobby summaries** and ensure table execution does not depend on spectator presence.
- [ ] **Step 5: Add Open tables observer action and benchmark table presentation** with client tests for live entry, disconnect/rejoin, and no player seating/action affordances.
- [ ] **Step 6: Run table, protocol, server, and client focused test suites** using the workspace scripts and ensure existing player-view behavior remains unchanged.

### Task 6: Admin maintenance UI, public leaderboard, and project docs

**Files:**
- Modify: `apps/client/src/admin/Admin.tsx`, `apps/client/src/App.tsx`, `apps/client/src/online/Lobby.tsx`, `apps/client/src/styles.css`, associated client tests
- Create: focused admin benchmark and leaderboard components/tests under `apps/client/src/admin` and `apps/client/src/online`
- Modify: `TODO.md`, `CHANGES.md`, `README.md`

**Interfaces:**
- Consumes: protected admin APIs and public benchmark APIs from Task 2; benchmark/replay routes and observer UI from Tasks 3–5.
- Produces: admin workflow for profile lifecycle, cohort membership, schedule/job health, and PBN import; public leaderboard with provisional state, rating uncertainty, sample count, version, and replay links.

- [ ] **Step 1: Write UI tests** for creating/editing a cohort, starting/pausing/resuming/canceling a job, retiring a profile without losing history, and showing provisional versus eligible rankings.
- [ ] **Step 2: Extend the admin page** with profile/version and cohort configuration, schedule controls, PBN upload, and job status/failure recovery; require an authenticated allowlisted admin session.
- [ ] **Step 3: Add the public leaderboard view** showing profile version, Glicko rating/RD, eligibility, sample size, rating date/version, and raw IMP/board and MP diagnostics.
- [ ] **Step 4: Link completed benchmark records to replay** while revealing full deals only after hand completion.
- [ ] **Step 5: Update `TODO.md`, `CHANGES.md`, and README** to distinguish shipped behavior from remaining calibration/operational work.
- [ ] **Step 6: Run release checks** with `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm web:verify`; refresh README screenshots only if the existing screenshots visibly change.

## Self-review

- **Spec coverage:** roster/version lifecycle (Tasks 1, 2, 6); bounded scheduling, identical boards, retries, and generated/PBN sources (Tasks 2–4); immutable replay and metrics (Task 4); Glicko-2 and eligibility (Tasks 1, 4, 6); live observer redaction and lobby (Task 5); admin maintenance, public leaderboard, and docs (Task 6).
- **Step scan:** Each task has a testable package or vertical slice and gives explicit files, boundaries, or a command. Calibration is intentionally an evidence-producing implementation step because the spec marks the ΔIMP scale as a hypothesis.
- **Type consistency:** Profile snapshots, rotation assignments, store/coordinator responsibilities, and route outputs are named once in Interfaces and reused by later tasks.
- **Review focus:** All five identified failure classes are tied to explicit tests in Tasks 2–5.
- **Proportion:** Six vertical tasks separate reusable domain logic, persistence, execution, result integrity, observation, and user-facing operations while keeping each downstream task dependent on stable prior interfaces.

