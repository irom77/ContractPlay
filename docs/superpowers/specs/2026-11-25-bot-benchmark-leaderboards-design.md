# Bot benchmark sessions and profile leaderboards

## Intent

Build a persistent benchmark system that runs ContractPlay bot profiles against identical bridge deals, records replayable results, and compares profiles over time. Individual bot profiles are the rated competitors. The system should support human observers during live play and leave a path for human rankings to reuse the same rating machinery later.

The system builds on the existing online duplicate-session engine, which already creates multi-table sessions, shares boards, waits for all tables before releasing the next board, and calculates matchpoint or cross-IMP standings. Existing solo and online bot records are private personal results, not server-authoritative rankings.

## Goals

- Schedule bounded bot-only benchmark work on Cloudflare without relying on a continuously running process.
- Give participating profiles identical boards and rotate seats and partners to reduce deal and partnership bias.
- Store enough immutable data to replay completed deals and reproduce benchmark summaries.
- Track profile identity and strategy version so additions, edits, and retirements preserve historical results.
- Let signed-in lobby users observe an active benchmark table's public bidding and play in real time, without a seat or access to hidden hands.
- Support generated boards first and imported PBN board sets with configurable board count, SAYC or 2/1, and Matchpoints or IMPs.
- Make rating and diagnostics extensible to human competitors without mixing personal bot records with public rankings.

## Non-goals

- Changing solo play or its local/account-owned bot results.
- Treating double-dummy par as a direct measure of playing strength.
- Ranking user-created characters in the initial release.
- Making a continuously running Worker process or running an unbounded job in one request/alarm.
- Publishing raw PBN traveller names, uploaded source metadata, or private player data.

## Existing constraints and relevant code

- `packages/table/src/session.ts` models immutable duplicate sessions and calculates per-table matchpoints or cross-IMPs. It knows tables, not the bot profiles at those tables.
- `apps/server/src/session-object.ts` persists a session in a Durable Object. `apps/server/src/table-object.ts` advances each table on alarms and intentionally performs at most one bot decision per alarm invocation to respect Worker CPU limits.
- `apps/server/src/lobby-object.ts` creates the current 2–8 table, 1–32 board sessions. `apps/client/src/online/Lobby.tsx` already supports PBN import, SAYC/2/1, Matchpoints/Cross-IMPs, and the Open tables list.
- `viewFor` is the existing single redaction boundary. Unseated viewers currently do not receive the in-progress game. Observation requires an explicit public view path; a spectator must never receive concealed hands.
- Existing `bot_results` and `bot_characters` migrations store personal account data. Public benchmark data needs separate persistence and retention rules.
- The production target is Cloudflare Workers, Durable Objects, and D1. A scheduler/controller must use scheduled events and/or Durable Object alarms with bounded work, retries, and idempotency.

## Approaches

1. **Scheduled duplicate sessions (selected).** A benchmark coordinator creates benchmark sessions from the existing duplicate machinery, records which versioned profile occupies each seat, and runs each table with bot actions. This makes same-board comparisons the rating source and supports live observers. It adds scheduling, persistence, and spectator-view work.
2. **Independent matches with stored deal baselines.** Easier to run, but ratings depend more on deal mix and baseline quality and are less directly comparable.
3. **Both.** Duplicate sessions drive ratings; independent matches add volume and diagnostic data. This multiplies operational and interpretation complexity before either result stream is calibrated.

Start with approach 1. Keep storage and rating interfaces open to additional result sources later.

## Proposed design

### Profile roster and historical identity

Define a server-managed benchmark profile with a stable profile ID and immutable strategy version. The profile snapshot for a benchmark run includes skill, aggressiveness/trait settings, bidding style, strategy version, and any required engine/build identifier. Never mutate a historical snapshot when a bot implementation or settings change.

Roster entries have lifecycle state (`active` or `retired`) and effective timestamps. Retiring a profile removes it from future schedules but retains all prior sessions, board results, and rating history. A new strategy version receives a new benchmark identity; the UI may group versions under a display family, but rankings remain version-specific. Initially include only built-in, versioned bot profiles; user-created profiles and humans are future roster sources.

### Benchmark scheduling and session execution

A coordinator queues bounded benchmark jobs. Administrators configure each cohort explicitly, selecting its active versioned profiles and the board source, board count, bidding style, scoring method, and schedule/version metadata. Cohort membership is snapshotted when a job starts, so later roster edits affect future jobs only. A deterministic rotation schedule balances compass seats and partner exposure across the cohort; each job has explicit caps on tables and boards so a large roster is split across bounded rounds rather than expanding into an unbounded all-pairs tournament. Record the rotation seed and assignments for audit and replay. The same board set is dealt to every table in a round. All bot actions advance through the existing validated table transition path and alarm-driven bot turn mechanism.

Scheduled work must be resumable and idempotent. Persist job status and per-table/per-board progress; retrying an alarm or result report must not duplicate a board score or rating update. Enforce caps for active jobs, tables, boards, decision work, and storage. Add pause/cancel and failure recovery at the coordinator boundary. Do not run an entire session inside one Worker invocation.

