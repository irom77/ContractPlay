import type { DoubleDummyBaseline, DoubleDummyRequest } from "../doubleDummy.js";

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Run bounded, resumable analysis for one completed benchmark job using the administrator's existing session. */
export async function analyzeBenchmarkJob(jobId: string, boardCount: number, solve: (board: DoubleDummyRequest) => Promise<DoubleDummyBaseline>,
  request: Fetch = fetch): Promise<{ analyzed: number; existing: number; unavailable: number }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(jobId) || !Number.isInteger(boardCount) || boardCount < 1 || boardCount > 32)
    throw new Error("Invalid benchmark job or board count");
  const counts = { analyzed: 0, existing: 0, unavailable: 0 };
  for (let index = 0; index < boardCount; index++) {
    const path = `/api/admin/benchmarks/jobs/${jobId}/boards/${index}/double-dummy`;
    const response = await request(path);
    if (response.status === 404) { counts.unavailable++; continue; }
    if (!response.ok) throw new Error(`Cannot read board ${index + 1} (HTTP ${response.status})`);
    const result = await response.json() as { analyzed: true } | { analyzed: false; board: DoubleDummyRequest };
    if (result.analyzed) { counts.existing++; continue; }
    const baseline = await solve(result.board);
    const recorded = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(baseline) });
    if (!recorded.ok) throw new Error(`Cannot save analysis for board ${index + 1} (HTTP ${recorded.status})`);
    if (recorded.status === 201) counts.analyzed++;
    else counts.existing++;
  }
  return counts;
}
