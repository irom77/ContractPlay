# Claims, Queued Cards, and Face-Down Hands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players claim remaining tricks (checked exactly by robots, answered by people online), queue their next card before their turn, and see card backs for hands they can't see.

**Architecture:** A `claim` game action in `packages/core` ends the hand and scores it. A budgeted exact search in `packages/bots` proves or refutes a claim. `packages/table` holds a pending claim between the claim and its answers, and robots answer it synchronously inside the reducer. The client gets shared `TableView` support for card backs and queued cards, plus a shared claim panel wired into solo `App.tsx` and online `OnlineTable.tsx`.

**Tech Stack:** TypeScript, React, Vitest, pnpm workspaces, Cloudflare Worker (Durable Object) server.

**Spec:** `docs/superpowers/specs/2026-11-12-claim-queue-card-backs-design.md`

## Global Constraints

- `packages/core` stays platform-neutral; `GameState` stays immutable; `applyAction` validates every action before it is recorded.
- The claim action is `{ type: "claim"; seat: Seat; tricks: number }`. `seat` is declarer for a declaring-side claim (whether declarer or dummy is to act), otherwise the defender to act. `tricks` is the number the claimer's side wins of the `13 − completedTricks.length` remaining tricks, including the trick in progress; `0 ≤ tricks ≤ remaining`.
- Robots never make claims, and they reject any claim the search does not prove, including when the search runs out of nodes ("unknown").
- Hidden hands stay empty arrays in the online view. Card backs come from counts only. While a claim is pending, the claimer's hand (the declaring side claims with declarer's cards; dummy is already face-up) is sent to everyone.
- `PROTOCOL_VERSION` becomes `3`.
- Queued cards are client-only. They play after `FORCED_PLAY_MS` (500 ms) when still legal, and are cleared silently otherwise.
- Any seat or game change clears a pending claim, except `handToBot` on a seat that still has to answer: there the stand-in answers with the robot check.
- Copy: claim history and review text is `Claimed by <Seat> (declarer)` or `Claimed by <Seat>`, followed by `: N of the remaining M tricks`. The rejection notice is `<Seat> rejected the claim of N tricks`.
- Every new or altered screen gets a `#/mocks` preview, an expectation in `Previews.test.tsx`, and a row in the README preview table.
- Verification commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`. Report actual output. Don't claim unrun checks passed.

## Review Focus

1. **Mid-trick claim:** a claim made with 2 cards of the current trick played counts that trick in "remaining", and scoring adds the claimed tricks to the tricks already won. (Test in Task 1.)
2. **Robot check on a full 13-card hand:** it must return within the node budget, as "unknown" if need be, and never hang the Worker. (Test in Task 2.)
3. **Declarer queues a card for their own hand while dummy is next:** the card must wait for declarer's own turn and must not be played from dummy. (Test in Task 6.)
4. **Play while a claim is pending:** `act` from anyone is refused, and `botToAct` returns undefined, so nobody plays on under a claim. (Test in Task 4.)
5. **Claim reveal leaks:** while a claim is pending, `viewFor` shows the claimer's hand and nothing else hidden, and once the claim is rejected the hand is hidden again. (Test in Task 4.)

---

### Task 1: Core claim action

**Files:**
- Modify: `packages/core/src/history.ts` (GameAction union)
- Modify: `packages/core/src/game.ts` (GameState, RuleError codes, applyAction, rebuild)
- Test: `packages/core/src/game.test.ts`

**Interfaces:**
- Produces:
  - `GameAction` gains `Readonly<{ type: "claim"; seat: Seat; tricks: number }>`.
  - `GameState.claim?: Readonly<{ seat: Seat; tricks: number }>`.
  - `RuleError["code"]` gains `"invalid-claim"`.
  - `export function remainingTricks(state: GameState): number` returns `13 − completedTricks.length`.
  - `export function claimSeatFor(state: GameState): Seat | undefined` returns the seat a claim on this turn records: declarer when `currentActor` is declarer or dummy, otherwise `currentActor`, and undefined outside play.

- [ ] **Step 1: Write failing tests** in a `describe("claims")` block. Use a helper that plays an auction to 4♠ by South (from the existing fixtures in `game.test.ts`), then plays N cards.
  - `it("lets declarer claim all remaining tricks when dummy is to play")`: after the opening lead and one more card, with dummy to act, `applyAction(state, { type: "claim", seat: "south", tricks: remainingTricks(state) })` is ok. `phase === "complete"`, `claim` is `{ seat: "south", tricks: 13 }`, and `score.tricksTaken === 13`.
  - `it("counts the trick in progress as remaining")`: after one completed trick won by the defence and two cards of trick 2, `remainingTricks === 12`. A defender claim (`seat` = the defender to act) of 2 gives declarer `score.tricksTaken === 10`.
  - `it("refuses dummy's seat, an off-turn defender, and an out-of-range count")`: each returns `{ ok: false, error: { code: "invalid-claim" } }`, as do `tricks: -1` and `tricks: remaining + 1`. During the auction the result is `wrong-phase`.
  - `it("undoes a claim like any action")`: `undoAction` after a claim gives back the pre-claim state, with `phase === "play"` and no `claim` key.
- [ ] **Step 2:** Run `pnpm vitest run packages/core/src/game.test.ts`. Expect the new tests to FAIL.
- [ ] **Step 3: Implement** `applyClaim` in `game.ts`, dispatched from `applyAction` on `action.type === "claim"`.
  - Validate in this order: phase (`wrong-phase`); then `action.seat === claimSeatFor(state)` and `Number.isInteger(tricks)` in range (`invalid-claim`).
  - Declaring tricks are the tricks won in `completedTricks` by the declaring side, plus `tricks` if the claimer is on the declaring side, else `remaining − tricks`.
  - Return `{ ...state, phase: "complete", claim, score: scoreContract(...), history: recordAction(...) }`, leaving `hands` and `currentTrick` unchanged.
  - Check that `rebuild`/`rewindTo` replays the claim (it goes through `applyAction`). Export `remainingTricks` and `claimSeatFor` from `index.ts`.
- [ ] **Step 4:** Run `pnpm vitest run packages/core`. Expect PASS. Run `pnpm typecheck` and fix any exhaustive `action.type` switches it reports (for example `pbn.ts`, `persistence`, `savedHand.ts` now see a third type; minimal compile fixes only, real handling comes in Task 3).
- [ ] **Step 5: Commit** with `feat(core): add the claim action`.

### Task 2: Robot claim check

**Files:**
- Create: `packages/bots/src/claim.ts`
- Modify: `packages/bots/src/index.ts` (export)
- Test: `packages/bots/src/claim.test.ts`

**Interfaces:**
- Consumes: `remainingTricks`, `claimSeatFor`, `GameState`, `trickWinner`, `validatePlay` from core.
- Produces:
  - `export type ClaimVerdict = "proven" | "refuted" | "unknown"`.
  - `export const CLAIM_SEARCH_NODES = 20_000`.
  - `export function checkClaim(state: GameState, claim: { seat: Seat; tricks: number }, maxNodes = CLAIM_SEARCH_NODES): ClaimVerdict`.

- [ ] **Step 1: Write failing tests:**
  - `it("proves a claim of all top trumps")`: a 3-card ending where declarer holds the three top trumps, all trumps are out, and declarer is on lead. `tricks: 3` is `"proven"`.
  - `it("refutes a claim that loses to best defence")`: a 2-card ending where the defender holds the ♠A behind declarer's ♠K. `tricks: 2` is `"refuted"` and `tricks: 1` is `"proven"`.
  - `it("checks a claim from inside a trick")`: a position with 1 card of the current trick already played gives the correct verdict.
  - `it("checks a defender's claim")`: the same as the first test, with the seats swapped so a defender claims.
  - `it("gives up as unknown on a full hand with a tiny budget")`: a fresh 13-card play position with `maxNodes = 50` returns `"unknown"`.
  - `it("stays fast on a full hand at the default budget")`: on the same position, `performance.now()` around `checkClaim` is under 250 ms, and the result is one of the three verdicts.
- [ ] **Step 2:** Run `pnpm vitest run packages/bots/src/claim.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement `checkClaim`.** The algorithm isn't determined by the tests, so here it is:
  - It is a boolean search: "can the claimer's side win at least `tricks` of the remaining tricks against every defence?"
  - `search(position, need)`: if `need ≤ 0`, return true. If `need > tricks left`, return false. Otherwise generate the legal moves of the side to act. Collapse touching ranks held by one hand into one move: two ranks count as touching if every rank between them has already been played or is in the same hand. Order the moves highest rank first.
  - When the claimer's side is to act, return true if **any** move succeeds. When the other side is to act, return true only if **every** move does. Completing a trick reduces `need` when the claimer's side wins it.
  - Count nodes. Once the count exceeds `maxNodes`, throw a private sentinel, catch it at the top, and return `"unknown"`.
  - Work on plain mutable arrays copied from `state` (do not call `applyAction` per node). The state passed in is not mutated.
