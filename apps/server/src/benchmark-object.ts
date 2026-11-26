import { DurableObject } from "cloudflare:workers";
import { BENCHMARK_ROTATION_VERSION, createRotation } from "@contractplay/benchmark";
import { MAX_TABLE_NAME } from "@contractplay/protocol";
import { BenchmarkStore, type BenchmarkClaim, type BenchmarkJob, type BenchmarkJobAction } from "./benchmark-store.js";
import { generatedSessionBoards, lobbyOf } from "./lobby-object.js";
import { BENCHMARK_ENGINE_VERSION } from "./table-object.js";

const STEP_MS = 1_000;
const POLL_MS = 15_000;
const LEASE_MS = 90_000;
const MAX_RETRIES = 5;
const BOARD_TIMEOUT_MS = 30 * 60_000;
// Keep replay facts for a rolling quarter or 10,000 completed boards, whichever is smaller.
// The 5-minute scheduled hook processes only a bounded batch; score and rating history is retained.
const REPLAY_RETENTION_MS = 90 * 24 * 60 * 60_000;
const REPLAY_RETENTION_BOARD_BUDGET = 10_000;
type Progress = { phase: "assign" | "boards" | "tables" | "session" | "admit" | "deal" | "wait";
  tableIds: string[]; boardIndex: number; nextTable: number; retries: number; deadline?: number };
type Lease = { id: string; token: string };
type Cleanup = { id: string; nextTable: number; count: number; nextAt: number; retries: number };
const runKey = (id: string) => `run:${id}`;
const cleanupKey = (id: string) => `cleanup:${id}`;
const sessionId = (id: string) => `benchmark:${id}`;
const initial = (): Progress => ({ phase: "assign", tableIds: [], boardIndex: 0, nextTable: 0, retries: 0 });
const terminal = (job: BenchmarkJob) => ["cancelled", "failed", "completed"].includes(job.status);

/** One serialized coordinator. Each alarm performs one setup, admission, dispatch, synchronization or cleanup step. */
export class BenchmarkObject extends DurableObject<Env> {
  private get store() { return new BenchmarkStore(this.env.DB); }

