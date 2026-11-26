import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [originInput, jobId] = process.argv.slice(2);
const cookie = process.env.BENCHMARK_ADMIN_COOKIE;
if (!originInput || !cookie || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(jobId ?? "")) {
  throw new Error("Usage: set BENCHMARK_ADMIN_COOKIE to your signed-in admin Cookie header, then run node apps/client/scripts/analyze-benchmark.mjs <origin> <job-id>");
}
const origin = new URL(originInput);
const localhost = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
if (originInput !== origin.origin || !(origin.protocol === "https:" || (localhost && origin.protocol === "http:"))) {
  throw new Error("Provide the HTTPS app origin or an HTTP localhost origin");
}
const request = (path, init) => fetch(new URL(path, origin), { ...init, redirect: "error",
  headers: { ...init?.headers, Origin: origin.origin, Cookie: cookie } });
const response = await request(`/api/admin/benchmarks/jobs/${jobId}`);
if (!response.ok) throw new Error(`Cannot read benchmark job (HTTP ${response.status})`);
const job = await response.json();
if (job.status !== "completed") throw new Error("The benchmark job must be complete");
// Vite loads the same TypeScript and bundled DDS module as the browser. Middleware mode opens no HTTP listener.
const runtime = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ["bridge-dds"] } });
try {
  const { analyzeBenchmarkJob } = await runtime.ssrLoadModule("/src/online/benchmarkAnalysis.ts");
  const { serializeDdsDeal } = await runtime.ssrLoadModule("/src/ddsDeal.ts");
  const { solveBoard } = await runtime.ssrLoadModule("/src/ddsAnalysis.ts");
  const counts = await analyzeBenchmarkJob(jobId, job.cohort.boardCount,
    (board) => solveBoard({ ...board, cards: serializeDdsDeal(board.deal) }), request);
  console.log(`${jobId}: ${counts.analyzed} analyzed, ${counts.existing} already analyzed, ${counts.unavailable} unavailable`);
} finally {
  await runtime.close();
}
