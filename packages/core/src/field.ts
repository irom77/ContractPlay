import type { Deal, Seat } from "./cards.js";
import { applyAction, createGameState, type GameState } from "./game.js";
import type { GameAction } from "./history.js";
import type { Vulnerability } from "./types.js";

/** The largest Multiplicity a traveller row may carry; anything larger is treated as invalid. */
export const MAX_MULTIPLICITY = 1000;

/** One result on a board's traveller. `nsScore` is undefined when unknown or irrelevant; `contract` is PBN text such as "4S", "3NTX" or "Pass". */
export type TravellerRow = Readonly<{
  nsScore?: number;
  contract?: string;
  declarer?: Seat;
  tricks?: number;
  multiplicity: number;
  artificial: boolean;
}>;

/** A board as played elsewhere: the deal, how the original table played it, and the field's results. */
export type HandRecord = Readonly<{
  board?: string;
  event?: string;
  scoring?: string;
  dealer: Seat;
  vulnerability: Vulnerability;
  deal: Deal;
  original?: readonly GameAction[];
  field: readonly TravellerRow[];
}>;

export type FieldMethod = "matchpoints" | "butler" | "cross";

/** A player's result against the field, always from the player's own side. */
export type FieldComparison = Readonly<{
  method: FieldMethod;
  count: number;
  matchpoints: Readonly<{ points: number; top: number; percentage: number }>;
  butler: Readonly<{ datum: number; imps: number }>;
  cross: Readonly<{ total: number; perComparison: number }>;
}>;

/** Lower bounds of the Law 78B IMP scale; the first is worth 1 IMP, the last 24. */
const IMP_THRESHOLDS = [
  20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000
] as const;

/** IMPs for a point difference, signed like the difference. */
export function impsFor(difference: number): number {
  const size = Math.abs(difference);
  const imps = IMP_THRESHOLDS.filter((threshold) => threshold <= size).length;
  return difference < 0 ? -imps : imps;
}

/** North-South scores that count, each repeated by its multiplicity; artificial and unscored rows are left out. */
export function fieldScores(rows: readonly TravellerRow[]): number[] {
  return rows.flatMap((row) =>
    row.artificial || row.nsScore === undefined ? [] : Array<number>(row.multiplicity).fill(row.nsScore)
  );
}

/** The comparison a PBN Scoring tag asks for; anything unrecognised is matchpoints. */
export function fieldMethod(scoring: string | undefined): FieldMethod {
  const tokens = (scoring ?? "").toLowerCase().split(/[;,\s]+/).filter(Boolean);
  if (tokens.some((token) => token.startsWith("cross"))) return "cross";
  return tokens.some((token) => token === "imp" || token === "butler") ? "butler" : "matchpoints";
}

/** Rounds to the nearest 10, halves away from zero. */
const roundToTen = (value: number): number => (Math.sign(value) * Math.round(Math.abs(value) / 10) * 10) || 0;

/** Compares a score with the field; undefined when the field has no real scores. The player's score counts as an extra table in matchpoints. */
export function compareWithField(
  rows: readonly TravellerRow[],
  nsScore: number,
  side: "NS" | "EW",
  method: FieldMethod
): FieldComparison | undefined {
  const sign = side === "NS" ? 1 : -1;
  const counted = rows
    .filter((row) => !row.artificial && row.nsScore !== undefined)
    .map((row) => ({ score: sign * row.nsScore!, weight: row.multiplicity }));
  const count = counted.reduce((sum, { weight }) => sum + weight, 0);
  if (count === 0) return undefined;
  const mine = sign * nsScore;
  const points = counted.reduce((sum, { score, weight }) => sum + weight * (score < mine ? 2 : score === mine ? 1 : 0), 0);
  const top = 2 * count;
  const datum = roundToTen(counted.reduce((sum, { score, weight }) => sum + score * weight, 0) / count);
  const total = counted.reduce((sum, { score, weight }) => sum + weight * impsFor(mine - score), 0);
  return {
    method,
    count,
    matchpoints: { points, top, percentage: (100 * points) / top },
    butler: { datum, imps: impsFor(mine - datum) },
    cross: { total, perComparison: total / count }
  };
}

/** The game after the original table's actions, or undefined when there are none or one is rejected. */
export function replayOriginal(record: HandRecord): GameState | undefined {
  if (!record.original || record.original.length === 0) return undefined;
  let state = createGameState(record);
  for (const action of record.original) {
    const result = applyAction(state, action);
    if (!result.ok) return undefined;
    state = result.state;
  }
  return state;
}
