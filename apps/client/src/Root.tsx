import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import App, { type MenuDialog } from "./App.js";
import { serviceUrl } from "./online/connection.js";
import { Lobby } from "./online/Lobby.js";
import { OnlineTable } from "./online/OnlineTable.js";
import { parseRoute, routeHash, type Route } from "./online/route.js";
import { Admin } from "./admin/Admin.js";
import { BenchmarkLeaderboard, BenchmarkReplay } from "./online/BenchmarkPages.js";
import { BenchmarkPracticePage } from "./online/BenchmarkPracticePage.js";

// The UI preview mode is loaded only when someone opens #/mocks.
const Previews = lazy(() => import("./mocks/Previews.js").then((module) => ({ default: module.Previews })));

export default function Root() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const storage = useMemo(() => window.localStorage, []);
  // Online play opens the solo app at its Recent hands dialog, where finished online hands are kept too.
  const [soloDialog, setSoloDialog] = useState<MenuDialog | undefined>();
  // The lobby's Play panel asks solo to deal at once. Held only until the route leaves solo, so a later visit never deals.
  const [soloStart, setSoloStart] = useState(false);
  useEffect(() => { if (route.screen !== "solo") setSoloStart(false); }, [route.screen]);
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Sets the route directly so navigation never depends on a hashchange event firing.
  const navigate = (next: Route) => {
    const hash = routeHash(next);
    if (hash === "") history.replaceState(null, "", location.pathname + location.search);
    else location.hash = hash;
    setRoute(next);
  };
  const openSolo = (dialog?: MenuDialog, start = false) => { setSoloDialog(dialog); setSoloStart(start); navigate({ screen: "solo" }); };

  if (route.screen === "mocks") {
    return <Suspense fallback={<main className="app-shell" />}><Previews index={route.index} onIndex={(index) => navigate({ screen: "mocks", index })} /></Suspense>;
  }
  const baseUrl = serviceUrl();
  if (location.pathname === "/admin") {
    if (baseUrl !== undefined) return <Admin baseUrl={baseUrl} />;
    return <main className="app-shell"><section className="empty-table lobby admin-page"><div className="lobby-panel">Online table administration is unavailable in this build.</div></section></main>;
  }
  if (baseUrl !== undefined && route.screen === "leaderboard") return <BenchmarkLeaderboard baseUrl={baseUrl} />;
  if (baseUrl !== undefined && route.screen === "benchmark-replay") return <BenchmarkReplay key={`${route.jobId}:${route.tableIndex}:${route.boardIndex}`} baseUrl={baseUrl} jobId={route.jobId} tableIndex={route.tableIndex} boardIndex={route.boardIndex} />;
  if (baseUrl !== undefined && route.screen === "benchmark-practice") return <BenchmarkPracticePage key={`${route.jobId}:${route.tableIndex}:${route.boardIndex}:${route.profileId}:${route.version}`} baseUrl={baseUrl} jobId={route.jobId} tableIndex={route.tableIndex} boardIndex={route.boardIndex} profileId={route.profileId} version={route.version}
    onExit={() => navigate({ screen: "benchmark-replay", jobId: route.jobId, tableIndex: route.tableIndex, boardIndex: route.boardIndex })} />;
  if (baseUrl === undefined || route.screen === "solo") return <App autoStart={soloStart} {...(soloDialog ? { initialDialog: soloDialog } : {})} />;
  if (route.screen === "lobby") {
    return <Lobby baseUrl={baseUrl} storage={storage} onOpenTable={(id, observer) => navigate({ screen: "table", id, ...(observer ? { observer } : {}) })} onPlaySolo={() => openSolo(undefined, true)} onRecentHands={() => openSolo("hands")} />;
  }
  if (route.screen === "table") return <OnlineTable key={`${route.id}:${route.observer ? "observer" : "player"}`} baseUrl={baseUrl} tableId={route.id} {...(route.observer ? { observer: true as const } : {})} storage={storage} onLeave={() => navigate({ screen: "lobby" })} onRecentHands={() => openSolo("hands")} />;
  return <App autoStart={soloStart} {...(soloDialog ? { initialDialog: soloDialog } : {})} />;
}
