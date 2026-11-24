# Deal Replays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive every finished hand in D1 and make every second hand, solo and online, a replay of a deal first
played at least a day ago, with a start notice and an IMP comparison against the average of earlier results.

**Architecture:** A D1-backed `DealArchive` (server) records results and picks replays. Online tables call it
directly from `TableObject`, injecting the replay before reducing the `deal` message (the `sessionBoard` pattern).
Solo calls two same-origin HTTP routes. Both sides show the replay through the existing `HandRecord` +
`FieldResult` comparison with scoring `"IMP"` (Butler datum).

**Tech Stack:** TypeScript, pnpm workspace, Cloudflare Workers + D1 + Durable Objects, React, Vitest
(`@cloudflare/vitest-plugin` for the server).

**Spec:** `docs/superpowers/specs/2026-11-24-deal-replays-design.md`

## Global Constraints

- Replay eligibility: `first_played_at <= now - 86_400_000` (24 h). Replays on hands 2, 4, 6, … of each table / solo run.
- No replays in duplicate sessions (`state.sessionId`). Rubber replays keep the archived deal and dealer and play at the rubber's vulnerability.
- Headline comparison: `compareWithField` method `butler` (record `scoring: "IMP"`), from the viewer's partnership; observers use NS.
- Field: the original result plus at most the 50 most recent other results, identical rows grouped with `multiplicity`.
- No player names, ids or table ids in the archive.
- Earlier results never appear in an online view before the hand is over.
- The server recomputes every score from actions with core; claims are stored with `claimed = 1`.
- Archive failures (including a missing table before the migration is applied) never block dealing or finishing a hand: log and deal fresh.
- Rate limits per address and hour: 120 result posts, 60 replay requests (`auth_rate_limits`, hashed key).
- Start notice copy: `Replayed deal · first played 12 Nov 2026, 14:32 · some of you may have played it before.` (solo: `… · you may have played it before.`); date formatted with `Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })` in the viewer's zone.
- Result panel copy: `Original: 4♠ by S · 10 tricks · NS +620 · 12 Nov 2026`; when rescored, `Earlier results rescored at your vulnerability`.
- `CLAUDE.md`: previews in `#/mocks` for new states, focused tests, TODO/CHANGES/README current. Verify with `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Review Focus

1. **Archive table missing in production** (deploy before `migrations apply --remote`): online deal and finish must still work with no notice. → Task 5 test.
2. **No eligible deal yet** (archive empty or all younger than 24 h): fresh shuffle, no notice, solo and online. → Tasks 2, 5, 7 tests.
3. **Solo replay fetch fails or the app is offline/native**: a fresh hand starts immediately, no notice, no error message. → Task 7 test.
4. **Online view mid-hand leaks results**: `view.replay.record` absent until the hand is over, for seated players and observers. → Task 4 test.
5. **Passed-out replay**: recorded as `Pass`/NS 0, and the comparison still shows. → Tasks 2 and 6 tests.

---

### Task 1: Core contract text, rescoring and replay info

**Files:**
- Modify: `packages/core/src/field.ts`, `packages/core/src/index.ts` (exports)
- Modify: `packages/persistence/src/index.ts` (`isHandRecord` accepts `replay`)
- Test: `packages/core/src/field.test.ts`, `packages/persistence/src/local-solo-store.test.ts`

**Interfaces:**
- Produces (core):
  - `contractText(contract: Contract | undefined): string`: `"4S"`, `"3NTX"`, `"6HXX"`, `"Pass"` when undefined.
  - `parseContractText(text: string, declarer: Seat | undefined): Contract | undefined`: inverse; `"Pass"` → undefined.
  - `rescoreRow(row: TravellerRow, vulnerability: Vulnerability): TravellerRow`: recomputes `nsScore` with `scoreContract`; returns the row unchanged when it is `Pass`, artificial, or lacks declarer/tricks.
  - `type ReplayInfo = Readonly<{ dealId: string; firstPlayedAt: number; original: TravellerRow; rescored: boolean }>`
  - `HandRecord` gains optional `replay?: ReplayInfo`.
- Replace the inline contract-text mapping in `apps/client/src/App.tsx` `replaySavedDeal` with `contractText`.

- [ ] **Step 1: Write failing tests** in `field.test.ts`:
  - `contractText` round-trips with `parseContractText` for `4S` by south, `3NTX` by east, `6HXX` by north; `contractText(undefined) === "Pass"`.
  - `rescoreRow({ contract: "4S", declarer: "south", tricks: 10, nsScore: 420, multiplicity: 1, artificial: false }, "NS").nsScore === 620`; with `"EW"` stays 420; `4S` by east, 8 tricks, at `"EW"` → `nsScore === 200`.
  - `rescoreRow` leaves a `Pass` row at 0.
  In `local-solo-store.test.ts`: a saved hand whose record has `replay` survives `saveSoloData` → `loadSoloData`; a record with `replay: { dealId: 5 }` is dropped like other invalid records.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/field.test.ts packages/persistence` and expect FAIL (`contractText` not exported).
