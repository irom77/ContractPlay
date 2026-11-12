import type { Seat, SkillLevel } from "@contractplay/core";
import { SEATS } from "@contractplay/core";
import { accept, betweenHands, hostAfter, refuse, seatOf, without, withoutGame, withoutHost, type Outcome, type PlayerId, type SeatState, type TableState } from "./state.js";

function withSeat(state: TableState, seat: Seat, value: SeatState): TableState["seats"] {
  return { ...state.seats, [seat]: value };
}

/** Seats a new human; the first human at the table becomes host. */
export function sit(state: TableState, player: PlayerId, name: string, seat: Seat, at: number): Outcome {
  if (state.seats[seat].kind !== "empty") return refuse(state, "seat-taken");
  if (seatOf(state, player) !== undefined) return refuse(state, "already-seated");
  if (!betweenHands(state)) return refuse(state, "hand-in-progress");
  const seats = withSeat(state, seat, { kind: "human", player, name, since: at });
  return accept(state, { seats, ...(state.host === undefined ? { host: player } : {}) });
}

/**
 * The sender leaves their seat. Between hands it is emptied; during a hand a bot takes it over for good so the
 * others can finish, unless nobody human would remain, in which case the hand is abandoned unscored.
 */
export function leave(state: TableState, player: PlayerId): Outcome {
  const seat = seatOf(state, player);
  if (!seat) return refuse(state, "not-seated");
  if (betweenHands(state)) return vacate(state, seat, player);
  const othersSeated = SEATS.some((other) => other !== seat && state.seats[other].kind === "human");
  if (!othersSeated) return vacate(withoutGame(state), seat, player);
  return vacate(state, seat, player, { kind: "bot", skill: "intermediate" });
}

export function setBot(state: TableState, player: PlayerId, seat: Seat, skill: SkillLevel): Outcome {
  if (!seatOf(state, player)) return refuse(state, "not-seated");
  if (!betweenHands(state)) return refuse(state, "hand-in-progress");
  if (state.seats[seat].kind === "human") return refuse(state, "not-allowed");
  return accept(state, { seats: withSeat(state, seat, { kind: "bot", skill }) });
}

export function clearSeat(state: TableState, player: PlayerId, seat: Seat): Outcome {
  if (!seatOf(state, player)) return refuse(state, "not-seated");
  if (!betweenHands(state)) return refuse(state, "hand-in-progress");
  const target = state.seats[seat];
  if (target.kind === "empty") return refuse(state, "not-allowed");
  if (target.kind === "bot") return accept(state, { seats: withSeat(state, seat, { kind: "empty" }) });
  const allowed = state.host === player || state.awaySince[target.player] !== undefined;
  return allowed ? vacate(state, seat, target.player) : refuse(state, "not-allowed");
}

/** Empties a human's seat (or hands it to `replacement`), drops their away mark (and their name if they have no open connection), and passes host on if needed. */
function vacate(state: TableState, seat: Seat, player: PlayerId, replacement: SeatState = { kind: "empty" }): Outcome {
  const seats = withSeat(state, seat, replacement);
  const names = (state.connections[player] ?? 0) > 0 ? state.names : without(state.names, player);
  return accept({ ...withoutHost(state), seats, names, awaySince: without(state.awaySince, player) }, hostAfter(state, seats));
}
