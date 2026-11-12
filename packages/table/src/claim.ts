import { SEATS, claimSeatFor, remainingTricks } from "@contractplay/core";
import type { GameState, Seat } from "@contractplay/core";
import { checkClaim } from "@contractplay/bots";
import { deciderOf, record } from "./hand.js";
import { accept, refuse, seatOf, withoutClaim, type Outcome, type PlayerId, type TableState } from "./state.js";

export { withoutClaim } from "./state.js";

/** 0 for north-south, 1 for east-west. */
export const sideOf = (seat: Seat): 0 | 1 => (SEATS.indexOf(seat) % 2) as 0 | 1;

/**
 * The seats that must accept a claim made now for `claimSeat`'s side: each defender for a declaring-side claim,
 * else whoever decides for declarer (a human dummy taking over for a bot declarer, or declarer).
 */
function respondersFor(state: TableState, claimSeat: Seat): Seat[] {
  const declarer = state.game!.contract!.declarer;
  return sideOf(claimSeat) === sideOf(declarer)
    ? SEATS.filter((seat) => sideOf(seat) !== sideOf(declarer))
    : [deciderOf(state, declarer)];
}

/** The seats that must accept the pending claim, as fixed when it was made; none when no claim is pending. */
export function claimResponders(state: TableState): Seat[] {
  return [...(state.pendingClaim?.responders ?? [])];
}

/** Whether a robot answers for this seat: a bot, or a human with a stand-in. */
function robotAnswers(state: TableState, seat: Seat): boolean {
  const s = state.seats[seat];
  return s.kind === "bot" || (s.kind === "human" && s.standIn !== undefined);
}

/** The person who made the pending claim, as a seat: whoever decides for the claiming side's seat. */
const claimerSeat = (state: TableState): Seat | undefined =>
  state.pendingClaim ? deciderOf(state, state.pendingClaim.seat) : undefined;

/** Drops the pending claim and stops its side claiming again until the current trick completes. */
function dropped(state: TableState): TableState {
  const side = sideOf(state.pendingClaim!.seat);
  return { ...withoutClaim(state), claimBlocked: { side, hand: state.handNumber, tricks: state.game!.completedTricks.length } };
}

/** Drops the pending claim and notes that `by` rejected it. */
function rejected(state: TableState, by: Seat): TableState {
  const { seat, tricks } = state.pendingClaim!;
  return { ...dropped(state), claimRejected: { seat, tricks, by } };
}

/**
 * Has every robot still to answer run the exact claim check (accepting only a proven claim), then applies the
 * claim once all responders have accepted. Expects a pending claim; the revision is already bumped.
 */
export function settleClaim(state: TableState, at: number): Outcome {
  const pending = state.pendingClaim!;
  const responders = pending.responders;
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

/** Whether `seat`'s side had a claim rejected or withdrawn earlier in the current trick of this hand. */
function claimBlockedFor(state: TableState, game: GameState, seat: Seat): boolean {
  const blocked = state.claimBlocked;
  return blocked !== undefined && blocked.side === sideOf(seat) && blocked.hand === state.handNumber &&
    blocked.tricks === game.completedTricks.length;
}

/**
 * The player on turn claims `tricks` of the remaining tricks for their side. Refused while a claim is pending, and
 * for a side whose claim was rejected or withdrawn during the current trick.
 */
export function claim(state: TableState, player: PlayerId, tricks: number, at: number): Outcome {
  const mine = seatOf(state, player);
  if (!mine) return refuse(state, "not-seated");
  const game = state.game;
  const seat = game ? claimSeatFor(game) : undefined;
  if (!game || seat === undefined || state.pendingClaim || claimBlockedFor(state, game, seat)) return refuse(state, "not-allowed");
  const own = state.seats[mine];
  if (deciderOf(state, game.currentActor) !== mine || (own.kind === "human" && own.standIn !== undefined)) return refuse(state, "not-your-turn");
  if (!Number.isInteger(tricks) || tricks < 0 || tricks > remainingTricks(game)) return refuse(state, "illegal");
  const madeAt = state.revision + 1;
  const pendingClaim = { seat, tricks, responders: respondersFor(state, seat), accepted: [], madeAt };
  const claimed = accept(withoutClaim(state), { pendingClaim, lastHumanAt: at });
  return settleClaim(claimed.state, at);
}

/** A responder accepts or rejects the pending claim, named by its `madeAt`; the first rejection cancels it. */
export function answerClaim(state: TableState, player: PlayerId, agree: boolean, claimId: number, at: number): Outcome {
  const mine = seatOf(state, player);
  if (!mine) return refuse(state, "not-seated");
  const pending = state.pendingClaim;
  if (!pending) return refuse(state, "not-allowed");
  if (pending.madeAt !== claimId) return refuse(state, "stale");
  const own = state.seats[mine];
  if (!pending.responders.includes(mine) || pending.accepted.includes(mine) ||
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
  return accept(dropped(state), { lastHumanAt: at });
}
