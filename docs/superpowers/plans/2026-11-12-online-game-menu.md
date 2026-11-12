# Online Game Menu Implementation Plan

**Goal:** Replace the online table's lone "Back to lobby" button with a collapsible, extensible game menu that also offers Take back and leaving or cancelling the game.

**Architecture:**
- `packages/core`: `rewindTo(state, count)` rebuilds a game after its first `count` actions, keeping the rest as redoable history.
- `packages/protocol`: new client messages `takeBack` and `cancelHand`.
- `packages/table`:
  - `takeBack` walks back through the hand's actions to the sender's most recent decision (their seat, or dummy/declarer as controller) and rewinds to just before it, undoing bot actions since. It refuses if another human without a stand-in acted after it, so no other person's decision is undone.
  - `cancelHand` (host only, live hand) removes the game without scoring it.
  - `leave` now works mid-hand: a bot (intermediate) takes the seat over for good, or the hand is abandoned when no other human is seated.
- `apps/client`:
  - `table/GameMenu.tsx` is a generic `<details>` menu driven by a `GameMenuItem[]` list. To add an option, add an item.
  - `OnlineTable` builds the items, enables Take back only when the service would accept it (mirroring the rule above from the public game), and returns to the lobby after Leave only once a view without a seat arrives.
- Previews: screen 9 "Game menu" shows the menu open mid-hand.

## Status

- [x] Core `rewindTo` with test.
- [x] Protocol messages with parse test.
- [x] Table reducer rules with tests (take back of a call and of a card, the other-human guard, host-only cancel, mid-hand leave, last human leaving).
- [x] Client menu with tests, preview screen, and README preview table.