- [ ] **Step 4:** Run `pnpm vitest run packages/bots`. Expect PASS. Record the measured full-hand time in the commit message.
- [ ] **Step 5: Commit** with `feat(bots): add an exact claim check with a node budget`.

### Task 3: Saving, PBN, and online history for claims

**Files:**
- Modify: `packages/persistence/src/index.ts:75-76` (action validator)
- Modify: `packages/pbn/src/pbn.ts` (serialize, parse)
- Modify: `apps/client/src/online/savedHand.ts`
- Modify: `apps/client/src/App.tsx` (review step text, if review lists actions) and `apps/client/src/table/labels.tsx`
- Test: `packages/persistence/src/local-solo-store.test.ts`, `packages/pbn/src/pbn.test.ts`, `apps/client/src/online/savedHand.test.ts`, `apps/client/src/table/labels.test.tsx`

**Interfaces:**
- Consumes: the Task 1 claim action and `GameState.claim`.
- Produces:
  - `export function claimText(claim: { seat: Seat; tricks: number }, declarer: Seat, remaining: number): string` in `labels.tsx`. It returns `"Claimed by South (declarer): 3 of the remaining 4 tricks"`, or `"Claimed by West: 1 of the remaining 4 tricks"` for a defender.
  - `PublicGame` will include `claim` (Task 4 adds it to the Pick). `savedHandFrom` appends `{ type: "claim", ...game.claim }` when present.

