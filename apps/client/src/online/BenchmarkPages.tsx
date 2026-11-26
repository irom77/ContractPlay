import { useEffect, useMemo, useState } from "react";
import { browserStorage, loadHandLayout } from "../table/handLayout.js";
import { applyAction, createGameState, SEATS, type GameAction, type GameState } from "@contractplay/core";
import { botCharacter } from "@contractplay/bots";
import type { PublicGame } from "@contractplay/protocol";
import { TableView } from "../table/TableView.js";
import type { ReleasedPracticeResult } from "./benchmarkPractice.js";
import { routeHash } from "./route.js";
import { ReloadButton } from "../table/ReloadButton.js";

type Rating = { competitorId: string; rating: number; deviation: number; volatility: number; sampleBoards: number; handsPlayed?: number; ratedAt: number; algorithmVersion: string; scoreTransformVersion: string; eligible: boolean };
type ResultSummary = { jobId: string; tableIndex: number; boardIndex: number; boardNumber: number; nsScore: number; ewScore: number; completedAt: number; releasedAt: number; replayAvailable: boolean; replayStatus: "available" | "private-import" | "expired" };
type Profile = { profile: { profileId: string; version: string; skill: string; aggression: string; biddingStyle: string; engineVersion: string }; status: string };
type Metrics = { scoring: "imps" | "matchpoints"; sessions: number; boards: number; impsPerBoard: number; matchpointPercentage: number; wins: number; ties: number; losses: number; winPercentage: number };
type Diagnostic = { source: string; maxTableResults: number; analyzedTableResults: number; auction: { samples: number; meanAbsoluteParGapPoints: number | null }; declarer: { samples: number; meanTricksBelowOptimum: number | null }; defense: { samples: number; meanTricksPreventedVsDoubleDummy: number | null } };
type RatingHistory = Rating & { jobId: string; scoreTransformVersion: string };
type Replay = ReleasedPracticeResult & { actions: GameAction[] };
const when = (value: number) => new Date(value).toLocaleDateString();