  async enqueue(input: { id: string; cohortId: string; roundIndex?: number }): Promise<BenchmarkJob | null> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.wake();
      return this.store.startJob({ ...input, roundIndex: input.roundIndex ?? null, now: Date.now() });
    });
  }

  async enqueueDue(at: number): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.wake();
      const store = this.store;
      try {
        await store.compactReplays(at, REPLAY_RETENTION_MS, REPLAY_RETENTION_BOARD_BUDGET);
      } catch (error) {
        // Archive maintenance is best-effort; it must not delay a due benchmark cohort.
        console.error("benchmark replay compaction failed", error);
      }
      for (const cohort of await store.dueCohorts(at)) {
        // Cohort IDs are server-generated UUIDs. Retries of the same cron tick identify the same job, including after a manually selected round.
        await store.startJob({ id: `cron-${cohort.id}-${at.toString(36)}`, cohortId: cohort.id, roundIndex: cohort.roundIndex, now: at });
      }
    });
  }

  async status(id: string): Promise<BenchmarkJob | null> { return this.store.getJob(id); }
  async pause(id: string): Promise<BenchmarkJob | null> { return this.change(id, "pause"); }
  async resume(id: string): Promise<BenchmarkJob | null> { return this.change(id, "resume"); }
  async cancel(id: string): Promise<BenchmarkJob | null> { return this.change(id, "cancel"); }

  private async change(id: string, action: BenchmarkJobAction): Promise<BenchmarkJob | null> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.wake();
      const store = this.store;
      const job = await store.getJob(id);
      if (!job) return null;
      if (action === "cancel" && !terminal(job)) await this.queueCleanup(job);
      if (action === "resume" && job.status === "paused") {
        const key = runKey(id);
        const progress = await this.ctx.storage.get<Progress>(key);
        if (progress?.phase === "wait") await this.ctx.storage.put(key, { ...progress, deadline: Date.now() + BOARD_TIMEOUT_MS });
      }
      return store.changeJobStatus(id, action, Date.now());
    });
  }

  private async wake(): Promise<void> {
    const at = Date.now() + STEP_MS;
    const armed = await this.ctx.storage.getAlarm();
    if (armed === null || armed > at) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      // Leave a durable recovery wake across external I/O even if execution stops before saving the cursor.
      await this.ctx.storage.setAlarm(Date.now() + LEASE_MS);
      const after = await this.ctx.storage.get<string>("cleanup-cursor") ?? "";
      let cleanups = await this.ctx.storage.list<Cleanup>({ prefix: "cleanup:", limit: 100, ...(after ? { startAfter: after } : {}) });
      if (cleanups.size === 0 && after) {
        await this.ctx.storage.delete("cleanup-cursor");
        cleanups = await this.ctx.storage.list<Cleanup>({ prefix: "cleanup:", limit: 100 });
      }
      const cleanupKeys = [...cleanups.keys()];
      const cleanup = [...cleanups.values()].find((item) => item.nextAt <= Date.now());
      const cursor = cleanup ? cleanupKey(cleanup.id) : cleanupKeys[cleanupKeys.length - 1];
      if (cursor) await this.ctx.storage.put("cleanup-cursor", cursor);
      if (cleanup) {
        try {
          await this.cleanup(cleanup);
          await this.wake();
          return;
        } catch (error) {
          const retries = cleanup.retries + 1;
          const nextAt = Date.now() + Math.min(POLL_MS * 2 ** Math.min(retries - 1, 5), 5 * 60_000);
          await this.ctx.storage.put(cleanupKey(cleanup.id), { ...cleanup, retries, nextAt });
          console.error("benchmark cleanup failed", cleanup.id, error);
          // Leave the cleanup durable, but let another cohort use this alarm while it backs off.
        }
      }
      const store = this.store;
      let lease = await this.ctx.storage.get<Lease>("lease");
      let job = lease && await store.renewClaim(lease.id, lease.token, Date.now(), LEASE_MS);
      if (!job) {
        const token = crypto.randomUUID();
        job = await store.claimNextJob(token, Date.now(), LEASE_MS);
        if (!job) {
          await this.ctx.storage.delete("lease");
          const expiry = await store.nextClaimExpiry();
          const cleanupWake = cleanups.size ? Date.now() + POLL_MS : null;
          const nextWake = [expiry, cleanupWake].filter((value): value is number => value !== null).reduce<number | null>(
            (earliest, value) => earliest === null || value < earliest ? value : earliest, null);
          if (nextWake !== null) await this.ctx.storage.setAlarm(Math.max(Date.now() + STEP_MS, nextWake));
          else await this.ctx.storage.deleteAlarm();
          return;
        }
        lease = { id: job.id, token };
        await this.ctx.storage.put("lease", lease);
      }
      const progress = await this.ctx.storage.get<Progress>(runKey(job.id)) ?? initial();
      let delay = STEP_MS;
      try {
        if (job.rotationVersion !== BENCHMARK_ROTATION_VERSION || job.profiles.some((p) => p.engineVersion !== BENCHMARK_ENGINE_VERSION)) {
          await this.finish(job, lease!.token, "failed");
        } else {
          delay = await this.advance(job, lease!.token, progress);
        }
      } catch (error) {
        // Partial RPCs are retried using the same session ID and table reservations.
        if (++progress.retries >= MAX_RETRIES) {
          console.error("benchmark step failed", job.id, progress.phase, error);
          await this.finish(job, lease!.token, "failed");
        } else {
          await this.ctx.storage.put(runKey(job.id), progress);
          delay = POLL_MS * progress.retries;
        }
      }
      await this.ctx.storage.setAlarm(Date.now() + delay);
    });
  }

  private async advance(job: BenchmarkJob, token: string, p: Progress): Promise<number> {
    const store = this.store;
    const claim = (): BenchmarkClaim => ({ token, now: Date.now() });
    const sid = sessionId(job.id);
    const session = this.env.SESSIONS.get(this.env.SESSIONS.idFromName(sid));
    switch (p.phase) {
      case "assign": {
        const rotation = [...createRotation(job.profiles, job.cohort.rotationSeed, job.roundIndex, job.cohort.maxTables)];
        if (rotation.length === 1) {
          // Compare both directions for a four-seat batch, including cohorts with byes.
          const { north, east, south, west } = rotation[0]!;
          rotation.push({ north: east, east: south, south: west, west: north });
        }
        await store.putTableAssignments(job.id, rotation, claim());
        if ((await store.listTableAssignments(job.id)).length !== rotation.length) throw new Error("Could not persist assignments");
        p.phase = "boards";
        break;
      }
      case "boards": {
        await store.putJobBoards(job.id, job.cohort.importId ? [] : generatedSessionBoards(job.cohort.boardCount), claim());
        if ((await store.listJobBoards(job.id)).length !== job.cohort.boardCount) throw new Error("Could not persist boards");
        p.phase = "tables";
        break;
      }
      case "tables": {
        const assignments = await store.listTableAssignments(job.id);
        const index = p.tableIds.length;
        const id = await lobbyOf(this.env).createBenchmarkTable({ jobId: job.id, sessionId: sid, tableIndex: index,
          name: `${job.cohort.name.slice(0, MAX_TABLE_NAME - 4)} · ${index + 1}`, style: job.cohort.biddingStyle,
          boardSource: job.cohort.importId === null ? "generated" : "imported", assignment: assignments[index]! });
        if (!id) {
          await this.finish(job, token, "failed");
          return STEP_MS;
        }
        p.tableIds.push(id);
        if (p.tableIds.length === assignments.length) p.phase = "session";
        break;
      }
      case "session":
        if (!await session.create({ id: sid, tables: p.tableIds, boards: await store.listJobBoards(job.id),
          scoring: job.cohort.scoring, benchmarkJobId: job.id })) throw new Error("Session creation conflict");
        p.phase = "admit";
        break;
      case "admit":
        if (!await store.startBoard(job.id, p.boardIndex, claim())) throw new Error("Board admission failed");
        p.nextTable = 0;
        p.phase = "deal";
        break;
      case "deal": {
        const tableId = p.tableIds[p.nextTable]!;
        const table = this.env.TABLES.get(this.env.TABLES.idFromName(tableId));
        if (!await table.startBenchmarkBoard(p.boardIndex)) throw new Error("Admitted board unavailable at table");
        if (++p.nextTable === p.tableIds.length) {
          p.phase = "wait";
          p.nextTable = 0;
          p.deadline = Date.now() + BOARD_TIMEOUT_MS;
        }
        break;
      }
      case "wait": {
        const next = await session.currentBoardIndex();
        if (next === undefined) throw new Error("Session unavailable");
        if (next === p.boardIndex) {
          if (p.deadline !== undefined && Date.now() >= p.deadline) {
            await this.finish(job, token, "failed");
            return STEP_MS;
          }
          // Repair one missing table alarm per poll. Choosing the next bot action stays on that table's own alarm.
          const id = p.tableIds[p.nextTable]!;
          if (!await this.env.TABLES.get(this.env.TABLES.idFromName(id)).startBenchmarkBoard(p.boardIndex)) throw new Error("Benchmark table unavailable");
          p.nextTable = (p.nextTable + 1) % p.tableIds.length;
          p.retries = 0;
          await this.ctx.storage.put(runKey(job.id), p);
          return POLL_MS;
        }
        if (next !== p.boardIndex + 1) throw new Error("Unexpected session board");
        if (next === job.cohort.boardCount) {
          await this.finish(job, token, "completed");
          return STEP_MS;
        }
        p.boardIndex = next;
        p.phase = "admit";
        break;
      }
    }
    p.retries = 0;
    await this.ctx.storage.put(runKey(job.id), p);
    return STEP_MS;
  }

  private async finish(job: BenchmarkJob, token: string, status: "completed" | "failed"): Promise<void> {
    await this.queueCleanup(job);
    const finalized = status === "completed"
      ? await this.store.finishRatedJob(job.id, token, Date.now())
      : await this.store.finishJob(job.id, token, status, Date.now());
    if (!finalized) throw new Error("Benchmark finalization refused");
  }

  private async queueCleanup(job: BenchmarkJob): Promise<void> {
    const key = cleanupKey(job.id);
    if (!await this.ctx.storage.get(key)) {
      await this.ctx.storage.put<Cleanup>(key, { id: job.id, nextTable: 0, count: job.cohort.maxTables, nextAt: Date.now(), retries: 0 });
    }
  }

  private async cleanup(item: Cleanup): Promise<void> {
    const key = cleanupKey(item.id);
    const job = await this.store.getJob(item.id);
    // An interrupted status change can leave an intent behind. The job row decides ownership.
    if (!job || !terminal(job)) {
      await this.ctx.storage.delete(key);
      return;
    }
    if (item.nextTable < item.count) {
      await lobbyOf(this.env).releaseBenchmarkTable(item.id, item.nextTable);
      await this.ctx.storage.put(key, { ...item, nextTable: item.nextTable + 1 });
      return;
    }
    const sid = sessionId(item.id);
    await this.env.SESSIONS.get(this.env.SESSIONS.idFromName(sid)).deleteForRollback();
    await this.ctx.storage.delete([key, runKey(item.id)]);
  }
}

export const benchmarkOf = (env: Env) => env.BENCHMARKS.get(env.BENCHMARKS.idFromName("benchmarks"));
