# PBN board sets against the field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In solo play, import a PBN file of already-played boards. Play each board fresh, and at the end of each hand compare the result with the file's field results (traveller). Then optionally step through the board's original auction and play.

**Architecture:** Core gains a pure `HandRecord` model and field-scoring functions (matchpoints, Butler IMPs, cross-IMPs). `@contractplay/pbn` captures `*Table` section rows, parses `ScoreTable` into traveller rows, resolves `#`/`##` tag inheritance, and maps boards to `HandRecord`s. Persistence keeps the active board set, the current record, and the record on each saved hand. The solo client starts board-set hands from a record instead of `deal()`. It shows a "Against the field" panel on the hand result and reuses the saved-hand review controls to step through the original play.

**Tech Stack:** TypeScript, React, Vitest + Testing Library, pnpm workspaces.

**Spec:** `docs/research/2026-11-13-hand-record-archives.md`, §1 (PBN 2.1: ScoreTable §5.9, tag inheritance §4.8), §5 (scoring formulas), §6 (architecture), and the MVP row of the phased plan. Nothing beyond the MVP row is in scope: no LIN, no USEBIO, no Neuberg or Butler-2, no double-dummy par, no online board sets.

## Global Constraints

- `packages/core` stays platform-neutral and dependency-free; all new state is immutable (`Readonly<…>`), and every original action is validated through `applyAction` before use.
- Pair and player names from a ScoreTable are **never** stored or shown (research §3: names are personal data).
- Spoilers: the field results and the original auction and play appear only once the hand is over (`complete` or `passed-out`), never during it.
- A board-set hand never counts towards the rubber; dealer and vulnerability come from the record.
- Matchpoints follow Law 78A as written in research §5: `M = 2·#{sᵢ < s} + #{sᵢ = s}`, top `2n`, percentage `100·M/2n`, with the player's score inserted as an extra table, not replacing one.
- IMP scale (Law 78B): a difference of at least 20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000 earns 1…24 IMPs respectively; sign follows the difference.
- Keep `SoloData.version` at `1`: new fields are optional, and data saved before this must still load.
- Every changed or new screen gets a `#/mocks` preview, a `Previews.test.tsx` expectation, and a README preview-table row (CLAUDE.md).
- Focused tests per task; final check is `pnpm typecheck && pnpm lint && pnpm test`, reported honestly.

## Review Focus

1. **ScoreTable column variety.** Columns arrive in any order, with any widths, and sometimes only `Score_EW`. Expected: the column header is read by name, and `nsScore` is the negated EW score when only EW is given. Tested in Task 2.
2. **Unknown or adjusted rows** (`?`, `-`, `^…`). Expected: listed (greyed) but left out of every comparison. Tested in Tasks 1 and 2.
3. **Partly broken files.** Some boards lack a Deal or carry error diagnostics. Expected: the readable boards load, and a message says how many were skipped. Tested in Task 4.
4. **Spoilers mid-hand.** Expected: no field panel and no "View original play" during the auction or play. Tested in Task 5.
5. **Player sitting East–West.** Expected: the comparison uses EW-signed scores, so a good EW result is a high percentage and positive IMPs. Tested in Task 1 (core) and Task 5 (panel uses the user's side).

---

### Task 1: Core hand record and field scoring

**Files:**
- Create: `packages/core/src/field.ts`, `packages/core/src/field.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./field.js";`)

