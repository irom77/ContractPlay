import type { Seat } from "./cards.js";
import type { Vulnerability } from "./types.js";
import type { Contract } from "./game.js";

export type ContractScore = Readonly<{
  /** Duplicate score from North-South's perspective. */
  score: number;
  tricksRequired: number;
  tricksTaken: number;
  overtricks: number;
  undertricks: number;
  vulnerable: boolean;
}>;

export const partnership = (seat: Seat): "NS" | "EW" =>
  seat === "north" || seat === "south" ? "NS" : "EW";

export function isVulnerable(seat: Seat, vulnerability: Vulnerability): boolean {
  const side = partnership(seat);
  return vulnerability === "Both" || vulnerability === side;
}

/** Points below the line for a made contract, including the doubling multiplier. */
export function contractTrickPoints(contract: Contract): number {
  const undoubled = contract.strain === "clubs" || contract.strain === "diamonds"
    ? contract.level * 20
    : contract.strain === "notrump"
      ? 40 + (contract.level - 1) * 30
      : contract.level * 30;
  return undoubled * (contract.doubled === 0 ? 1 : contract.doubled === 1 ? 2 : 4);
}

/** Penalty for going down, the same in rubber and duplicate scoring. */
export function undertrickPenalty(count: number, vulnerable: boolean, doubled: 0 | 1 | 2): number {
  if (doubled === 0) return count * (vulnerable ? 100 : 50);
  let penalty = 0;
  for (let under = 1; under <= count; under++) {
    if (vulnerable) penalty += under === 1 ? 200 : 300;
    else if (under === 1) penalty += 100;
    else if (under <= 4) penalty += 200;
    else penalty += 300;
  }
  return penalty * (doubled === 2 ? 2 : 1);
}

/** Calculates standard duplicate contract score, signed from North-South's perspective. */
export function scoreContract(
  contract: Contract,
  tricksTaken: number,
  vulnerability: Vulnerability
): ContractScore {
  if (!Number.isInteger(tricksTaken) || tricksTaken < 0 || tricksTaken > 13) {
    throw new RangeError("Tricks taken must be an integer from 0 to 13");
  }

  const tricksRequired = contract.level + 6;
  const overtricks = Math.max(0, tricksTaken - tricksRequired);
  const undertricks = Math.max(0, tricksRequired - tricksTaken);
  const vulnerable = isVulnerable(contract.declarer, vulnerability);
  let declaringSideScore: number;

  if (undertricks > 0) {
    declaringSideScore = -undertrickPenalty(undertricks, vulnerable, contract.doubled);
  } else {
    const trickPoints = contractTrickPoints(contract);
    let bonus = trickPoints >= 100 ? (vulnerable ? 500 : 300) : 50;
    if (contract.level === 6) bonus += vulnerable ? 750 : 500;
    if (contract.level === 7) bonus += vulnerable ? 1500 : 1000;
    if (contract.doubled === 1) bonus += 50;
    if (contract.doubled === 2) bonus += 100;

    let overtrickPoints = 0;
    if (contract.doubled === 0) {
      const perTrick = contract.strain === "clubs" || contract.strain === "diamonds" ? 20 : 30;
      overtrickPoints = overtricks * perTrick;
    } else {
      overtrickPoints = overtricks * (vulnerable ? 200 : 100) * (contract.doubled === 2 ? 2 : 1);
    }
    declaringSideScore = trickPoints + bonus + overtrickPoints;
  }

  return {
    score: partnership(contract.declarer) === "NS" ? declaringSideScore : -declaringSideScore,
    tricksRequired,
    tricksTaken,
    overtricks,
    undertricks,
    vulnerable
  };
}

