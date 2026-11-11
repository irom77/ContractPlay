import { applyAction, createDeck, createGameState, deal as dealCards, playContextFor, SEATS, shuffle } from "@contractplay/core";
import type { GameAction, GameState, Seat, SkillLevel } from "@contractplay/core";
import { createBot } from "@contractplay/bots";
import {
  BOT_PAUSE_MS, TRICK_PAUSE_MS, accept, betweenHands, refuse, seatOf,
  type Outcome, type PlayerId, type TableState
} from "./state.js";

const VULNERABILITY = ["None", "NS", "EW", "Both", "NS", "EW", "Both", "None", "EW", "Both", "None", "NS", "Both", "None", "NS", "EW"] as const;

const dummyOf = (game: GameState): Seat | undefined =>
  game.contract ? SEATS[(SEATS.indexOf(game.contract.declarer) + 2) % 4] : undefined;

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
  const game = createGameState({
    deal: dealCards(shuffle(createDeck(), random)),
    dealer: SEATS[(handNumber - 1) % 4]!,
    vulnerability: VULNERABILITY[(handNumber - 1) % 16]!
  });
  return accept(state, { handNumber, game, turnSince: at, lastHumanAt: at, trickJustCompleted: false });
}

/** Seat that a human player may act for: their own, or dummy when they are the human declarer. */
function controls(state: TableState, player: PlayerId, seat: Seat): boolean {
  const game = state.game;
  const actingSeat = game?.phase === "play" && seat === dummyOf(game) ? game.contract!.declarer : seat;
  const s = state.seats[actingSeat];
  return s.kind === "human" && s.player === player && s.standIn === undefined && actingSeat === seatOf(state, player);
}

/** Records an action that already passed the controller check; refuses when the rules do. */
function record(state: TableState, action: GameAction, at: number, byHuman: boolean): Outcome {
  if (!state.game) return refuse(state, "illegal");
  const result = applyAction(state.game, action);
  if (!result.ok) return refuse(state, result.error.code === "wrong-actor" ? "not-your-turn" : "illegal");
  const game = result.state;
  const trickJustCompleted = action.type === "play" && game.phase === "play" && game.currentTrick.length === 0;
  let totals = state.totals;
  if (game.phase === "complete" && game.score && game.contract) {
    // score is signed from North-South's side: the side that scored plus is credited
    const { score } = game.score;
    totals = score >= 0 ? { ...totals, ns: totals.ns + score } : { ...totals, ew: totals.ew - score };
  }
  return accept(state, { game, totals, turnSince: at, trickJustCompleted, ...(byHuman ? { lastHumanAt: at } : {}) });
}

export function act(state: TableState, player: PlayerId, message: { handNumber: number; revision: number; action: GameAction }, at: number): Outcome {
  if (!seatOf(state, player)) return refuse(state, "not-seated");
  if (message.handNumber !== state.handNumber || message.revision !== state.revision) return refuse(state, "stale");
  if (!controls(state, player, message.action.seat)) return refuse(state, "not-your-turn");
  return record(state, message.action, at, true);
}

export function applyBotEvent(state: TableState, revision: number, action: GameAction, at: number): Outcome {
  if (revision !== state.revision || botToAct(state) !== action.seat) return { state };
  return record(state, action, at, false);
}

/** Skill of the bot that decides for a seat: the seat's own bot or stand-in, or declarer's when the seat is dummy. */
function botSkill(state: TableState, seat: Seat): SkillLevel | undefined {
  const game = state.game;
  const owner = game?.phase === "play" && seat === dummyOf(game) ? game.contract!.declarer : seat;
  const s = state.seats[owner];
  if (s.kind === "bot") return s.skill;
  return s.kind === "human" ? s.standIn : undefined;
}

export function botToAct(state: TableState): Seat | undefined {
  const game = state.game;
  if (!game || (game.phase !== "auction" && game.phase !== "play")) return undefined;
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

export function nextWake(state: TableState): number | undefined {
  return botToAct(state) === undefined ? undefined : state.turnSince + BOT_PAUSE_MS + (state.trickJustCompleted ? TRICK_PAUSE_MS : 0);
}
