# Claims, queued cards, and face-down hands — design

Date: 2026-11-12. Status: agreed in conversation; builder check done (calls marked "claude's call").

## Intent

Three play-phase improvements, for solo play against robots and for online tables with people:

1. **Claim**: end an obvious ending without playing every card.
2. **Queue the next card**: pick your card while others are still playing; it goes when your turn comes.
3. **Face-down hands**: the table shows card backs at seats whose cards you can't see, instead of empty space.

Success: a hand where the rest is obvious ends in one action. A player who already knows their card doesn't have to wait for their turn to pick it. The table looks like four people holding cards.

## Goals

- Claims work in solo and online play, from declarer or either defender.
- Robots judge a claim by checking it against all four hands, and never accept an unproven claim.
- Claimed hands score, save, review, and export like played hands.
- Queued cards work in solo and online play, for your own hand and (as declarer) dummy.
- Face-down backs in solo and online, during the auction and play.
- `#/mocks` previews and README table stay current.

## Non-goals

- Robots making claims themselves.
- Conceding (claiming 0 is allowed, but there is no separate "concede" button).
- A general double-dummy solver for hints. The search below is only for checking claims, though it may later feed the `Solver` hint interface.
- Claim disputes or a director. A rejection simply resumes play.

## Anti-goals

- A robot accepting a claim that could fail against best defence. If the robot can't prove the claim, it rejects it.
- A queued card ever playing an illegal card or a card from the wrong hand.
- Leaking hidden cards. Card backs show counts only, and the online view still sends empty arrays for hidden hands.

## Rules decided

### Claim

- **Who:** any player who controls the hand on lead or to play, on their turn, during the play phase. Declarer claims for the declaring side whether it is declarer's or dummy's turn. A defender claims on their own turn. Dummy's owner cannot claim, except when the online "human dummy controls a bot declarer" rule makes them the controller (`deciderOf`). Then they claim as the declaring side's controller.
- **The action's seat** *(claude's call, from the builder check)*: core does not know who sits where, so the `claim` action records the **side's seat**. That is declarer for a declaring-side claim, whether declarer or dummy is to act and whoever controls them. For a defender's claim it is the defender to act. `applyAction` checks only this: if declarer or dummy is to act, `seat` must be declarer; otherwise `seat` must be `currentActor`. The table package maps the person to that seat with `deciderOf` before building the action. PBN import uses the same mapping from "the player to act". History text names the side's seat ("Claimed by North (declarer)").
- **Mid-trick claims are allowed.** "Remaining tricks" means `13 − completedTricks.length`, including the trick in progress.
- **What:** the claimer picks "all remaining" or a number from 0 to the remaining count. The number is how many of the remaining tricks the **claimer's side** wins.
- **Who answers:** the opposing side.
  - Opposing defenders: every human defender (not on a stand-in or Auto play) must accept. A defender played by a robot or stand-in runs the check.
  - Opposing declaring side: whoever `deciderOf` says controls declarer. If that is a human, they answer. If it is a robot, it runs the check.
  - If every answer is accept, the claim is applied. The first rejection cancels the claim, and play continues where it stopped.
