import { RANKS, SEATS, SUITS, remainingTricks, type Card, type GameState, type Seat } from "@contractplay/core";

/** Whether a claim holds against every defence, fails against some defence, or could not be settled in budget. */
export type ClaimVerdict = "proven" | "refuted" | "unknown";

/** The default number of search nodes a claim check may visit before it gives up as "unknown". */
export const CLAIM_SEARCH_NODES = 20_000;

/** Thrown inside the search once the node budget is spent; never escapes checkClaim. */
const budgetSpent: unique symbol = Symbol("claim search budget spent");

const suitIndex = (card: Card): number => SUITS.indexOf(card.suit);
const rankIndex = (card: Card): number => RANKS.indexOf(card.rank);
const seatIndex = (seat: Seat): number => SEATS.indexOf(seat);

/**
 * An exact double-dummy check of a claim: can the claimer's side win at least `claim.tricks` of the remaining
 * tricks (counting the one in progress) against every defence? Gives up as "unknown" past `maxNodes` nodes.
 * The state passed in is not mutated.
 */
export function checkClaim(state: GameState, claim: Readonly<{ seat: Seat; tricks: number }>, maxNodes = CLAIM_SEARCH_NODES): ClaimVerdict {
  if (state.phase !== "play" || !state.contract) return "unknown";
  const trump = state.contract.strain === "notrump" ? -1 : SUITS.indexOf(state.contract.strain);
  const side = seatIndex(claim.seat) % 2;

  // hands[seat * 4 + suit] and gone[suit] are rank bitmasks; gone holds cards from completed tricks.
  const hands = new Array<number>(16).fill(0);
  for (const seat of SEATS) for (const held of state.hands[seat]) hands[seatIndex(seat) * 4 + suitIndex(held)]! |= 1 << rankIndex(held);
  const gone = [0, 0, 0, 0];
  for (const trick of state.completedTricks) for (const play of trick) gone[suitIndex(play.card)]! |= 1 << rankIndex(play.card);

  // Every card played, one slot per ply so backtracking never overwrites an earlier trick; the trick in progress
  // is the last `count` slots before `ply`, with its leader and current winner.
  const playedSuits = new Array<number>(56).fill(0);
  const playedRanks = new Array<number>(56).fill(0);
  let ply = 0;
  let count = 0;
  let leader = seatIndex(state.trickLeader);
  let winner = leader;
  let winSuit = -1;
  let winRank = -1;
  for (const play of state.currentTrick) {
    const suit = suitIndex(play.card);
    const rank = rankIndex(play.card);
    playedSuits[ply] = suit;
    playedRanks[ply] = rank;
    ply++;
    count++;
    if (winSuit < 0 || (suit === winSuit && rank > winRank) || (suit === trump && winSuit !== trump)) {
      winner = seatIndex(play.seat);
      winSuit = suit;
      winRank = rank;
    }
  }

  let nodes = 0;

  /** Collects one move per run of equivalent cards in the hand, highest rank first. */
  function moves(seat: number): number[] {
    const found: number[] = [];
    const led = count > 0 ? playedSuits[ply - count]! : -1;
    const ledHeld = led >= 0 ? hands[seat * 4 + led]! : 0;
    for (let suit = 0; suit < 4; suit++) {
      if (ledHeld !== 0 && suit !== led) continue;
      const mask = hands[seat * 4 + suit]!;
      let inRun = false;
      for (let rank = 12; rank >= 0; rank--) {
        const bit = 1 << rank;
        if (mask & bit) {
          if (!inRun) found.push(rank * 4 + suit);
          inRun = true;
        } else if (!(gone[suit]! & bit)) {
          inRun = false;
        }
      }
    }
    // Encoded as rank * 4 + suit, so a descending sort orders by rank first.
    return found.sort((a, b) => b - a);
  }

  function search(need: number, left: number): boolean {
    if (++nodes > maxNodes) throw budgetSpent;
    if (need <= 0) return true;
    if (need > left) return false;
    const seat = (leader + count) % 4;
    const claimerToAct = seat % 2 === side;
    for (const move of moves(seat)) {
      const suit = move & 3;
      const rank = move >> 2;
      const bit = 1 << rank;
      const savedCount = count, savedLeader = leader, savedWinner = winner, savedWinSuit = winSuit, savedWinRank = winRank;
      hands[seat * 4 + suit]! &= ~bit;
      playedSuits[ply] = suit;
      playedRanks[ply] = rank;
      ply++;
      count++;
      if (winSuit < 0 || (suit === winSuit && rank > winRank) || (suit === trump && winSuit !== trump)) {
        winner = seat;
        winSuit = suit;
        winRank = rank;
      }
      let succeeds: boolean;
      if (count === 4) {
        for (let index = ply - 4; index < ply; index++) gone[playedSuits[index]!]! |= 1 << playedRanks[index]!;
        const won = winner % 2 === side ? 1 : 0;
        leader = winner;
        count = 0;
        winSuit = -1;
        winRank = -1;
        succeeds = search(need - won, left - 1);
        for (let index = ply - 4; index < ply; index++) gone[playedSuits[index]!]! &= ~(1 << playedRanks[index]!);
      } else {
        succeeds = search(need, left);
      }
      ply--;
      count = savedCount;
      leader = savedLeader;
      winner = savedWinner;
      winSuit = savedWinSuit;
      winRank = savedWinRank;
      hands[seat * 4 + suit]! |= bit;
      if (succeeds === claimerToAct) return succeeds;
    }
    return !claimerToAct;
  }

  try {
    return search(claim.tricks, remainingTricks(state)) ? "proven" : "refuted";
  } catch (thrown) {
    if (thrown === budgetSpent) return "unknown";
    throw thrown;
  }
}
