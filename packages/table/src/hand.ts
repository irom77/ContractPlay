import { applyAction, createDeck, createGameState, deal as dealCards, emptyRubber, nextRubberDeal, playContextFor, recordRubberHand, rewindTo, SEATS, shuffle } from "@contractplay/core";
import type { GameAction, GameState, Seat, SkillLevel } from "@contractplay/core";
import { createBot } from "@contractplay/bots";
import {
  BOT_PAUSE_MS, TRICK_PAUSE_MS, accept, betweenHands, refuse, scoringOf, seatOf, withoutAutoPlay, withoutClaim, withoutGame,
  type Outcome, type PlayerId, type TableState
} from "./state.js";

const VULNERABILITY = ["None", "NS", "EW", "Both", "NS", "EW", "Both", "None", "EW", "Both", "None", "NS", "Both", "None", "NS", "EW"] as const;

const dummyOf = (game: GameState): Seat | undefined =>
  game.contract ? SEATS[(SEATS.indexOf(game.contract.declarer) + 2) % 4] : undefined;

/** The id a table's hand has in its rubber. */
export const rubberHandId = (handNumber: number): string => `hand-${handNumber}`;

/** True when every seat is filled and at least one is a human. */
function tableReady(state: TableState): boolean {
  const kinds = SEATS.map((seat) => state.seats[seat].kind);
  return !kinds.includes("empty") && kinds.includes("human");
}

/** Whether this player may start a hand now. */
export function canDeal(state: TableState, player: PlayerId | undefined): boolean {
  return seatOf(state, player) !== undefined && tableReady(state) && betweenHands(state);
}

export function dealHand(state: TableState, player: PlayerId, at: number, random: () => number): Outcome {
  if (!seatOf(state, player)) return refuse(state, "not-seated");
  if (!canDeal(state, player)) return refuse(state, "not-ready");
  const handNumber = state.handNumber + 1;
  const deal = dealCards(shuffle(createDeck(), random));
  if (scoringOf(state) === "rubber") {
    // Rubber deals rotate the dealer from North and take vulnerability from games won; a won rubber starts a new one.
    const next = nextRubberDeal(state.rubber ?? emptyRubber(), "north");
    const game = createGameState({ deal, dealer: next.dealer, vulnerability: next.vulnerability });
    const rubber = { ...next.rubber, activeHandId: rubberHandId(handNumber) };
    return accept(state, { handNumber, game, rubber, turnSince: at, lastHumanAt: at, trickJustCompleted: false });
  }
  const game = createGameState({
    deal,
    dealer: SEATS[(handNumber - 1) % 4]!,
    vulnerability: VULNERABILITY[(handNumber - 1) % 16]!
  });
  return accept(state, { handNumber, game, turnSince: at, lastHumanAt: at, trickJustCompleted: false });
}

/** The seat whose holder decides for `seat`, including a human dummy taking over for a bot declarer. */
export function deciderOf(state: TableState, seat: Seat): Seat {
  const game = state.game;
  if (game?.phase !== "play" || !game.contract) return seat;
  const declarer = game.contract.declarer;
  const dummy = dummyOf(game)!;
  const declarerState = state.seats[declarer];
  const dummyState = state.seats[dummy];
  const dummyCanTakeOver = declarerState.kind === "bot" && dummyState.kind === "human" &&
    (dummyState.standIn !== undefined || state.awaySince[dummyState.player] === undefined);
  if (dummyCanTakeOver && (seat === declarer || seat === dummy)) return dummy;
  return seat === dummy ? declarer : seat;
}

/** Whether the seated human controls this play, including both declaring hands after a bot declares. */
function controls(state: TableState, player: PlayerId, seat: Seat): boolean {
  const actingSeat = deciderOf(state, seat);
  const s = state.seats[actingSeat];
  return s.kind === "human" && s.player === player && s.standIn === undefined && actingSeat === seatOf(state, player);
}