**Interfaces:**
- Produces (all exported from `@contractplay/core`):
  - `type TravellerRow = Readonly<{ nsScore?: number; contract?: string; declarer?: Seat; tricks?: number; multiplicity: number; artificial: boolean }>`. Here `nsScore` is undefined when unknown or irrelevant, and `contract` is the PBN text (`"4S"`, `"3NTX"`, `"Pass"`).
  - `type HandRecord = Readonly<{ board?: string; event?: string; scoring?: string; dealer: Seat; vulnerability: Vulnerability; deal: Deal; original?: readonly GameAction[]; field: readonly TravellerRow[] }>`
  - `type FieldMethod = "matchpoints" | "butler" | "cross"`
  - `type FieldComparison = Readonly<{ method: FieldMethod; count: number; matchpoints: Readonly<{ points: number; top: number; percentage: number }>; butler: Readonly<{ datum: number; imps: number }>; cross: Readonly<{ total: number; perComparison: number }> }>`. All figures are from the player's side; `datum` is from that side's view too.
  - `impsFor(difference: number): number`
  - `fieldScores(rows: readonly TravellerRow[]): number[]`: the NS scores that count, with each row repeated `multiplicity` times. Rows that are `artificial` or have no `nsScore` are left out.
  - `fieldMethod(scoring: string | undefined): FieldMethod`
  - `compareWithField(rows: readonly TravellerRow[], nsScore: number, side: "NS" | "EW", method: FieldMethod): FieldComparison | undefined`. Returns undefined when `fieldScores` is empty.
  - `replayOriginal(record: HandRecord): GameState | undefined`: the game after folding `record.original` through `applyAction` from `createGameState(record)`. Returns undefined when there are no actions or any action is rejected.

- [ ] **Step 1: Write the failing tests** in `field.test.ts`:

```ts
const row = (nsScore?: number, extra: Partial<TravellerRow> = {}): TravellerRow => ({ nsScore, multiplicity: 1, artificial: false, ...extra });
const field = [row(420), row(-50), row(430), row(0), row(420), row(420, { artificial: true }), row(undefined)];

it("converts point differences with the Law 78B scale", () => {
  expect([0, 10, 20, 40, 50, 180, 430, 490, 500, 3990, 4000, 7600].map(impsFor)).toEqual([0, 0, 1, 1, 2, 5, 10, 10, 11, 23, 24, 24]);
  expect(impsFor(-180)).toBe(-5);
});
it("keeps only real scores, repeated by multiplicity", () => {
  expect(fieldScores([...field, row(100, { multiplicity: 3 })])).toEqual([420, -50, 430, 0, 420, 100, 100, 100]);
});
it("matchpoints a new score as an extra table", () => {
  expect(compareWithField(field, 420, "NS", "matchpoints")!.matchpoints).toEqual({ points: 6, top: 10, percentage: 60 });
});
it("IMPs against the rounded average datum and across the field", () => {
  const result = compareWithField(field, 420, "NS", "butler")!;
  expect(result.butler).toEqual({ datum: 240, imps: 5 });   // average 244 → 240; 180 → 5 IMPs
  expect(result.cross).toEqual({ total: 19, perComparison: 3.8 });
});
it("scores from East-West's side when the player sat East-West", () => {
  const result = compareWithField(field, -50, "EW", "matchpoints")!;   // EW +50: beats four tables, ties one
  expect(result.matchpoints).toEqual({ points: 9, top: 10, percentage: 90 });
  expect(result.butler.datum).toBe(-240);
});
it("has no comparison without real scores", () => {
  expect(compareWithField([row(undefined), row(420, { artificial: true })], 420, "NS", "matchpoints")).toBeUndefined();
});
it("reads the method from the PBN Scoring tag", () => {
  expect([undefined, "MP", "MatchPoints", "IMP", "IMP;Butler", "IMP;Cross", "Cross1"].map(fieldMethod))
    .toEqual(["matchpoints", "matchpoints", "matchpoints", "butler", "butler", "cross", "cross"]);
});
it("replays the original actions, and refuses an illegal one", () => { /* build a record from deal() with a 1C pass pass pass auction: phase "play"; then a record whose first action is out of turn: undefined; and no actions: undefined */ });
```

- [ ] **Step 2: Run them to see them fail.** Run `pnpm vitest run packages/core/src/field.test.ts`. Expected: FAIL, because `./field.js` cannot be resolved.

- [ ] **Step 3: Implement `field.ts`.**
  - `impsFor`: count the scale thresholds ≤ `|difference|` and apply the sign.
  - Butler datum: the side-signed mean of `fieldScores`, rounded to the nearest 10 with halves rounded away from zero.
  - `perComparison`: `total / count`, unrounded.
  - `fieldMethod`: case-insensitive. A token starting with `cross` gives `cross`. Otherwise a token `imp` or `butler` gives `butler`. Anything else gives `matchpoints`.
  - For the EW side, negate the field scores and the player's score before every calculation.

