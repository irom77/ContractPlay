# One-Screen Table Design

Supersedes the header, drawer, and hand-panel layout described in [the centered auction design](2026-10-28-centered-auction-table-design.md); the centered bidding grid and seat-aligned calls from that design remain.

## Intent

Make the screen all about the game. The whole table fits one window without scrolling, labels that the game context already makes obvious are removed, full screen is one click or key away, and cards read at a glance.

## What the player sees

The player asked to see only: cards, bidding (with each player's history beside their seat), what is next, Take back / Redo, Show hint, the current contract, tricks per pair, and the last trick.

- **Top-left:** contract (click during play to show or hide the bidding beside the seats), NS and EW trick counts, and whose turn it is.
- **Top-right:** table menu (new deal, next-deal settings, PBN import, recent hands, version) and the full-screen button; below them the last trick, always visible, winner outlined. Clicking it lays the last trick on the table.
- **Seats:** a compass letter only. Gold glow marks the turn, a red ring marks vulnerability, and "D" marks the dealer during the auction. Every call a seat made is shown as a chip beside it.
- **Center:** the bidding grid during the auction (no title, header row, or level column), the trick during play, and the result with a Next deal button when the hand ends.
- **Bottom corners:** Take back / Redo (Previous / Next in review) on the left, Show hint on the right.
- **Bottom edge:** the hand, fanned. A tag names its owner only when that is not the seat drawn at the bottom.

## Decisions

- **No scrolling.** The shell is exactly one viewport tall. Sizes derive from one unit, `--u = min(1vh, 0.75vw)`, so a 4:3 or narrower window scales by width. Only the table menu scrolls internally.
- **Table orientation.** The bottom seat is the user's seat against bots; at a manual table it is declarer once there is a contract, otherwise South. Dummy therefore faces declarer.
- **Dummy.** Laid out as cards at its seat. When the acting player controls dummy, those cards are the play buttons and the bottom edge keeps showing declarer's own hand. When the user is dummy, the bottom hand is the dummy.
- **Waiting hand.** Against bots and in review, the bottom seat's cards stay visible (not playable) when it is someone else's turn.
- **Cards.** Two colours (black and red). The corner index owns the outer 26% of the card width; pips and court frames are confined to the middle so they cannot run under a rank, including "10".
- **Full screen.** Button or F key; Esc exits. Browsers use the Fullscreen API; the Tauri host sets the window full screen (`core:window:allow-set-fullscreen`).
- **Portrait windows.** Supported without scrolling, with seats moved clear of the corner clusters; landscape is the primary target.

## Non-goals

- Game rules, bots, persistence, and PBN behavior are unchanged.
- No four-colour deck, card-back art, or animation.

## Acceptance

- No page scrollbar in any phase at 1280x720, 1024x768, 800x500, or 390x844, and no table element outside the viewport.
- No "Auction", "Playing as", board, header, or footer text on the table.
- Existing accessible names for bids, cards, Take back, Redo, Show hint, Last trick, and the table menu still work.