/** Records an action that already passed the controller check; refuses when the rules do. Clears any claim notice. */
export function record(state: TableState, action: GameAction, at: number, byHuman: boolean): Outcome {
  if (!state.game) return refuse(state, "illegal");
  const result = applyAction(state.game, action);
  if (!result.ok) return refuse(state, result.error.code === "wrong-actor" ? "not-your-turn" : "illegal");
  const game = result.state;
  const trickJustCompleted = action.type === "play" && game.phase === "play" && game.currentTrick.length === 0;
  let totals = state.totals;
  const rubber = state.rubber && game.phase === "complete" ? { rubber: recordRubberHand(state.rubber, rubberHandId(state.handNumber), game) } : {};
  if (scoringOf(state) === "duplicate" && game.phase === "complete" && game.score && game.contract) {
    // score is signed from North-South's side: the side that scored plus is credited
    const { score } = game.score;
    totals = score >= 0 ? { ...totals, ns: totals.ns + score } : { ...totals, ew: totals.ew - score };
  }
  // Auto play lasts for one hand: when the last card is played, or the hand is passed out, those players get their seats back.
  const seats = game.phase === "complete" || game.phase === "passed-out" ? withoutAutoPlay(state.seats) : state.seats;
  return accept(withoutClaim(state), { game, totals, ...rubber, seats, turnSince: at, trickJustCompleted, ...(byHuman ? { lastHumanAt: at } : {}) });
}

export function act(state: TableState, player: PlayerId, message: { handNumber: number; revision: number; action: GameAction }, at: number): Outcome {
  if (!seatOf(state, player)) return refuse(state, "not-seated");
  if (state.pendingClaim) return refuse(state, "not-allowed");
  if (message.handNumber !== state.handNumber || message.revision !== state.revision) return refuse(state, "stale");
  if (!controls(state, player, message.action.seat)) return refuse(state, "not-your-turn");
  return record(state, message.action, at, true);
}

/**
 * Takes back the sender's most recent call or card in the live hand, together with every bot action made since.
 * Refused when another human (not a stand-in bot) has acted after it, so nobody else's decision is ever undone.
 */
export function takeBack(state: TableState, player: PlayerId, at: number): Outcome {
  const mine = seatOf(state, player);
  if (!mine) return refuse(state, "not-seated");
  const game = state.game;
  const own = state.seats[mine];
  if (!game || betweenHands(state) || (own.kind === "human" && own.standIn !== undefined)) return refuse(state, "not-allowed");
  for (let count = game.history.cursor - 1; count >= 0; count--) {
    const before = rewindTo(game, count);
    const decider = deciderOf({ ...state, game: before }, game.history.actions[count]!.seat);
    if (decider === mine) return accept(withoutClaim(state), { game: before, turnSince: at, lastHumanAt: at, trickJustCompleted: false });
    const s = state.seats[decider];
    if (s.kind === "human" && s.standIn === undefined) return refuse(state, "not-allowed");
  }
  return refuse(state, "not-allowed");
}

/** The host abandons the hand in progress: it is not scored and the table returns to seating. */
export function cancelHand(state: TableState, player: PlayerId, at: number): Outcome {
  if (!seatOf(state, player)) return refuse(state, "not-seated");
  if (state.host !== player || betweenHands(state)) return refuse(state, "not-allowed");
  return accept(withoutGame(withoutClaim(state)), { seats: withoutAutoPlay(state.seats), turnSince: at, lastHumanAt: at, trickJustCompleted: false });
}

export function applyBotEvent(state: TableState, revision: number, action: GameAction, at: number): Outcome {
  if (revision !== state.revision || botToAct(state) !== action.seat) return { state };
  return record(state, action, at, false);
}

/** Skill of the bot deciding for a seat: its own bot or stand-in, or its controller's bot for dummy. */
function botSkill(state: TableState, seat: Seat): SkillLevel | undefined {
  const s = state.seats[deciderOf(state, seat)];
  if (s.kind === "bot") return s.skill;
  return s.kind === "human" ? s.standIn : undefined;
}

export function botToAct(state: TableState): Seat | undefined {
  const game = state.game;
  if (!game || (game.phase !== "auction" && game.phase !== "play") || state.pendingClaim) return undefined;
  return botSkill(state, game.currentActor) === undefined ? undefined : game.currentActor;
}

export async function chooseBotAction(state: TableState): Promise<GameAction | undefined> {
  const seat = botToAct(state);
  const game = state.game;
  if (seat === undefined || !game) return undefined;
  const skill = botSkill(state, seat)!;
  const bot = createBot({ skill, biddingStyle: state.style });
  if (game.phase === "auction") return { type: "bid", seat, bid: await bot.chooseBid(game.hands[seat], game.auction, seat) };
  return { type: "play", seat, card: await bot.chooseCard(playContextFor(game, seat)) };
}

/** When the next bot decision is due, or undefined when no bot is to act. */
export function botWake(state: TableState): number | undefined {
  return botToAct(state) === undefined ? undefined : state.turnSince + BOT_PAUSE_MS + (state.trickJustCompleted ? TRICK_PAUSE_MS : 0);
}
