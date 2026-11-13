import { SEATS, type Deal, type Seat } from "./cards.js";
import type { Contract, GameState } from "./game.js";
import { contractTrickPoints, isVulnerable, partnership, undertrickPenalty } from "./scoring.js";
import type { Vulnerability } from "./types.js";

export type Side = "NS" | "EW";
export type SidePoints = Readonly<Record<Side, number>>;

/** One scored hand of a rubber: trick points below the line and everything else above it. */
export type RubberHand = Readonly<{
  handId: string;
  below: SidePoints;
  above: SidePoints;
  /** How the points were earned, for the scorecard's breakdown. Missing on hands scored before breakdowns. */
  detail?: RubberHandDetail;
}>;

/** The contract a rubber hand was played in, the tricks declarer took, and each line of its score. */
export type RubberHandDetail = Readonly<{ contract: Contract; tricksTaken: number; vulnerable: boolean; items: readonly RubberScoreItem[] }>;

/** A rubber in progress: its scored hands, the dealer of its latest deal, and the hand being played for it. */
export type Rubber = Readonly<{
  hands: readonly RubberHand[];
  lastDealer?: Seat;
  activeHandId?: string;
}>;

/** What a line of a hand's rubber score is for. */
export type RubberItemKind = "contract" | "overtricks" | "insult" | "slam" | "undertricks" | "honors";

/** One line of a hand's rubber score: who scores it, where it is written, and why. `count` is the over- or undertricks. */
export type RubberScoreItem = Readonly<{ side: Side; line: "above" | "below"; kind: RubberItemKind; points: number; count?: number }>;

/** One score written on the pad, and the hand it came from (`rubber-bonus` for the bonus that ends the rubber). */
export type RubberEntry = Readonly<{ handId: string; points: number }>;
export type SideEntries = Readonly<Record<Side, readonly RubberEntry[]>>;

/** The id of the rubber bonus entry above the line. */
export const RUBBER_BONUS_ENTRY = "rubber-bonus";

export type RubberGame = Readonly<{
  below: SidePoints;
  winner?: Side;
  /** Each hand's trick points written below the line in this game, in order. */
  entries: SideEntries;
  /** The hand that won the game. */
  wonOn?: string;
}>;

export type RubberSummary = Readonly<{
  /** Games in order; the last one has no winner while it is still being played. */
  games: readonly RubberGame[];
  gamesWon: SidePoints;
  /** Points above the line, including the rubber bonus once the rubber is over. */
  above: SidePoints;
  /** Each score written above the line, in order, ending with the rubber bonus once the rubber is over. */
  aboveEntries: SideEntries;
  totals: SidePoints;
  vulnerability: Vulnerability;
  winner?: Side;
  rubberBonus?: number;
  /** The hand that won the rubber. Hands recorded after it are not part of this rubber. */
  wonOn?: string;
}>;

const nextSeatClockwise = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 1) % 4]!;
const SIDES: readonly Side[] = ["NS", "EW"];
const zero: SidePoints = { NS: 0, EW: 0 };
const other = (side: Side): Side => (side === "NS" ? "EW" : "NS");
const noEntries: SideEntries = { NS: [], EW: [] };
const addEntry = (entries: SideEntries, side: Side, entry: RubberEntry): SideEntries => ({ ...entries, [side]: [...entries[side], entry] });
const add = (points: SidePoints, side: Side, amount: number): SidePoints => ({ ...points, [side]: points[side] + amount });

export const emptyRubber = (): Rubber => ({ hands: [] });

/** Honors held in one hand: 150 for all five trump honors or all four aces at notrump, 100 for four trump honors. */
export function honorsBonus(contract: Contract, deal: Deal): Readonly<{ side: Side; points: number }> | undefined {
  for (const seat of SEATS) {
    const hand = deal[seat];
    if (contract.strain === "notrump") {
      if (hand.filter((card) => card.rank === "A").length === 4) return { side: partnership(seat), points: 150 };
    } else {
      const honors = hand.filter((card) => card.suit === contract.strain && ["A", "K", "Q", "J", "T"].includes(card.rank)).length;
      if (honors === 5) return { side: partnership(seat), points: 150 };
      if (honors === 4) return { side: partnership(seat), points: 100 };
    }
  }
  return undefined;
}

/**
 * The lines of a played contract's rubber score: trick points below the line; overtricks, the insult, slam bonuses,
 * undertricks, and honors above it. Game and part-score bonuses do not exist in rubber; the rubber bonus comes at the end.
 */
export function rubberHandItems(contract: Contract, tricksTaken: number, vulnerability: Vulnerability, deal?: Deal): RubberScoreItem[] {
  const declaring = partnership(contract.declarer);
  const vulnerable = isVulnerable(contract.declarer, vulnerability);
  const required = contract.level + 6;
  const items: RubberScoreItem[] = [];
  if (tricksTaken < required) {
    const count = required - tricksTaken;
    items.push({ side: other(declaring), line: "above", kind: "undertricks", points: undertrickPenalty(count, vulnerable, contract.doubled), count });
  } else {
    const overtricks = tricksTaken - required;
    items.push({ side: declaring, line: "below", kind: "contract", points: contractTrickPoints(contract) });
    const perOvertrick = contract.doubled === 0
      ? (contract.strain === "clubs" || contract.strain === "diamonds" ? 20 : 30)
      : (vulnerable ? 200 : 100) * contract.doubled;
    if (overtricks) items.push({ side: declaring, line: "above", kind: "overtricks", points: overtricks * perOvertrick, count: overtricks });
    if (contract.doubled) items.push({ side: declaring, line: "above", kind: "insult", points: contract.doubled * 50 });
    if (contract.level === 6) items.push({ side: declaring, line: "above", kind: "slam", points: vulnerable ? 750 : 500 });
    if (contract.level === 7) items.push({ side: declaring, line: "above", kind: "slam", points: vulnerable ? 1500 : 1000 });
  }
  const honors = deal ? honorsBonus(contract, deal) : undefined;
  if (honors) items.push({ side: honors.side, line: "above", kind: "honors", points: honors.points });
  return items;
}

