import { SEATS, type Bid, type Hand, type PublicBid, type Seat, type SkillLevel, type Suit } from "@contractplay/core";

/**
 * A compact model of an auction as the player to act sees it.
 *
 * Calls are written as short tokens ("1C", "2N", "P", "X", "R") and the auction is read from the opening bid, so an
 * agreement can be written once as a pattern such as "1N P 2C P" whoever dealt and however many passes came first.
 */

export type Letter = "C" | "D" | "H" | "S";
export type StrainLetter = Letter | "N";
export type Token = string;
export type Style = "SAYC" | "2/1";

export const LETTERS: readonly Letter[] = ["C", "D", "H", "S"];
export const MAJORS: readonly Letter[] = ["S", "H"];
export const MINORS: readonly Letter[] = ["D", "C"];
const STRAINS: readonly StrainLetter[] = ["C", "D", "H", "S", "N"];
const suitOf: Readonly<Record<Letter, Suit>> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades" };
const strainNames: Readonly<Record<StrainLetter, string>> = { ...suitOf, N: "notrump" };
const letterOf: Readonly<Record<string, StrainLetter>> = { clubs: "C", diamonds: "D", hearts: "H", spades: "S", notrump: "N" };
const honorPoints: Readonly<Record<string, number>> = { A: 4, K: 3, Q: 2, J: 1 };
const skillRank: Readonly<Record<SkillLevel, number>> = { beginner: 0, intermediate: 1, advanced: 2, expert: 3 };

export const isMajor = (strain: string | undefined): strain is "H" | "S" => strain === "H" || strain === "S";
export const isMinor = (strain: string | undefined): strain is "C" | "D" => strain === "C" || strain === "D";
export const isSuit = (strain: string | undefined): strain is Letter => isMajor(strain) || isMinor(strain);
export const otherMajor = (major: Letter): Letter => major === "H" ? "S" : "H";
export const partnerOf = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!;

/** Orders contract tokens; 0 for pass, double and redouble. */
export function rank(token: Token | undefined): number {
  if (!token || !/^[1-7][CDHSN]$/.test(token)) return 0;
  return Number(token[0]) * 5 + STRAINS.indexOf(token[1] as StrainLetter) + 1;
}
export const levelOf = (token: Token): number => Number(token[0]);
export const strainOf = (token: Token | undefined): StrainLetter | undefined => token && rank(token) > 0 ? token[1] as StrainLetter : undefined;
export const isContract = (token: Token | undefined): boolean => rank(token) > 0;
export const gameLevel = (strain: StrainLetter): number => strain === "N" ? 3 : isMajor(strain) ? 4 : 5;
export const isGame = (token: Token | undefined): boolean => !!token && rank(token) > 0 && levelOf(token) >= gameLevel(token[1] as StrainLetter);

export function toToken(bid: Bid): Token {
  if (bid === "pass") return "P";
  if (bid === "double") return "X";
  if (bid === "redouble") return "R";
  return `${bid[0]}${letterOf[bid.slice(1)]}`;
}

export function toBid(token: Token): Bid {
  if (token === "P") return "pass";
  if (token === "X") return "double";
  if (token === "R") return "redouble";
  return `${token[0]}${strainNames[token[1] as StrainLetter]}` as Bid;
}

export function isLegalCall(bid: Bid, auction: readonly PublicBid[], seat: Seat): boolean {
  if (bid === "pass") return true;
  const lastContract = [...auction].reverse().find((call) => rank(toToken(call.bid)) > 0);
  if (bid !== "double" && bid !== "redouble") return rank(toToken(bid)) > (lastContract ? rank(toToken(lastContract.bid)) : 0);
  if (!lastContract) return false;
  const lastNonPass = [...auction.slice(auction.indexOf(lastContract) + 1)].reverse().find((call) => call.bid !== "pass");
  const ourContract = SEATS.indexOf(lastContract.seat) % 2 === SEATS.indexOf(seat) % 2;
  return bid === "double" ? !lastNonPass && !ourContract : lastNonPass?.bid === "double" && ourContract;
}

/** What a hand is worth, with suit lengths by letter. */
export interface Eval {
  readonly hand: Hand;
  readonly hcp: number;
  readonly C: number;
  readonly D: number;
  readonly H: number;
  readonly S: number;
  readonly balanced: boolean;
  /** Suits from longest to shortest; equal lengths rank the higher suit first. */
  readonly byLength: readonly Letter[];
  readonly aces: number;
  readonly kings: number;
  len(strain: string | undefined): number;
  has(suit: Letter, ranks: string): boolean;
  /** How many of the given ranks the suit holds. */
  count(suit: Letter, ranks: string): number;
  stopper(suit: string | undefined): boolean;
  /** High-card points plus shortness points when raising the given trump suit. */
  support(trump: Letter): number;
  /** A suit worth bidding on its own: six cards, or five with two of the top three or three of the top five honors. */
  goodSuit(suit: Letter): boolean;
}

