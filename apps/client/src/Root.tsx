import { useEffect, useMemo, useState } from "react";
import App from "./App.js";
import { serviceUrl } from "./online/connection.js";
import { Lobby } from "./online/Lobby.js";
import { parseRoute, routeHash, type Route } from "./online/route.js";

export default function Root() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const storage = useMemo(() => window.localStorage, []);
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

  const baseUrl = serviceUrl();
  if (baseUrl === undefined || route.screen === "solo") return <App />;
  if (route.screen === "lobby") {
    return <Lobby baseUrl={baseUrl} storage={storage} onOpenTable={(id) => navigate({ screen: "table", id })} onSolo={() => navigate({ screen: "solo" })} />;
  }
  return <main className="app-shell"><h1>Table {route.id}</h1></main>;
}
