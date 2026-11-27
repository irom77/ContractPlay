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

## Live review, 2026-11-27

We reviewed the production cohort after its first runs. It had played 38 sessions of 8 boards (304 boards, 608 table results) between 2026-11-26 15:53 and 2026-11-27 10:38 UTC. The cohort has four SAYC profiles: Kim (Expert), Sam (Advanced, conservative), Bea (Advanced, aggressive) and Will (Intermediate). All results came from the public result routes.

- **Ratings are computed as designed.** Replaying all 38 sessions through the production IMP table and `ratingPeriodUpdate`, with the `scoreSession` and `rateSession` attribution, reproduces every live rating and deviation exactly: 152 snapshots, zero difference.
- **The rotation is fair.** Every session seats the two partnerships in opposite directions at its two tables. The 12 seatings each ran three or four times, which is three full rotations plus two sessions. Each profile has 18–20 appearances in each seat. It has 28 with one partner and 24 with each of the other two. The uneven count comes from the two extra sessions, not from the rotation.
- **The ordering follows skill.** Kim averages +0.76 ± 0.62 cross-IMPs a board (95% interval over sessions), Bea +0.24 ± 0.66, Sam +0.14 ± 0.66 and Will −1.14 ± 0.55. Their ratings, in the same order, are 1532, 1500, 1508 and 1460, each with a deviation of 76. Only Will is separated from the others beyond noise. Sam and Bea have swapped places over time, and the three Advanced and Expert profiles overlap within their deviations.
- **Live margins are much smaller than in calibration.** The absolute session margin has a median of 1.125 cross-IMPs a board, a 75th percentile of 2.375, a 90th percentile of 4.0 and a maximum of 4.5. The fixture's figures were roughly 4, 5, 6.25 and 9. Both tables reached the same contract on 255 of 304 boards (84%), and the same score on 83. The fixture spanned all twelve profiles from Beginner to Expert, while this cohort spans only Intermediate to Expert. At the live upper quartile, the 10.5 scale gives a score of 0.627 rather than the intended 0.75. A margin of 1 IMP a board is worth about 38 rating points.

The scale has no bias: it keeps the ordering and is symmetric. With close cohorts it compresses the spread and makes deviations shrink slowly. The 72-point gap between Kim and Will is smaller than twice either deviation. Fitting the same rule to this cohort's upper quartile would give a scale of 5.0. That would need a new transform version, and old ratings would not compare with new ones. Whether to change it is a product decision. We leave `cross-imp-per-board-10.5-v1` in place. The 2/1 style has not run live yet.

## Replay and retention boundary

An imported PBN upload is reduced to board facts; the source file and traveller data are never retained. A job snapshots the imported/generated source kind and copies parsed board facts into its own board rows, so later removal of the reusable import set does not affect a completed replay. Imported replays remain private to authenticated benchmark administrators by default; generated completed replays are available through the public result route. Replay payloads are compacted after 90 days or when they fall outside the newest 10,000 board records, whichever comes first. Board scores, session summaries, diagnostics, rating periods, and rating history remain retained.
