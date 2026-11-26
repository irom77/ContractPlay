import { benchmarkProfileVersionId, GLICKO_2_VERSION, INITIAL_RATING, ratingPeriodUpdate } from "@contractplay/benchmark";
import type { BenchmarkTableAssignment, RatingScoreTransform, RatingState } from "@contractplay/benchmark";
import { SEATS } from "@contractplay/core";
import { duplicateBoardScore } from "@contractplay/table";

export const BENCHMARK_SCORE_TRANSFORM: RatingScoreTransform = {
  version: "cross-imp-per-board-10.5-v1",
  toFractionalScore: ({ crossImps }, boards) => 1 / (1 + 10 ** (-(crossImps / boards) / 10.5))
};
export type ScoredBoard = { boardIndex: number; tableIndex: number; nsScore: number };
type Score = ReturnType<typeof duplicateBoardScore>;
type ProfileScore = Score & { competitorId: string; sampleBoards: number; appearances: number };
export type SessionScores = {
  scoring: "imps" | "matchpoints";
  boards: (ScoredBoard & Score)[];
  tables: (Score & { tableIndex: number; rank: number })[];
  profiles: ProfileScore[];
};

export function scoreSession(scoring: SessionScores["scoring"], assignments: BenchmarkTableAssignment[], rows: ScoredBoard[], boardCount: number): SessionScores {
  const tables = assignments.map((_, tableIndex) => ({ tableIndex, rank: 1, crossImps: 0, matchpoints: { points: 0, top: 0 } }));
  const boards: SessionScores["boards"] = [];
  const boardRows = new Map<number, ScoredBoard[]>();
  for (const row of rows) {
    const group = boardRows.get(row.boardIndex) ?? [];
    group.push(row);
    boardRows.set(row.boardIndex, group);
  }
  if (tables.length < 2 || boardRows.size !== boardCount) throw new Error("Incomplete benchmark session");
  for (let index = 0; index < boardCount; index++) {
    const group = boardRows.get(index);
    if (!group || group.length !== tables.length) throw new Error("Incomplete benchmark board");
    for (const row of group) {
      const score = duplicateBoardScore(row.nsScore, group.filter(other => other.tableIndex !== row.tableIndex).map(other => other.nsScore));
      boards.push({ ...row, ...score });
      const table = tables[row.tableIndex]!;
      table.crossImps += score.crossImps;
      table.matchpoints.points += score.matchpoints.points;
      table.matchpoints.top += score.matchpoints.top;
    }
  }
  const metric = (t: Score) => scoring === "imps" ? t.crossImps : t.matchpoints.points;
  const profiles = new Map<string, ProfileScore>();
  for (const table of tables) {
    table.rank = 1 + tables.filter(other => metric(other) > metric(table)).length;
    for (const [index, seat] of SEATS.entries()) {
      const competitorId = benchmarkProfileVersionId(assignments[table.tableIndex]![seat]);
      const own = profiles.get(competitorId) ?? { competitorId, sampleBoards: boardCount, appearances: 0, crossImps: 0, matchpoints: { points: 0, top: 0 } };
      const ns = index % 2 === 0;
      own.appearances++;
      own.crossImps += (ns ? table.crossImps : -table.crossImps) / (tables.length - 1);
      own.matchpoints.points += ns ? table.matchpoints.points : table.matchpoints.top - table.matchpoints.points;
      own.matchpoints.top += table.matchpoints.top;
      profiles.set(competitorId, own);
    }
  }
  for (const own of profiles.values()) {
    own.crossImps /= own.appearances;
    own.matchpoints.points /= own.appearances;
    own.matchpoints.top /= own.appearances;
  }
  return { scoring, boards, tables, profiles: [...profiles.values()] };
}

/** One observation against the opposing pair, adjusted for partner strength. Repeated exposures share their weight. */
export function rateSession(scores: SessionScores, assignments: BenchmarkTableAssignment[], previous: Map<string, RatingState>) {
  const observations = scores.profiles.map(p => {
    const coefficients = new Map<string, number>();
    for (const table of assignments) {
      const ids = SEATS.map(seat => benchmarkProfileVersionId(table[seat]));
      const seat = ids.indexOf(p.competitorId);
      if (seat < 0) continue;
      for (let offset = 1; offset <= 3; offset++) {
        const other = ids[(seat + offset) % 4]!;
        coefficients.set(other, (coefficients.get(other) ?? 0) + (offset === 2 ? -1 : 1) / p.appearances);
      }
    }
    let rating = 0, variance = 0;
    for (const [id, weight] of coefficients) {
      const opponent = previous.get(id) ?? INITIAL_RATING;
      rating += weight * opponent.rating;
      variance += (weight * opponent.deviation) ** 2;
    }
    return { competitorId: p.competitorId, opponentId: "adjusted-opposition",
      opponentRating: { rating, deviation: Math.sqrt(variance) }, sampleBoards: p.sampleBoards,
      rawScore: { crossImps: p.crossImps, matchpoints: p.matchpoints } };
  });
  return ratingPeriodUpdate(previous, observations, GLICKO_2_VERSION, BENCHMARK_SCORE_TRANSFORM);
}
