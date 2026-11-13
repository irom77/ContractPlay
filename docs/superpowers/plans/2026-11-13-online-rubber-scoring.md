# Online rubber scoring

Goal: online tables score rubber bridge, as solo play does, by default for new tables.

## Decisions

- `TableState.scoring` (`"rubber" | "duplicate"`). `createTable` defaults to `"rubber"`; the HTTP create endpoint accepts an optional `scoring` (default rubber). Stored tables without the field keep running totals (`scoringOf`), so live tables are unaffected.
- Rubber tables keep a core `Rubber` in `TableState.rubber`: `dealHand` uses `nextRubberDeal(rubber, "north")` for dealer and vulnerability and sets `activeHandId` to `hand-<n>`; `record` scores a completed hand with `recordRubberHand`. Passed-out and cancelled hands score nothing; take-back cannot rewind a finished hand, so a scored hand is never removed. Running totals are not updated at rubber tables.
- A won rubber stays on the table (for the result and seating screens) until the next deal starts a new one.
- Protocol v4: `TableSummary.scoring`, `TableView.rubber`. The client summarises the rubber with `summarizeRubber` and reuses `RubberScoresheet` and `rubberHandText`.

## Client

- Lobby: "Scoring" select (Rubber bridge / Running totals) and the scoring next to each listed table's style.
- Online table: "Rubber score" menu item (live hand and result) opening a dialog; the result panel shows the hand's rubber line and the scoresheet; the status card shows rubber totals; the seating screen shows the scoresheet; Deal reads "Deal a new rubber" after a won rubber.
- UI previews: new "Rubber score" screen (14); preview tables deal into a rubber.

## Tests

- `packages/table/src/hand.test.ts` "rubber scoring": dealer and vulnerability, passed-out hands, vulnerability after a game, new rubber after a win, played hands recorded, legacy tables.
- Server: default scoring, explicit running totals, invalid scoring refused, full hand scored on the rubber.
- Client: lobby scoring choice and labels; preview expectations for the result and Rubber score screens and the game menu.
