import { impsFor } from "@contractplay/core";
import type { Deal, Seat, Vulnerability } from "@contractplay/core";

export type DuplicateSessionBoard = Readonly<{
  number: number;
  deal: Deal;
  dealer: Seat;
  vulnerability: Vulnerability;
}>;

export type DuplicateSession = Readonly<{
  id: string;
  tables: readonly string[];
  boards: readonly DuplicateSessionBoard[];
  scoring: "matchpoints" | "imps";
  /** Board index currently released. Equals `boards.length` when the session is complete. */
  currentBoard: number;
  /** NS score for each table, keyed first by board index and then by table id. */
  results: Readonly<Record<number, Readonly<Record<string, number>>>>;
}>;

export type DuplicateSessionStanding = Readonly<{
  tableId: string;
  completedBoards: number;
  matchpoints: Readonly<{ points: number; top: number; percentage: number }>;
  /** Sum of the table's IMP differences against all other tables on all completed boards. */
  crossImps: number;
}>;

export function createDuplicateSession(input: {
  id: string;
  tables: readonly string[];
  boards: readonly DuplicateSessionBoard[];
  scoring: DuplicateSession["scoring"];
}): DuplicateSession {
  if (!input.id || input.tables.length < 2 || new Set(input.tables).size !== input.tables.length || input.tables.some((id) => !id)) {
    throw new Error("A duplicate session needs an id and at least two unique table ids");
  }
  if (input.boards.length === 0) throw new Error("A duplicate session needs at least one board");
  return { ...input, tables: [...input.tables], boards: [...input.boards], currentBoard: 0, results: {} };
}

/** Records an NS score once; the final result for a board releases the next board. */
export function recordDuplicateResult(session: DuplicateSession, tableId: string, boardIndex: number, nsScore: number): DuplicateSession | undefined {
  if (!session.tables.includes(tableId) || !Number.isSafeInteger(nsScore) || boardIndex < 0 || boardIndex >= session.boards.length) return undefined;
  if (boardIndex < session.currentBoard) return session.results[boardIndex]?.[tableId] === nsScore ? session : undefined;
  if (boardIndex !== session.currentBoard) return undefined;
  const current = session.results[boardIndex] ?? {};
  const previous = current[tableId];
  if (previous !== undefined) return previous === nsScore ? session : undefined;
  const results = { ...current, [tableId]: nsScore };
  const finalized = session.tables.every((table) => results[table] !== undefined);
  return {
    ...session,
    results: { ...session.results, [boardIndex]: results },
    currentBoard: finalized ? boardIndex + 1 : boardIndex
  };
}

/** Duplicate comparison of a North–South result with every other table on the same board. */
export function duplicateBoardScore(mine: number, otherScores: readonly number[]) {
  let points = 0, crossImps = 0;
  for (const other of otherScores) {
    points += mine > other ? 2 : mine === other ? 1 : 0;
    crossImps += impsFor(mine - other);
  }
  return { crossImps, matchpoints: { points, top: 2 * otherScores.length } };
}

/** Computes the visible standing from finalized boards only. */
export function sessionStanding(session: DuplicateSession, tableId: string): DuplicateSessionStanding | undefined {
  if (!session.tables.includes(tableId)) return undefined;
  let points = 0, top = 0, crossImps = 0, completedBoards = 0;
  for (let index = 0; index < session.currentBoard; index++) {
    const scores = session.results[index];
    const mine = scores?.[tableId];
    if (mine === undefined || !session.tables.every((table) => scores?.[table] !== undefined)) continue;
    completedBoards++;
    const board = duplicateBoardScore(mine, session.tables.filter(id => id !== tableId).map(id => scores![id]!));
    top += board.matchpoints.top;
    points += board.matchpoints.points;
    crossImps += board.crossImps;
  }
  return { tableId, completedBoards, matchpoints: { points, top, percentage: top === 0 ? 0 : points * 100 / top }, crossImps };
}

/** Competition ranking across the finalized session boards; ties share a rank. */
export function sessionRank(session: DuplicateSession, tableId: string): { rank: number; tableCount: number } | undefined {
  const mine = sessionStanding(session, tableId);
  if (!mine) return undefined;
  const metric = (standing: DuplicateSessionStanding) => session.scoring === "matchpoints"
    ? standing.matchpoints.percentage : standing.crossImps;
  const mineValue = metric(mine);
  const rank = 1 + session.tables.filter((id) => {
    const standing = sessionStanding(session, id);
    return standing !== undefined && metric(standing) > mineValue;
  }).length;
  return { rank, tableCount: session.tables.length };
}
