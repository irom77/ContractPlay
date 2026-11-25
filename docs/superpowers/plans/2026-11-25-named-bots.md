# Named bots

Goal: give solo players a cast of named bots with distinct temperaments to try as partner and opponents, so they get to know them and pick favourites. Builds on bot aggressiveness (`2026-11-25-bot-aggressiveness.md`).

## Design

- `packages/bots/src/characters.ts`: twelve characters, one per skill level × aggressiveness, each with an id, name and one-line blurb. Twelve is every distinct combination the bots can play today; more characters would be duplicates under another name until bots gain new traits (lead style, preempting habits, slam appetite).
- Bidding style stays one choice for the table: partners must share a system, and the hints describe it.
- `apps/client/src/soloSetup.ts`: `SoloSetup.cast = { partner, left, right }`, each a character id or `"custom"` (stored setups without it, or with unknown ids, read as custom, which keeps today's behaviour). Helpers place the roles around the player's seat (`castRoleOf`), find a seat's character (`castCharacterAt`) and its bot settings (`botSettingsAt`; the custom bot and the bot playing the player's own cards on auto play take the setup's skill and aggressiveness).
- `apps/client/src/table/BotCastFields.tsx`: Partner / Left opponent / Right opponent selects (custom first, then the cast grouped by skill) and the chosen characters' blurbs. Used in the lobby Play panel and solo Settings; Bot skill and Bot aggressiveness show only while a seat is custom.
- Solo App: each seat's bot is created from its own settings; bid explanations use the seat's skill; the seat label and the turn line carry the character's name.
- Previews: 17 (Solo: new deal) picks Bold Bea, Careful Cora and a custom bot; 20 (dummy for a bot declarer) shows the names at the table. Screens 18 and 19, used for README screenshots, are unchanged.

## Later

Results per partner; named bots at online tables (needs per-seat aggressiveness on the service); players' own saved characters on their account.

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm test`.