- [ ] **Step 4: Run the tests to see them pass.** Run `pnpm vitest run packages/core/src/field.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/core/src && git commit -m "feat(core): hand records and field scoring (matchpoints, Butler, cross-IMPs)"`

---

### Task 2: PBN table sections, ScoreTable, tag inheritance, and records

**Files:**
- Modify: `packages/pbn/src/pbn.ts`, `packages/pbn/src/pbn.test.ts`

**Interfaces:**
- Consumes: `TravellerRow`, `HandRecord` (Task 1).
- Produces:
  - `PbnBoard` gains `tables?: Readonly<Record<string, string>>`, which holds the raw row text under each tag whose name ends in `Table` (keyed by tag name as written), and `field?: readonly TravellerRow[]`, which is parsed from `ScoreTable`.
  - `parseScoreTable(header: string, rowsText: string, line: number): { rows: TravellerRow[]; diagnostics: PbnDiagnostic[] }`.
  - `pbnBoardToRecord(board: PbnBoard): HandRecord | undefined`. Returns undefined when the board has no `deal` or no `dealer`, or when it has an error diagnostic. It uses `vulnerability ?? "None"`; `board` comes from the `Board` tag, `event` from the `Event` tag, and `scoring` from the `Scoring` tag. `original` is `actions` when non-empty, and `field` is `field ?? []`.

Behaviour to implement:
- **Tables as sections.** In `parsePbn`, a tag whose name ends in `Table` (case-insensitive) is still pushed to `tags`. It also opens a section whose following non-tag lines are collected verbatim into `tables[name]`, instead of producing "Ignored content outside a PBN section". `materializeBoard` parses `tables.ScoreTable` (if any) with the ScoreTable tag's value and line, and appends its diagnostics.
- **ScoreTable rows.** Read the column names from the header: split on `;`, then strip any `\<width>[LR]` suffix. Tokenize each row on whitespace, keeping a `"…"` quoted string as one token.
  - Use the columns `Score_NS`, `Score_EW`, `Contract`, `Declarer` (one letter, NESW), `Result` → `tricks`, and `Multiplicity` (default 1).
  - A score token that starts with `^` marks the row `artificial`.
  - `?` or `-` means unknown. `nsScore` comes from `Score_NS` when it is numeric, otherwise it is the negated `Score_EW`.
  - Name columns are ignored. A row with the wrong token count gives a warning naming the row and is skipped.
- **Inheritance (§4.8).** Resolve it in `parsePbn` after the boards are split and before `materializeBoard`.
  - A value `#` takes the previous board's value for that tag.
  - A value starting with `##` sets the remainder as the value for this board and for later boards that leave the tag out.
  - `#` or `##` on Dealer, Vulnerable, Deal, Declarer, Contract, Auction, or Play is an error diagnostic, `Tag <Name> cannot inherit a value`.
  - `#` with no previous value is a warning, and the tag is dropped.
- **Round trip.** `serializePbn` writes each `tables[name]` text (trimmed) on the lines right after its `[Name "…"]` tag. A board with `tables` always takes the raw branch.

- [ ] **Step 1: Write the failing tests.** Build the fixture from `exportPbn({ dealer: "north", vulnerability: "None", actions: [], deal: fixedDeal, tags: [{ name: "Event", value: "Club Pairs" }, { name: "Board", value: "1" }, { name: "Scoring", value: "MP" }] })`. Here `fixedDeal = deal(createDeck())` is unshuffled, so the deal is deterministic. Append this ScoreTable:

```text
[ScoreTable "PairId_NS\2R;PairId_EW\2R;Names_NS;Contract\4L;Declarer\1R;Result\2R;Score_NS\6R;Score_EW\6R"]
 1  5 "Smith - Jones" 4S   N 10    420      -
 2  6 "Lee - Patel"   4S   N  9      -     50
 3  7 "Ng - Ruiz"     3NT  S 10    430      -
 4  8 "Ito - Berg"    Pass -  -      0      0
 9 10 "Ali - Moss"    4S   N 10   ^420      -
11 12 "Fox - Kerr"    ?    ?  ?      ?      ?
```

