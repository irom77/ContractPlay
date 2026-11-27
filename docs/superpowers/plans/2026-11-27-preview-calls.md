# Preview a Call Before Making It — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the bidding box, a first tap selects a call and shows its meaning; a second tap (or the confirm button) makes it. On by default, switchable from the ≡ menu.

**Architecture:** `TableView` owns the selection (local state) and draws the meaning row when its new `confirmCalls` prop is given; callers pass that prop only when the setting is on, with a `meaning(bid)` built from `explainBid` on the auction plus the candidate call. A tiny storage module holds the setting, shared by solo and online like the hand layout.

**Tech Stack:** React + TypeScript, vitest + Testing Library, `@contractplay/bots` `explainBid`.

**Spec:** `docs/superpowers/specs/2026-11-27-preview-calls-design.md`

## Global Constraints

- Default: confirm **on**. Storage key `contractplay.confirmCalls`; only the value `"off"` turns it off.
- Meaning: `explainBid([...game.auction, { seat: game.currentActor, bid }], game.auction.length, style, "expert")`.
- Confirm button text: `Bid 3♥` for a contract bid (use `compactCallLabel`), `Pass`, `Double`, `Redouble` for the others; its accessible name is `Confirm ${callLabel(bid)}` so it never clashes with the bidding box's own `Pass` button.
- Selected cell style must be distinct from `.hinted-bid` (gold).
- Commands: tests `npx vitest run apps/client --maxWorkers 2 --testTimeout 15000`; types `npx tsc -p apps/client --noEmit`; lint `npx eslint <files>`.
- Other sessions share the checkout: `git add` files by name.

## Review Focus

