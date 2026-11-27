/** A benchmark table's job, as the admin API names it; only a benchmark admin's session can read or stop it. */
export type BenchmarkTableJob = { jobId: string; status: "queued" | "running" | "paused" | "cancelled" | "completed" | "failed" };

const path = (tableId: string) => `/api/admin/benchmarks/tables/${encodeURIComponent(tableId)}`;

/** The job behind a watched benchmark table, or undefined when the viewer is not a benchmark admin (or the table is gone). */
export async function benchmarkTableJob(tableId: string, request: typeof fetch = fetch): Promise<BenchmarkTableJob | undefined> {
  try {
    const response = await request(path(tableId), { credentials: "same-origin" });
    return response.ok ? await response.json() as BenchmarkTableJob : undefined;
  } catch {
    return undefined;
  }
}

/** Cancels the benchmark run a table belongs to; its tables then close and its session is removed. */
export async function stopBenchmarkTable(tableId: string, request: typeof fetch = fetch): Promise<BenchmarkTableJob> {
  const response = await request(`${path(tableId)}/stop`, { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error(`Could not stop the run (HTTP ${response.status})`);
  return await response.json() as BenchmarkTableJob;
}

/** The admin calls behind Stop, injectable so the UI previews can show it without a server. */
export type BenchmarkAdminApi = { job(tableId: string): Promise<BenchmarkTableJob | undefined>; stop(tableId: string): Promise<BenchmarkTableJob> };
export const benchmarkAdminApi: BenchmarkAdminApi = { job: (tableId) => benchmarkTableJob(tableId), stop: (tableId) => stopBenchmarkTable(tableId) };
