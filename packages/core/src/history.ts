import type { Card, Seat } from "./cards.js";

export type Bid = "pass" | "double" | "redouble" | `${1 | 2 | 3 | 4 | 5 | 6 | 7}${"clubs" | "diamonds" | "hearts" | "spades" | "notrump"}`;
export type GameAction =
  | Readonly<{ type: "bid"; seat: Seat; bid: Bid }>
  | Readonly<{ type: "play"; seat: Seat; card: Card }>
  | Readonly<{ type: "claim"; seat: Seat; tricks: number }>;
export type GameHistory = Readonly<{ actions: readonly GameAction[]; cursor: number }>;

export const emptyHistory = (): GameHistory => ({ actions: [], cursor: 0 });

/** Appending after undo discards the abandoned future, as in a normal take-back. */
export function recordAction(history: GameHistory, action: GameAction): GameHistory {
  return { actions: [...history.actions.slice(0, history.cursor), action], cursor: history.cursor + 1 };
}

export function undo(history: GameHistory): GameHistory {
  return { ...history, cursor: Math.max(0, history.cursor - 1) };
}

export function redo(history: GameHistory): GameHistory {
  return { ...history, cursor: Math.min(history.actions.length, history.cursor + 1) };
}

export function visibleActions(history: GameHistory): readonly GameAction[] {
  return history.actions.slice(0, history.cursor);
}

export function replay(history: GameHistory): readonly GameAction[] {
  return history.actions;
}
