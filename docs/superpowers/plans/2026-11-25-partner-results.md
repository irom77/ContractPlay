# Results with each named partner and against each named opponent

Goal: help solo players pick favourite partners from the named bot cast (`2026-11-25-named-bots.md`) by showing how they have done together.

## Design

- `apps/client/src/partnerResults.ts`: one entry per finished hand with a named partner — hand id, partner, both opponents (kept for results against them later), the player's side's score in duplicate points (from the contract score, so rubber and single deals compare alike), whether the side declared, and whether that contract made. Stored under `contractplay.partnerResults`, apart from the hand history, which keeps only the latest 25 solo hands; capped at the newest 2,000 entries. Recording a hand id again replaces its entry, so a hand taken back from the end and finished again counts once. Passed-out hands and hands with a custom partner are not counted.
- `partnerStats` sums each partner's hands, average score a hand (rounded), contracts declared and made, most-played first; `partnerSummary` words it ("14 hands together, +230 a hand").
- Solo App records a result once per finish (a ref holds the game last counted, starting with the hand open when solo starts) and only for real play, not previews.
- Shown beside the chosen partner's blurb in the lobby Play panel and solo Settings, and as **Your partners** in Recent hands (which now opens when only results exist).
- Previews 17 and 25 load a fixed history: 14 hands with Bold Bea, 9 with Sharp Kim, 3 with Rookie Ray.

## Against each opponent

- `opponentStats` sums each named opponent's hands and the player's average score a hand, counting an opponent once per hand even if it sits in both opponent seats; `opponentSummary` words it ("16 hands against, +317 a hand").
- A hand is now recorded when any of the three bots is named (before, only with a named partner); `partnerStats` skips a custom partner.
- Shown beside each chosen opponent's blurb and as **Your opponents** in Recent hands. Previews 17 and 25 use a sample history with varied opponents.

## Later

Results on the account so they follow a player across devices.

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm test`.