1. **Auction moves on while a call is selected** (a bot or another player calls, or the view refreshes): the selection and meaning disappear; no stale "Bid 2♠" is left to press. Test in Task 1.
2. **Selected call becomes unavailable** (e.g. opponent's overcall makes 2♠ illegal): cleared, confirm button never sends an illegal call. Covered by test 1 (auction length change).
3. **Confirm off**: one tap bids exactly as before, no meaning row. Test in Task 1.
4. **Phone landscape (844×390) and iPad**: the extra meaning row must not push the bidding box off screen or under the hand. Checked with screenshots in Task 4.
5. **Hint and selection on the same call**: both classes may apply; the selected ring must still be visible over the gold. Checked visually in Task 4.

---

### Task 1: Selection and meaning in the bidding box

**Files:**
- Create: `apps/client/src/table/confirmCalls.ts`
- Modify: `apps/client/src/table/TableView.tsx` (props ~line 66; bid picker ~lines 256–268)
- Modify: `apps/client/src/styles.css` (next to `.bid-cell.hinted-bid`, ~line 417)
- Test: `apps/client/src/table/TableView.test.tsx`

**Interfaces:**
- Produces (`confirmCalls.ts`):
  - `export const confirmCallsStorageKey = "contractplay.confirmCalls"`
  - `export function loadConfirmCalls(storage: Pick<Storage, "getItem"> | undefined): boolean` — true unless stored `"off"`; true if storage throws.
  - `export function saveConfirmCalls(storage: Pick<Storage, "setItem"> | undefined, on: boolean): void` — swallows errors.
  - `export function confirmCallsMenuItem(on: boolean, onToggle: () => void): GameMenuItem` — `id: "confirm-calls"`; label `"Bid with one tap"` when on, `"Confirm each call"` when off; title `"Make a call with a single tap, remembered in this browser"` / `"Tap a call to see what it means, then tap again to make it"`.
- Produces (`TableViewProps`): `confirmCalls?: { meaning(bid: Bid): string; initial?: Bid | undefined } | undefined`.

- [ ] **Step 1: Write the failing tests** in `TableView.test.tsx`, `describe("confirming calls")`, rendering an auction where South is to call (dealer North; North `1spades`, East `pass`) with `onBid` a `vi.fn()`, `confirmCalls={{ meaning: (bid) => \`means ${bid}\` }}`:
  - `"a first tap selects a call and shows its meaning without bidding"`: click `2 spades` → `onBid` not called; `getByRole("status")` has text `means 2spades`; button `Confirm 2♠` has text `Bid 2♠`; the `2 spades` cell has class `selected-bid`.
  - `"a second tap on the selected call, or the confirm button, makes it"`: click `2 spades` twice → `onBid` called once with `"2spades"`; separately click `Pass` then `Confirm Pass` → called with `"pass"`.
  - `"tapping another call moves the selection"`: click `2 spades` then `3 spades` → status `means 3spades`, `onBid` not called.
  - `"Escape clears the selection"`: select, press Escape → no `Confirm` button.
  - `"the selection is dropped when the auction moves on"`: select `2 spades`, rerender with one more call in the auction (South passes, West to call) and South still the viewer → no `Confirm` button and no `selected-bid` cell.
  - `"without confirmCalls one tap bids"`: no prop, click `2 spades` → `onBid("2spades")`, no status row.
  - `"initial selects a call on first render"`: `confirmCalls={{ meaning, initial: "2spades" }}` → status shows `means 2spades`.
  - Plus a `confirmCalls.ts` test file `apps/client/src/table/confirmCalls.test.ts`: empty storage → true; `"off"` → false; `"on"` → true; throwing `getItem` → true; save writes `"off"`/`"on"`.

- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run apps/client/src/table/TableView.test.tsx apps/client/src/table/confirmCalls.test.ts`
  Expected: FAIL (module not found / onBid called on first tap).

- [ ] **Step 3: Implement `confirmCalls.ts` and the selection in `TableView`**
  - State `const [selected, setSelected] = useState<{ bid: Bid; at: number } | undefined>(confirmCalls?.initial ? { bid: confirmCalls.initial, at: game.auction.length } : undefined)`. The live selection is `selected` only when `confirmCalls`, `canAct`, `!bidsDisabled`, `selected.at === game.auction.length` and `isCallAvailable(game, selected.bid)`; otherwise treat as none (derive, don't sync with effects).
  - A shared `choose(bid)` for every bidding-box button: without `confirmCalls`, `onBid(bid)`; with it, a tap on the live selected call calls `onBid(bid)` and clears; any other tap selects.
  - Escape and clicks outside `.bid-picker` clear (document listeners in an effect, as `GameMenu` does).
  - Under `.bid-special-calls`, only when `confirmCalls` is given: `<div className="call-preview">`. With a selection: `<p role="status"><strong className={callChipClass(bid)}>{compactCallLabel(bid)}</strong> {meaning}</p>` and `<button className="primary-button" aria-label={\`Confirm ${callLabel(bid)}\`}>` (text per Global Constraints). Without one: a quiet line `Tap a call to see what it means.` so the box keeps its height.
  - CSS: `.bid-cell.selected-bid, .bid-special.selected-bid` — white ring and slight lift (e.g. `outline: max(2px, calc(.35 * var(--u))) solid #fff; outline-offset: 1px`), visible on top of `.hinted-bid`; `.call-preview` a flex row, sized in `var(--u)` and `var(--text-m)` like the rest of `.bid-picker`, text wrapping, min-height for two lines.

- [ ] **Step 4: Run the tests and see them pass**
  Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add apps/client/src/table/confirmCalls.ts apps/client/src/table/confirmCalls.test.ts apps/client/src/table/TableView.tsx apps/client/src/table/TableView.test.tsx apps/client/src/styles.css && git commit -m "Let the bidding box select a call and show its meaning before making it"`

### Task 2: Solo table

**Files:**
- Modify: `apps/client/src/App.tsx` (state ~line 184, menu ~line 1019, `<TableView>` ~line 1134)
- Test: `apps/client/src/App.test.tsx`

**Interfaces:**
- Consumes: `loadConfirmCalls`, `saveConfirmCalls`, `confirmCallsMenuItem` (Task 1); `TableViewProps.confirmCalls`.

- [ ] **Step 1: Write the failing tests** in `App.test.tsx`:
  - `"a first call is previewed and confirmed"`: on the user's turn in the auction, click a bid cell → no call recorded (auction unchanged), status shows the `explainBid` text for it; click `Confirm …` → call recorded.
  - `"the game menu switches to one-tap bidding and remembers it"`: open Game menu, click `Bid with one tap` → `localStorage.getItem("contractplay.confirmCalls") === "off"`; one click on a bid cell now bids.
  - Update existing tests that bid: add a helper `makeCall(user, name)` that clicks the cell and then `Confirm …`, and use it wherever a test clicks a bid cell expecting the call to be made.

- [ ] **Step 2: Run them and see the new ones fail**
  Run: `npx vitest run apps/client/src/App.test.tsx`. Expected: the two new tests FAIL.

- [ ] **Step 3: Implement**
  - `const [confirmOn, setConfirmOn] = useState(() => loadConfirmCalls(persistence.storage))`; toggle saves with `saveConfirmCalls`.
  - Add `confirmCallsMenuItem(confirmOn, toggle)` to the non-review `menuItems` right after Settings (also when `benchmarkPractice`).
  - Pass `confirmCalls={confirmOn && game ? { meaning: (bid) => explainBid([...game.auction, { seat: game.currentActor, bid }], game.auction.length, biddingStyle, "expert") } : undefined}` (use the same game object the bidding box is drawn from).

- [ ] **Step 4: Run the whole App suite and see it pass**
  Run: `npx vitest run apps/client/src/App.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add apps/client/src/App.tsx apps/client/src/App.test.tsx && git commit -m "Preview and confirm calls at the solo table"`

### Task 3: Online table and its preview

**Files:**
- Modify: `apps/client/src/online/OnlineTable.tsx` (props ~line 56, `handLayoutItem` ~line 258, mid-hand `menuItems` ~line 584, live `<TableView>` ~line 616)
- Modify: `apps/client/src/mocks/scenarios.ts` (table `PreviewData` type ~line 136; new scenario **appended at the end of the scenario list** so existing preview numbers do not shift; add its id to the `"Bidding"` group)
- Modify: `apps/client/src/mocks/Previews.tsx` (~line 73, pass the new prop)
- Test: `apps/client/src/online/OnlineTable.test.tsx`, `apps/client/src/mocks/Previews.test.tsx`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `OnlineTableProps.initialSelectedCall?: Bid`; table `PreviewData.selectedCall?: Bid`.

- [ ] **Step 1: Write the failing tests**
  - `OnlineTable.test.tsx` `"previews a call before sending it"`: on your turn, click `2 spades` → no `bid` message sent; status shows its meaning; click `Confirm 2♠` → sent `{ type: "bid", bid: "2spades" }` (match the existing message shape in this file).
  - Same file `"one-tap bidding from the game menu"`: menu → `Bid with one tap`; one click sends the bid.
  - Update existing tests here that bid by clicking a cell to click twice via a `makeCall` helper (as in Task 2).
  - `Previews.test.tsx`: the new preview `auction-confirm` ("Auction: checking a call before making it") renders a `selected-bid` `2 spades` cell, a status with text containing `2♠`, and a `Confirm 2♠` button.

- [ ] **Step 2: Run them and see the new ones fail**
  Run: `npx vitest run apps/client/src/online/OnlineTable.test.tsx apps/client/src/mocks/Previews.test.tsx`. Expected: new tests FAIL.

- [ ] **Step 3: Implement**
  - State from `loadConfirmCalls(storage)`, toggle as in Task 2; `confirmCallsMenuItem` in the mid-hand `menuItems` next to `handLayoutItem`.
  - Live `<TableView>` gets `confirmCalls` with `meaning` from `explainBid(..., view.style, "expert")` and `initial: initialSelectedCall`.
  - Scenario: `{ id: "auction-confirm", title: "Auction: checking a call before making it", detail: "Partner opened 1♠ and East passed; you tapped 2♠ once: it is selected and its meaning shows under the bidding box, with Bid 2♠ to make it. Bid with one tap in the game menu turns this off.", build: () => ({ ...view(bid(dealt(table("Friday club", you, others("south"))), 2), "south", you), selectedCall: "2spades" }) }`.

- [ ] **Step 4: Run the client suite, types and lint**
  Run: `npx vitest run apps/client --maxWorkers 2 --testTimeout 15000 && npx tsc -p apps/client --noEmit && npx eslint <changed files>`. Expected: all pass, no errors.

- [ ] **Step 5: Commit**
  `git add` the four files above by name, `git commit -m "Preview and confirm calls at online tables"`

### Task 4: Docs, screenshots, and layout check

**Files:**
- Modify: `README.md` (preview table: add the new last row; describe confirm-before-bidding where the README explains bidding/hints), `CHANGES.md` (Unreleased entry), `TODO.md` (if it lists this), `docs/screenshots/bidding.png` (and `hints.png` if the box changed visibly there)

- [ ] **Step 1: Check layouts** with headless screenshots of the new preview and `#/mocks/18` (Solo: your call) at 1656×781, 1180×820, 820×1180, 1024×693, 844×390, 390×844: the meaning row and the whole bidding box stay on screen and clear of the hand; a hinted and selected cell (Hints on in preview 4, select the hinted call) still shows the white ring. Fix CSS if not.
- [ ] **Step 2: Refresh README screenshots** per CLAUDE.md (960×600, device scale 2, preview bar hidden): `bidding.png` from `#/mocks/18`, `hints.png` from `#/mocks/18` with Hints on and North's 1♠ clicked. Update alt text if the image content changes.
- [ ] **Step 3: Write CHANGES.md / README / TODO entries.**
- [ ] **Step 4: Rerun the client suite** (command above). Expected: PASS.
- [ ] **Step 5: Commit and push to main**
  `git add README.md CHANGES.md TODO.md docs/screenshots/bidding.png docs/screenshots/hints.png docs/superpowers/specs/2026-11-27-preview-calls-design.md docs/superpowers/plans/2026-11-27-preview-calls.md && git commit -m "Document previewing calls" && git push`
