import { SEATS } from "@contractplay/core";
import type { Deal, Seat } from "@contractplay/core";
import type { PublicGame, SeatInfo, TableSummary, TableView } from "@contractplay/protocol";
import { canDeal } from "./hand.js";
import { betweenHands, seatOf, type PlayerId, type SeatState, type TableState } from "./state.js";

const seatInfo = (state: TableState, s: SeatState): SeatInfo =>
  s.kind === "human"
    ? { kind: "human", name: s.name, away: state.awaySince[s.player] !== undefined, ...(s.standIn ? { standIn: s.standIn } : {}) }
    : s;

export function summaryOf(state: TableState): TableSummary {
  const seats = Object.fromEntries(SEATS.map((seat) => [seat, seatInfo(state, state.seats[seat])])) as Record<Seat, SeatInfo>;
  return { id: state.id, name: state.name, style: state.style, seats, handInProgress: !betweenHands(state) };
}

/** The game as `viewer` may see it: only own cards, plus dummy once the opening lead is made. */
function publicGame(state: TableState, viewerSeat: Seat): PublicGame | undefined {
  const g = state.game;
  if (!g) return undefined;
  const dummy = g.contract ? SEATS[(SEATS.indexOf(g.contract.declarer) + 2) % 4] : undefined;
  const dummyShown = g.completedTricks.length > 0 || g.currentTrick.length > 0;
  const viewerInfo = state.seats[viewerSeat];
  const declarerShownToHumanDummy = dummyShown && dummy === viewerSeat && g.contract !== undefined &&
    state.seats[g.contract.declarer].kind === "bot" && viewerInfo.kind === "human" &&
    (viewerInfo.standIn !== undefined || state.awaySince[viewerInfo.player] === undefined);
  const hands = Object.fromEntries(SEATS.map((seat) => [
    seat, seat === viewerSeat || (dummyShown && seat === dummy) || (declarerShownToHumanDummy && seat === g.contract!.declarer) ? [...g.hands[seat]] : []
  ])) as unknown as Deal;
  return {
    phase: g.phase, dealer: g.dealer, vulnerability: g.vulnerability, currentActor: g.currentActor,
    auction: g.auction, ...(g.contract ? { contract: g.contract } : {}), hands,
    currentTrick: g.currentTrick, completedTricks: g.completedTricks, ...(g.score ? { score: g.score } : {}),
    trickLeader: g.trickLeader
  };
}

/** The only function that builds game data for a client. */
export function viewFor(state: TableState, player: PlayerId | undefined): TableView {
  const yourSeat = seatOf(state, player);
  const hostSeat = seatOf(state, state.host);
  const game = yourSeat ? publicGame(state, yourSeat) : undefined;
  return {
    ...summaryOf(state),
    listed: state.listed, revision: state.revision, handNumber: state.handNumber, totals: { ...state.totals },
    ...(hostSeat ? { host: hostSeat } : {}),
    ...(yourSeat ? { yourSeat } : {}),
    canDeal: canDeal(state, player),
    ...(game ? { game } : {}),
    ...(yourSeat && state.game && betweenHands(state) ? { revealed: state.game.initialDeal } : {})
  };
}
