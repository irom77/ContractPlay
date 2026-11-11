export type Route = { screen: "solo" } | { screen: "lobby" } | { screen: "table"; id: string };

export function parseRoute(hash: string): Route {
  if (hash === "#/online") return { screen: "lobby" };
  const match = /^#\/table\/([A-Za-z0-9]+)$/.exec(hash);
  if (match?.[1]) return { screen: "table", id: match[1].toUpperCase() };
  return { screen: "solo" };
}

export function routeHash(route: Route): string {
  switch (route.screen) {
    case "solo": return "";
    case "lobby": return "#/online";
    case "table": return `#/table/${route.id}`;
  }
}
