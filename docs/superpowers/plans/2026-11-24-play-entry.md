# One Play entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lobby's separate "Solo play" button and "New table" form with one **Play** panel: "Me and bots" deals a solo hand on the device, "With other people" creates an online table.

**Architecture:** Saved settings handoff. A new client module `soloSetup.ts` owns the solo setup in browser storage; solo (`App.tsx`) reads and writes it, and the lobby writes it before asking `Root` to open solo with a one-shot start-now flag (component state, like the existing `soloDialog`, so a reload never deals again).

**Tech Stack:** React 19 + Vite client, Vitest + Testing Library, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-24-play-entry-design.md`

## Global Constraints

- Play lives in the account-gated lobby; `#/solo` keeps working directly; no sign-in changes.
- "Me and bots" never contacts the table server (no `createTable`, no Worker CPU).
- Me and bots fields: Your seat, Bot skill (Beginner, Intermediate, Advanced, Expert), Bidding style (SAYC, 2/1), Scoring (Rubber bridge, Single deals).
- With other people fields: Table name, Bidding style, Scoring (Rubber, Duplicate — the existing `scoringNames` labels), Show in lobby; Play does what **New table** did (create, then open).
- New duplicate session form, Open tables, and online table behaviour are unchanged.
- Lobby header keeps account name, Sign out, Recent hands; loses **Solo play**.
- Solo start screen: **Play online** becomes **Lobby** (to `#/online`); start screen keeps its setup, Recent hands, PBN import. Settings dialog keeps Opponents (Manual table / Bots), Dealer, Vulnerability.
- Solo defaults to Bots when nothing is stored.
- Start-now is one-shot; if solo has an unfinished hand (phase `auction` or `play`), it resumes that hand instead of dealing.
- UI previews, README preview table, and `CHANGES.md` stay current (project CLAUDE.md).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Stored setup that is corrupt or from another version (bad JSON, unknown skill, unknown seat) → each bad field falls back to its default; solo still opens. Test in Task 1.
2. Pressing Play (Me and bots) while a solo hand is mid-auction → that hand is shown, no new deal, no replay fetch. Test in Task 2.
3. Reloading `#/solo` after a start-now → no second deal. Test in Task 2.
4. UI previews render solo with a fixed `preview.userSeat`; persisted setup must not override preview values, and frozen previews must not write storage. Test in Task 1.
5. The lobby's shared `style` state between the old New table form and the session form: changing the Play panel's bidding style must not silently change the session's style, and vice versa. Test in Task 3.

---

### Task 1: Remembered solo setup

**Files:**
- Create: `apps/client/src/soloSetup.ts`, `apps/client/src/soloSetup.test.ts`
- Modify: `apps/client/src/App.tsx` (state at lines 121–124 and 136–138; `chooseScoring` near 444; `scoringStorageKey` at 59)
- Test: `apps/client/src/App.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type SoloOpponents = "bots" | "manual";
  export type SoloSetup = Readonly<{ opponents: SoloOpponents; seat: Seat; botSkill: SkillLevel; biddingStyle: "SAYC" | "2/1"; scoring: ScoringFormat }>;
  export const defaultSoloSetup: SoloSetup; // { opponents: "bots", seat: "north", botSkill: "beginner", biddingStyle: "SAYC", scoring: "rubber" }
  export function loadSoloSetup(storage: Pick<Storage, "getItem">): SoloSetup;
  export function saveSoloSetup(storage: Pick<Storage, "setItem">, setup: SoloSetup): void;
  ```
  Storage: opponents, seat, botSkill, biddingStyle as JSON under `contractplay.soloSetup`; scoring stays under the existing `contractplay.scoring` key (`"single"` → single, anything else → rubber) so current players keep their choice. `saveSoloSetup` writes both keys and swallows storage errors. Import `ScoringFormat` from wherever `App.tsx` gets it today.

- [ ] **Step 1: Write the failing tests** in `soloSetup.test.ts` (use an in-memory `Map`-backed storage):
  - `"defaults to bots, North, Beginner, SAYC, rubber"` → `loadSoloSetup(empty)` equals `defaultSoloSetup` with exactly those values.
  - `"round-trips every field"` → save `{ opponents: "manual", seat: "west", botSkill: "expert", biddingStyle: "2/1", scoring: "single" }`, load returns it; `storage.getItem("contractplay.scoring")` is `"single"`.
  - `"keeps a scoring choice stored before this change"` → only `contractplay.scoring = "single"` set → `scoring` is `"single"`, other fields default.
  - `"falls back field by field on bad stored values"` → `contractplay.soloSetup = '{"seat":"up","botSkill":"expert","opponents":7}'` → `{ ...defaultSoloSetup, botSkill: "expert" }`; `"{not json"` → `defaultSoloSetup`.
  - `"ignores storage that throws"` → getItem/setItem that throw: load returns defaults, save does not throw.
