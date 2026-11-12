# Forced-play automation and Auto play

**Goal:** keep card play moving: play a card for the user when it is their only legal choice, and let the user hand card play to a bot for the rest of the current deal, with control returning when the deal ends.

## Forced play

- [x] `forcedCard(game)` in `packages/core/src/rules.ts`: the single legal card for the player on turn during play (a singleton in the led suit, or the last card), else undefined. Works on `GameState` and the online `PublicGame`.
- [x] Solo (`apps/client/src/App.tsx`): when the user may act, no completed trick is on display, and a card is forced, apply it after `FORCED_PLAY_MS` (500 ms). A position reached by Take back is not auto-played, so the take-back is not undone at once.
- [x] Online (`apps/client/src/online/OnlineTable.tsx`): the same rule for the viewer's own turns (including dummy when declaring), sending a normal `act` with the view's hand number and revision. A view brought by the viewer's take-back is not auto-played.
- [x] Setting "Play forced cards automatically" (on by default) in the solo deal settings, stored as `contractplay.forcedPlay` and read by online tables (`apps/client/src/table/forcedPlay.ts`).

## Auto play

- [x] Solo: an Auto play button beside Hints during card play reuses the existing per-hand bot handover (`botsFinishHandId`), which ends with the deal.
- [x] Online protocol: new client message `{ type: "autoPlay" }`; `SeatInfo` gains `autoPlay?: true`. No protocol version bump: older clients never send it and ignore the new field.
- [x] Table reducer (`packages/table/src/presence.ts`): `autoPlay` is accepted only during card play for a seated player without a stand-in, and sets an `intermediate` stand-in marked `autoPlay`. Reconnecting keeps it; `resume` ends it; the last card of the hand and `cancelHand` remove it (`withoutAutoPlay` in `state.ts`).
- [x] Online client: "Auto play this hand" in the game menu during card play, an "auto play" seat badge, and a "Stop auto play" banner button.
- [x] UI preview screen "Auto play" with its test expectation and README row.
