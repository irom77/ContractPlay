# Forcing continuations and game-value nets

## Problem

Simulating whole auctions (all four seats, every skill and style) showed three defects in bot bidding:

- In about 3% of deals a bot passed a call partner had made as forcing: opener passing an unpassed partner's new-suit response (sometimes with 20+ HCP), opener passing a negative double, or responder passing a reverse or a new suit after a two-level response.
- Most rules compared the auction against a fixed number of calls, so they only fired when the opener was the dealer. After any pass before the opening bid, bots stopped overcalling, advancing, balancing, and continuing; about 6% of decisions changed.
- A partnership with 27+ HCP stopped in a partscore in about 8% of deals, mostly because responder passed with a hand no rule described.

## Design

All of it lives in the `createBot` wrapper, so the rule classes keep their structure and every skill level and the hints get the same behavior.

1. **Leading passes.** Passes before the opening bid only matter when they make the responding hand a passed hand. The rules therefore read the auction from the opening bid, except for the opening side when opener's partner passed first (Drury, non-forcing new suits, and 2/1 passed-hand ranges still depend on that).
2. **Forced continuations** (`packages/bots/src/forcing.ts`), used only when the rules would pass:
   - opener's natural rebid after an unpassed partner's new-suit response at the one or two level;
   - opener's rebid after partner's negative double;
   - responder's rebid after a reverse, or after opener's new suit over a two-level response;
   - the bidder's rebid after partner's cue-bid raise.
3. **Responses with no rule**: a first response with 6+ HCP to one of a suit, 8+ HCP opposite 1NT, and a rebid with 8–12 HCP after 1x–1y–1z.
4. **Game with known values**: in an auction the opponents stayed out of, a bot that would pass partner's call below game bids game when its points plus the minimum partner has shown reach 26: four of a major with a known eight-card fit or a self-sufficient suit, otherwise 3NT, or five of a minor with a nine-card fit, an unstopped suit, and 28+.
5. **Strong opener**: with 19+ HCP after a one-level response, a cheap suit rebid chosen by the rules is replaced by a jump shift, reverse, or jump in notrump.

## Out of scope

Contested auctions beyond the cases above, advancing takeout doubles by strength, and defending against preempts remain on the roadmap. The rule classes still match fixed call counts internally; the wrapper makes that harmless for leading passes only.

## Measured effect (4,000 simulated deals per skill and style)

- Passes of the forcing calls listed above: about 3% of deals before, none after.
- Calls that changed after a leading opponent pass: about 6% of decisions before, none after.
- 27+ HCP stopping in a partscore: about 8% of deals before, under 3% after.