- [ ] **Step 2: Run** `pnpm vitest run apps/client/src/soloSetup.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `soloSetup.ts`.**
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Write failing App tests** in `App.test.tsx`, new `describe("Remembered solo setup")` with `beforeEach(() => window.localStorage.clear())`:
  - `"opens against bots by default"` → `render(<App />)`; Opponents combobox value `"bots"`.
  - `"remembers opponents, seat, bot skill and bidding style"` → change Your seat to West, Bot skill to Expert, Bot bidding style to Basic 2/1; `cleanup()`; render again; the three comboboxes show `west`, `expert`, `2/1`.
  - `"keeps preview values and does not write storage in a preview"` → render the `solo-setup` preview path the way `Previews.test.tsx` does (or `App` with a `preview` whose `userSeat` is `"south"` and a separate storage holding seat `west`): Your seat shows `south`; `window.localStorage.getItem("contractplay.soloSetup")` stays `null`.
- [ ] **Step 6: Run** `pnpm vitest run apps/client/src/App.test.tsx -t "Remembered solo setup"` — expect FAIL.
- [ ] **Step 7: Wire `App.tsx`.** Initialise `playAgainstBots`, `userSeat`, `botSkill`, `biddingStyle`, `scoring` from `loadSoloSetup(persistence.storage)`; preview values (`preview.userSeat` → bots + that seat) win over storage. A `useEffect` on those five values calls `saveSoloSetup` unless `frozen`. Replace the local scoring read/write (`scoringStorageKey`) with the module. Keep `hintsStorageKey` and forced play as they are.
- [ ] **Step 8: Fix existing tests that relied on the old Manual-table default.** In `App.test.tsx` (and any other client test that starts a solo hand expecting a manual table), seed manual opponents in the relevant `beforeEach` with `saveSoloSetup(window.localStorage, { ...defaultSoloSetup, opponents: "manual" })`, or select "Manual table" in the test; do not change assertions about game behaviour. `Previews.test.tsx` `solo-setup` already expects `bots`.
- [ ] **Step 9: Run** `pnpm test` and `pnpm typecheck` and `pnpm lint` — expect all PASS.
- [ ] **Step 10: Commit** — `git add apps/client/src/soloSetup.ts apps/client/src/soloSetup.test.ts apps/client/src/App.tsx apps/client/src/*.test.tsx apps/client/src/**/*.test.tsx && git commit -m "Remember solo setup and default to bots"`

### Task 2: Start-now and the Lobby button in solo

**Files:**
- Modify: `apps/client/src/App.tsx` (props at line 110; `goOnline` and the start screen at ~802 and ~878)
- Test: `apps/client/src/App.test.tsx` (`describe("Play online entry")` at ~1984)

**Interfaces:**
- Consumes: Task 1's storage-backed setup (solo deals with whatever setup is stored).
- Produces: `App` prop `autoStart?: boolean` — when true on mount, and the stored current game is absent or its phase is `"passed-out"` or `"complete"`, App calls `startHand()` once; when the current game's phase is `"auction"` or `"play"`, it does nothing (the hand is resumed). Ignored when `preview` is set.

- [ ] **Step 1: Write the failing tests** (stub `fetch` to reject, as the file does elsewhere):
  - Rename the describe to `"Lobby entry"`; `"offers Lobby on the start screen and routes to the lobby"` → button **Lobby** sets `location.hash` to `"#/online"`; no button named "Play online".
  - `"deals at once when asked to start"` → `render(<App autoStart />)` with empty storage; the "New deal" region is gone and the auction is shown (status pill or bidding box present).
  - `"resumes an unfinished hand instead of dealing"` → seed `saveSoloData` with a `currentGame` mid-auction (one bid made, as `Root.test.tsx` builds games); `render(<App autoStart />)`; the auction still holds that bid (Auction calls list has 1 item); `fetch` not called.
  - `"deals once, not on every render"` → `render(<App autoStart />)`, then `rerender(<App autoStart />)`; hands started stays 1 (read `loadSoloData(window.localStorage).handsStarted` after the save effect, or assert the dealt hand id is unchanged).
- [ ] **Step 2: Run** `pnpm vitest run apps/client/src/App.test.tsx -t "Lobby entry"` — expect FAIL.
- [ ] **Step 3: Implement.** Add `autoStart` to App's props; a mount-only effect guarded by a ref so it fires at most once per mount. Rename the start-screen button to **Lobby** (same `goOnline` handler, shown only when `online`).
- [ ] **Step 4: Run** the same command — expect PASS; then `pnpm test`, `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] **Step 5: Commit** — `git commit -am "Let solo start a hand on arrival and link back to the lobby"`

