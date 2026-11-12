/** `mocks` is the UI preview mode; `index` counts from 0 while its hash counts screens from 1. */
export type Route = { screen: "solo" } | { screen: "lobby" } | { screen: "table"; id: string } | { screen: "mocks"; index: number };

export function parseRoute(hash: string): Route {
  if (hash === "#/online") return { screen: "lobby" };
  const match = /^#\/table\/([A-Za-z0-9]+)$/.exec(hash);
  if (match?.[1]) return { screen: "table", id: match[1].toUpperCase() };
  const mocks = /^#\/mocks(?:\/(\d+))?$/.exec(hash);
  if (mocks) return { screen: "mocks", index: Math.max(0, Number(mocks[1] ?? 1) - 1) };
  return { screen: "solo" };
}

export function routeHash(route: Route): string {
  switch (route.screen) {
    case "solo": return "";
    case "lobby": return "#/online";
    case "table": return `#/table/${route.id}`;
    case "mocks": return `#/mocks/${route.index + 1}`;
  }
}
