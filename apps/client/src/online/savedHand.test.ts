import { applyAction, createDeck, createGameState, deal, playContextFor, shuffle, type GameState } from "@contractplay/core";
import { createBot } from "@contractplay/bots";
import { createTable, viewFor, type TableState } from "@contractplay/table";
import { describe, expect, it } from "vitest";
import { savedHandFrom } from "./savedHand.js";

function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plays a seeded deal to the end in core, with a bot choosing every call and card. */
async function playedHand(seed: number): Promise<GameState> {
  let game = createGameState({ deal: deal(shuffle(createDeck(), seededRandom(seed))), dealer: "east", vulnerability: "NS" });
  const bot = createBot({ skill: "advanced", biddingStyle: "SAYC" });
  while (game.phase === "auction" || game.phase === "play") {
    const seat = game.currentActor;
    const result = applyAction(game, game.phase === "auction"
      ? { type: "bid", seat, bid: await bot.chooseBid(game.hands[seat], game.auction, seat) }
      : { type: "play", seat, card: await bot.chooseCard(playContextFor(game, seat)) });
    if (!result.ok) throw new Error(result.error.message);
    game = result.state;
  }
  return game;
}

/** A finished table with alice seated at north, as the service holds it after the hand. */
function finishedTable(game: GameState): TableState {
  return {
    ...createTable({ id: "T", name: "Table", style: "SAYC", listed: false, at: 0 }),
    seats: { north: { kind: "human", player: "alice", name: "Alice", since: 0 }, east: { kind: "bot", skill: "advanced" }, south: { kind: "bot", skill: "advanced" }, west: { kind: "bot", skill: "advanced" } },
    game, handNumber: 2, revision: 90
  };
}

describe("savedHandFrom", () => {
  it("rebuilds the full hand from the seated view at the end of the hand", async () => {
    const original = await playedHand(7);
    expect(original.phase).toBe("complete");
    const view = viewFor(finishedTable(original), "alice");
    expect(view.revealed).toBeDefined();

    const saved = savedHandFrom(view, "online-T-2", "2026-11-11T10:00:00.000Z");
    expect(saved?.id).toBe("online-T-2");
    expect(saved?.savedAt).toBe("2026-11-11T10:00:00.000Z");
    expect(saved?.game.phase).toBe("complete");
    expect(saved?.game.auction).toEqual(original.auction);
    expect(saved?.game.completedTricks).toEqual(original.completedTricks);
    expect(saved?.game.contract).toEqual(original.contract);
    expect(saved?.game.score).toEqual(original.score);
    expect(saved?.game.initialDeal).toEqual(original.initialDeal);
    expect(saved?.game.history.actions).toEqual(original.history.actions);
  });

  it("returns undefined without the revealed deal", async () => {
    const original = await playedHand(7);
    const view = viewFor(finishedTable(original), "alice");
    delete view.revealed;
    expect(savedHandFrom(view, "x", "now")).toBeUndefined();
  });

  it("returns undefined when a step cannot be replayed", async () => {
    const original = await playedHand(7);
    const view = viewFor(finishedTable(original), "alice");
    const [first, ...rest] = view.game!.completedTricks;
    const tampered = { ...view, game: { ...view.game!, completedTricks: [[first![1]!, first![0]!, ...first!.slice(2)], ...rest] } };
    expect(savedHandFrom(tampered, "x", "now")).toBeUndefined();
  });

  it("returns undefined when the revealed deal is malformed", async () => {
    const original = await playedHand(7);
    const view = viewFor(finishedTable(original), "alice");
    const malformed = { ...view, revealed: { ...view.revealed!, north: view.revealed!.north.slice(1) } };
    expect(savedHandFrom(malformed, "x", "now")).toBeUndefined();
  });
});
