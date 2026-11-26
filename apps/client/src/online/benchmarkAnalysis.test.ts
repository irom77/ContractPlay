import { deal } from "@contractplay/core";
import { expect, it, vi } from "vitest";
import { analyzeBenchmarkJob } from "./benchmarkAnalysis.js";

it("resumes at unanalyzed retained boards and sends only numeric analysis", async () => {
  const board = { number: 6, dealer: "north", deal: deal(), vulnerability: "Both" };
  const baseline = { source: "bridge-dds-1.4.0" as const, parNS: 90, tricks: Array.from({ length: 5 }, () => [2, 7, 8, 9]) };
  const solve = vi.fn(async () => baseline);
  const request = vi.fn<NonNullable<Parameters<typeof analyzeBenchmarkJob>[3]>>()
    .mockResolvedValueOnce(Response.json({ analyzed: true }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ analyzed: false, board }))
    .mockResolvedValueOnce(Response.json({ analyzed: true }, { status: 201 }));
  expect(await analyzeBenchmarkJob("job", 3, solve, request)).toEqual({ existing: 1, analyzed: 1, unavailable: 1 });
  expect(solve).toHaveBeenCalledExactlyOnceWith(board);
  expect(request).toHaveBeenLastCalledWith("/api/admin/benchmarks/jobs/job/boards/2/double-dummy",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(baseline) });
});
