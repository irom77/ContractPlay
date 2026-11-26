import { DurableObject } from "cloudflare:workers";
import { createDuplicateSession, recordDuplicateResult, sessionRank, sessionStanding } from "@contractplay/table";
import type { DuplicateSession, DuplicateSessionBoard } from "@contractplay/table";
import { BenchmarkStore } from "./benchmark-store.js";

const STATE_KEY = "session";
type StoredSession = DuplicateSession & { benchmarkJobId?: string };

/** One duplicate session: the private shared boards and serialized cross-table results. */
export class SessionObject extends DurableObject<Env> {
  private state: StoredSession | null | undefined;

  async create(input: { id: string; tables: readonly string[]; boards: readonly DuplicateSessionBoard[]; scoring: "matchpoints" | "imps"; benchmarkJobId?: string }): Promise<boolean> {
    const existing = await this.load();
    if (existing) return input.benchmarkJobId !== undefined && existing.benchmarkJobId === input.benchmarkJobId
      && existing.tables.length === input.tables.length && existing.tables.every((id, index) => id === input.tables[index]);
    const { benchmarkJobId, ...session } = input;
    this.state = { ...createDuplicateSession(session), ...(benchmarkJobId ? { benchmarkJobId } : {}) };
    await this.ctx.storage.put(STATE_KEY, this.state);
    return true;
  }

  async deleteForRollback(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  /** Internal table RPC. Only the matching released board can be fetched. */
  async boardFor(tableId: string, boardIndex: number): Promise<DuplicateSessionBoard | undefined> {
    const state = await this.load();
    if (!state || !state.tables.includes(tableId) || boardIndex !== state.currentBoard) return undefined;
    if (state.benchmarkJobId && !await new BenchmarkStore(this.env.DB).boardStarted(state.benchmarkJobId, boardIndex)) return undefined;
    return state.boards[boardIndex];
  }

  /** Internal table RPC. Duplicate reports are safe to retry after an object restart. */
  async report(tableId: string, boardIndex: number, nsScore: number): Promise<boolean> {
    const state = await this.load();
    if (!state) return false;
    const next = recordDuplicateResult(state, tableId, boardIndex, nsScore);
    if (!next) return false;
    if (next !== state) {
      this.state = state.benchmarkJobId ? { ...next, benchmarkJobId: state.benchmarkJobId } : next;
      await this.ctx.storage.put(STATE_KEY, this.state);
    }
    return true;
  }

  async currentBoardIndex(): Promise<number | undefined> {
    return (await this.load())?.currentBoard;
  }

  /** Does not return boards, deals, auctions, or play. */
  async status(tableId: string): Promise<{
    board: number; position: number; boardCount: number; scoring: "matchpoints" | "imps"; completedBoards: number;
    complete: boolean; waitingForTables: boolean; rank: number; tableCount: number;
    matchpoints: { points: number; top: number; percentage: number }; crossImps: number;
  } | undefined> {
    const state = await this.load();
    if (!state) return undefined;
    const standing = sessionStanding(state, tableId);
    const rank = sessionRank(state, tableId);
    return standing && rank ? {
      board: state.boards[Math.min(state.currentBoard, state.boards.length - 1)]!.number,
      position: Math.min(state.currentBoard, state.boards.length - 1) + 1,
      boardCount: state.boards.length,
      scoring: state.scoring,
      completedBoards: standing.completedBoards,
      complete: state.currentBoard === state.boards.length,
      waitingForTables: state.currentBoard < state.boards.length && state.results[state.currentBoard]?.[tableId] !== undefined,
      ...rank,
      matchpoints: standing.matchpoints,
      crossImps: standing.crossImps
    } : undefined;
  }

  private async load(): Promise<StoredSession | null> {
    if (this.state === undefined) this.state = (await this.ctx.storage.get<StoredSession>(STATE_KEY)) ?? null;
    return this.state;
  }
}