/** Rubber points for a played contract: the sum of its `rubberHandItems` below and above the line. */
export function scoreRubberHand(
  handId: string,
  contract: Contract,
  tricksTaken: number,
  vulnerability: Vulnerability,
  deal?: Deal
): RubberHand {
  let below = zero;
  let above = zero;
  const items = rubberHandItems(contract, tricksTaken, vulnerability, deal);
  for (const item of items) {
    if (item.line === "below") below = add(below, item.side, item.points);
    else above = add(above, item.side, item.points);
  }
  return { handId, below, above, detail: { contract, tricksTaken, vulnerable: isVulnerable(contract.declarer, vulnerability), items } };
}

/** Works the rubber out from its hands: games, vulnerability, and the 700 or 500 bonus once a side wins two games. */
export function summarizeRubber(rubber: Rubber): RubberSummary {
  const games: RubberGame[] = [];
  let current = zero;
  let currentEntries = noEntries;
  let gamesWon = zero;
  let above = zero;
  let aboveEntries = noEntries;
  let winner: Side | undefined;
  let wonOn: string | undefined;
  for (const hand of rubber.hands) {
    if (winner) break;
    for (const side of SIDES) {
      if (hand.above[side]) aboveEntries = addEntry(aboveEntries, side, { handId: hand.handId, points: hand.above[side] });
      if (hand.below[side]) currentEntries = addEntry(currentEntries, side, { handId: hand.handId, points: hand.below[side] });
    }
    above = { NS: above.NS + hand.above.NS, EW: above.EW + hand.above.EW };
    current = { NS: current.NS + hand.below.NS, EW: current.EW + hand.below.EW };
    const gameWinner: Side | undefined = current.NS >= 100 ? "NS" : current.EW >= 100 ? "EW" : undefined;
    if (gameWinner) {
      games.push({ below: current, winner: gameWinner, entries: currentEntries, wonOn: hand.handId });
      gamesWon = add(gamesWon, gameWinner, 1);
      current = zero;
      currentEntries = noEntries;
      if (gamesWon[gameWinner] === 2) {
        winner = gameWinner;
        wonOn = hand.handId;
      }
    }
  }
  const rubberBonus = winner ? (gamesWon[other(winner)] === 0 ? 700 : 500) : 0;
  if (winner) {
    above = add(above, winner, rubberBonus);
    aboveEntries = addEntry(aboveEntries, winner, { handId: RUBBER_BONUS_ENTRY, points: rubberBonus });
  } else {
    games.push({ below: current, entries: currentEntries });
  }
  const belowTotal = games.reduce((sum, game) => ({ NS: sum.NS + game.below.NS, EW: sum.EW + game.below.EW }), zero);
  const vulnerability: Vulnerability = gamesWon.NS && gamesWon.EW ? "Both" : gamesWon.NS ? "NS" : gamesWon.EW ? "EW" : "None";
  return {
    games,
    gamesWon,
    above,
    aboveEntries,
    totals: { NS: belowTotal.NS + above.NS, EW: belowTotal.EW + above.EW },
    vulnerability,
    ...(winner && wonOn ? { winner, rubberBonus, wonOn } : {})
  };
}

/** The dealer and vulnerability of the rubber's next deal; a finished rubber starts a new one with the given first dealer. */
export function nextRubberDeal(rubber: Rubber, firstDealer: Seat): Readonly<{ rubber: Rubber; dealer: Seat; vulnerability: Vulnerability }> {
  const fresh = summarizeRubber(rubber).winner !== undefined;
  const base = fresh ? emptyRubber() : rubber;
  const dealer = base.lastDealer ? nextSeatClockwise(base.lastDealer) : firstDealer;
  return { rubber: { ...base, lastDealer: dealer }, dealer, vulnerability: summarizeRubber(base).vulnerability };
}

/**
 * Keeps the rubber in step with the hand being played for it: a finished hand is scored, and a hand taken back from its
 * end loses its score again. Hands that are not the rubber's active hand leave it unchanged.
 */
export function recordRubberHand(rubber: Rubber, handId: string, game: GameState): Rubber {
  if (rubber.activeHandId !== handId) return rubber;
  const existing = rubber.hands.some((hand) => hand.handId === handId);
  if (game.phase === "complete" && game.contract && game.score) {
    const scored = scoreRubberHand(handId, game.contract, game.score.tricksTaken, game.vulnerability, game.initialDeal);
    const previous = rubber.hands.find((hand) => hand.handId === handId);
    if (previous && JSON.stringify(previous) === JSON.stringify(scored)) return rubber;
    return { ...rubber, hands: [...rubber.hands.filter((hand) => hand.handId !== handId), scored] };
  }
  return existing ? { ...rubber, hands: rubber.hands.filter((hand) => hand.handId !== handId) } : rubber;
}