The tests:

```ts
it("reads a ScoreTable into traveller rows without names", () => {
  const [board] = parsePbn(fixture).boards;
  expect(board!.diagnostics).toEqual([]);
  expect(board!.field).toEqual([
    { nsScore: 420, contract: "4S", declarer: "north", tricks: 10, multiplicity: 1, artificial: false },
    { nsScore: -50, contract: "4S", declarer: "north", tricks: 9, multiplicity: 1, artificial: false },
    { nsScore: 430, contract: "3NT", declarer: "south", tricks: 10, multiplicity: 1, artificial: false },
    { nsScore: 0, contract: "Pass", multiplicity: 1, artificial: false },
    { nsScore: 420, contract: "4S", declarer: "north", tricks: 10, multiplicity: 1, artificial: true },
    { multiplicity: 1, artificial: false }
  ]);
  expect(JSON.stringify(board!.field)).not.toContain("Smith");
});
it("reads columns in any order, and EW-only scores as negated NS scores", () => { /* header "Score_EW;Contract;Declarer", row "50 4S N" → nsScore -50 */ });
it("warns about a row with the wrong number of values and skips it", () => { /* … message contains the row text */ });
it("resolves # and ## tag inheritance across boards", () => { /* board 1 Event "##Spring Pairs", Site "Club"; board 2 Site "#" and no Event → board 2 tags Event "Spring Pairs", Site "Club" */ });
it("refuses inheritance for Deal-defining tags", () => { /* Dealer "#" → error "Tag Dealer cannot inherit a value" */ });
it("keeps other tables' rows without warnings and writes them back", () => { /* OptimumResultTable rows: no diagnostics; serializePbn(parsePbn(x)) contains the rows under the tag */ });
it("maps a board to a hand record", () => {
  expect(pbnBoardToRecord(parsePbn(fixture).boards[0]!)).toMatchObject({ board: "1", event: "Club Pairs", scoring: "MP", dealer: "north", vulnerability: "None", field: expect.any(Array) });
});
```

- [ ] **Step 2: Run them to see them fail.** Run `pnpm --filter @contractplay/core build && pnpm vitest run packages/pbn/src/pbn.test.ts`. Expected: the new tests FAIL and the existing ones pass.

- [ ] **Step 3: Implement the behaviour above** in `pbn.ts`.

- [ ] **Step 4: Run them to see them pass.** Run the same command. Expected: PASS, including every existing PBN test.

- [ ] **Step 5: Commit.** `git add packages/pbn/src && git commit -m "feat(pbn): read ScoreTable travellers, tag inheritance, and hand records"`

---

### Task 3: Persist board sets and records

**Files:**
- Modify: `packages/persistence/src/index.ts`, `packages/persistence/src/local-solo-store.test.ts`

**Interfaces:**
- Consumes: `HandRecord`, `TravellerRow` (Task 1).
- Produces:
  - `type BoardSet = Readonly<{ name: string; records: readonly HandRecord[]; position: number }>`, where `position` is the index of the board being played.
  - `SoloData` gains `boardSet?: BoardSet` and `currentRecord?: HandRecord`. `SavedHand` gains `record?: HandRecord`.

- [ ] **Step 1: Write the failing tests.**
  - Save and load round-trip a `SoloData` with a two-record `boardSet` (position 1), a `currentRecord`, and a saved hand with `record`. All three come back equal.
  - Drop an invalid `boardSet`: an empty `records`, a `position` out of range, or a record with an invalid deal. The rest of the data survives.
  - A saved hand with a malformed `record` keeps the hand and loses the `record`.
  - Data saved before this change (no new fields) loads unchanged.

- [ ] **Step 2: Run them to see them fail.** Run `pnpm --filter @contractplay/core build && pnpm vitest run packages/persistence`. Expected: FAIL.

