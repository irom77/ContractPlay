import type { Seat, SkillLevel } from "@contractplay/core";
import { accept, betweenHands, hostAfter, refuse, seatOf, without, withoutHost, type Outcome, type PlayerId, type SeatState, type TableState } from "./state.js";

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

export function leave(state: TableState, player: PlayerId): Outcome {
  const seat = seatOf(state, player);
  if (!seat) return refuse(state, "not-seated");
  if (!betweenHands(state)) return refuse(state, "hand-in-progress");
  return vacate(state, seat, player);
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

/** Empties a human's seat, drops their away mark, and passes host on if needed. */
function vacate(state: TableState, seat: Seat, player: PlayerId): Outcome {
  const seats = withSeat(state, seat, { kind: "empty" });
  return accept({ ...withoutHost(state), seats, awaySince: without(state.awaySince, player) }, hostAfter(state, seats));
}