- [ ] **Step 1: Write failing tests:**
  - Persistence: a saved game whose history ends in a claim action loads back equal to the original. A claim with a non-integer `tricks` is rejected like any malformed action.
  - PBN: a claimed hand serializes to a `[Play ...]` section ending with ` *` and a `[Result "10"]` tag. Parsing that text back gives the same actions, including the claim. Parsing `*` with a `Result` that is inconsistent (more than tricks possible) keeps today's behaviour and adds a warning diagnostic.
  - `savedHandFrom`: a view whose game has `claim: { seat: "south", tricks: 3 }` gives a saved game with `phase: "complete"` and `claim` set.
  - `claimText`: both strings above.
- [ ] **Step 2:** Run the four test files. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The validator accepts `type === "claim"` with an integer `tricks` from 0 to 13. Leave the data version at 1, since older saves are still valid.
  - PBN serialize: after the played cards, when `game.claim` is set, write `*` and add `Result` = the declaring side's total tricks. Parse: on `*`, if a `Result` tag is present and the play state is in phase play, let `more = Result − declaring tricks already won`. Build the claim `{ seat: claimSeatFor(playState), tricks: claimer is declaring side ? more : remainingTricks − more }`. Apply it, and warn if it doesn't apply.
  - The review shows `claimText` as the status when the review cursor sits on a claim action.
- [ ] **Step 4:** Run `pnpm test`. Expect PASS.
- [ ] **Step 5: Commit** with `feat: save, export, and review claimed hands`.

### Task 4: Online claims in protocol and table

**Files:**
- Modify: `packages/protocol/src/index.ts` (version, messages, view, parser)
- Create: `packages/table/src/claim.ts`
- Modify: `packages/table/src/state.ts`, `reduce.ts`, `hand.ts` (act/botToAct/takeBack/cancelHand), `presence.ts` (handToBot, leave via seats), `view.ts`, `index.ts`
- Test: `packages/protocol/src/index.test.ts`, `packages/table/src/claim.test.ts`, `packages/table/src/view.test.ts`

**Interfaces:**
- Consumes: `checkClaim` (Task 2), `claimSeatFor`/`remainingTricks` (Task 1), `deciderOf` (hand.ts).
- Produces:
  - Protocol: `PROTOCOL_VERSION = 3`. `ClientMessage` gains `{ type: "claim"; tricks: number } | { type: "answerClaim"; accept: boolean } | { type: "withdrawClaim" }`.
  - `PublicGame` picks `"claim"` too.
  - `TableView` gains `claim?: { seat: Seat; tricks: number; waitingOn: Seat[] }` and `claimRejected?: { seat: Seat; tricks: number; by: Seat }`.
  - `TableState` gains `pendingClaim?: { seat: Seat; tricks: number; accepted: Seat[] }` and `claimRejected?: { seat: Seat; tricks: number; by: Seat }`.
  - In `claim.ts`: `claim(state, player, tricks, at): Outcome`, `answerClaim(state, player, accept, at): Outcome`, `withdrawClaim(state, player, at): Outcome`, `claimResponders(state): Seat[]` (the seats that must answer: for the defending side each defender seat; for the declaring side `deciderOf(state, declarer)`), and `withoutClaim(state): TableState`.