- [ ] **Step 3: Implement it.**
  - Add `isTravellerRow` and `isHandRecord`, reusing `isSeat` and `isDeal`. `original` actions are checked with the same rule `isGame` uses for history actions, so extract that predicate as `isAction`.
  - Add `isBoardSet`, which needs `records.length > 0` and an integer `0 ≤ position < records.length`.
  - In `normalize`, keep the valid fields and drop the invalid ones.

- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/persistence/src && git commit -m "feat(persistence): keep board sets and hand records"`

---

### Task 4: Import a PBN board set and play it board by board

**Files:**
- Create: `apps/client/src/boardSet.ts`, `apps/client/src/boardSet.test.ts`
- Modify: `apps/client/src/App.tsx`, `apps/client/src/App.test.tsx`

**Interfaces:**
- Consumes: `parsePbn`, `pbnBoardToRecord` (Task 2); `BoardSet` and the `SoloData` fields (Task 3).
- Produces:
  - `boardSetFromPbn(text: string): { set?: BoardSet; skipped: number }`. The `name` is the first record's `event`, else `"Imported boards"`. `position` is 0. `skipped` counts boards that `pbnBoardToRecord` rejects.
  - `isBoardSetFile(set: BoardSet): boolean`, which is true when there is more than one record or any record has a non-empty `field`.
  - `boardLabel(set: BoardSet): string`, which gives `Board ${record.board ?? position + 1} · ${position + 1} of ${records.length}`, for example `"Board 7 · 1 of 3"`.

Behaviour (decided in this plan, see "Calls made"):
- **When an import is a board set.** `importHand` first calls `boardSetFromPbn`.
  - If `isBoardSetFile(set)`, it starts a board set.
  - Otherwise it keeps today's behaviour, where a single board without a traveller resumes at its recorded actions, so the existing import tests stay green.
  - If `skipped > 0`, the message reads `Skipped ${skipped} board(s) that could not be read.`
  - If nothing is readable, it keeps today's error message.
- **Starting a board.** Board `position` starts with `createGameState({ deal, dealer, vulnerability })` taken from the record, in the auction phase, with a fresh hand id. It stores `currentRecord` and `boardSet`, and does **not** touch the rubber, so `rubber.activeHandId` is not set.
- **Menu changes.** While a set is active:
  - The game menu's "Deal a new hand" becomes **Next board**, which moves to `position + 1`. On the last board it reads **Finish board set**.
  - A **Leave the board set** item clears `boardSet` and keeps the current hand.
- **Starting a random hand** (`startHand`) clears `boardSet` and `currentRecord`.
- **Saving.** The save effect writes `boardSet` and `currentRecord` into `SoloData`, and puts `record: currentRecord` on the `SavedHand` it creates.

- [ ] **Step 1: Write the failing tests.**
  - In `boardSet.test.ts`: a two-board file gives a set with `skipped: 0`. A three-board file with one board missing its Deal gives two records and `skipped: 1`. Check `boardLabel` on `{ board: "7" }` at position 0 of 3, and `isBoardSetFile` for a one-board file without a traveller (false) and with one (true).
  - In `App.test.tsx`, import a two-board PBN with a ScoreTable on board 1, using `exportPbn` of two `deal()`s with dealer East on board 1 and the Task 2 table text. Then check:
    - The table is in the auction with East to bid.
    - The menu has **Next board**, and clicking it starts board 2 with its dealer.
    - On board 2 the menu reads **Finish board set**.
    - After a reload (unmount, then render again from the same `localStorage`), the set and position survive.
    - The existing tests "imports the first PBN board with its deal settings" and "imports a PBN file selected from the browser file picker" still pass unchanged.

- [ ] **Step 2: Run them to see them fail.** Run `pnpm --filter @contractplay/persistence... build && pnpm --filter @contractplay/pbn... build && pnpm vitest run apps/client/src/boardSet.test.ts apps/client/src/App.test.tsx`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement `boardSet.ts` and the App wiring.** Add a `startBoard(set: BoardSet)` helper in `App.tsx` that `importHand` and Next board share.

- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git add apps/client/src && git commit -m "feat(client): import PBN board sets and play them board by board"`

