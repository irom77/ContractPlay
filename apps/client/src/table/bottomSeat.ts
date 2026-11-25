import type { Seat } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
import { partnerOf } from "./labels.js";

type SeatedGame = Pick<PublicGame, "phase" | "contract" | "completedTricks" | "currentTrick">;

/**
 * The seat drawn at the bottom edge for `viewer`: their own, except that a dummy who plays the cards for a bot
 * declarer has the table turned once dummy is down, so the declarer's hand they play sits at the bottom and their own
 * hand lies across the table as dummy.
 */
export function bottomSeatFor(game: SeatedGame, viewer: Seat, playsForDeclarer: boolean): Seat {
  const declarer = game.contract?.declarer;
  if (!playsForDeclarer || !declarer || declarer !== partnerOf(viewer)) return viewer;
  const dummyDown = game.phase === "complete" || game.completedTricks.length > 0 || game.currentTrick.length > 0;
  return dummyDown ? declarer : viewer;
}