- [ ] **Step 1: Write failing tests** in `claim.test.ts`, using `test-helpers.ts`. Set up a table in play with South human declarer, North bot, and East/West humans; another setup has East human and West bot.
  - `it("lets the human on turn claim and waits on both human defenders")`: `waitingOn` is `["east","west"]`. After East accepts, `waitingOn` is `["west"]`. After West accepts, the game is complete with `claim` set and the totals updated.
  - `it("cancels on the first rejection and records who rejected")`: `pendingClaim` is cleared, `claimRejected.by === "east"`, the phase is still play, and the next `act` clears `claimRejected`.
  - `it("has a robot defender answer at once with the check")`: for a provable claim, the robot is accepted in the same reduce. For a refuted or unknown claim, the claim is rejected with `by` = the robot's seat.
  - `it("refuses claims off turn, from a dummy, while pending, and outside play")`: refusals are `not-your-turn`, `not-your-turn`, `not-allowed`, and `not-allowed`.
  - `it("freezes play while a claim is pending")`: `act` is refused `not-allowed`, and `botToAct(state)` is undefined.
  - `it("clears a pending claim on take-back, cancel, and leave, but keeps it when an away responder is handed to a bot")`: in the handToBot case, the stand-in answers immediately with the check.
  - `it("lets the claimer withdraw")`.
  - In `view.test.ts`, `it("reveals the claimer's hand only while the claim is pending")`: while pending, East sees South's cards. After the rejection, East's view has `hands.south` empty again.
  - Protocol: parse round-trips for the three new messages. `claim` with `tricks` of -1, 14, or 1.5 is rejected.
- [ ] **Step 2:** Run `pnpm vitest run packages/table packages/protocol`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The claimer is `seatOf(player)`, who must be `deciderOf(state, currentActor)` and not on a stand-in.
  - The action seat is `claimSeatFor(game)`.
  - Validate the count with `remainingTricks`.
  - Robot responders (bot seats, or humans with `standIn`) are resolved at once: run `checkClaim` on `state.game`, accept on `"proven"`, reject otherwise.
  - When `accepted` covers all of `claimResponders`, call `record(...)` with the claim action. Export `record` from `hand.ts` for this; it already handles totals and the Auto play reset.
  - Every other mutating path (`act`, `takeBack`, `cancelHand`, `leave`, `clearSeat`, `resume`, `autoPlay`) goes through `withoutClaim`.
  - `handToBot` keeps the claim and re-runs the robot answers.
  - `viewFor` adds the claimer's real hand to `publicGame` while pending, and sets `claim.waitingOn` = responders not yet in `accepted`.
- [ ] **Step 4:** Run `pnpm test`, which includes the server tests. Expect PASS. If `apps/server` has a version test, update it to 3.
- [ ] **Step 5: Commit** with `feat(table): online claims answered by people or checked by robots`.

### Task 5: Card backs at hidden seats

**Files:**
- Modify: `apps/client/src/table/labels.tsx` (`cardsHeld`)
- Modify: `apps/client/src/table/TableView.tsx` (seat rendering)
- Modify: `apps/client/src/styles.css` (`.card-back`, `.hidden-hand`, side and top fans)
- Test: `apps/client/src/table/TableView.test.tsx` (create)

