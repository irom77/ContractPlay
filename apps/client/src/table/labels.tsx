import { type Bid, type Card, type Contract, type Seat, type Suit } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
import type { ReactElement } from "react";

export const seatNames: Record<Seat, string> = { north: "North", east: "East", south: "South", west: "West" };
/** The review/result line for a claim, counting the claimer's tricks among the tricks that remained. */
export function claimText(claim: { seat: Seat; tricks: number }, declarer: Seat, remaining: number): string {
  const who = claim.seat === declarer ? `${seatNames[claim.seat]} (declarer)` : seatNames[claim.seat];
  return `Claimed by ${who}: ${claim.tricks} of the remaining ${remaining} tricks`;
}
/** A claim still waiting for its answers, named for the claimer ("You claim …") or for everyone else ("East claims …"). */
export function pendingClaimText(claim: { seat: Seat; tricks: number }, remaining: number, byViewer: boolean): string {
  return `${byViewer ? "You claim" : `${seatNames[claim.seat]} claims`} ${claim.tricks} of the remaining ${remaining} tricks`;
}
/** The notice after a claim is turned down. */
export function claimRejectedText(rejection: { tricks: number; by: Seat }): string {
  return `${seatNames[rejection.by]} rejected the claim of ${rejection.tricks} tricks`;
}
/** How many cards a seat still holds: 13 minus its plays, whether or not its hand is sent. */
export function cardsHeld(game: PublicGame, seat: Seat): number {
  const played = [...game.completedTricks.flat(), ...game.currentTrick].filter((play) => play.seat === seat).length;
  return 13 - played;
}
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
  const suit = <SuitGlyph suit={card.suit} />;
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

/** Preferred left-to-right suit order for a hand: spades first, colours alternating. */
const preferredSuitOrder: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];
const permutations = <T,>(items: readonly T[]): T[][] =>
  items.length <= 1 ? [[...items]] : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]));

/**
 * The order a hand's suits are laid out in, so that two suits of the same colour never sit side by side whenever the
 * suits held allow it (♠♥♣♦; with clubs void ♥♠♦; with hearts void ♠♦♣). Among the orders that alternate, the one
 * closest to ♠♥♣♦ wins; a hand of only one colour keeps that order.
 */
export function handSuitOrder(cards: readonly Card[]): Suit[] {
  const held = preferredSuitOrder.filter((suit) => cards.some((card) => card.suit === suit));
  const sameColourTouches = (order: readonly Suit[]) => order.slice(1).filter((suit, index) => isRedSuit(suit) === isRedSuit(order[index]!)).length;
  // Distance from the preferred order: how many pairs of suits are flipped.
  const inversions = (order: readonly Suit[]) => order.reduce((count, suit, index) => count + order.slice(index + 1).filter((later) => held.indexOf(later) < held.indexOf(suit)).length, 0);
  return permutations(held).reduce((best, order) => {
    const difference = sameColourTouches(order) - sameColourTouches(best) || inversions(order) - inversions(best);
    return difference < 0 ? order : best;
  }, held);
}

export function sortHand(cards: readonly Card[]): Card[] {
  const order = handSuitOrder(cards);
  return [...cards].sort((a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || "23456789TJQKA".indexOf(b.rank) - "23456789TJQKA".indexOf(a.rank));
}

/**
 * Suit-group spacing for a spread hand of `count` cards: the extra room at each suit boundary is taken back from the
 * steps inside the suits, so the hand is exactly as wide as an evenly stepped one. Returns the share of one boundary
 * gap each in-suit step gives up.
 */
export function suitGapShare(cards: readonly Card[]): number {
  const boundaries = cards.slice(1).filter((card, index) => card.suit !== cards[index]!.suit).length;
  const inSuitSteps = cards.length - 1 - boundaries;
  return inSuitSteps > 0 ? boundaries / inSuitSteps : 0;
}

/**
 * Suit shapes drawn to be told apart at a glance rather than taken from whatever symbol font the system has: the spade
 * comes to a sharp point and the club is three separate round lobes; the heart is broad and round-shouldered and the
 * diamond is slim and pointed at both ends.
 */
const suitShapes: Record<Suit, ReactElement> = {
  spades: <path d="M50 3C61 22 95 38 95 62C95 76 85 85 73 85C64 85 57 81 53 74C54 84 58 92 67 97H33C42 92 46 84 47 74C43 81 36 85 27 85C15 85 5 76 5 62C5 38 39 22 50 3Z" />,
  hearts: <path d="M50 95C21 70 3 53 3 31C3 15 15 4 29 4C39 4 46 10 50 20C54 10 61 4 71 4C85 4 97 15 97 31C97 53 79 70 50 95Z" />,
  diamonds: <path d="M50 2Q66 28 86 50Q66 72 50 98Q34 72 14 50Q34 28 50 2Z" />,
  clubs: <>
    <circle cx="50" cy="25" r="21" /><circle cx="25" cy="59" r="21" /><circle cx="75" cy="59" r="21" /><circle cx="50" cy="52" r="11" />
    <path d="M47 55C47 76 42 88 32 97H68C58 88 53 76 53 55Z" />
  </>
};

export function SuitGlyph({ suit }: { suit: Suit }) {
  return <svg className={`suit-glyph suit-glyph-${suit}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">{suitShapes[suit]}</svg>;
}
