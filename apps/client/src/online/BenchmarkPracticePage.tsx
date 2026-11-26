import { useEffect, useState } from "react";
import App from "../App.js";
import { createBenchmarkPractice, type ReleasedPracticeResult } from "./benchmarkPractice.js";
import { routeHash } from "./route.js";

export function BenchmarkPracticePage({ baseUrl, jobId, tableIndex, boardIndex, profileId, version, onExit }: {
  baseUrl: string; jobId: string; tableIndex: number; boardIndex: number; profileId: string; version: string; onExit(): void;
}) {
  const [result, setResult] = useState<ReleasedPracticeResult>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch(`${baseUrl.replace(/\/+$/, "")}/api/benchmarks/results/${encodeURIComponent(jobId)}/${tableIndex}/${boardIndex}`).then(async (response) => {
      if (!response.ok) throw new Error("This generated board is private, incomplete, or no longer retained.");
      const value = await response.json() as ReleasedPracticeResult;
      if (active) setResult(value);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Couldn't load this benchmark board."); });
    return () => { active = false; };
  }, [baseUrl, jobId, tableIndex, boardIndex]);

  if (error) return <main className="app-shell"><section className="lobby-panel" role="alert">{error}<a href={routeHash({ screen: "leaderboard" })}>Bot leaderboard</a></section></main>;
  if (!result) return <main className="app-shell"><p role="status">Loading released benchmark board…</p></main>;
  const practice = createBenchmarkPractice(result, profileId, version);
  if (!practice) return <main className="app-shell"><section className="lobby-panel" role="alert">That profile is not assigned to this released benchmark table.<a href={routeHash({ screen: "leaderboard" })}>Bot leaderboard</a></section></main>;
  return <App key={`${jobId}:${tableIndex}:${boardIndex}:${profileId}:${version}`} benchmarkPractice={practice} onExitBenchmarkPractice={onExit} />;
}
