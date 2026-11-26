# Calibrating the benchmark IMP score

The primary rating input is average cross-IMPs per board in both Matchpoint and IMP events. For each table on a board, compare its NS score with every other table's NS score, convert each difference to IMPs, and average the comparisons. Reverse the sign for EW. Both partners receive their partnership's result. When a profile plays the same board twice in mirrored seats, average its two appearances and count one board. Average these board results over the session to get margin `m`.

The transform `cross-imp-per-board-10.5-v1` gives one session score, `1 / (1 + 10 ** (-m / 10.5))`. Equal tables get 0.5. A margin of +1 IMP per board gives 0.555. A margin of +5 gives 0.750. Reversing direction gives the complementary score. The per-board unit allows a four-board session and a sixteen-board session to express the same performance margin.

## Measurement

The calibration fixture plays 144 eight-board duplicate sessions, or 2,304 completed table hands. Each board is shuffled once and played at two tables with opposite partnerships. The production table reducer validates the actual bots' bids and cards. Three quartets include all twelve built-in profiles. Each quartet completes all twelve seating rounds in SAYC and in 2/1. Every player has three rounds in each seat and four with each of their three partners. Dealer and vulnerability follow the duplicate cycle.

We used 72 sessions to select the scale and reserved the next 72 sessions of newly shuffled deals to check it. The table gives nearest-rank percentiles of absolute session margins, in cross-IMPs per board. Each session contributes once because the four players share the two partnerships' mirrored outcomes.

| Sample | Median | 75th percentile | 90th percentile | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Fit | 4.125 | 5.00 | 6.375 | 9.00 |
| Held out | 3.875 | 5.25 | 6.125 | 7.00 |

We chose a score of 0.75 for the upper-quartile winning margin. This leaves room for larger wins to affect a rating while giving the usual decisive win more credit than a tie. Solving the transform at the fitting quartile gives `5 / log10(3) = 10.48`, rounded to the nearest half IMP as 10.5. At the held-out quartile the selected scale gives 0.760. Scales of 6 and 12 give 0.882 and 0.733 at that same margin. These numbers describe rating weights. They do not estimate a probability of winning a future match.

The fixture covers eight-board sessions with two tables and built-in bots. Larger fields and human populations need separate validation. Paired outcomes include partner contributions. Individual ratings become more informative as those partnerships rotate. Future recalibrations need a new transform version to preserve the meaning of past ratings.

## Reproduction

From the repository root, run `pnpm build`, then `node apps/server/scripts/calibrate-benchmark.mjs`. The script writes the raw NS score pair for every board to `apps/server/src/fixtures/benchmark-calibration.json`. Deal shuffles use seed 20261125. The calibration test derives the IMP margins from those raw scores and checks the production transform, seat and partner exposure, direction symmetry, and per-board normalization.

```sh
pnpm --filter @contractplay/server test src/benchmark-rating-calibration.test.ts
```

## Replay and retention boundary

An imported PBN upload is reduced to board facts; the source file and traveller data are never retained. A job snapshots the imported/generated source kind and copies parsed board facts into its own board rows, so later removal of the reusable import set does not affect a completed replay. Imported replays remain private to authenticated benchmark administrators by default; generated completed replays are available through the public result route. Replay payloads are compacted after 90 days or when they fall outside the newest 10,000 board records, whichever comes first. Board scores, session summaries, diagnostics, rating periods, and rating history remain retained.
