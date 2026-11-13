import type { Hand, Suit } from "@contractplay/core";
import type { SavedHand } from "@contractplay/persistence";

/** Suits in name order, with the letter that starts each suit's cards. */
const suitLetters: readonly (readonly [Suit, string])[] = [["spades", "S"], ["hearts", "H"], ["clubs", "C"], ["diamonds", "D"]];
const rankOrder = "AKQJT98765432";

/**
 * A hand written as its cards, suit by suit: each suit's letter followed by its ranks from the ace down, T for ten,
 * suits joined by underscores, for example `SKT9_HKQJ32_CA2_D543`. A void is its letter alone (`SAKQJT98765_H_C43_D2`).
 */
export function handName(hand: Hand): string {
  return suitLetters.map(([suit, letter]) => letter + hand
    .filter((card) => card.suit === suit)
    .map((card) => card.rank)
    .sort((a, b) => rankOrder.indexOf(a) - rankOrder.indexOf(b))
    .join("")).join("_");
}

/** The name for a newly saved hand: the player's dealt cards, with `_2`, `_3`, … added if the history already has it. */
export function createHandName(hand: Hand, taken: ReadonlySet<string> = new Set()): string {
  const base = handName(hand);
  if (!taken.has(base)) return base;
  for (let copy = 2; ; copy += 1) {
    const name = `${base}_${copy}`;
    if (!taken.has(name)) return name;
  }
}

/** A saved hand's name; a hand saved before hands were named is called after South's dealt cards. */
export function savedHandName(hand: SavedHand): string {
  return hand.name ?? handName(hand.game.initialDeal.south);
}