### Task 3: Lobby Play panel, Root wiring, previews and docs

**Files:**
- Modify: `apps/client/src/online/Lobby.tsx` (props at 37–38, `LobbyTables` 164–330), `apps/client/src/Root.tsx`, `apps/client/src/mocks/scenarios.ts` (lobby detail at 145), `apps/client/src/mocks/Previews.test.tsx` (lobby expectation), `README.md` (lines 56, 89, and the lobby row if its title changes), `CHANGES.md`
- Test: `apps/client/src/online/Lobby.test.tsx`, `apps/client/src/Root.test.tsx`

**Interfaces:**
- Consumes: `loadSoloSetup`, `saveSoloSetup`, `SoloSetup` (Task 1); `App` `autoStart` prop (Task 2).
- Produces: `LobbyProps.onPlaySolo(): void` replaces `onSolo`. Root: `openSolo(dialog?: MenuDialog, start = false)` keeps the flag in component state (like `soloDialog`) and renders `<App autoStart={soloStart} … />`; the flag is cleared when the route leaves solo, so returning to `#/solo` later does not deal again.

Panel spec: a `form.lobby-panel` with `aria-label="Play"` and an `<h2>Play</h2>`, placed above Open tables. A radio group `aria-label="Who's playing"` with **Me and bots** (default) and **With other people**. Only the chosen mode's fields render. Me and bots: Your seat (North/East/South/West), Bot skill, Bidding style, Scoring (`Rubber bridge` / `Single deals`), initial values from `loadSoloSetup(storage)`. With other people: the existing Table name, Bidding style, Scoring, Show in lobby controls. One submit button **Play**. The Me-and-bots style and the With-other-people style are separate state; the session form gets its own style state too (default SAYC).

- [ ] **Step 1: Update and write the failing tests** in `Lobby.test.tsx`:
  - Update every `"New table"` click to choose **With other people** then click **Play**; `"creates a table from the form and opens it"` still asserts the same `createTable` input and `onOpenTable` call.
  - `"requires sign-in before showing tables or lobby actions"` → no buttons **Play** or **Solo play**.
  - `"opens recent hands"` → no **Solo play** button exists.
  - New `"starts solo against bots with the chosen settings, without creating a table"` → choose West, Expert, 2/1, Single deals; click **Play**; `onPlaySolo` called once; `createTable` not called; `loadSoloSetup(storage)` equals `{ opponents: "bots", seat: "west", botSkill: "expert", biddingStyle: "2/1", scoring: "single" }`.
  - New `"fills Me and bots from the remembered solo setup"` → storage seeded with seat `east`, skill `advanced`; the panel shows those.
  - New `"keeps the session's bidding style separate from the Play panel's"` → set With other people's Bidding style to 2/1; Session bidding style still `SAYC`; create session → `createSession` input `style` is `"SAYC"`.
- [ ] **Step 2: Update `Root.test.tsx`:** `"renders the lobby for #/online and starts solo from Play"` → click **Play** (Me and bots default); solo shows a dealt hand (no "Start a new hand" button), `location.hash` is `"#/solo"`. Add `"does not deal again when solo is reopened later"`: after that, navigate to `#/online` then back to `#/solo` via hashchange; handsStarted stays 1.
- [ ] **Step 3: Run** `pnpm vitest run apps/client/src/online/Lobby.test.tsx apps/client/src/Root.test.tsx` — expect FAIL.
- [ ] **Step 4: Implement** the panel in `Lobby.tsx` and the Root wiring.
- [ ] **Step 5: Previews.** Update the `lobby` screen detail to "Signed in as Alex with Change name, the Play panel (Me and bots or With other people), and open tables (one mid-hand, one with open seats). Renaming here changes only the preview." Add to its `Previews.test.tsx` expectation: a form named "Play" and radios "Me and bots" / "With other people". Lobby clicks in previews must still not contact the server or write storage — if the preview lobby passes storage, make **Play** a no-op there as existing preview actions are.
- [ ] **Step 6: Docs.** README line 56: "solo play is available from there after sign-in" → "its **Play** panel starts a game against bots on this device or an online table for other people". README line 89: "table creation controls, and solo play" → "the **Play** panel (Me and bots, or With other people)". `CHANGES.md`: a new top entry "One Play entry: the lobby's Play panel starts a solo game against bots or an online table; solo remembers your seat, bot skill, bidding style and opponents, and starts against bots by default." Previews 1–34 keep their titles, so the README preview table is unchanged unless a title changed.
- [ ] **Step 7: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint` — expect all PASS.
- [ ] **Step 8: Commit** — `git add -A apps/client/src README.md CHANGES.md && git commit -m "Merge solo and online starts into one Play panel"`