Generated deals are the default and should use the existing secure dealing path. PBN import is admin-only for benchmark jobs. Inputs use only board number, deal, dealer, and vulnerability as in existing online sessions; discard traveller names/results and original play. Record a stable source identifier/hash and parsed board snapshot alongside the benchmark results for their retention period, so replay does not depend on the original upload. Retain the original PBN file only if operationally required, under a separately documented access and deletion policy; never make uploaded boards globally visible by default.

### Result records and replay

Persist a benchmark run, each immutable profile snapshot and seat assignment, the board metadata/deal, auction, card play, contract, tricks, raw NS/EW score, duplicate score, and derived session summaries. Keep raw facts separate from derived ratings so rating formulas can be recalculated. A replay view reconstructs the table from the stored public event sequence and reveals the full deal only after the hand is complete, subject to the same redaction rules as current online play.

Results are benchmark records, separate from `bot_results`. Add a retention policy and storage budget; prefer a configurable rolling archive or compact replay records after a documented horizon. Preserve the complete result and rating history needed to explain public rankings and retirement records.

### Ratings and leaderboard eligibility

Use Glicko-2 as a candidate engine with initial rating 1500, high initial deviation, and volatility. The service accepts versioned competitor IDs and period results so it can later rate human IDs through the same math. Implement and validate rating calculations independently of Cloudflare persistence.

Bridge is a partnership game, so do not treat every board as an independent ordinary 1v1 game or update a profile multiple times from correlated duplicate comparisons without calibration. Build rating periods from completed benchmark sessions after rotating partners and seats. Derive per-profile session results from pair outcomes and document how partner contribution and cross-IMP results enter the Glicko score. The proposed transform `S = 1 / (1 + 10^(-ΔIMP/12))` is an initial hypothesis, not a fixed standard; calibrate its scale against observed session distributions before publishing it. Preserve raw IMP and matchpoint results regardless of transform.

Use a provisional state until a profile has at least 20 completed boards and RD below 100; require both gates for the main leaderboard. Show provisional rating and uncertainty separately. Keep Matchpoints and IMPs as event scoring choices, but pick one declared primary rating input for comparable scheduled benchmark rounds. Publish rating date, sample size, RD, volatility, profile version, and the scoring/rating version used. Preserve prior rating snapshots when the algorithm changes.

### Secondary bot metrics

Track rolling IMPs per board and matchpoint percentage by scoring format. Add double-dummy diagnostics only when explicitly labeled: e.g. declarer/defender tricks relative to double-dummy optimum and auction contract/score distance from par. Define vulnerability, par source, and denominator before displaying each metric. These diagnostics explain behavior; they do not enter ratings initially.

### Live observers and lobby

Benchmark tables appear in Open tables with an explicit benchmark badge and observer action. Observers connect read-only: no sitting, dealing, acting, claiming, or host controls. Add a spectator-specific view/event stream that contains the auction and played cards visible to a normal table observer, but not unplayed hands, bot private state, future boards, or hidden benchmark deals. Keep `viewFor` or a clearly centralized sibling as the only redaction boundary. Apply socket/IP caps and bounded spectator fan-out; table execution continues when nobody is watching. Completed results expose replay links from the lobby/leaderboard.

### Storage and boundaries

Keep `packages/core`, `packages/bots`, `packages/protocol`, and `packages/table` platform-neutral. Put scheduling, Durable Object orchestration, D1 persistence, and public API routes in `apps/server`. Put rating math and domain models in a platform-neutral package or a platform-neutral module with focused tests. Do not store benchmark records in account personal-result tables. Use additive schema migrations and explicit schema/rating version fields.

## Risks and decisions for implementation

- Cloudflare scheduled/DO execution limits and D1 write volume must be measured early. A benchmark rate/cadence should be configurable and defaults conservative.
- The rating model is the largest validity risk: partnership outcomes are not clean 1v1 observations. Validate partner/seat rotation and IMP transformation through simulation before public ranking.
- Public observer views increase socket load and require strict hidden-information tests.
- Uploaded PBN boards may be copyrighted or contain personal data. Keep import admin-only, retain only parsed board facts needed for benchmark replay, and do not redistribute source files or traveler information.
- Existing duplicate sessions were designed for human tables and have not yet been confirmed as a production-tested benchmark runner; reuse should be validated with an end-to-end local run before scheduling live jobs.

## Acceptance criteria

- A scheduled job can create and resume a bounded bot-only duplicate benchmark without user participation.
- Every compared profile plays the same boards over a documented rotation of seats and partners.
- Duplicate retries do not duplicate results or rating changes; a completed board and its deal/play can be replayed.
- A read-only lobby observer sees live bidding and played cards but no hidden cards or controls, and the match completes without observers.
- Active/retired profiles and strategy versions retain historical identity and leaderboard history.
- Main leaderboard eligibility and provisional ratings display sample size and RD; raw board/session scores remain available.
- Generated and imported PBN source boards support SAYC/2/1 and Matchpoints/IMPs under configured limits.
- Human rating support can use the same rating interface without sharing bot profile identity or personal hand history.
