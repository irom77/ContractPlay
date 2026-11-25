# Named bots at online tables

Goal: bring the solo bot cast (`2026-11-25-named-bots.md`) to online tables, so any bot seat can be a named bot with its own temperament.

## Design

- The cast moves from `packages/bots` to `packages/core/src/characters.ts` (re-exported from bots), so the protocol can check a character id without depending on the bots package.
- Protocol: `SeatInfo` bot gains an optional `character`; `setBot` takes an optional `character`. The parser rejects an unknown or non-string character and sets `skill` to the character's own skill. Both fields are optional, so older clients and stored tables keep working; the protocol version stays 8.
- Table state: a bot seat may hold a `character`. `setBot` refuses an unknown character and stores the character's skill with it; a plain `setBot` turns a named bot back into a table bot. The bot deciding for a seat (including a named declarer's dummy) uses the character's aggressiveness, otherwise the table's. Stand-ins and the bot that takes a leaving player's seat stay table bots.
- Client: the seating screen's per-seat **Bot** select lists table bots by skill, then the named bots; `setBotFor` builds the message. `botName` names a bot seat at the table, on the scorecard (side names), in the lobby list and in admin; the seating screen shows "Bold Bea · Advanced · Aggressive".
- Previews: 1 (Lobby) seats Careful Cora at the Beginners welcome table; 2 (Seating) seats Bold Bea at East.

## Later

Results with and against named bots at online tables (on the account); players' own saved characters.

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm test`.
