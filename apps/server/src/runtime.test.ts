import { SELF } from "cloudflare:test";
import { applyAction, createDeck, createGameState, deal, playContextFor, shuffle } from "@contractplay/core";
import type { GameState, Seat } from "@contractplay/core";
import { createBot } from "@contractplay/bots";
import { describe, expect, it } from "vitest";

function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("worker", () => {
  it("health", async () => {
    const response = await SELF.fetch("https://x/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, protocol: 1 });
  });

  it("bots run in the Worker runtime", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const seats: Seat[] = ["north", "east", "south", "west"];
    const times: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      let state: GameState = createGameState({
        deal: deal(shuffle(createDeck(), seededRandom(seed))),
        dealer: seats[seed % 4]!,
        vulnerability: "None"
      });
      while (state.phase !== "complete" && state.phase !== "passed-out") {
        const seat = state.currentActor;
        const start = performance.now();
        const action = state.phase === "auction"
          ? { type: "bid" as const, seat, bid: await bot.chooseBid(state.hands[seat], state.auction, seat) }
          : { type: "play" as const, seat, card: await bot.chooseCard(playContextFor(state, seat)) };
        times.push(performance.now() - start);
        const result = applyAction(state, action);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
      }
    }
    const max = Math.max(...times);
    const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
    console.log(`bot decisions: n=${times.length} max=${max.toFixed(3)}ms mean=${mean.toFixed(3)}ms`);
    expect(max).toBeLessThan(50);
  });
});
