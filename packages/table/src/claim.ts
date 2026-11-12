import { SEATS, claimSeatFor, remainingTricks } from "@contractplay/core";
import type { Seat } from "@contractplay/core";
import { checkClaim } from "@contractplay/bots";
import { deciderOf, record } from "./hand.js";
import { accept, refuse, seatOf, withoutClaim, type Outcome, type PlayerId, type TableState } from "./state.js";

export { withoutClaim } from "./state.js";

const partnerOf = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 2) % 4]!;

/**
 * The seats that must accept the pending claim: each defender for a declaring-side claim, else whoever decides
 * for declarer (a human dummy taking over for a bot declarer, or declarer).
 */
export function claimResponders(state: TableState): Seat[] {
  const pending = state.pendingClaim;
  const declarer = state.game?.contract?.declarer;
  if (!pending || !declarer) return [];
  const declaringSide = pending.seat === declarer || pending.seat === partnerOf(declarer);
  return declaringSide ? SEATS.filter((seat) => seat !== declarer && seat !== partnerOf(declarer)) : [deciderOf(state, declarer)];
}

/** Whether a robot answers for this seat: a bot, or a human with a stand-in. */
function robotAnswers(state: TableState, seat: Seat): boolean {
  const s = state.seats[seat];
  return s.kind === "bot" || (s.kind === "human" && s.standIn !== undefined);
}

/** The person who made the pending claim, as a seat: whoever decides for the claiming side's seat. */
const claimerSeat = (state: TableState): Seat | undefined =>
  state.pendingClaim ? deciderOf(state, state.pendingClaim.seat) : undefined;

/** Drops the pending claim and notes that `by` rejected it. */
function rejected(state: TableState, by: Seat): TableState {
  const { seat, tricks } = state.pendingClaim!;
  return { ...withoutClaim(state), claimRejected: { seat, tricks, by } };
}

/**
 * Has every robot still to answer run the exact claim check (accepting only a proven claim), then applies the
 * claim once all responders have accepted. Expects a pending claim; the revision is already bumped.
 */
export function settleClaim(state: TableState, at: number): Outcome {
  const pending = state.pendingClaim!;
  const responders = claimResponders(state);
  const robots = responders.filter((seat) => !pending.accepted.includes(seat) && robotAnswers(state, seat));
  let next = state;
  if (robots.length > 0) {
    if (checkClaim(state.game!, pending) !== "proven") return { state: rejected(state, robots[0]!) };
    next = { ...state, pendingClaim: { ...pending, accepted: [...pending.accepted, ...robots] } };
  }
  const accepted = next.pendingClaim!.accepted;
  if (!responders.every((seat) => accepted.includes(seat))) return { state: next };
  return record(next, { type: "claim", seat: pending.seat, tricks: pending.tricks }, at, true);
}

/** The player on turn claims `tricks` of the remaining tricks for their side. */
export function claim(state: TableState, player: PlayerId, tricks: number, at: number): Outcome {
  const mine = seatOf(state, player);
  if (!mine) return refuse(state, "not-seated");
  const game = state.game;
  const seat = game ? claimSeatFor(game) : undefined;
  if (!game || seat === undefined || state.pendingClaim) return refuse(state, "not-allowed");
  const own = state.seats[mine];
  if (deciderOf(state, game.currentActor) !== mine || (own.kind === "human" && own.standIn !== undefined)) return refuse(state, "not-your-turn");
  if (!Number.isInteger(tricks) || tricks < 0 || tricks > remainingTricks(game)) return refuse(state, "illegal");
  const claimed = accept(withoutClaim(state), { pendingClaim: { seat, tricks, accepted: [] }, lastHumanAt: at });
  return settleClaim(claimed.state, at);
}

/** A responder accepts or rejects the pending claim; the first rejection cancels it. */
export function answerClaim(state: TableState, player: PlayerId, agree: boolean, at: number): Outcome {
  const mine = seatOf(state, player);
  if (!mine) return refuse(state, "not-seated");
  const pending = state.pendingClaim;
  const own = state.seats[mine];
  if (!pending || !claimResponders(state).includes(mine) || pending.accepted.includes(mine) ||
    (own.kind === "human" && own.standIn !== undefined)) return refuse(state, "not-allowed");
  if (!agree) return accept(rejected(state, mine), { lastHumanAt: at });
  const answered = accept(state, { pendingClaim: { ...pending, accepted: [...pending.accepted, mine] }, lastHumanAt: at });
  return settleClaim(answered.state, at);
}

/** The claimer takes the pending claim back; play resumes. */
export function withdrawClaim(state: TableState, player: PlayerId, at: number): Outcome {
  const mine = seatOf(state, player);
  if (!mine) return refuse(state, "not-seated");
  if (claimerSeat(state) !== mine) return refuse(state, "not-allowed");
  return accept(withoutClaim(state), { lastHumanAt: at });
}
