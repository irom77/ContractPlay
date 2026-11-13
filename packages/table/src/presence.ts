import type { Seat } from "@contractplay/core";
import { SEATS } from "@contractplay/core";
import { settleClaim } from "./claim.js";
import { botWake, deciderOf } from "./hand.js";
import {
  EMPTY_TABLE_MS, HOST_AWAY_MS, IDLE_MS, UNVISITED_TABLE_MS, accept, refuse, seatOf, without, withoutClaim,
  type Outcome, type PlayerId, type SeatState, type TableState
} from "./state.js";

// Presence bookkeeping (connect, disconnect, tick) changes who is shown as away or host but not
// what anyone may play, so it does not bump `revision`: an action chosen against the current
// revision stays valid when someone else's connection comes or goes.

type Human = Extract<SeatState, { kind: "human" }>;

const withoutStandIn = (seat: Human): Human =>
  ({ kind: "human", player: seat.player, name: seat.name, since: seat.since });

/**
 * A new connection: counts it, records the name, clears away and any stand-in put in while the player was away
 * (an Auto play stand-in the player chose stays until the hand ends), and marks a human as present.
 */
export function connect(state: TableState, player: PlayerId, name: string, at: number): Outcome {
  const seat = seatOf(state, player);
  const held = seat ? state.seats[seat] as Human : undefined;
  const seats = seat && held ? { ...state.seats, [seat]: { ...(held.autoPlay ? held : withoutStandIn(held)), name } } : state.seats;
  const visited = Object.fromEntries(Object.entries(state).filter(([key]) => key !== "unvisited")) as TableState;
  return {
    state: {
      ...visited, seats,
      connections: { ...state.connections, [player]: (state.connections[player] ?? 0) + 1 },
      awaySince: without(state.awaySince, player),
      names: { ...state.names, [player]: name },
      lastHumanAt: at
    }
  };
}

/** A closed connection: a seated player whose last connection closed is away from `at`; an unseated one is forgotten. */
export function disconnect(state: TableState, player: PlayerId, at: number): Outcome {
  const count = state.connections[player] ?? 0;
  if (count === 0) return { state };
  const remaining = count - 1;
  const seated = seatOf(state, player) !== undefined;
  const away = remaining === 0 && seated;
  return {
    state: {
      ...state,
      connections: remaining > 0 ? { ...state.connections, [player]: remaining } : without(state.connections, player),
      awaySince: away ? { ...state.awaySince, [player]: at } : state.awaySince,
      names: remaining === 0 && !seated ? without(state.names, player) : state.names,
      lastHumanAt: at
    }
  };
}

/** Whether `seat`'s holder decides the turn now in progress (their own seat, or dummy as declarer). */
function onTurn(state: TableState, seat: Seat): boolean {
  const game = state.game;
  return game !== undefined && (game.phase === "auction" || game.phase === "play") && deciderOf(state, game.currentActor) === seat;
}

/**
 * Puts a bot in for an away player (any other seated human), or for an idle player on turn (host only).
 * A pending claim is kept only when that seat was still to answer it, and the stand-in then answers at once;
 * otherwise the claim is cleared.
 */
export function handToBot(state: TableState, player: PlayerId, seat: Seat, at: number): Outcome {
  if (!seatOf(state, player)) return refuse(state, "not-seated");
  const target = state.seats[seat];
  if (target.kind !== "human" || target.standIn !== undefined || target.player === player) return refuse(state, "not-allowed");
  const away = state.awaySince[target.player] !== undefined;
  const idle = state.host === player && onTurn(state, seat) && at - state.turnSince >= IDLE_MS;
  if (!away && !idle) return refuse(state, "not-allowed");
  const pending = state.pendingClaim;
  const answers = pending !== undefined && pending.responders.includes(seat) && !pending.accepted.includes(seat);
  const handed = accept(pending && !answers ? withoutClaim(state) : state, { seats: { ...state.seats, [seat]: { ...target, standIn: "intermediate" } } });
  return answers ? settleClaim(handed.state, at) : handed;
}

/**
 * Auto play: during the auction or card play the sender hands their own calls and cards to a bot for the rest of the
 * hand. The stand-in ends by itself when the hand does (played out or passed out), or sooner when the player takes the
 * seat back.
 */
export function autoPlay(state: TableState, player: PlayerId): Outcome {
  const seat = seatOf(state, player);
  if (!seat) return refuse(state, "not-seated");
  const held = state.seats[seat] as Human;
  const phase = state.game?.phase;
  if ((phase !== "auction" && phase !== "play") || held.standIn !== undefined) return refuse(state, "not-allowed");
  return accept(withoutClaim(state), { seats: { ...state.seats, [seat]: { ...held, standIn: "intermediate", autoPlay: true } } });
}

/** The sender takes their seat back from a stand-in. */
export function resume(state: TableState, player: PlayerId): Outcome {
  const seat = seatOf(state, player);
  if (!seat) return refuse(state, "not-seated");
  const held = state.seats[seat] as Human;
  if (held.standIn === undefined) return refuse(state, "not-allowed");
  return accept(withoutClaim(state), { seats: { ...state.seats, [seat]: withoutStandIn(held) } });
}

/** The longest-seated human who is not away, other than `except`. */
function earliestPresent(state: TableState, except: PlayerId): PlayerId | undefined {
  let best: Human | undefined;
  for (const seat of SEATS) {
    const s = state.seats[seat];
    if (s.kind === "human" && s.player !== except && state.awaySince[s.player] === undefined && (!best || s.since < best.since)) best = s;
  }
  return best?.player;
}

/** When the host passes on, if the host is away and someone present could take over. */
function hostDeadline(state: TableState): number | undefined {
  const host = state.host;
  const since = host === undefined ? undefined : state.awaySince[host];
  return since === undefined || earliestPresent(state, host!) === undefined ? undefined : since + HOST_AWAY_MS;
}

/** When the table expires, if nobody is connected: sooner when no human has ever connected. */
function expiryDeadline(state: TableState): number | undefined {
  if (Object.keys(state.connections).length > 0) return undefined;
  return state.lastHumanAt + (state.unvisited ? UNVISITED_TABLE_MS : EMPTY_TABLE_MS);
}

/** Passes host on after HOST_AWAY_MS away, and reports expiry after EMPTY_TABLE_MS with nobody connected (UNVISITED_TABLE_MS if nobody ever was). */
export function tick(state: TableState, at: number): Outcome {
  const deadline = hostDeadline(state);
  const next = deadline !== undefined && at >= deadline ? { ...state, host: earliestPresent(state, state.host!)! } : state;
  const expiry = expiryDeadline(next);
  return expiry !== undefined && at >= expiry ? { state: next, expired: true } : { state: next };
}

/** When the shell should wake the table next: the earliest of the bot's turn and the host and expiry deadlines. */
export function nextWake(state: TableState): number | undefined {
  const times = [botWake(state), hostDeadline(state), expiryDeadline(state)].filter((t): t is number => t !== undefined);
  return times.length === 0 ? undefined : Math.min(...times);
}
