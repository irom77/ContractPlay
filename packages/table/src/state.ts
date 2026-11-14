import type { Deal, GameAction, GameState, Rubber, Seat, SkillLevel } from "@contractplay/core";
import { SEATS } from "@contractplay/core";
import type { ClientMessage, RefusalReason, TableScoring, TableStyle } from "@contractplay/protocol";

export type PlayerId = string;
export type SeatState =
  | { kind: "empty" }
  | { kind: "bot"; skill: SkillLevel }
  | { kind: "human"; player: PlayerId; name: string; since: number; standIn?: SkillLevel;
      /** The stand-in was asked for by the player (Auto play) and lasts only until the hand ends. */
      autoPlay?: true };

export type TableState = Readonly<{
  id: string; name: string; style: TableStyle; listed: boolean;
  /** Missing on tables stored before rubber scoring, which keep their running totals. */
  scoring?: TableScoring;
  /** Durable duplicate-session coordinator id; only generated-session table views carry this. */
  sessionId?: string;
  /** The current released board, copied from the coordinator immediately before dealing. */
  sessionBoard?: Readonly<{ index: number; number: number; deal: Deal; dealer: Seat; vulnerability: GameState["vulnerability"] }>;
  /** A rubber table's rubber, from its first deal. A won rubber stays until the next deal starts a new one. */
  rubber?: Rubber;
  host?: PlayerId; seats: Readonly<Record<Seat, SeatState>>;
  connections: Readonly<Record<PlayerId, number>>;
  awaySince: Readonly<Record<PlayerId, number>>;
  /** Display names learned on connect; a seated player with no known name is shown as "Player". */
  names: Readonly<Record<PlayerId, string>>;
  /** The staleness token for `act`, bumped by game and seat changes only; presence changes keep it, so it is not a change counter. */
  revision: number; handNumber: number;
  game?: GameState; totals: { ns: number; ew: number };
  turnSince: number; lastHumanAt: number; trickJustCompleted: boolean;
  /**
   * A claim waiting for answers. `seat` is the claiming side's seat in the game (declarer for the declaring side,
   * else the defender who claimed). `responders` are the seats that must accept, fixed when the claim is made;
   * `accepted` lists those that have. `madeAt` is the revision the claim was made at, which answers must quote.
   * Play is frozen meanwhile.
   */
  pendingClaim?: Readonly<{ seat: Seat; tricks: number; responders: readonly Seat[]; accepted: readonly Seat[]; madeAt: number }>;
  /** The last claim and the seat that rejected it, kept until the next game action or claim change. */
  claimRejected?: Readonly<{ seat: Seat; tricks: number; by: Seat }>;
  /**
   * The side (0 north-south, 1 east-west) whose claim was last rejected or withdrawn, in hand `hand` with `tricks`
   * tricks completed: it may not claim again until a trick completes. Stale once the hand or trick count moves on.
   */
  claimBlocked?: Readonly<{ side: 0 | 1; hand: number; tricks: number }>;
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

/** How a table scores; tables stored before rubber scoring keep running totals. */
export const scoringOf = (state: TableState): TableScoring => state.scoring ?? "duplicate";

export function createTable(input: { id: string; name: string; style: TableStyle; scoring?: TableScoring; listed: boolean; at: number }): TableState {
  return {
    id: input.id, name: input.name, style: input.style, scoring: input.scoring ?? "rubber", listed: input.listed,
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

/** The seats with every Auto play stand-in removed, for when a hand ends: those players get their seats back. */
export function withoutAutoPlay(seats: TableState["seats"]): TableState["seats"] {
  if (!SEATS.some((seat) => { const s = seats[seat]; return s.kind === "human" && s.autoPlay; })) return seats;
  return Object.fromEntries(SEATS.map((seat) => {
    const s = seats[seat];
    return [seat, s.kind === "human" && s.autoPlay ? { kind: "human", player: s.player, name: s.name, since: s.since } : s];
  })) as TableState["seats"];
}

/** The state with no hand on the table, as before the first deal. */
export const withoutGame = (state: TableState): TableState =>
  Object.fromEntries(Object.entries(state).filter(([k]) => k !== "game")) as TableState;

/** The state with no pending claim and no rejection notice. */
export const withoutClaim = (state: TableState): TableState =>
  state.pendingClaim === undefined && state.claimRejected === undefined
    ? state
    : Object.fromEntries(Object.entries(state).filter(([k]) => k !== "pendingClaim" && k !== "claimRejected")) as TableState;

/** The state with its host removed (so a new host, if any, can be added without a stale one). */
export const withoutHost = (state: TableState): TableState =>
  Object.fromEntries(Object.entries(state).filter(([k]) => k !== "host")) as TableState;
