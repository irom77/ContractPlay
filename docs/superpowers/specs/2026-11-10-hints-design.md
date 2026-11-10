# Hints: suggested calls and cards, and what each call means

Date: 2026-11-10

## Intent

A player learning at the table wants three things on request: what partner's or an opponent's bid means, what to bid, and what to play and why. Hints are a switch, off by default, so the table stays clean for players who do not want help.

## Behaviour agreed with the user

- **Hints switch.** Replaces the "Show hint" button, bottom-right of the table, shown during the auction and play. Off by default; the choice is remembered on the device.
- **Points.** With hints on during the auction, the high-card points of the hand on screen are shown.
- **Suggested bid.** On the user's turn, the call the bot would make is highlighted in yellow in the bidding box, with its meaning. The user still makes the call.
- **Call meanings.** With hints on, each call chip beside a seat is clickable and shows a short meaning next to that seat. Esc, clicking elsewhere, or clicking the chip again closes it.
- **Suggested card.** On the user's turn to play (including from dummy as declarer), one card is highlighted with a one-line reason.
- **Hints off.** No points, highlights, or clickable calls.

## Decisions made by the builder

- Suggestions come from the Expert bot using the bidding style chosen in the menu. A suggested call is shown only if it is legal in the position.
- Call meanings are derived from the public auction alone in `packages/bots/src/hints.ts` (`explainBid`), following standard SAYC / 2-over-1 agreements. Splinters, Reverse Drury, and Lebensohl are explained only when the bidder is an Expert bot; calls by the user and at a manual table are read as Expert.
- Covered: openings, responses, raises, notrump structure (Stayman, Jacoby and Texas transfers, Gerber, quantitative 4NT), strong 2♣ and weak-two continuations, overcalls, Michaels, Unusual 2NT, takeout / negative / support / penalty doubles, redoubles, advances, opener's rebids, reverses, fourth suit, Blackwood and its answers. Anything else falls back to a plain natural description.
- The suggested card is the Expert bot's card, except that when out of the suit led the hint does not spend a trump that is not needed to win the trick. `explainPlay` words the reason from the position.
- A host-supplied solver still takes precedence for card hints; its cards are highlighted with "Recommended by the solver."
- The setting is stored under `contractplay.hints` in local storage, separate from saved-game data.

## Limits

- "Best" is the bot's choice from standard technique. No double-dummy solver is bundled, so a suggestion can be wrong.
- Meanings do not cover every sequence the bots can bid; unusual continuations get the natural fallback.

## Verification

- `packages/bots/src/hints.test.ts` covers meanings by situation, play reasons, and that every bot call in seeded auctions has a meaning and every suggested card is legal.
- `apps/client/src/App.test.tsx` covers the switch default, persistence, points, the highlighted bid, call meanings, and card hints with and without a solver.
- Screenshots at 1280×720, 1024×768, and 390×844 confirm nothing scrolls or leaves the window with hints and a meaning open.