**Interfaces:**
- Produces:
  - `export function cardsHeld(game: PublicGame, seat: Seat): number` returns 13 minus that seat's cards in `completedTricks` and `currentTrick`.
  - `TableView` prop `exposedSeat?: Seat`: a seat to show face-up at its place (the claimer's hand while a claim is pending).
  - A hidden seat renders `<div className="hidden-hand" aria-hidden="true">` with `cardsHeld` `.card-back` spans. The seat compass `aria-label` gains `, N cards`.

- [ ] **Step 1: Write failing tests** (render `TableView` with a `PublicGame` built from `createGameState` plus a few plays, hidden hands emptied like `publicGame` does):
  - `it("shows 13 backs at each hidden seat during the auction")`.
  - `it("shows one fewer back after a seat plays")`: after the opening lead, the leader's seat has 12 backs.
  - `it("shows dummy and an exposed seat face-up, not as backs")`.
  - `it("shows no backs on a completed hand")`.
  - `it("never puts card names in hidden seats")`: no element inside `.hidden-hand` has an `aria-label` containing " of ".
- [ ] **Step 2:** Run `pnpm vitest run apps/client/src/table/TableView.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - A seat is hidden when the phase is auction or play, it is not the bottom seat's displayed hand, it is not showing face-up cards (`seatHasCards`), it is not `exposedSeat`, and `cardsHeld > 0`.
  - Solo has full hands, but it should follow the same rule: use `cardsHeld`, never `hands[seat].length`, for the count.
  - The top seat is a horizontal overlapping row, and the side seats are a vertical overlapping column. The table must still fit 360 px wide with no horizontal scroll. Check this in the `#/mocks` screens at phone width.
- [ ] **Step 4:** Run `pnpm test`. Expect PASS, including `Previews.test.tsx`. Existing screens now show backs, and their expectations should still hold.
- [ ] **Step 5: Commit** with `feat(client): show card backs for hidden hands`.

### Task 6: Queue the next card

**Files:**
- Create: `apps/client/src/table/queuedCard.ts`
- Modify: `apps/client/src/table/TableView.tsx` (queue props and rendering)
- Modify: `apps/client/src/App.tsx`, `apps/client/src/online/OnlineTable.tsx`
- Modify: `apps/client/src/styles.css` (`.queued-card`: raised and outlined)
- Test: `apps/client/src/table/queuedCard.test.ts`, `apps/client/src/App.test.tsx`, `apps/client/src/online/OnlineTable.test.tsx`

**Interfaces:**
- Produces:
  - `export type QueuedCard = { handKey: string; seat: Seat; card: Card }`. `handKey` identifies the hand: the solo `currentHandId`, or the online `handNumber`.
  - `export function queuedPlay(game: PublicGame, queued: QueuedCard | undefined, actingSeat: Seat | undefined): Card | undefined`. It returns the card only when `actingSeat === queued.seat === game.currentActor` and the card is legal (`validatePlay` with the led suit). Otherwise it returns undefined.
  - `export function queueStillValid(game: PublicGame, queued: QueuedCard, handKey: string): boolean`. It returns false when the hand differs, the phase is not play, a claim is pending, or the card is no longer in a visible hand. It also returns false when the seat is to act and the card is illegal.
  - `TableView` props: `queueSeats?: readonly Seat[]` (seats whose cards may be queued now), `queuedCard?: { seat: Seat; card: Card }`, and `onQueue?(seat: Seat, card: Card): void`. A queueable card is a button labelled `Queue <card>`, or `Unqueue <card>` when it is the queued card.

- [ ] **Step 1: Write failing tests.**
  - Unit (`queuedCard.test.ts`):
    - `queuedPlay` returns the card on its seat's turn.
    - It returns undefined on the partner seat's turn. This is Review Focus 3: declarer queued a card from their own hand and dummy is to act.
    - It returns undefined when the card is illegal because the player must follow suit.
    - `queueStillValid` is false on a new hand, and false while `claim` is pending.
  - Solo (`App.test.tsx`, with fake timers): against bots, on a bot's turn, click `Queue <card>`. The status shows `Queued: <card>`. Advance the bots. On the user's turn after `FORCED_PLAY_MS` the card has been played. Clicking the queued card again removes the queue. A queued card that becomes illegal is dropped, and the user's cards are enabled. Manual table shows no `Queue` buttons.
  - Online (`OnlineTable.test.tsx`): queue during another seat's turn. When the next view makes it your turn, an `act` with that card is sent after `FORCED_PLAY_MS`. With a stand-in (Auto play), no `Queue` buttons appear.
- [ ] **Step 2:** Run those test files. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `queueSeats`: in solo against bots, it is the user's seat, plus dummy when the user is declarer and dummy is visible. Online, it is your seat, plus dummy when you are its decider. It is empty while it's your turn for that seat, during the auction, during review, while bots finish, during Manual table, under a stand-in, and while a claim is pending.
  - Both apps hold `const [queued, setQueued] = useState<QueuedCard>()`. Drop it when `queueStillValid` is false or when `queueSeats` no longer includes its seat (this covers Auto play, bots finishing, and stand-ins). Play it in the same effect style as forced play: `setTimeout(FORCED_PLAY_MS)`, which in solo applies the action, and online sends `act`. The forced-card effect stays as it is; when both apply, it is the same card, so guard against a double send by running only one effect per turn.
  - Take-back clears the queue.
  - The status pill shows `Queued: <card label>` while a card is queued and it isn't your turn.
- [ ] **Step 4:** Run `pnpm test`. Expect PASS.
- [ ] **Step 5: Commit** with `feat(client): queue your next card while others play`.

### Task 7: Claim UI in solo and online

**Files:**
- Create: `apps/client/src/table/ClaimPanel.tsx`
- Modify: `apps/client/src/App.tsx` (solo claim flow), `apps/client/src/online/OnlineTable.tsx` (online claim flow, menu item), `apps/client/src/table/GameMenu.tsx` if needed
- Modify: `apps/client/src/styles.css`
- Test: `apps/client/src/App.test.tsx`, `apps/client/src/online/OnlineTable.test.tsx`

**Interfaces:**
- Consumes: `checkClaim` (Task 2), `claimSeatFor`/`remainingTricks` (Task 1), `claimText` (Task 3), the Task 4 view fields and messages, and `exposedSeat` (Task 5).
- Produces: `ClaimPanel` with props `{ mode: "pick"; remaining: number; onClaim(tricks: number): void; onCancel(): void }`, `{ mode: "pending"; text: string; onWithdraw?(): void }`, or `{ mode: "answer"; text: string; onAccept(): void; onReject(): void }`.
  - The picker has a primary `Claim all N` button, a number stepper from 0 to N with `Claim`, and `Cancel`.

- [ ] **Step 1: Write failing tests.**
  - Solo against bots: on the user's play turn, the table menu has `Claim`. `Claim all 13` from a provable ending is accepted: the hand is complete and the result shows `claimText`. A refuted claim shows `<Seat> rejected the claim of N tricks`, and play continues with the user still to act. In Manual table, a claim is applied immediately. No `Claim` item appears on a bot's turn, during review, or while bots finish.
  - Online:
    - On your turn, the game menu has `Claim`, and choosing all sends `{ type: "claim", tricks: N }`.
    - With a view that has `claim.waitingOn` containing your seat, `Accept` and `Reject` buttons send `answerClaim`.
    - The claimer sees `Waiting for East, West` and `Withdraw`.
    - The claimer's cards are shown face-up at their seat (via `exposedSeat`).
    - `claimRejected` shows the rejection notice.
- [ ] **Step 2:** Run those test files. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Solo: robots on the other side answer with `checkClaim(game, claim)` after `BOT_PAUSE`-like 800 ms, so the player sees "Checking…". Accept means `applyAction(claim)`; reject means a message.
  - Online: the claim item is shown when `actingSeat` is defined, the phase is play, and no claim is pending. The answer panel takes priority over other overlay content.
  - Pass `exposedSeat = view.claim?.seat` mapped to the claimer's hand seat (declarer for a declaring-side claim).
- [ ] **Step 4:** Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`. Expect all three to pass.
- [ ] **Step 5: Commit** with `feat(client): claim remaining tricks in solo and online play`.

### Task 8: Previews and docs

**Files:**
- Modify: `apps/client/src/mocks/scenarios.ts`, `apps/client/src/mocks/Previews.test.tsx`
- Modify: `README.md` (preview table, Status, Online tables), `TODO.md`, `CHANGES.md`

**Interfaces:**
- Consumes: Tasks 4–7.

- [ ] **Step 1: Write failing expectations.**
  - Add `claim-answer` after `auto-play`: "Claim waiting on you". You are East; South claims all remaining tricks. Expect `Accept` and `Reject` buttons and South's cards face-up.
  - Add `queued` after `defending-right`: "Card queued". You are West, East to play, a card queued. Expect one button labelled `Unqueue …` and the status text `Queued:`.
  - In `defending-left`, add an expectation that the top seat shows `.hidden-hand .card-back` elements.
- [ ] **Step 2:** Run `pnpm vitest run apps/client/src/mocks`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Build both screens in `scenarios.ts` through `run(...)` with the real reducer. For `queued`, pass the preview's initial queued card through whatever prop path `OnlineTable` already exposes for previews, or add an optional `initialQueued` prop.
  - Update the README table: 13 screens, with the numbering following `previewScreens`.
  - README Status gets one sentence each for claims, the card queue, and card backs. "Online tables → Play" gets the claim answer rules.
  - TODO: add a checked item under Online multiplayer.
  - CHANGES: add a user-facing entry.
- [ ] **Step 4:** Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`. Expect PASS. Open `#/mocks` with `pnpm web:dev` and step through the screens at desktop and 390 px widths.
- [ ] **Step 5: Commit** with `docs: previews and docs for claims, queued cards, and card backs`.
