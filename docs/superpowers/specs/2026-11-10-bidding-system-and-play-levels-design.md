# Bidding system layer and play by skill level

## Problem

The rule bots matched fixed auction patterns. An audit of about 250 standard SAYC / 2/1 positions showed that Intermediate and above gave a wrong call in roughly a third of the checks: partner's takeout double was advanced without regard to strength, nothing was done over the opponents' preempts or 1NT, many opener and responder continuations fell through to a pass, and contested auctions with game values stopped in a partscore (just under 3% of deals with 27+ HCP). Advanced and Expert played the cards almost exactly like Intermediate. `createBot` also had to strip passes before the opening bid because the rule classes counted calls from the dealer.

## Design

### System layer (`packages/bots/src`)

- `auction.ts` reads an auction as tokens from the opening bid (`1N P 2C P`), filling a pass for any skipped seat, and builds a `View` (who opened, our and their calls, passed hands, legal and cheapest bids) and an `Eval` of the hand (points, lengths, stoppers, support). A handler is `(hand, view) => call | undefined`.
- Handlers are grouped by subject: `constructive.ts` (openings, raises, Jacoby 2NT, rebids, fourth suit, 2/1 game force), `notrump.ts`, `twos.ts` (strong 2♣, weak twos, preempts), `competitive.ts` (advancing doubles and overcalls, action over preempts and 1NT, balancing, opener and responder in competition), and `inference.ts` (strength and length shown so far, Blackwood, game with known values).
- `system.ts` runs them in three stages around the existing rules: **agreed** calls take precedence over the rules; **corrections** replace a specific rule choice that the agreements contradict; **continuations** apply only when the rules pass. The forcing-continuation net and then the known-values check follow. The final call is checked for legality and falls back to a pass.
- Style: handlers take `SAYC` or `2/1` and differ where the systems do (1M–1NT rebids, two-level responses, invitation ranges).
- Skill: Beginner never starts an overcall, double, or preempt but answers partner's; Intermediate acts over preempts and 1NT and opens at the four level; Advanced balances, reopens with a double, and opens light in third and fourth seat or by the rule of 20; Expert keeps its conventions in the rule class.
- Known values in contested auctions: when the points shown by partner plus the hand reach 25, bid a major game with a fit, 3NT with their suits stopped, a minor game, or double for penalty.
- `BeginnerBot`, `IntermediateBot`, and `ExpertBot` drop inert leading passes themselves, so `createBot` no longer rewrites the auction.

### Card play

- `PlayContext` (core) gains optional `declarer`, `visibleHand` (dummy, or declarer's hand for dummy's turn), and `played`; `playContextFor(state, seat)` builds it from public information only, and the client uses it for bots and hints.
- `play.ts`: `advancedCard` draws trumps as declarer, ruffs when void, plays third hand high, and discards from the weakest suit. `expertCard` also cashes cards that are masters given the cards played and visible, leads a singleton against a suit contract, and keeps winners when discarding.

## Out of scope

Rarer conventions (for example Michaels follow-ups beyond the basics, control-showing cue bids, Roman Key Card), opening-lead tables beyond the existing rules, counting the defenders' distribution, and squeezes or endplays.

## Measured effect

- Audit: wrong calls at Intermediate and above fell from about 180 of 490 checks to a small reviewed residue; the reviewed answers are frozen as table tests in `system.test.ts`.
- Bidding simulation (3,000 deals per skill and style): 27+ HCP stopping in a partscore fell from about 2.7% to 0.9–1.4%; no takeout double was passed by a hand that should bid; no auction ran away past game without values.
- Play simulation (296 deals per pairing, same contracts): Intermediate took 3.43 more tricks per deal than Beginner, Advanced 0.40 more than Intermediate, Expert 0.61 more than Advanced; no illegal plays.