export function BenchmarkLeaderboard({ baseUrl }: { baseUrl: string }) {
  const api = baseUrl.replace(/\/+$/, "");
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [results, setResults] = useState<ResultSummary[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  const [metrics, setMetrics] = useState<Metrics[]>([]);
  const [diagnostics, setDiagnostics] = useState<unknown>();
  const [history, setHistory] = useState<RatingHistory[]>([]);
  useEffect(() => { void Promise.all([fetch(`${api}/api/benchmarks/leaderboard`), fetch(`${api}/api/benchmarks/results`)]).then(async ([r, s]) => {
    if (!r.ok || !s.ok) throw new Error();
    setRatings((await r.json() as { ratings: Rating[] }).ratings); setResults((await s.json() as { results: ResultSummary[] }).results);
  }).catch(() => setError("Couldn't load benchmark rankings.")); }, [api]);
  useEffect(() => { if (!selected) return; let active = true; const [id, version] = JSON.parse(selected) as [string, string];
    void Promise.all([fetch(`${api}/api/benchmarks/profiles/${id}/${version}/metrics`), fetch(`${api}/api/benchmarks/profiles/${id}/${version}/diagnostics`), fetch(`${api}/api/benchmarks/profiles/${id}/${version}/ratings`)]).then(async ([m, d, h]) => {
      if (!m.ok || !d.ok || !h.ok) throw new Error(); const [nextMetrics, nextDiagnostics, nextHistory] = await Promise.all([m.json() as Promise<Metrics[]>, d.json(), h.json() as Promise<{ ratings: RatingHistory[] }>]);
      if (!active) return; setMetrics(nextMetrics); setDiagnostics(nextDiagnostics); setHistory(nextHistory.ratings);
    }).catch(() => { if (active) { setMetrics([]); setDiagnostics(undefined); setHistory([]); } });
    return () => { active = false; };
  }, [api, selected]);
  const profiles = useMemo(() => fetch(`${api}/api/benchmarks/profiles`).then((response) => response.json() as Promise<{ profiles: Profile[] }>), [api]);
  const [roster, setRoster] = useState<Profile[]>([]);
  useEffect(() => { let active = true; void profiles.then((value) => { if (active) setRoster(value.profiles); }).catch(() => {}); return () => { active = false; }; }, [profiles]);
  const profileFor = (competitorId: string) => { try { const [id, version] = JSON.parse(competitorId) as [string, string]; return roster.find((item) => item.profile.profileId === id && item.profile.version === version)?.profile; } catch { return undefined; } };
  const ratingTable = (items: Rating[], ranked: boolean) => items.length ? <div className="benchmark-rankings"><table><thead><tr>{ranked ? <th>Rank</th> : null}<th>Profile</th><th>Rating ± RD</th><th>σ</th><th title="Distinct deals: each is played at every table and scored by comparing the tables">Boards</th><th title="Hands this bot played: one per board at each table where it sat">Hands</th><th>Status</th><th>Rated</th><th>Versions</th></tr></thead><tbody>{items.map((rating, index) => { const profile = profileFor(rating.competitorId); return <tr key={rating.competitorId}>{ranked ? <td>{index + 1}</td> : null}<td><button className="text-button" onClick={() => setSelected(rating.competitorId)}>{profile ? `${profile.profileId} · ${profile.version}` : rating.competitorId}</button>{profile ? <small>{profile.skill} · {profile.aggression} · {profile.biddingStyle} · {profile.engineVersion}</small> : null}</td><td>{rating.rating.toFixed(0)} ± {rating.deviation.toFixed(0)}</td><td>{rating.volatility.toFixed(3)}</td><td>{rating.sampleBoards}</td><td>{rating.handsPlayed ?? "—"}</td><td>{rating.eligible ? "Eligible" : "Provisional"}</td><td>{when(rating.ratedAt)}</td><td>{rating.algorithmVersion} · {rating.scoreTransformVersion}</td></tr>; })}</tbody></table></div> : <p className="quiet-copy">No {ranked ? "eligible" : "provisional"} bot profiles yet.</p>;
  const eligible = ratings.filter((rating) => rating.eligible);
  const provisional = ratings.filter((rating) => !rating.eligible);
  return <main className="app-shell"><section className="empty-table lobby" aria-label="Bot benchmark leaderboard">
    <div className="start-bar"><span className="brand"><span className="brand-mark">C</span>Bot benchmarks</span><span className="table-tools-row"><a className="secondary-button" href="/#/online">Back to lobby</a><ReloadButton /></span></div>
    <section className="lobby-panel"><h1>Bot leaderboard</h1><p className="quiet-copy">Ratings are versioned; a profile becomes eligible after 20 boards and rating deviation below 100. A board is one deal, played at every table of a round and scored by comparing the tables, so each bot plays more hands than boards.</p>{error ? <p role="alert">{error}</p> : null}
      <h2>Eligible rankings</h2>{ratingTable(eligible, true)}<h2>Provisional ratings</h2>{ratingTable(provisional, false)}
      {selected ? <section aria-label="Selected profile diagnostics"><h2>Rolling profile diagnostics</h2>{metrics.length ? metrics.map((item) => <p key={item.scoring}>{item.scoring}: {item.boards} boards / {item.sessions} sessions · {item.impsPerBoard.toFixed(2)} IMP/board · {item.matchpointPercentage.toFixed(1)}% MP · {item.wins}-{item.ties}-{item.losses} ({item.winPercentage.toFixed(1)}% wins)</p>) : <p>No completed sessions yet.</p>}<h3>Double-dummy diagnostics</h3>{(() => { const dd = diagnostics as Diagnostic | undefined; return dd ? <><p>Source: {dd.source}. Coverage: {dd.analyzedTableResults} of at most {dd.maxTableResults} recent table results.</p><p>Auction: mean absolute par gap {dd.auction.meanAbsoluteParGapPoints?.toFixed(1) ?? "—"} points ({dd.auction.samples} samples).</p><p>Declarer: {dd.declarer.meanTricksBelowOptimum?.toFixed(2) ?? "—"} tricks below optimum ({dd.declarer.samples} declaring samples).</p><p>Defense: {dd.defense.meanTricksPreventedVsDoubleDummy?.toFixed(2) ?? "—"} tricks prevented versus double dummy ({dd.defense.samples} samples).</p></> : <p>No DDS analysis recorded yet.</p>; })()}<h3>Rating history</h3>{history.length ? <ol>{history.map((item) => <li key={`${item.jobId}:${item.ratedAt}`}>{when(item.ratedAt)} · {item.rating.toFixed(0)} ± {item.deviation.toFixed(0)} · {item.sampleBoards} boards · {item.algorithmVersion}/{item.scoreTransformVersion}</li>)}</ol> : <p>No archived ratings yet.</p>}</section> : null}
    </section>
    <section className="lobby-panel"><h2>Completed boards</h2>{results.map((result) => <p key={`${result.jobId}:${result.tableIndex}:${result.boardIndex}`}>Board {result.boardNumber} · NS {result.nsScore} / EW {result.ewScore} · {when(result.completedAt)} {result.replayStatus === "available" ? <a href={`/#/benchmark/replay/${result.jobId}/${result.tableIndex}/${result.boardIndex}`}>Replay</a> : result.replayStatus === "private-import" ? <span>Imported deal replay is private</span> : <span>Replay expired under the retention policy</span>}</p>)}</section>
  </section></main>;
}

export function BenchmarkReplay({ baseUrl, jobId, tableIndex, boardIndex }: { baseUrl: string; jobId: string; tableIndex: number; boardIndex: number }) {
  const [result, setResult] = useState<Replay>(); const [error, setError] = useState(""); const [step, setStep] = useState(0);
  useEffect(() => { let active = true; void fetch(`${baseUrl.replace(/\/+$/, "")}/api/benchmarks/results/${encodeURIComponent(jobId)}/${tableIndex}/${boardIndex}`).then(async (response) => {
    if (!response.ok) throw new Error(response.status === 404 ? "This replay is unavailable or private." : "Couldn't load this replay.");
    const replay = await response.json() as Replay; if (active) { setResult(replay); setStep(0); }
  }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Couldn't load this replay."); }); return () => { active = false; }; }, [baseUrl, jobId, tableIndex, boardIndex]);
  const game = useMemo(() => { if (!result) return undefined; let state = createGameState({ deal: result.board.deal, dealer: result.board.dealer, vulnerability: result.board.vulnerability });
    for (const action of result.actions.slice(0, step)) { const transition = applyAction(state, action); if (!transition.ok) return undefined; state = transition.state; } return state;
  }, [result, step]);
  if (error) return <main className="app-shell"><section className="lobby-panel" role="alert">{error}<a href="/#/leaderboard">Leaderboard</a></section></main>;
  if (!result || !game) return <main className="app-shell"><p role="status">Loading completed replay…</p></main>;
  const atEnd = step >= result.actions.length;
  const replayGame = { ...game, hands: atEnd ? game.hands : { north: [], east: [], south: [], west: [] } };
  const revealed = atEnd ? Object.fromEntries(Object.entries(result.board.deal)) as GameState["hands"] : undefined;
  return <main className="app-shell"><section className="empty-table lobby" aria-label="Benchmark replay"><div className="start-bar"><span className="brand">Completed benchmark replay · Board {result.board.number}</span><span className="table-tools-row"><a className="secondary-button" href={routeHash({ screen: "leaderboard" })}>Leaderboard</a><ReloadButton /></span></div>
    {result.field.length >= 2 ? <section className="lobby-panel" aria-label="Play this benchmark deal"><h2>Play this deal</h2><p>Take a profile’s assigned seat, face its original three bots, and compare your result with the released duplicate field.</p><div className="field-actions">{SEATS.map((seat) => { const profile = result.assignment[seat]; const character = botCharacter(profile.profileId); return <a className="secondary-button" key={`${profile.profileId}:${profile.version}`} href={routeHash({ screen: "benchmark-practice", jobId: result.jobId, tableIndex: result.tableIndex, boardIndex: result.boardIndex, profileId: profile.profileId, version: profile.version })}>Play as {character?.name ?? profile.profileId} · {profile.version}</a>; })}</div></section> : null}
    <div className="replay-controls"><button className="secondary-button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Previous action</button><label>Action {step} of {result.actions.length}<input aria-label="Replay action" type="range" min={0} max={result.actions.length} value={step} onChange={(event) => setStep(Number(event.target.value))} /></label><button className="secondary-button" onClick={() => setStep(Math.min(result.actions.length, step + 1))} disabled={atEnd}>Next action</button></div>
    <TableView game={replayGame as PublicGame} bottomSeat="south" handLayout={loadHandLayout(browserStorage())} displayedTrick={game.currentTrick} showCalls lastTrickOpen={false} onToggleCalls={() => {}} onToggleLastTrick={() => {}} showBottomHand fixedSeatHands cardsDisabled bidsDisabled statusText={atEnd ? "Completed deal · all hands revealed" : "Replay actions · hands concealed"} ariaLabel="Benchmark deal replay" boardLabel={`Board ${result.board.number}`} {...(revealed ? { revealedHands: revealed } : {})} />
  </section></main>;
}
