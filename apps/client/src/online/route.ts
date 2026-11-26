/** `mocks` is the UI preview mode; `index` counts from 0 while its hash counts screens from 1. */
export type Route = { screen: "solo" } | { screen: "lobby" } | { screen: "table"; id: string; observer?: true } | { screen: "leaderboard" } | { screen: "benchmark-replay"; jobId: string; tableIndex: number; boardIndex: number } | { screen: "benchmark-practice"; jobId: string; tableIndex: number; boardIndex: number; profileId: string; version: string } | { screen: "mocks"; index: number };

export function parseRoute(hash: string): Route {
  // On the online deployment, the bare site address opens the account-gated lobby.
  if (hash === "") return { screen: "lobby" };
  if (hash === "#/online") return { screen: "lobby" };
  if (hash === "#/solo") return { screen: "solo" };
  if (hash === "#/leaderboard") return { screen: "leaderboard" };
  const replay = /^#\/benchmark\/replay\/([A-Za-z0-9_.-]{1,64})\/(\d+)\/(\d+)$/.exec(hash);
  if (replay?.[1] && replay[2] && replay[3]) return { screen: "benchmark-replay", jobId: replay[1], tableIndex: Number(replay[2]), boardIndex: Number(replay[3]) };
  const practice = /^#\/benchmark\/practice\/([A-Za-z0-9_.-]{1,64})\/(\d+)\/(\d+)\/([A-Za-z0-9_.-]{1,64})\/([A-Za-z0-9_.-]{1,64})$/.exec(hash);
  if (practice?.[1] && practice[2] && practice[3] && practice[4] && practice[5]) return {
    screen: "benchmark-practice", jobId: practice[1], tableIndex: Number(practice[2]), boardIndex: Number(practice[3]), profileId: practice[4], version: practice[5]
  };
  const match = /^#\/table\/([A-Za-z0-9]+)$/.exec(hash);
  if (match?.[1]) return { screen: "table", id: match[1].toUpperCase() };
  const observer = /^#\/observe\/([A-Za-z0-9]+)$/.exec(hash);
  if (observer?.[1]) return { screen: "table", id: observer[1].toUpperCase(), observer: true };
  const mocks = /^#\/mocks(?:\/(\d+))?\/?$/.exec(hash);
  if (mocks) return { screen: "mocks", index: Math.max(0, Number(mocks[1] ?? 1) - 1) };
  return { screen: "solo" };
}

export function routeHash(route: Route): string {
  switch (route.screen) {
    case "solo": return "#/solo";
    case "lobby": return "#/online";
    case "table": return route.observer ? `#/observe/${route.id}` : `#/table/${route.id}`;
    case "leaderboard": return "#/leaderboard";
    case "benchmark-replay": return `#/benchmark/replay/${route.jobId}/${route.tableIndex}/${route.boardIndex}`;
    case "benchmark-practice": return `#/benchmark/practice/${route.jobId}/${route.tableIndex}/${route.boardIndex}/${route.profileId}/${route.version}`;
    case "mocks": return `#/mocks/${route.index + 1}`;
  }
}
