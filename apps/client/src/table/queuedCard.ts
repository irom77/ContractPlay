import { cardId, validatePlay, type Card, type Seat } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";

/** A card picked before its seat's turn. `handKey` identifies the hand: the solo hand id, or the online hand number. */
export type QueuedCard = { handKey: string; seat: Seat; card: Card };

const isLegal = (game: PublicGame, seat: Seat, card: Card): boolean =>
  validatePlay(game.hands[seat], card, game.currentTrick[0]?.card.suit).legal;

/** The queued card to play now: only when its seat is the one to act and the viewer acts for it, and the card is legal. */
export function queuedPlay(game: PublicGame, queued: QueuedCard | undefined, actingSeat: Seat | undefined): Card | undefined {
  if (!queued || game.phase !== "play" || actingSeat !== queued.seat || game.currentActor !== queued.seat) return undefined;
  return isLegal(game, queued.seat, queued.card) ? queued.card : undefined;
}

/**
 * Whether a queued card may stay queued: the same hand, card play with no claim pending, the card still in a
 * visible hand, and, when its seat is to act, a legal play.
 */
export function queueStillValid(game: PublicGame, queued: QueuedCard, handKey: string, claimPending: boolean): boolean {
  if (queued.handKey !== handKey || game.phase !== "play" || claimPending) return false;
  if (!game.hands[queued.seat].some((card) => cardId(card) === cardId(queued.card))) return false;
  return game.currentActor !== queued.seat || isLegal(game, queued.seat, queued.card);
}
