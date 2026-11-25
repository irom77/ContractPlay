# Next-hand readiness and the shuffle animation

Status: implemented 2026-11-25.

## Goal

At an online table, the result of a finished hand stays up until every person at the table has confirmed they are
ready, so nobody's review is cut short by someone else pressing Deal. Every newly dealt hand, solo and online, opens
with a short shuffle-and-deal animation.

## Readiness (shared table reducer)

- `TableState.nextHandReady` lists the players who have sent `deal` since the last hand ended
  (`packages/table/src/state.ts`). Every deal clears it, and so does removing the hand (`withoutGame`).
- `readyNeeded(state)` (`packages/table/src/hand.ts`): once a hand has been played and is over, the seated humans who
  are present and play their own seat. Bots, away players, and stand-ins never hold a deal up. Before the first hand,
  and after a cancelled one, nothing is awaited.
- `dealsNow(state, player)`: the `deal` message deals the hand only when every needed player other than the sender has
  confirmed; otherwise `dealHand` records the sender as ready (a repeat confirmation is a no-op). A ready player who
  presses again after the others went away deals.
- `viewFor` adds `nextHand: { ready, waitingOn }` (seats) between hands; protocol version 8.
- The table Durable Object asks the deal archive for a replay only when the message will deal (`dealsNow`), so bare
  confirmations never read D1.

## Client

- `DealButton` (`apps/client/src/online/SeatingPanel.tsx`), on the result card and the seating screen: **Ready**
  while others still need to confirm, disabled **Waiting for …** once you have, **Deal** when nobody else is awaited.
- `useDealAnimation` and `DealAnimation` (`apps/client/src/table/DealAnimation.tsx`): a hand that appears while the
  table is already known plays a ~2.1 s riffle (two packets fanning out and interleaving, twice) and a pitch of eight
  cards to the seats; `TableView`'s `dealing` prop adds the overlay and fades the hands, calls, and bidding box in as
  it ends. A reload or reconnect mid-hand does not replay it; `prefers-reduced-motion` skips it.
- Preview 36 (`result-waiting`) shows a result waiting on East.
