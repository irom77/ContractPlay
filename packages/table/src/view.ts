import { SEATS } from "@contractplay/core";
import type { Deal, HandRecord, Seat } from "@contractplay/core";
import type { PublicGame, SeatInfo, TableSummary, TableView } from "@contractplay/protocol";
import { sideOf } from "./claim.js";
import { canDeal, readyNeeded } from "./hand.js";
import { betweenHands, scoringOf, seatOf, type PlayerId, type SeatState, type TableState } from "./state.js";

const seatInfo = (state: TableState, s: SeatState): SeatInfo =>
  s.kind === "human"
    ? { kind: "human", name: s.name, away: state.awaySince[s.player] !== undefined, ...(s.standIn ? { standIn: s.standIn } : {}), ...(s.autoPlay ? { autoPlay: true as const } : {}) }
    : s;

export function summaryOf(state: TableState): TableSummary {
  const seats = Object.fromEntries(SEATS.map((seat) => [seat, seatInfo(state, state.seats[seat])])) as Record<Seat, SeatInfo>;
  return { id: state.id, name: state.name, style: state.style, scoring: scoringOf(state), aggression: state.aggression ?? "normal", seats, handInProgress: !betweenHands(state) };
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

/**
 * A replayed hand's notice for everyone at the table. Only once it is over: the original result, whether earlier
 * results were rescored, and the earlier results themselves (without the original play).
 */
function replayOf(state: TableState): TableView["replay"] {
  const record = state.replay?.record;
  if (!record?.replay) return undefined;
  const { firstPlayedAt, rescored, original } = record.replay;
  const shown = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "original")) as HandRecord;
  return betweenHands(state) ? { firstPlayedAt, rescored, original, record: shown } : { firstPlayedAt };
}

/** Between hands after one has been played: the seats that have confirmed the next hand and those it still waits for. */
function nextHandOf(state: TableState): TableView["nextHand"] {
  if (!state.game || !betweenHands(state)) return undefined;
  const ready = state.nextHandReady ?? [];
  const needed = readyNeeded(state);
  const seatsWhere = (test: (player: PlayerId) => boolean) => SEATS.filter((seat) => {
    const s = state.seats[seat];
    return s.kind === "human" && test(s.player);
  });
  return { ready: seatsWhere((player) => ready.includes(player)), waitingOn: seatsWhere((player) => needed.includes(player) && !ready.includes(player)) };
}

/** The only function that builds game data for a client. */
export function viewFor(state: TableState, player: PlayerId | undefined, session?: NonNullable<TableView["session"]>): TableView {
  const yourSeat = seatOf(state, player);
  const hostSeat = seatOf(state, state.host);
  const game = yourSeat ? publicGame(state, yourSeat) : undefined;
  const pending = state.pendingClaim;
  const replay = replayOf(state);
  const nextHand = nextHandOf(state);
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
    ...(replay ? { replay } : {}),
    ...(nextHand ? { nextHand } : {}),
    ...(yourSeat && state.game && betweenHands(state) ? { revealed: state.game.initialDeal } : {})
  };
}