---

### Task 5: Result against the field, and viewing the original play

**Files:**
- Create: `apps/client/src/table/FieldResult.tsx`, `apps/client/src/table/FieldResult.test.tsx`
- Modify: `apps/client/src/App.tsx`, `apps/client/src/App.test.tsx`, `apps/client/src/styles.css`

**Interfaces:**
- Consumes: `compareWithField`, `fieldMethod`, `replayOriginal`, `partnership` (Task 1, core); `boardLabel` (Task 4).
- Produces: `FieldResult(props: { record: HandRecord; nsScore: number; side: "NS" | "EW"; label?: string; actions?: ReactNode })`. It is presentational, and `actions` holds the buttons.

The panel (exact copy):
- **Section and label.** A `<section aria-label="Result against the field">` with heading `Against the field`, then `label` when given, for example `Board 7 · 1 of 3`.
- **Headline**, by `fieldMethod(record.scoring)`:
  - matchpoints: `60.0% · 6 of 10 matchpoints`
  - butler: `+5 IMPs against a datum of NS +240`. The datum is shown NS-signed, with `EW` and its sign flipped when `side` is EW.
  - cross: `+19 IMPs across the field · 3.8 per comparison`
- **No field.** When `compareWithField` returns undefined, show `No field results for this board.` instead.
- **Table.** Columns `Contract`, `By`, `Tricks`, `NS score`. Rows are sorted by NS score, highest first, with unknown and artificial rows last and given class `field-row-void`. The player's row is inserted at its place with class `field-row-you` and `Contract` text `You`. A row with multiplicity above 1 shows `×k` after the score.

Behaviour in `App.tsx`:
- **When the panel shows.** It shows in the hand-result overlay (complete and passed-out) whenever the shown hand has a record: `currentRecord` for the live hand, `selectedHand.record` when reviewing. It replaces the `hand-points-line` and goes under the contract outcome.
  - The score is `shownGame.score?.score ?? 0`.
  - `side` is `partnership(userSeat)` against bots, otherwise `"NS"`.
  - The `label` is `boardLabel(boardSet)` for a live set hand.
- **Panel buttons.**
  - **View original play** shows when `replayOriginal(record)` is defined.
  - Then **Next board** / **Finish board set** while a set is active, or **Next deal** otherwise (the review case shows neither).
- **Viewing the original.** **View original play** enters review mode on `replayOriginal(record)`. Generalize `reviewState(hand, cursor)` to `reviewState(game: GameState, cursor: number)`, with the reviewed game as `selectedHand?.game ?? originalGame`.
  - The status reads `Original play: action ${cursor} of ${count}`.
  - The menu's exit item and the exit path read **Back to your result**, which returns to the live result.
  - Add `SoloPreview.viewOriginal?: number` (a starting cursor) so a preview can open it.

- [ ] **Step 1: Write the failing tests.**
  - In `FieldResult.test.tsx`, render with the Task 1 field and `nsScore` 420 under `scoring` `"MP"`, `"IMP"`, and `"IMP;Cross"`, and expect the three headlines above verbatim. Then check:
    - The `You` row sits between 430 and the first 420.
    - The void rows are last.
    - EW side: `nsScore` -50 with scoring `MP` shows `90.0% · 9 of 10 matchpoints`.
    - No scores shows `No field results for this board.`
  - In `App.test.tsx`, import the Task 4 two-board file, then:
    - During the auction, `queryByRole("region", { name: "Result against the field" })` is null and there is no **View original play** button.
    - Pass four times (passed out, NS 0 against `[420, -50, 430, 0, 420]`, so `M = 3`) and expect `30.0% · 3 of 10 matchpoints`.
    - With an original 1♣–pass–pass–pass auction in board 1, **View original play** shows `Original play: action 0 of 4`, Next reaches `action 4 of 4`, and **Back to your result** brings the panel back.

- [ ] **Step 2: Run them to see them fail.** Run `pnpm vitest run apps/client/src/table/FieldResult.test.tsx apps/client/src/App.test.tsx` after the Task 4 build. Expected: FAIL.

