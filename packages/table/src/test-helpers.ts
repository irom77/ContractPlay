import { createBot } from "@contractplay/bots";
import { SEATS, applyAction, playContextFor } from "@contractplay/core";
import type { GameAction, Seat } from "@contractplay/core";
import type { ClientMessage, TableScoring } from "@contractplay/protocol";
import { chooseBotAction, deciderOf } from "./hand.js";
import { reduce } from "./reduce.js";
import { createTable, type Outcome, type PlayerId, type TableState } from "./state.js";

export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newTable = (scoring: TableScoring = "rubber"): TableState => createTable({ id: "t", name: "Table", style: "SAYC", scoring, listed: true, at: 0 });

export function send(state: TableState, player: PlayerId, message: Exclude<ClientMessage, { type: "hello" }>, at = 1, random: () => number = seededRandom(1)): Outcome {
  return reduce(state, { type: "message", player, message, at }, random);
}

/** Like `send` but fails the test when the event is refused. */
export function sendOk(state: TableState, player: PlayerId, message: Exclude<ClientMessage, { type: "hello" }>, at = 1, random: () => number = seededRandom(1)): TableState {
  const out = send(state, player, message, at, random);
  if (out.refused) throw new Error(`unexpectedly refused: ${out.refused}`);
  return out.state;
}

/** A table with `alice` at north and bots in the other seats, ready to deal. */
export function tableWithBots(scoring: TableScoring = "rubber"): TableState {
  let state = sendOk(newTable(scoring), "alice", { type: "sit", seat: "north" }, 1);
  for (const seat of SEATS.slice(1)) state = sendOk(state, "alice", { type: "setBot", seat, skill: "advanced" });
  return state;
}

/** Plays the hand to its end (or until `until` holds): bots through `bot` events, human seats by asking a bot and sending `act`. Calls `onStep` after each accepted action. */
export async function playOut(start: TableState, onStep?: (state: TableState, action: GameAction) => void, until?: (state: TableState) => boolean): Promise<TableState> {
  let state = start;
  let at = 10;
  while (state.game && state.game.phase !== "complete" && state.game.phase !== "passed-out" && !until?.(state)) {
    const game = state.game;
    at += 1;
    const botAction = await chooseBotAction(state);
    let out: Outcome;
    let action: GameAction;
    if (botAction) {
      action = botAction;
      out = reduce(state, { type: "bot", revision: state.revision, action, at }, seededRandom(1));
    } else {
      const seat: Seat = game.currentActor;
      const bot = createBot({ skill: "advanced", biddingStyle: state.style });
      const sender = state.seats[seat];
      const owner = game.phase === "play" ? state.seats[deciderOf(state, seat)] : sender;
      if (owner.kind !== "human") throw new Error("no controller");
      action = game.phase === "auction"
        ? { type: "bid", seat, bid: await bot.chooseBid(game.hands[seat], game.auction, seat) }
        : { type: "play", seat, card: await bot.chooseCard(playContextFor(game, seat)) };
      out = reduce(state, { type: "message", player: owner.player, message: { type: "act", handNumber: state.handNumber, revision: state.revision, action }, at }, seededRandom(1));
    }
    if (out.refused || out.state === state) throw new Error(`stuck: ${out.refused ?? "ignored"} ${JSON.stringify(action)}`);
    state = out.state;
    onStep?.(state, action);
  }
  return state;
}

/** Four humans (p0..p3) seated north, east, south, west. */
export function fourHumans(scoring: TableScoring = "rubber"): TableState {
  let t = newTable(scoring);
  SEATS.forEach((seat, i) => { t = sendOk(t, `p${i}`, { type: "sit", seat }, i); });
  return t;
}

/**
 * A table in the play of 1NT by South (seed 1 deal, North deals): each seat a human (player id = seat name) or a
 * bot. Humans sit in the order south, north, east, west, so the first of them is host. With `lead`, West has made
 * the opening lead and dummy is to play.
 */
export function tableInPlay(kinds: Record<Seat, "human" | "bot">, lead = true, seed = 1): TableState {
  const order = (["south", "north", "east", "west"] as const).filter((seat) => kinds[seat] === "human");
  const first = order[0]!;
  let t = newTable();
  for (const seat of order) t = sendOk(t, seat, { type: "sit", seat }, 1);
  for (const seat of SEATS) if (kinds[seat] === "bot") t = sendOk(t, first, { type: "setBot", seat, skill: "advanced" });
  t = sendOk(t, first, { type: "deal" }, 1, seededRandom(seed));
  let game = t.game!;
  const bids: GameAction[] = [
    { type: "bid", seat: "north", bid: "pass" }, { type: "bid", seat: "east", bid: "pass" },
    { type: "bid", seat: "south", bid: "1notrump" }, { type: "bid", seat: "west", bid: "pass" },
    { type: "bid", seat: "north", bid: "pass" }, { type: "bid", seat: "east", bid: "pass" }
  ];
  if (lead) bids.push({ type: "play", seat: "west", card: game.hands.west[0]! });
  for (const action of bids) {
    const result = applyAction(game, action);
    if (!result.ok) throw new Error(result.error.message);
    game = result.state;
  }
  return { ...t, game, revision: t.revision + 1 };
}
