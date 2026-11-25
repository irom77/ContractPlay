# Online results with named bots, saved to the account

Goal: hands finished at online tables with a named bot count towards the player's record with and against it, and the whole
record (solo and online) is saved to a signed-in player's account so it follows them across devices.

Chosen approach: one record, kept in the browser as before and synced with the account alongside the online hand history
(the player picked account sync over device-only). Results stay untrusted personal records, like hand archives.

1. **Shared shape** (`packages/persistence/src/botResults.ts`): `BotResult` (the old client `PartnerResult`) gains
   `online?: true`, `at?` (finish time) and a device-only `owner?`; `isBotResult` checks seat entries are a named bot id,
   `"custom"` or `"human"`, scores are bounded integers, and `made` implies `declared`. `MAX_BOT_RESULTS` = 2000.
2. **Service**: migration `0004_bot_results.sql` (`bot_results`, keyed by account and hand id); `AuthStore.upsertBotResults`
   keeps the newest 2000 by finish time; `GET/POST /api/account/bot-results` (`apps/server/src/bot-results.ts`) with the
   same session, origin and expected-player checks as the hand history, batches of at most 500, the device's owner tag dropped.
3. **Client sync** (`apps/client/src/online/botResultsSync.ts`): `syncBotResults` sends the device's results the account lacks,
   or holds an earlier finish of, in batches of 500, then keeps the account's list tagged as its own plus other accounts'
   results on the device; `uploadBotResult` sends one new result. Called where the hand history syncs (lobby on sign-in,
   joining a table, Recent hands) and when a hand finishes.
4. **Online recording** (`OnlineTable.tsx`): when a finished hand is saved to history, `onlineCast` reads who sat around the
   player (named bots by id, other bots "custom", people "human") and `partnerResultOf` records it once per hand id.
5. Tests: server route and store, client sync, `onlineCast`, online recording once and only with a named bot, solo upload.
