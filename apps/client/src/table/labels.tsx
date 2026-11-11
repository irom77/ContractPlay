import { SUITS, type Bid, type Card, type Contract, type Seat, type Suit } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";

export const seatNames: Record<Seat, string> = { north: "North", east: "East", south: "South", west: "West" };
export const biddingStrains = ["clubs", "diamonds", "hearts", "spades", "notrump"] as const;
export const suitSymbols: Record<Suit, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const suitNames: Record<Suit, string> = { spades: "spades", hearts: "hearts", diamonds: "diamonds", clubs: "clubs" };
const ranks: Record<string, string> = { A: "ace", K: "king", Q: "queen", J: "jack", T: "ten" };
/** Pip centres as [x, y] percentages of the pip area; the lower half is drawn upside down like a printed card. */
const cardPipLayouts: Record<number, readonly (readonly [number, number])[]> = {
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[0, 0], [100, 0], [0, 100], [100, 100]],
  5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
  6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
  7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
  8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
  9: [[0, 0], [100, 0], [0, 33], [100, 33], [50, 50], [0, 67], [100, 67], [0, 100], [100, 100]],
  10: [[0, 0], [100, 0], [50, 17], [0, 33], [100, 33], [0, 67], [100, 67], [50, 83], [0, 100], [100, 100]]
};
export const seats: readonly Seat[] = ["north", "east", "south", "west"];
export const isRedSuit = (suit: string): boolean => suit === "hearts" || suit === "diamonds";
export const partnerOf = (seat: Seat): Seat => seats[(seats.indexOf(seat) + 2) % 4]!;
export const samePartnership = (a: Seat, b: Seat): boolean => seats.indexOf(a) % 2 === seats.indexOf(b) % 2;
const contractRank = (bid: Bid): number => {
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? Number(match[1]) * 5 + biddingStrains.indexOf(match[2] as typeof biddingStrains[number]) : 0;
};

export function isCallAvailable(game: PublicGame, bid: Bid): boolean {
  if (bid === "pass") return true;
  const previousContract = [...game.auction].reverse().find(({ bid: call }) => call !== "pass" && call !== "double" && call !== "redouble");
  const callsSinceContract = previousContract ? game.auction.slice(game.auction.indexOf(previousContract) + 1) : [];
  const lastNonPass = [...callsSinceContract].reverse().find(({ bid: call }) => call !== "pass");
  if (bid === "double") return !!previousContract && !["double", "redouble"].includes(lastNonPass?.bid ?? "") && !samePartnership(previousContract.seat, game.currentActor);
  if (bid === "redouble") return !!previousContract && lastNonPass?.bid === "double" && samePartnership(previousContract.seat, game.currentActor);
  return !previousContract || contractRank(bid) > contractRank(previousContract.bid);
}

export function callLabel(bid: Bid): string {
  if (bid === "pass") return "Pass";
  if (bid === "double") return "Double";
  if (bid === "redouble") return "Redouble";
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? `${match[1]} ${match[2]}` : bid;
}

export function compactCallLabel(bid: Bid): string {
  if (bid === "double") return "X";
  if (bid === "redouble") return "XX";
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  if (!match) return callLabel(bid);
  const strain = match[2] as typeof biddingStrains[number];
  return `${match[1]}${strain === "notrump" ? "NT" : suitSymbols[strain]}`;
}

export function cardLabel(card: Card): string {
  return `${ranks[card.rank] ?? card.rank} of ${suitNames[card.suit]}`;
}

export function cardFace(card: Card) {
  const suit = suitSymbols[card.suit];
  const rank = card.rank === "T" ? "10" : card.rank;
  const pips = cardPipLayouts[card.rank === "T" ? 10 : Number(card.rank)];
  const corner = (side: "top" | "bottom") => <span className={`card-corner card-corner-${side}`} aria-hidden="true"><span className={rank === "10" ? "card-rank-ten" : undefined}>{rank}</span><span>{suit}</span></span>;
  return <>
    {corner("top")}
    {pips ? <span className="card-pips" aria-hidden="true">{pips.map(([x, y], index) => <span className={`card-pip ${y > 50 ? "card-pip-flipped" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} key={index}>{suit}</span>)}</span>
      : card.rank === "A" ? <span className="card-center-suit" aria-hidden="true">{suit}</span>
        : <span className="card-portrait" aria-hidden="true"><span>{card.rank}</span><span>{suit}</span></span>}
    {corner("bottom")}
  </>;
}

/** The contract as level, coloured strain symbol, and doubling marks, as shown on the badge and the score panel. */
export function contractText(contract: Contract) {
  return <>{contract.level}<span className={isRedSuit(contract.strain) ? "red-card" : ""}>{contract.strain === "notrump" ? "NT" : suitSymbols[contract.strain]}</span>{"X".repeat(contract.doubled)}</>;
}

export function callChipClass(bid: Bid): string {
  if (bid === "pass" || bid === "double" || bid === "redouble") return `call-${bid}`;
  return isRedSuit(bid.slice(1)) ? "auction-call-red" : "";
}

export function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || "23456789TJQKA".indexOf(b.rank) - "23456789TJQKA".indexOf(a.rank));
}