- [ ] **Step 3: Implement** in `field.ts`; extend `isHandRecord` to validate `replay` (string `dealId`, finite `firstPlayedAt`, boolean `rescored`, `original` a valid traveller row).
- [ ] **Step 4: Run** the same command and expect PASS, then `pnpm vitest run apps/client/src/App.test.tsx` and expect PASS.
- [ ] **Step 5: Commit** `Add contract text and result rescoring for deal replays`.

### Task 2: D1 deal archive

**Files:**
- Create: `apps/server/migrations/0003_deal_archive.sql` (schema exactly as the spec's Storage section, including `claimed` and per-result `vulnerability`)
- Create: `apps/server/src/deal-archive.ts`
- Test: `apps/server/src/deal-archive.test.ts` (apply `0001` then `0003` with `?raw` like `hand-history.test.ts`)

**Interfaces:**
- Consumes: Task 1 `contractText`, `rescoreRow`, `ReplayInfo`, core `applyAction`, `createGameState`.
- Produces:
  ```ts
  export const REPLAY_MIN_AGE_MS = 86_400_000;
  export const MAX_FIELD_RESULTS = 50;
  export type ArchiveInput = Readonly<{ deal: Deal; dealer: Seat; vulnerability: Vulnerability; actions: readonly GameAction[];
    source: "solo" | "online"; playedAt: number; replayOf?: string }>;
  export type ReplayDeal = Readonly<{ dealId: string; record: HandRecord }>;
  export class DealArchive {
    constructor(db: D1Database);
    /** The deal id the result was stored under, or undefined when the actions are not a legal finished hand or `replayOf` names another deal. */
    record(input: ArchiveInput): Promise<string | undefined>;
    /** A random deal first played at least REPLAY_MIN_AGE_MS before `now`; its record's field is rescored to `vulnerability` when given, else to the deal's own. */
    pickReplay(now: number, vulnerability?: Vulnerability, random?: () => number): Promise<ReplayDeal | undefined>;
  }
  ```
- The returned record has: `deal`, `dealer`, `vulnerability` (target), `scoring: "IMP"`, `event: "Replay"`,
  `original` (first play's actions), `field`, and `replay: { dealId, firstPlayedAt, original, rescored }`.
- `deal_key`: the four hands' sorted card ids joined per seat, plus dealer.

- [ ] **Step 1: Write failing tests:**
  - `record` stores a fresh complete hand and returns an id; the same cards and dealer recorded again reuse that id.
  - `record` returns undefined for unfinished actions, an illegal action, and `replayOf` with different cards.
  - A hand ending in a claim stores `claimed = 1`; a passed-out hand stores `contract "Pass"`, `ns_score 0`.
  - `pickReplay(now)` returns undefined when the only deal was first played 23 h ago, and returns it at 25 h.
  - `pickReplay(now, "NS")` on a deal first played at `"None"` with `4S` by south making 10 → field row `nsScore 620`, `replay.rescored === true`; at `"None"`, `rescored === false`.
  - With 60 results the field holds the original + 50 most recent; three identical results become one row with `multiplicity: 3`.
  - The record has `scoring: "IMP"` and `compareWithField(record.field, 0, "NS", fieldMethod(record.scoring))!.method === "butler"`.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/server test -- deal-archive` and expect FAIL.
- [ ] **Step 3: Implement.** Validate by replaying actions from `createGameState({ deal, dealer, vulnerability })`; the final phase must be `complete` or `passed-out`; the score comes from the final state. Pick a replay without scanning the whole table:
  ```sql
  -- cutoff: newest eligible rowid (uses archived_deals_age)
  SELECT rowid FROM archived_deals WHERE first_played_at <= ? ORDER BY first_played_at DESC LIMIT 1;
  -- probe r = 1 + floor(random() * cutoff)
  SELECT * FROM archived_deals WHERE rowid >= ? AND rowid <= ? AND first_played_at <= ? ORDER BY rowid LIMIT 1;
  ```
  Then read its results ordered by `played_at`.
- [ ] **Step 4: Run** the same command and expect PASS.
- [ ] **Step 5: Commit** `Add D1 deal archive`.

### Task 3: Solo HTTP routes

**Files:**
- Create: `apps/server/src/deal-input.ts`: move the card validation out of `importedBoards` in `apps/server/src/index.ts` into `parseDeal(value: unknown): Deal | undefined`, and make `importedBoards` use it.
- Create: `apps/server/src/deal-routes.ts`
- Modify: `apps/server/src/index.ts` (route `/api/deals/*` before the `/api/` 404)
- Test: `apps/server/src/deal-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 `DealArchive`, `AuthStore.admitAuthAttempt`, `authRequestAllowed`.
- Produces: `dealRoute(request: Request, env: Env): Promise<Response>`
  - `GET /api/deals/replay[?vulnerability=None|NS|EW|Both]` → `200 { dealId, record }`, `204` when there is none, `429 { error: "too-many-requests" }`.
  - `POST /api/deals/results` with body `{ deal, dealer, vulnerability, actions, replayOf? }` (≤ 64 000 bytes) → `201 { dealId }`, `400 { error: "invalid-hand" }`, or `429`.
  - Both require `authRequestAllowed(request, env)` (otherwise 403). The rate key is the SHA-256 of `deals:replay:<CF-Connecting-IP>` / `deals:results:<ip>`; limits come from Global Constraints. `source` is always `"solo"`, `playedAt` is `Date.now()`, and caller-supplied `source`/`playedAt` are ignored.

- [ ] **Step 1: Write failing tests:**
  - POST a legal finished hand returns 201; the GET at 25 h (by injecting `first_played_at` via SQL) returns it.
  - POST with a 12-card hand, a duplicate card, or unfinished actions returns 400.
  - POST with a cross-origin `Origin` returns 403.
  - The 121st POST from one IP within the hour returns 429.
  - GET with an empty archive returns 204.
  - GET `?vulnerability=Bogus` returns 400.
  - The existing session-import tests in `server.test.ts` still pass.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/server test` and expect the new tests to FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and expect all PASS.
- [ ] **Step 5: Commit** `Add solo deal replay routes`.

### Task 4: Table state, dealing and view

**Files:**
- Modify: `packages/table/src/state.ts`, `packages/table/src/hand.ts`, `packages/table/src/view.ts`, `packages/table/src/index.ts`
- Modify: `packages/protocol/src/index.ts` (`TableView.replay`)
- Test: `packages/table/src/hand.test.ts`, `packages/table/src/view.test.ts`

**Interfaces:**
- Consumes: Task 1 `HandRecord`, `ReplayInfo`.
- Produces:
  - `TableState.replayBoard?: Readonly<{ index: number; dealId: string; record: HandRecord }>` is injected before reduce, like `sessionBoard`.
  - `TableState.replay?: Readonly<{ dealId: string; record: HandRecord }>` is the current hand's replay, cleared by every fresh deal.
  - `isReplayHand(state: TableState): boolean` is true when `!state.sessionId && (state.handNumber + 1) % 2 === 0`.
  - `replayVulnerability(state: TableState): Vulnerability | undefined`: at a rubber table, `nextRubberDeal(state.rubber ?? emptyRubber(), "north").vulnerability`; otherwise undefined.
  - `TableView.replay?: { firstPlayedAt: number; rescored: boolean; original: TravellerRow; record?: HandRecord }`, where `record` is present only when `betweenHands(state)` and has `original` (the actions) removed.
- `dealHand`: when `replayBoard.index === handNumber - 1`, the hand uses `record.deal` and `record.dealer`. The vulnerability is the rubber's at a rubber table, otherwise `record.vulnerability`. It then sets `replay` and drops `replayBoard`. Without a replay board it deals fresh and drops `replay`.

- [ ] **Step 1: Write failing tests:**
  - Dealing hand 2 with a `replayBoard` uses its cards and dealer, and the vulnerability comes from the record.
  - In rubber, it uses the dealer from the record and the vulnerability from the rubber.
  - Dealing hand 3 afterwards is fresh and has no `replay`.
  - `isReplayHand` is false for session tables.
  - The view during play has `replay.firstPlayedAt` and no `replay.record`, for both a seated player and an observer. After the hand completes it has `replay.record`, without `original`.
- [ ] **Step 2: Run** `pnpm vitest run packages/table` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/table` and expect PASS.
- [ ] **Step 5: Commit** `Deal and show replayed hands at online tables`.

### Task 5: TableObject picks replays and records results

**Files:**
- Modify: `apps/server/src/table-object.ts` (`dispatch`)
- Test: `apps/server/src/table-object.test.ts`

**Interfaces:**
- Consumes: Task 2 `DealArchive`, Task 4 `isReplayHand`, `replayVulnerability`, and the `replayBoard`/`replay` fields.
- On a `deal` message where `isReplayHand(state)` holds, call `new DealArchive(this.env.DB).pickReplay(Date.now(), replayVulnerability(state))` inside try/catch. If it returns a deal, set `beforeReduce.replayBoard = { index: state.handNumber, dealId, record }`.
- After `save`, when the game has just reached `complete` or `passed-out` (it was not finished before) and the table is not a session table, call `record({ deal: game.initialDeal, dealer, vulnerability: game.vulnerability, actions: game.history.actions, source: "online", playedAt: Date.now(), replayOf: out.state.replay?.dealId })` inside try/catch with `console.warn`.

- [ ] **Step 1: Write failing tests:**
  - Completing a hand writes one row to `deal_results` with `source: "online"`.
  - With an eligible archived deal, hand 2 is dealt from it and the view has `replay`; hand 1 is fresh.
  - When `archived_deals` does not exist (migration not applied), hands 1 and 2 deal and finish normally.
  - Session tables never write to the archive.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/server test -- table-object` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @contractplay/server test` and expect all PASS.
- [ ] **Step 5: Commit** `Record online hands and serve replays at online tables`.

### Task 6: Replay notice and result panel (shared + online)

**Files:**
- Create: `apps/client/src/replays.ts`
- Modify: `apps/client/src/table/FieldResult.tsx`, `apps/client/src/online/OnlineTable.tsx`, `apps/client/src/styles.css`
- Test: `apps/client/src/replays.test.ts`, `apps/client/src/table/FieldResult.test.tsx` (create if absent), `apps/client/src/online/OnlineTable.test.tsx`

**Interfaces:**
- Consumes: Task 1 `ReplayInfo`, Task 4 `TableView.replay`.
- Produces (`replays.ts`):
  - `replayNotice(firstPlayedAt: number, solo: boolean): string`, with the copy from Global Constraints.
  - `fetchReplay(vulnerability?: Vulnerability): Promise<ReplayDeal | undefined>` resolves undefined on any failure, a non-200 status, or a missing `fetch`.
  - `postResult(input: { deal: Deal; dealer: Seat; vulnerability: Vulnerability; actions: readonly GameAction[]; replayOf?: string }): Promise<void>` never rejects.
  - `type ReplayDeal = { dealId: string; record: HandRecord }`.
- `FieldResult` shows when `record.replay` exists:
  - `Original: <contract> by <S> · <n> tricks · NS <±score> · <date>` (`Original: Passed out · <date>` for a pass);
  - `Earlier results rescored at your vulnerability` when `rescored`.
- `OnlineTable`:
  - Shows `replayNotice(view.replay.firstPlayedAt, false)` in the status area while `view.replay` is set.
  - Renders `FieldResult` with `view.replay.record`, the hand's `game.score?.score ?? 0`, and the side from `view.yourSeat` (NS for observers) once the record is present.
  - `saveToHistory` stores `record: view.replay.record` when it is present.

- [ ] **Step 1: Write failing tests:**
  - `replayNotice(Date.UTC(2026, 10, 12, 14, 32), false)` with `TZ=UTC` returns the exact copy.
  - `fetchReplay` resolves undefined when `fetch` rejects and when the response is 204.
  - `FieldResult` with a replay record (original `4S` by S, 10 tricks, +620) shows the Original line and an IMP headline matching `/IMPs? against a datum of NS/`.
  - `FieldResult` shows the rescored note only when `rescored`.
  - `FieldResult` with a passed-out hand (`nsScore` 0) still shows the comparison.
  - `OnlineTable` shows the notice during play, shows no "Against the field" panel until the view carries `replay.record`, and saves the record with the hand.
- [ ] **Step 2: Run** `pnpm vitest run apps/client/src/replays.test.ts apps/client/src/table apps/client/src/online` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and expect PASS.
- [ ] **Step 5: Commit** `Show replay notice and IMP comparison at online tables`.

### Task 7: Solo replays

**Files:**
- Modify: `packages/persistence/src/index.ts` (`SoloData.handsStarted?: number`, validated as a non-negative integer)
- Modify: `apps/client/src/App.tsx`
- Test: `apps/client/src/App.test.tsx`, `packages/persistence/src/local-solo-store.test.ts`

**Interfaces:**
- Consumes: Task 6 `fetchReplay`, `postResult`, `replayNotice`, Task 1 `contractText`.
- `startHand` increments and persists `handsStarted`. On an even count it awaits `fetchReplay` (passing `nextRubberDeal(rubber, dealer).vulnerability` in rubber scoring). With a replay it starts the game from `record.deal` and `record.dealer`, uses the rubber's vulnerability in rubber or `record.vulnerability` otherwise, and calls `setCurrentRecord(record)`. Otherwise it deals fresh exactly as today. The New hand control is disabled while a fetch is pending, so a second click can't start two hands.
- The status card shows `replayNotice(currentRecord.replay.firstPlayedAt, true)` while `currentRecord?.replay` is set; it survives a reload through the persisted `currentRecord`.
- When a hand reaches `complete` or `passed-out` with `playAgainstBots`, no `currentPbnMetadata`, no board set, and either no `currentRecord` or one with `replay`, call `postResult` once per hand id, tracked in a ref. `replayOf` is `currentRecord?.replay?.dealId`.
- Imported, board-set and "Play this deal again" hands neither count toward `handsStarted` nor post results.

- [ ] **Step 1: Write failing tests** (mock `fetch`):
  - The second New hand requests `/api/deals/replay`, deals the returned cards, and shows the solo notice.
  - The first and third New hands make no replay request.
  - A rejected fetch on the second hand deals a fresh hand with no notice and no error message.
  - A double click on New hand during a pending fetch starts one hand.
  - In rubber scoring the request carries `?vulnerability=` with the rubber's vulnerability.
  - A finished hand against bots posts once to `/api/deals/results`, with `replayOf` for a replay.
  - A manual-table hand posts nothing.
  - After a reload mid-replay, the notice is still shown.
  - `handsStarted` round-trips through persistence, and a negative value is dropped.
- [ ] **Step 2: Run** `pnpm vitest run apps/client/src/App.test.tsx packages/persistence` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and expect PASS.
- [ ] **Step 5: Commit** `Replay archived deals every second solo hand`.

### Task 8: Previews, docs and full verification

**Files:**
- Modify: `apps/client/src/mocks/scenarios.ts`, `apps/client/src/mocks/Previews.tsx`, `apps/client/src/mocks/Previews.test.tsx`
- Modify: `README.md` (feature text, previews table), `TODO.md`, `CHANGES.md`, `docs/platform-delivery.md` (apply `0003_deal_archive.sql` with `wrangler d1 migrations apply contractplay-auth --remote` before deploying)

- [ ] **Step 1: Add three preview scenarios with test expectations:**
  - "Solo: replayed deal" shows the notice during bidding.
  - "Solo: replay result" shows the Original line, the IMP headline and the rescored note.
  - "Online: replay result" shows the online table after a replayed hand.
- [ ] **Step 2: Run** `pnpm vitest run apps/client/src/mocks` and expect PASS.
- [ ] **Step 3: Update the docs.** README describes replays, the anonymous archive and the preview rows. CHANGES gets an Unreleased entry. TODO gets a checked item plus an unchecked item "Apply migration 0003 to production and verify a replay live".
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test` and expect every command to exit 0.
- [ ] **Step 5: Commit** `Document deal replays and add previews`.