- **The robot check:** exact search (minimax with alpha-beta over all four actual hands, from the current position including any partial trick). The claim is proven if the claimer's side can guarantee at least the claimed number of the remaining tricks against every defence. The search has a node budget. If it runs out, the result is "unknown" and the robot rejects. The budget is the builder's choice, sized to stay well inside a Cloudflare Workers request's CPU time. Prefer ordering moves and treating equivalent cards (touching ranks in one hand) as one move.
- **Claimer's cards are shown** to the claimer's opponents while the claim is pending (not to partner), as in real bridge. *(Builder may skip this for solo, where the robot already sees everything.)*
- **While a claim is pending,** no cards can be played, robots do not act, and the claimer can withdraw it. Take-back and Cancel hand still work and clear the claim. Leaving or handing a seat to a robot also clears it. *(The simple rule: any seat or game change clears a pending claim.)*
- **Applied claim:** recorded as a game action `{ type: "claim", seat, tricks }` in core history, only once accepted. Applying it sets phase `complete`. The declaring side's tricks are `won so far + (claimer is declaring side ? tricks : remaining − tricks)`, scored with the existing `scoreContract`. The state keeps `claim: { seat, tricks }` for display. Unplayed cards stay in `hands`. Undo/rewind/replay treat it like any action.
- **Away responders online** *(claude's call)*: a human defender or declarer who must answer and is away (no stand-in) holds the claim open. There is no timeout. The claimer can withdraw. If another player hands the away seat to a robot, the pending claim is **kept**, and the new stand-in answers with the robot check. This is the one exception to "seat changes clear a pending claim". `tick` needs no claim logic.
- **Solo modes** *(claude's call)*:
  - Against robots: the robots on the other side answer with the check.
  - Manual table (one person plays all four seats): Claim is offered and applies at once, because the same person is both sides. There is no card queue (every turn is yours). Seats not currently shown display card backs as normal.
  - While robots finish the hand (`botsFinishing`) and during review, there is no Claim and no queue. Card backs show as normal.
- **Security rules** *(claude's call (security review))*:
  - Answers carry the claim's id, so a stale answer cannot settle a newer claim.
  - After a rejection or withdrawal, that side cannot claim again until the trick ends.
  - The claimer's cards are revealed to opponents only.
- **Rejection feedback:** the claimer sees who rejected (for example, "West rejected your claim of 3 tricks"). It stays until the next game action.

### Queue the next card

- Client-only; no protocol or core change.
- During play, when it is not your turn, your playable hand's cards (and dummy's, if you are declarer or control dummy) are clickable. A click queues that card. The queued card is raised and outlined, and the status text says "Queued: 7♠". Clicking it again un-queues it, and clicking another card replaces it. One card is queued at most, across both hands.
- When the queued card's seat becomes the one you are to act for, the card plays after `FORCED_PLAY_MS` if it is still legal. If not, the queue is cleared silently and you play normally.
- The queue is cleared on take-back, a new hand, a claim being made or pending, Auto play turning on, and on reconnect/view of a different hand.
- A forced card (only legal play) still plays automatically. If a queued card exists for that seat, it is necessarily the same card or illegal.
- Hints keep showing on your turn as now. The queue doesn't change them.

### Face-down hands

- During the auction and play (not on the result screen, where all hands are revealed), every seat whose cards the viewer cannot see shows one card back per card that seat still holds.
- Count = 13 − cards that seat has played (from completed tricks and the current trick). This works for the online `PublicGame` (hidden hands are empty arrays) and for solo.
- Layout: the same seat area dummy uses. Top seat is a horizontal fan. Side seats are a compact vertical fan, overlapping heavily, so the table fits a phone width. When a seat is face-up (dummy, a revealed claimer hand, a declarer shown to a human dummy), it shows faces instead.
- Card backs are decorative (`aria-hidden`). The seat's accessible label gains "N cards".

## Constraints

- `packages/core` stays platform-neutral and immutable. The claim action is validated in `applyAction` (phase, seat on turn per the rules above, tricks in range).
- The claim search lives in `packages/bots` (it is a robot capability), exported for the client and the table package.
- Online: `ClientMessage` gains `{ type: "claim"; tricks }`, `{ type: "answerClaim"; accept: boolean }`, and `{ type: "withdrawClaim" }`. `TableState` gains `pendingClaim?: { seat, tricks, accepted: Seat[] }` and a short-lived `claimRejected?: { seat, tricks, by: Seat }`. `TableView` exposes both plus the claimer's hand while pending. Protocol version goes to 3. The robot check runs in the table package when a claim needs a robot's answer. The reducer stays synchronous if the search is synchronous with a budget; otherwise, follow the `chooseBotAction` pattern.
- Persistence: the saved-game validator must accept `claim` actions. Older saves stay valid. Bump the data version only if needed.
- PBN: export writes the played cards followed by `*` and a `[Result "N"]` tag (declarer's total tricks) for claimed hands. Import treats `*` plus `Result` as a claim by the player to act, when the result is consistent. Otherwise it keeps today's behaviour.
- Hand review and history show "Claimed by South: 3 of the remaining 4 tricks" as the last step.
- Previews: add a "Claim pending, waiting on you" screen and a "Card queued" screen. Existing screens will show card backs automatically. Update `Previews.test.tsx` expectations and the README preview table.
- Docs: TODO.md, CHANGES.md, README (Status and online-tables sections mention claims, queueing, and card backs).

## Left to the builder

- Search budget, move ordering, and caching details.
- Exact claim UI: placement of the Claim button (game menu online and table menu solo, or a play-area button) and the number picker. Keep it to one tap for "all remaining".
- Card-back artwork (CSS is fine) and exact overlap amounts.
- Whether the rejection notice uses the status pill or the overlay messages area.
- Plan file under `docs/superpowers/plans/`.
