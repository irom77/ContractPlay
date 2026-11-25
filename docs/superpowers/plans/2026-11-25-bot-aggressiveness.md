# Bot aggressiveness

Goal: players choose how aggressive the bots are (Conservative, Normal, Aggressive), alongside skill and bidding style, in solo settings and when creating an online table. The setting changes both bidding and card play. Normal is today's behaviour, unchanged.

## Design

- `packages/core`: `Aggression = "conservative" | "normal" | "aggressive"`; `BotConfig.aggression` is optional and means Normal when missing.
- `packages/bots/src/aggression.ts`: an adjustment layer applied in `createBot` after the skill rules and system layer have chosen. The skill rules are not touched.
  - Aggressive bidding: opens 10–11 point hands by the Rule of 20, overcalls a good five-card suit at the one level on 7–10 points, and competes one more level (to at most three) in partner's natural suit with support.
  - Conservative bidding: passes openings below 12 points, preempts without two of the top three honours or with fewer than 6 points, overcalls below 10 points (12 at the two level), takeout doubles below 13 points, and three-level competitive raises below 8 points. It never passes where a pass would break a forcing agreement.
  - Aggressive play: defenders cash an ace from A-K against a suit contract; second hand wins the trick when it can, cheaply.
  - Conservative play: second hand plays low; defenders leading against a suit contract lead the top of an honour sequence or from a suit without the ace or king.
- Online tables: the table records an `aggression` chosen at creation (`POST /api/tables` takes an optional `aggression`; tables stored without one are Normal). Every bot and stand-in at the table uses it. The lobby lists non-Normal tables with the setting.
- Solo: `SoloSetup.botAggression` remembered with the rest of the setup; chosen in the lobby Play panel and the in-game settings.
- Hints stay on Normal: they describe the system, not a bot's temperament.

## Later

Named bot presets (a saved name for skill + style + aggressiveness) can build on this: browser storage for solo first, account storage to follow a player across devices.

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm test`.