export function evaluate(hand: Hand): Eval {
  const lengths = { C: 0, D: 0, H: 0, S: 0 } as Record<Letter, number>;
  const ranks = { C: "", D: "", H: "", S: "" } as Record<Letter, string>;
  let hcp = 0;
  for (const card of hand) {
    const letter = letterOf[card.suit] as Letter;
    lengths[letter] += 1;
    ranks[letter] += card.rank;
    hcp += honorPoints[card.rank] ?? 0;
  }
  const counts = LETTERS.map((letter) => lengths[letter]);
  const count = (suit: Letter, wanted: string): number => [...wanted].filter((value) => ranks[suit].includes(value)).length;
  const len = (strain: string | undefined): number => isSuit(strain) ? lengths[strain] : 0;
  return {
    hand,
    hcp,
    ...lengths,
    balanced: counts.every((value) => value >= 2) && counts.filter((value) => value === 2).length <= 1,
    byLength: [...LETTERS].sort((a, b) => lengths[b] - lengths[a] || LETTERS.indexOf(b) - LETTERS.indexOf(a)),
    aces: LETTERS.filter((letter) => ranks[letter].includes("A")).length,
    kings: LETTERS.filter((letter) => ranks[letter].includes("K")).length,
    len,
    has: (suit, wanted) => [...wanted].every((value) => ranks[suit].includes(value)),
    count,
    stopper(suit) {
      if (!isSuit(suit)) return true;
      const held = ranks[suit];
      return held.includes("A") || (held.length >= 2 && held.includes("K")) || (held.length >= 3 && held.includes("Q")) || (held.length >= 4 && held.includes("J"));
    },
    support(trump) {
      return hcp + LETTERS.filter((letter) => letter !== trump).reduce((total, letter) => total + (lengths[letter] === 0 ? 5 : lengths[letter] === 1 ? 3 : lengths[letter] === 2 ? 1 : 0), 0);
    },
    goodSuit: (suit) => lengths[suit] >= 6 || (lengths[suit] === 5 && (count(suit, "AKQ") >= 2 || count(suit, "AKQJT") >= 3))
  };
}

export interface View {
  readonly auction: readonly PublicBid[];
  readonly seat: Seat;
  readonly style: Style;
  /** 0 beginner, 1 intermediate, 2 advanced, 3 expert. */
  readonly skill: number;
  /** Tokens from the opening bid onward. */
  readonly tokens: readonly Token[];
  /** The tokens joined by spaces: "1H P 2H P". Empty before the opening. */
  readonly text: string;
  /** Whether the player to act belongs to the side that opened. */
  readonly opened: boolean;
  /** The player's own side's calls from the opening onward, oldest first, including passes. */
  readonly ours: readonly Token[];
  readonly theirs: readonly Token[];
  /** The player's own earlier calls, and partner's. */
  readonly mine: readonly Token[];
  readonly partners: readonly Token[];
  /** Whether the player, or partner, passed before the opening bid. */
  readonly iPassed: boolean;
  readonly partnerPassed: boolean;
  /** The number of passes before the opening bid, or before the player's turn when nobody has opened. */
  readonly leadingPasses: number;
  /** The last contract bid, if any, and whether the player's side made it. */
  readonly last: Token | undefined;
  readonly lastIsOurs: boolean;
  /** Suits the opponents have bid naturally. */
  readonly theirSuits: readonly Letter[];
  /** True when the opponents have made no call other than pass since the opening. */
  readonly uncontested: boolean;
  legal(token: Token): boolean;
  /** The cheapest legal bid in a strain, optionally a number of levels higher. */
  cheapest(strain: StrainLetter, jump?: number): Token;
  match(pattern: RegExp): RegExpExecArray | null;
}

export function createView(raw: readonly PublicBid[], seat: Seat, style: Style, skill: SkillLevel): View {
  // Fill in a pass for any seat the recorded auction skips, so that positions can be read by counting calls.
  const filled: PublicBid[] = [];
  const passUntil = (next: Seat): void => {
    while (filled.length > 0 && SEATS[(SEATS.indexOf(filled.at(-1)!.seat) + 1) % SEATS.length] !== next) {
      filled.push({ seat: SEATS[(SEATS.indexOf(filled.at(-1)!.seat) + 1) % SEATS.length]!, bid: "pass" });
    }
  };
  for (const call of raw) { passUntil(call.seat); filled.push(call); }
  passUntil(seat);
  const auction: readonly PublicBid[] = filled;
  const first = auction.findIndex(({ bid }) => bid !== "pass");
  const live = first < 0 ? [] : auction.slice(first);
  const tokens = live.map(({ bid }) => toToken(bid));
  const partner = partnerOf(seat);
  const before = first < 0 ? auction : auction.slice(0, first);
  const side = (other: Seat): boolean => SEATS.indexOf(other) % 2 === SEATS.indexOf(seat) % 2;
  const of = (wanted: (other: Seat) => boolean): Token[] => live.filter((call) => wanted(call.seat)).map(({ bid }) => toToken(bid));
  let lastIndex = tokens.length - 1;
  while (lastIndex >= 0 && rank(tokens[lastIndex]) === 0) lastIndex -= 1;
  const last = lastIndex >= 0 ? tokens[lastIndex] : undefined;
  const theirs = of((other) => !side(other));
  const legal = (token: Token): boolean => isLegalCall(toBid(token), raw, seat);
  return {
    auction, seat, style, skill: skillRank[skill], tokens, text: tokens.join(" "),
    opened: live.length > 0 && side(live[0]!.seat),
    ours: of(side), theirs, mine: of((other) => other === seat), partners: of((other) => other === partner),
    iPassed: before.some((call) => call.seat === seat), partnerPassed: before.some((call) => call.seat === partner),
    leadingPasses: before.length,
    last, lastIsOurs: lastIndex >= 0 && side(live[lastIndex]!.seat),
    theirSuits: LETTERS.filter((letter) => theirs.some((token) => rank(token) > 0 && token[1] === letter)),
    uncontested: theirs.every((token) => token === "P"),
    legal,
    cheapest(strain, jump = 0) {
      for (let level = 1; level <= 7; level += 1) if (rank(`${level}${strain}`) > rank(last)) return `${Math.min(7, level + jump)}${strain}`;
      return "P";
    },
    match: (pattern) => pattern.exec(tokens.join(" "))
  };
}

/** A handler names the call an agreement requires, or returns undefined when the position is not its concern. */
export type Handler = (h: Eval, v: View) => Token | undefined;
