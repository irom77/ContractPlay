import { RANKS, SEATS, SUITS, type Deal } from "@contractplay/core";

/** PBN deal string used by DDS: North, East, South, West, with S.H.D.C suits and descending ranks. */
export function serializeDdsDeal(deal: Deal): string {
  return SEATS.map((seat, index) => {
    const hands = SUITS.map((suit) =>
      [...deal[seat]].filter((card) => card.suit === suit)
        .sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank))
        .map((card) => card.rank)
        .join("")
    ).join(".");
    return index === 0 ? "N:" + hands : hands;
  }).join(" ");
}
