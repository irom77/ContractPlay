# Online duplicate sessions

## Goal

Let players create a duplicate session with several tables, play the same board at each table, and see cross-table matchpoints or IMPs and an overall ranking. Board deals and unrevealed hand records remain private until each table finishes.

## Chosen approach

Add a `SessionObject` Durable Object as the authoritative coordinator. It owns the board set, table membership, completed results, scoring method, and session ranking. Existing `TableObject`s continue to own seats and live games. A session-bound table receives its board and board metadata through internal coordinator calls; after a completed hand it reports the NS score. Table views expose only the session's current-board status and eligible ranking data, never the deal or other tables' actions. Session changes are idempotent by `(tableId, boardIndex, handNumber)`.

An in-process coordinator shared by table objects would not survive worker eviction or serialize concurrent results. Storing the entire session in the lobby would make the lobby a contention point. A dedicated Durable Object gives one serialized owner for each session and supports independent sessions.

## Constraints and initial defaults

- The first release uses generated random boards; importing a PBN board set into an online session is deferred until generated sessions work end to end.
- A session has a fixed table count, board count, and scoring mode chosen at creation. Boards advance in order only when every participating table completes or explicitly forfeits that board.
- A table can start a board only after it is ready and the session has released that board.
- Session rankings are provisional until all tables have reported the board. No hand record, deal, auction, or play is returned by the coordinator while the table is in progress.
- For matchpoints, compare each table's NS score against every other table's NS score; each tie earns one point and the top is `2 * (tableCount - 1)`. For IMPs, each table's cross-IMP total is the mean IMP difference against all other tables. Session ranking aggregates board percentages or per-board cross-IMPs.
- Existing non-session tables retain their behavior and existing protocol clients reload on the version change.
- The core package remains platform-neutral; coordinator and scoring code belong in table/server layers.

## Work plan

1. [x] Add pure duplicate-session state and scoring helpers with tests: board release, idempotent score receipt, completion, matchpoint/IMP aggregation, and ranking.
2. [x] Add protocol messages and session summaries, strict parsing/size limits, session routes, and the `SessionObject` binding/migration.
3. [x] Add session creation/join flow in the lobby, creating and binding the fixed set of tables; test coordinator persistence and concurrent/idempotent reports.
4. [x] Let session tables deal the coordinator-provided deal, report completed boards, and project spoiler-safe status/rankings. Verify board locking, idempotent report retries, passed-out scoring in the model, and no board leak through session status.
5. [x] Add the client flow to create/join a session, select a table, show board progress and session ranking, and document the preview states. Run workspace checks and `pnpm web:verify` before pushing.

## Review focus

- A single table cannot advance or finalize a board without the other tables.
- Duplicate result reports cannot alter a finalized board or double-count a score.
- No session API or table view returns a board deal or another table's actions before its own table finishes.
- Passed-out hands count as completed with score zero; cancelled hands do not count as completed.
- A failed coordinator request cannot leave a table permanently unable to recover; reconnect/retry uses an idempotent report key.
- Session rankings handle missing or unfinished tables without presenting provisional results as final.

## Out of scope

Licensed board-set distribution, online PBN imports, player identity beyond existing table identity, tournament movement between tables, and federation-level masterpoints.
