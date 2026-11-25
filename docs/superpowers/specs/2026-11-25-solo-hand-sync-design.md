# Sync solo hands to the account — design

Date: 2026-11-25. Size: small change (short design).

## Intent

A signed-in player finished a rubber against bots, closed the browser, and found Recent hands empty: solo hands live only in the browser that played them. Signed-in players should find their finished solo hands in Recent hands on any device and after the browser's data is gone, the way online hands already are.

## Goals

- When signed in, every finished solo hand that was dealt or replayed from the archive is saved to the account and comes back in Recent hands on any device the player signs in on.
- Solo hands already in a browser upload on that browser's next sync (as guest online hands do today).
- The account keeps the newest 25 solo hands, separately from its newest 25 online hands, so neither pushes the other out.

## Non-goals

- Hands from imported PBN files and board sets, and "Play this deal again" repeats, never leave the browser (decided: option A). The rule matches which hands go to the deal archive today: no PBN metadata, and either no board record or a record from an archive replay.
- Unfinished solo play, settings, and the board-set library stay on the device.
- **Delete** still removes only the browser copy; server deletion is not added.
- No sync for guests (not signed in).

## Anti-goals

- A solo hand must never affect duplicate standings or the deal archive; uploads stay unverified personal records.
- Signing in must not lose or duplicate local solo hands, and an upload failure must leave local history intact for a later retry.
- Imported file contents (PBN tags, comments, event names) must never reach the server.

## Approaches

1. **Reuse the account hand store — chosen.** The existing `online_hands` table and `/api/account/online-hands` endpoints accept solo hands as well, told apart by id (solo ids have no `online-` prefix). The server keeps separate 25-hand caps for the two kinds. The client's existing sync (on sign-in and whenever Recent hands opens) also uploads missing eligible solo hands and merges remote ones; a solo hand also uploads when it finishes. No migration, same limits and checks.
2. Separate solo table, endpoint and sync — rejected: mostly duplicated code for no visible difference.

## Decided

- Server: solo hands are accepted only with the id shape solo play creates, validated like online uploads (size limit, `isSavedHand`, picked fields only). Any PBN metadata is refused or dropped; a board record is kept only when it carries archive replay info (so replay review still shows the original table's result).
- Solo hands synced from or to an account are marked with that account as owner in the browser, like online hands, so another account signing in on the same browser does not take them over. Unowned local solo hands go to the first account that syncs.
- Docs: README "Recent hands" paragraph and the lobby line no longer say solo hands stay on the device; `CHANGES.md` entry.

## Left to the builder

- Exact solo id pattern, how the two caps are expressed in SQL, and whether the client keeps one combined request or two.
- Tests for: the server accepting/refusing solo hands and keeping separate caps; the client uploading eligible solo hands, skipping imported/board-set/repeat ones, merging remote solo hands, and the finish-time upload.
- Whether any preview needs updating (likely none: no screen changes).
