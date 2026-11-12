import type { GameAction, GameState, Seat, SkillLevel } from "@contractplay/core";
import { SEATS } from "@contractplay/core";
import type { ClientMessage, RefusalReason, TableStyle } from "@contractplay/protocol";

export type PlayerId = string;
export type SeatState =
  | { kind: "empty" }
  | { kind: "bot"; skill: SkillLevel }
  | { kind: "human"; player: PlayerId; name: string; since: number; standIn?: SkillLevel };

export type TableState = Readonly<{
  id: string; name: string; style: TableStyle; listed: boolean;
  host?: PlayerId; seats: Readonly<Record<Seat, SeatState>>;
  connections: Readonly<Record<PlayerId, number>>;
  awaySince: Readonly<Record<PlayerId, number>>;
  /** Display names learned on connect; a seated player with no known name is shown as "Player". */
  names: Readonly<Record<PlayerId, string>>;
  /** The staleness token for `act`, bumped by game and seat changes only; presence changes keep it, so it is not a change counter. */
  revision: number; handNumber: number;
  game?: GameState; totals: { ns: number; ew: number };
  turnSince: number; lastHumanAt: number; trickJustCompleted: boolean;
  /** Present (true) until a human first connects. A state without it counts as visited. */
  unvisited?: true;
}>;

export type TableEvent =
  | { type: "connect"; player: PlayerId; name: string; at: number }
  | { type: "disconnect"; player: PlayerId; at: number }
  | { type: "message"; player: PlayerId; message: Exclude<ClientMessage, { type: "hello" }>; at: number }
  | { type: "bot"; revision: number; action: GameAction; at: number }
  | { type: "tick"; at: number };

export type Outcome = { state: TableState; refused?: RefusalReason; expired?: true };

export const BOT_PAUSE_MS = 1000, TRICK_PAUSE_MS = 2000, IDLE_MS = 120_000, HOST_AWAY_MS = 600_000, EMPTY_TABLE_MS = 86_400_000;
/** A table no human has ever connected to expires this long after it was created. */
export const UNVISITED_TABLE_MS = 600_000;

export function createTable(input: { id: string; name: string; style: TableStyle; listed: boolean; at: number }): TableState {
  return {
    id: input.id, name: input.name, style: input.style, listed: input.listed,
    seats: { north: { kind: "empty" }, east: { kind: "empty" }, south: { kind: "empty" }, west: { kind: "empty" } },
    connections: {}, awaySince: {}, names: {}, revision: 0, handNumber: 0, totals: { ns: 0, ew: 0 },
    turnSince: input.at, lastHumanAt: input.at, trickJustCompleted: false, unvisited: true
  };
}

export const refuse = (state: TableState, refused: RefusalReason): Outcome => ({ state, refused });

/** Applies a change and bumps the revision by one. */
export const accept = (state: TableState, patch: Partial<Record<keyof TableState, unknown>>): Outcome =>
  ({ state: { ...state, ...patch, revision: state.revision + 1 } as TableState });

/** The seat a player occupies, if any. */
export function seatOf(state: TableState, player: PlayerId | undefined): Seat | undefined {
  if (player === undefined) return undefined;
  return SEATS.find((seat) => {
    const s = state.seats[seat];
    return s.kind === "human" && s.player === player;
  });
}

/** True when no hand is being played: no game yet, or the last one is complete or passed out. */
export const betweenHands = (state: TableState): boolean =>
  state.game === undefined || state.game.phase === "complete" || state.game.phase === "passed-out";

/** The player with the smallest `since` among seated humans, if any. */
export function earliestHuman(seats: TableState["seats"]): PlayerId | undefined {
  let best: { player: PlayerId; since: number } | undefined;
  for (const seat of SEATS) {
    const s = seats[seat];
    if (s.kind === "human" && (!best || s.since < best.since)) best = { player: s.player, since: s.since };
  }
  return best?.player;
}

/** Host after the seats changed: unchanged while the host is still seated, else the longest-seated human. */
export function hostAfter(state: TableState, seats: TableState["seats"]): { host?: PlayerId } {
  const stillSeated = state.host !== undefined && SEATS.some((seat) => {
    const s = seats[seat];
    return s.kind === "human" && s.player === state.host;
  });
  const host = stillSeated ? state.host : earliestHuman(seats);
  return host === undefined ? {} : { host };
}

export const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** The state with no hand on the table, as before the first deal. */
export const withoutGame = (state: TableState): TableState =>
  Object.fromEntries(Object.entries(state).filter(([k]) => k !== "game")) as TableState;

/** The state with its host removed (so a new host, if any, can be added without a stale one). */
export const withoutHost = (state: TableState): TableState =>
  Object.fromEntries(Object.entries(state).filter(([k]) => k !== "host")) as TableState;