- [ ] **Step 3: Implement `FieldResult.tsx`, the App wiring, and the styles.** The styles go in `styles.css`, next to the existing `.score-panel` rules, and reuse the existing tokens. They cover the table, the highlighted `field-row-you`, and the greyed `field-row-void`.

- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git add apps/client/src && git commit -m "feat(client): compare a board-set result with the field and view the original play"`

---

### Task 6: Previews, docs, and full check

**Files:**
- Modify: `apps/client/src/mocks/scenarios.ts`, `apps/client/src/mocks/Previews.test.tsx`, `README.md`, `CHANGES.md`, `TODO.md`

- [ ] **Step 1: Add two solo preview screens** at the end of `soloScreens`. Both use `soloGame(8, (g) => g.phase === "complete")` as the hand. They take a record built from that game: `board: "7"`, `event: "Club Pairs"`, `scoring: "MP"`, `original: game.history.actions`, the game's dealer, vulnerability, and `initialDeal`, and a five-row field that includes one `^` row. Pass `boardSet: { name: "Club Pairs", records: [record, record2, record3], position: 0 }`, `currentRecord: record`, and `rubber: { hands: [] }` in `extra`, so the hand is outside the rubber.
  - `solo-field-result`, "Solo: result against the field". Its detail: "4♠ made on board 7 of an imported club game: your +420 placed in the field's traveller with your matchpoint percentage, the original play one click away, and Next board."
  - `solo-original-play`, "Solo: viewing the original play". Its detail: "The same board as it was really bid and played, stepped through with Previous and Next; Back to your result returns to the comparison." Its table is `{ userSeat: "north", viewOriginal: 8 }`.

- [ ] **Step 2: Add their expectations** in `Previews.test.tsx`:
  - The first shows the region `Result against the field`, the text `Board 7 · 1 of 3`, and the buttons `View original play` and `Next board`.
  - The second shows `Original play: action 8 of` and the button `Back to your result` (in the open menu or the review controls, wherever Task 5 put it).

- [ ] **Step 3: Update `README.md`.**
  - The preview table becomes 28 screens: rebalance it to 14 rows, with 1–14 on the left and 15–28 on the right.
  - Change "solo screens (16–26)" to "(16–28)".
  - Extend the PBN sentence at line 117: a PBN file with several boards or a `ScoreTable` opens as a board set, played board by board, with the result compared against the file's field and the original auction and play viewable after each hand.

- [ ] **Step 4: Update `CHANGES.md` and `TODO.md`.**
  - Add an Unreleased entry in the file's style, covering board-set import, the field comparison by the file's Scoring method, View original play, skipped-board messages, that no pair names are kept, and the two new previews ("for 28 screens").
  - In `TODO.md` under "Hand records and replays", add a checked item for this MVP above the existing hand-records item. Reword that item to its remaining scope: LIN, USEBIO travellers, Butler-2 and Neuberg, double-dummy par, licensed sets, and online board sets.

- [ ] **Step 5: Run the full check.** Run `pnpm typecheck && pnpm lint && pnpm test`. Expected: all pass, including the README-table test in `Previews.test.tsx`. Report any failure with its output; do not claim a pass that did not run.

- [ ] **Step 6: Commit.** `git add -A apps/client/src/mocks README.md CHANGES.md TODO.md && git commit -m "docs: board-set previews, README, changes, and roadmap"`

---

## Calls made in this plan (not yet confirmed by the owner)

- **Import split.** Only a file with several boards or a traveller becomes a board set. A single board without a traveller still resumes at its recorded actions, as it does today.
- **Comparison method.** The method comes from the file's `Scoring` tag: IMP or Butler gives Butler, Cross gives cross-IMPs, and anything else gives matchpoints.
- **Butler datum.** It is the plain average rounded to 10. There is no Butler-2 or Neuberg in this release.
- **Your side.** The comparison is from your partnership against bots, and from North–South at a manual table.
- **The original play** is viewable only after the hand ends, through the existing review controls.
- **Solo only.** Online board sets are phase 5.
