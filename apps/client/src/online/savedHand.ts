import { applyAction, createGameState, type GameAction } from "@contractplay/core";
import type { SavedHand } from "@contractplay/persistence";
import type { TableView } from "@contractplay/protocol";

/**
 * The finished hand as a full game for the device's hand history: the revealed deal replayed through
 * the auction and every played card in order. Undefined when the deal is not revealed or a step fails.
 */
export function savedHandFrom(view: TableView, id: string, savedAt: string): SavedHand | undefined {
  const game = view.game;
  if (!game || !view.revealed) return undefined;
  const actions: GameAction[] = [
    ...game.auction.map(({ seat, bid }): GameAction => ({ type: "bid", seat, bid })),
    ...[...game.completedTricks.flat(), ...game.currentTrick].map(({ seat, card }): GameAction => ({ type: "play", seat, card }))
  ];
  let state = createGameState({ deal: view.revealed, dealer: game.dealer, vulnerability: game.vulnerability });
  for (const action of actions) {
    const result = applyAction(state, action);
    if (!result.ok) return undefined;
    state = result.state;
  }
  return { id, game: state, savedAt };
}
