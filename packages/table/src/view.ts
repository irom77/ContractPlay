import { SEATS } from "@contractplay/core";
import type { Deal, Seat } from "@contractplay/core";
import type { PublicGame, SeatInfo, TableSummary, TableView } from "@contractplay/protocol";
import { sideOf } from "./claim.js";
import { canDeal } from "./hand.js";
import { betweenHands, scoringOf, seatOf, type PlayerId, type SeatState, type TableState } from "./state.js";

const seatInfo = (state: TableState, s: SeatState): SeatInfo =>
  s.kind === "human"
    ? { kind: "human", name: s.name, away: state.awaySince[s.player] !== undefined, ...(s.standIn ? { standIn: s.standIn } : {}), ...(s.autoPlay ? { autoPlay: true as const } : {}) }
    : s;

export function summaryOf(state: TableState): TableSummary {
  const seats = Object.fromEntries(SEATS.map((seat) => [seat, seatInfo(state, state.seats[seat])])) as Record<Seat, SeatInfo>;
  return { id: state.id, name: state.name, style: state.style, scoring: scoringOf(state), seats, handInProgress: !betweenHands(state) };
}

/**
 * The game as `viewer` may see it: only own cards, plus dummy once the opening lead is made, and, for the
 * claimer's opponents, the claiming side's seat while its claim is pending.
 */
function publicGame(state: TableState, viewerSeat: Seat): PublicGame | undefined {
  const g = state.game;
  if (!g) return undefined;
  const dummy = g.contract ? SEATS[(SEATS.indexOf(g.contract.declarer) + 2) % 4] : undefined;
  const dummyShown = g.completedTricks.length > 0 || g.currentTrick.length > 0;
  const viewerInfo = state.seats[viewerSeat];
  const declarerShownToHumanDummy = dummyShown && dummy === viewerSeat && g.contract !== undefined &&
    state.seats[g.contract.declarer].kind === "bot" && viewerInfo.kind === "human" &&
    (viewerInfo.standIn !== undefined || state.awaySince[viewerInfo.player] === undefined);
  const claimShown = state.pendingClaim !== undefined && sideOf(viewerSeat) !== sideOf(state.pendingClaim.seat);
  const hands = Object.fromEntries(SEATS.map((seat) => [
    seat, seat === viewerSeat || (claimShown && seat === state.pendingClaim!.seat) || (dummyShown && seat === dummy) || (declarerShownToHumanDummy && seat === g.contract!.declarer) ? [...g.hands[seat]] : []
  ])) as unknown as Deal;
  return {
    phase: g.phase, dealer: g.dealer, vulnerability: g.vulnerability, currentActor: g.currentActor,
    auction: g.auction, ...(g.contract ? { contract: g.contract } : {}), hands,
    currentTrick: g.currentTrick, completedTricks: g.completedTricks, ...(g.score ? { score: g.score } : {}),
    trickLeader: g.trickLeader, ...(g.claim ? { claim: g.claim } : {})
  };
}

/** The only function that builds game data for a client. */
export function viewFor(state: TableState, player: PlayerId | undefined, session?: NonNullable<TableView["session"]>): TableView {
  const yourSeat = seatOf(state, player);
  const hostSeat = seatOf(state, state.host);
  const game = yourSeat ? publicGame(state, yourSeat) : undefined;
  const pending = state.pendingClaim;
  const waitingOn = pending ? pending.responders.filter((seat) => !pending.accepted.includes(seat)) : [];
  return {
    ...summaryOf(state),
    listed: state.listed, revision: state.revision, handNumber: state.handNumber, totals: { ...state.totals },
    ...(state.rubber ? { rubber: state.rubber } : {}),
    ...(hostSeat ? { host: hostSeat } : {}),
    ...(yourSeat ? { yourSeat } : {}),
    canDeal: canDeal(state, player) && (!state.sessionId || (session !== undefined && !session.complete && !session.waitingForTables && session.completedBoards === state.handNumber)),
    ...(game ? { game } : {}),
    ...(pending ? { claim: { seat: pending.seat, tricks: pending.tricks, waitingOn, madeAt: pending.madeAt } } : {}),
    ...(state.claimRejected ? { claimRejected: { ...state.claimRejected } } : {}),
    ...(session ? { session } : {}),
    ...(yourSeat && state.game && betweenHands(state) ? { revealed: state.game.initialDeal } : {})
  };
}
