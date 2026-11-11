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
}>;

/** A rubber in progress: its scored hands, the dealer of its latest deal, and the hand being played for it. */
export type Rubber = Readonly<{
  hands: readonly RubberHand[];
  lastDealer?: Seat;
  activeHandId?: string;
}>;

export type RubberGame = Readonly<{ below: SidePoints; winner?: Side }>;

export type RubberSummary = Readonly<{
  /** Games in order; the last one has no winner while it is still being played. */
  games: readonly RubberGame[];
  gamesWon: SidePoints;
  /** Points above the line, including the rubber bonus once the rubber is over. */
  above: SidePoints;
  totals: SidePoints;
  vulnerability: Vulnerability;
  winner?: Side;
  rubberBonus?: number;
}>;

const nextSeatClockwise = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 1) % 4]!;
const zero: SidePoints = { NS: 0, EW: 0 };
const other = (side: Side): Side => (side === "NS" ? "EW" : "NS");
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

/** Rubber points for a played contract. Game and part-score bonuses do not exist in rubber; the rubber bonus comes at the end. */
export function scoreRubberHand(
  handId: string,
  contract: Contract,
  tricksTaken: number,
  vulnerability: Vulnerability,
  deal?: Deal
): RubberHand {
  const declaring = partnership(contract.declarer);
  const vulnerable = isVulnerable(contract.declarer, vulnerability);
  const required = contract.level + 6;
  let below = zero;
  let above = zero;
  if (tricksTaken < required) {
    above = add(above, other(declaring), undertrickPenalty(required - tricksTaken, vulnerable, contract.doubled));
  } else {
    const overtricks = tricksTaken - required;
    below = add(below, declaring, contractTrickPoints(contract));
    const perOvertrick = contract.doubled === 0
      ? (contract.strain === "clubs" || contract.strain === "diamonds" ? 20 : 30)
      : (vulnerable ? 200 : 100) * contract.doubled;
    let bonus = overtricks * perOvertrick;
    if (contract.level === 6) bonus += vulnerable ? 750 : 500;
    if (contract.level === 7) bonus += vulnerable ? 1500 : 1000;
    bonus += contract.doubled * 50;
    above = add(above, declaring, bonus);
  }
  const honors = deal ? honorsBonus(contract, deal) : undefined;
  if (honors) above = add(above, honors.side, honors.points);
  return { handId, below, above };
}

/** Works the rubber out from its hands: games, vulnerability, and the 700 or 500 bonus once a side wins two games. */
export function summarizeRubber(rubber: Rubber): RubberSummary {
  const games: RubberGame[] = [];
  let current = zero;
  let gamesWon = zero;
  let above = zero;
  let winner: Side | undefined;
  for (const hand of rubber.hands) {
    if (winner) break;
    above = { NS: above.NS + hand.above.NS, EW: above.EW + hand.above.EW };
    current = { NS: current.NS + hand.below.NS, EW: current.EW + hand.below.EW };
    const gameWinner: Side | undefined = current.NS >= 100 ? "NS" : current.EW >= 100 ? "EW" : undefined;
    if (gameWinner) {
      games.push({ below: current, winner: gameWinner });
      gamesWon = add(gamesWon, gameWinner, 1);
      current = zero;
      if (gamesWon[gameWinner] === 2) winner = gameWinner;
    }
  }
  const rubberBonus = winner ? (gamesWon[other(winner)] === 0 ? 700 : 500) : 0;
  if (winner) {
    above = add(above, winner, rubberBonus);
  } else {
    games.push({ below: current });
  }
  const belowTotal = games.reduce((sum, game) => ({ NS: sum.NS + game.below.NS, EW: sum.EW + game.below.EW }), zero);
  const vulnerability: Vulnerability = gamesWon.NS && gamesWon.EW ? "Both" : gamesWon.NS ? "NS" : gamesWon.EW ? "EW" : "None";
  return {
    games,
    gamesWon,
    above,
    totals: { NS: belowTotal.NS + above.NS, EW: belowTotal.EW + above.EW },
    vulnerability,
    ...(winner ? { winner, rubberBonus } : {})
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
