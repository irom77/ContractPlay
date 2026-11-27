# Preview a call before making it

## Intent

During the auction, a player wants to try calls and read what each would tell partner before committing to one,
so they learn the system instead of guessing. Today one tap on the bidding box makes the call.

## Approaches

1. **Select, then confirm** (chosen). A tap selects a call and shows its meaning; a second tap on it, or the Bid
   button, makes it. Works the same with a mouse and on touch, makes comparing calls easy, and guards against mis-taps.
   Costs one extra tap per call, so it can be switched off.
2. Preview toggle: an "Explore" mode where taps only explain. Fast for experts, but the mode is easy to forget.
3. Hover / long-press: no extra taps, but long-press is hard to discover and slow for comparing on touch.

Confirm is on by default (the user's choice).

## Design

- **Selecting.** With confirm on, tapping an available call in the bidding box selects it: the cell is highlighted
  (distinct from the gold hint highlight) and a meaning line appears under the box, for example
  `3♥  Invitational raise: 3+ hearts, 10–12 points.` next to a primary **Bid 3♥** button (**Pass**, **Double**,
  **Redouble** for the special calls). Tapping another call moves the selection; tapping the selected call again,
  or the button, makes it. Esc or tapping outside the box clears it.
- **Meaning.** `explainBid([...auction, { seat: you, bid }], auction.length, style, "expert")`. It reads only the
  public auction, so it's safe at online tables.
- **Clearing.** The selection is dropped when the auction changes, when it stops being your turn, or when the call
  becomes unavailable.
- **Setting.** "Confirm calls" in the ≡ game menu, solo and online, stored in local storage like Hints and on by
  default. Off restores today's one-tap bidding.
- **Hints.** Unchanged. The suggested call keeps its gold outline, and a selected call shows its own meaning.
- **Everywhere the bidding box appears**: solo, online, and the previews. Add or update a preview showing a selected
  call, its test expectation, and the README preview table. Refresh the README bidding screenshot, since the box changes.

## Non-goals

- No "what would partner do next" simulation; only the meaning of the call itself.
- No change to how calls already made are explained (tap a call in the auction).

## Left to the builder

The exact look of the selected cell and of the meaning row, as long as it fits the iPhone, iPad and laptop layouts
without pushing the bidding box off screen.
