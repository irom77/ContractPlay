import { validatePlay } from "@contractplay/core";
import type { GameAction, Seat } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { botToAct, botWake, chooseBotAction } from "./hand.js";
import { viewFor } from "./view.js";
import { reduce } from "./reduce.js";
import { fourHumans, newTable, playOut, seededRandom, send, sendOk, tableWithBots } from "./test-helpers.js";
import type { TableState } from "./state.js";

const act = (state: TableState, action: GameAction) =>
  ({ type: "act" as const, handNumber: state.handNumber, revision: state.revision, action });
const pass = (seat: Seat): GameAction => ({ type: "bid", seat, bid: "pass" });


function expectTotals(done: TableState): void {
  const game = done.game!;
  if (game.phase === "passed-out") { expect(done.totals).toEqual({ ns: 0, ew: 0 }); return; }
  expect(game.phase).toBe("complete");
  const score = game.score!.score;
  expect(done.totals).toEqual(score >= 0 ? { ns: score, ew: 0 } : { ns: 0, ew: -score });
}

describe("dealing", () => {
  it("refuses with an empty seat or four bots", () => {
    const t = tableWithBots();
    const empty = sendOk(t, "alice", { type: "clearSeat", seat: "west" });
    expect(send(empty, "alice", { type: "deal" }).refused).toBe("not-ready");
    expect(send(empty, "zed", { type: "deal" }).refused).toBe("not-seated");
    const bots = { ...t, seats: { ...t.seats, north: { kind: "bot", skill: "expert" } } } as TableState;
    expect(viewFor(bots, "alice").canDeal).toBe(false);
  });

  it("rotates dealer and vulnerability", () => {
    let t = fourHumans();
    const random = seededRandom(1);
    const seen: [string, string][] = [];
    for (let i = 0; i < 5; i++) {
      t = sendOk(t, "p0", { type: "deal" }, 1, random);
      expect(t.handNumber).toBe(i + 1);
      seen.push([t.game!.dealer, t.game!.vulnerability]);
      // everyone passes: passed-out
      for (let k = 0; k < 4; k++) t = sendOk(t, `p${(i + k) % 4}`, act(t, pass(t.game!.currentActor)));
      expect(t.game!.phase).toBe("passed-out");
    }
    expect(seen).toEqual([["north", "None"], ["east", "NS"], ["south", "EW"], ["west", "Both"], ["north", "NS"]]);
    expect(t.totals).toEqual({ ns: 0, ew: 0 });
  });

  it("passes out, allows the next deal, and refuses seat changes during a hand", () => {
    let t = fourHumans();
    t = sendOk(t, "p0", { type: "deal" }, 1, seededRandom(2));
    expect(send(t, "p0", { type: "leave" }).refused).toBe("hand-in-progress");
    expect(send(t, "p0", { type: "setBot", seat: "east", skill: "expert" }).refused).toBe("hand-in-progress");
    expect(send(t, "p0", { type: "clearSeat", seat: "east" }).refused).toBe("hand-in-progress");
    expect(send(t, "p0", { type: "deal" }).refused).toBe("not-ready");
    for (let k = 0; k < 4; k++) t = sendOk(t, `p${k}`, act(t, pass(t.game!.currentActor)));
    expect(t.game!.phase).toBe("passed-out");
    expect(viewFor(t, "p1").canDeal).toBe(true);
    t = sendOk(t, "p1", { type: "deal" }, 1, seededRandom(3));
    expect(t.handNumber).toBe(2);
    expect(t.game!.dealer).toBe("east");
  });
});

describe("acting", () => {
  it("checks turn, legality, and staleness", () => {
    const t = sendOk(fourHumans(), "p0", { type: "deal" }, 1, seededRandom(4));
    expect(send(t, "p1", act(t, pass("east"))).refused).toBe("not-your-turn");
    expect(send(t, "p1", act(t, pass("north"))).refused).toBe("not-your-turn");
    expect(send(t, "p0", { ...act(t, pass("north")), revision: 99 }).refused).toBe("stale");
    const opened = sendOk(t, "p0", act(t, { type: "bid", seat: "north", bid: "2hearts" }));
    expect(opened.game!.auction).toHaveLength(1);
    const again = send(opened, "p0", act(t, { type: "bid", seat: "north", bid: "2hearts" }));
    expect(again.refused).toBe("stale");
    expect(again.state.game!.auction).toHaveLength(1);
    const low = send(opened, "p1", act(opened, { type: "bid", seat: "east", bid: "1clubs" }));
    expect(low.refused).toBe("illegal");
    expect(low.state).toBe(opened);
  });

  it("lets a human declarer play dummy but not a human dummy", () => {
    let t = sendOk(fourHumans(), "p0", { type: "deal" }, 1, seededRandom(5));
    t = sendOk(t, "p0", act(t, { type: "bid", seat: "north", bid: "1spades" }));
    for (const [p, seat] of [["p1", "east"], ["p2", "south"], ["p3", "west"]] as const) t = sendOk(t, p, act(t, pass(seat)));
    expect(t.game!.contract!.declarer).toBe("north");
    expect(t.game!.currentActor).toBe("east");
    const lead = t.game!.hands.east[0]!;
    t = sendOk(t, "p1", act(t, { type: "play", seat: "east", card: lead }));
    expect(t.game!.currentActor).toBe("south");
    const card = t.game!.hands.south.find((c) => c.suit === lead.suit) ?? t.game!.hands.south[0]!;
    const play: GameAction = { type: "play", seat: "south", card };
    expect(send(t, "p2", act(t, play)).refused).toBe("not-your-turn");
    expect(send(t, "p1", act(t, play)).refused).toBe("not-your-turn");
    const next = sendOk(t, "p0", act(t, play));
    expect(next.game!.currentTrick).toHaveLength(2);
  });
});

describe("bots", () => {
  it("transfers both declaring-side plays to a human dummy when declarer is a bot", async () => {
    let t = sendOk(newTable(), "alice", { type: "sit", seat: "south" });
    for (const seat of ["north", "east", "west"] as const) t = sendOk(t, "alice", { type: "setBot", seat, skill: "advanced" });
    t = sendOk(t, "alice", { type: "deal" }, 1, seededRandom(7));
    // Model both declaring-side turns after the opening lead.
    const game = {
      ...t.game!, phase: "play" as const,
      contract: { level: 1 as const, strain: "spades" as const, declarer: "north" as const, doubled: 0 as const },
      currentActor: "north" as const,
      currentTrick: [
        { seat: "east" as const, card: t.game!.hands.east[0]! },
        { seat: "south" as const, card: t.game!.hands.south[0]! },
        { seat: "west" as const, card: t.game!.hands.west[0]! }
      ]
    };
    const declarerTurn: TableState = { ...t, game };
    expect(botToAct(declarerTurn)).toBeUndefined();
    const ledSuit = game.currentTrick[0]!.card.suit;
    const declarerCard = game.hands.north.find((card) => validatePlay(game.hands.north, card, ledSuit).legal)!;
    expect(send(declarerTurn, "alice", act(declarerTurn, { type: "play", seat: "north", card: declarerCard })).refused).toBeUndefined();

    const dummyTurn: TableState = { ...t, game: { ...game, currentActor: "south", currentTrick: [game.currentTrick[0]!] } };
    expect(botToAct(dummyTurn)).toBeUndefined();
    const dummyLedSuit = dummyTurn.game!.currentTrick[0]!.card.suit;
    const dummyCard = dummyTurn.game!.hands.south.find((card) => validatePlay(dummyTurn.game!.hands.south, card, dummyLedSuit).legal)!;
    expect(send(dummyTurn, "alice", act(dummyTurn, { type: "play", seat: "south", card: dummyCard })).refused).toBeUndefined();
  });

  it("plays a full hand with one human and three bots and credits the side that scored", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const t = sendOk(tableWithBots(), "alice", { type: "deal" }, 1, seededRandom(seed));
      const done = await playOut(t);
      expectTotals(done);
    }
  });

  it("credits totals correctly for north-south and east-west declarers, made and failed", async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40 && seen.size < 4; seed++) {
      const done = await playOut(sendOk(fourHumans(), "p0", { type: "deal" }, 1, seededRandom(seed)));
      expectTotals(done);
      const game = done.game!;
      if (game.phase !== "complete") continue;
      const ns = ["north", "south"].includes(game.contract!.declarer);
      seen.add(`${ns ? "ns" : "ew"}-${game.score!.undertricks > 0 ? "failed" : "made"}`);
    }
    expect([...seen].sort()).toEqual(["ew-failed", "ew-made", "ns-failed", "ns-made"]);
  });

  it("schedules the next bot decision", async () => {
    let t = tableWithBots();
    t = sendOk(t, "alice", { type: "deal" }, 100, seededRandom(1));
    // dealer north is the human; after alice's bid east (a bot) is to act
    expect(botToAct(t)).toBeUndefined();
    expect(botWake(t)).toBeUndefined();
    t = sendOk(t, "alice", act(t, pass("north")), 500);
    expect(botToAct(t)).toBe("east");
    expect(botWake(t)).toBe(500 + 1000);
    // stale bot events are ignored
    const ignored = reduce(t, { type: "bot", revision: t.revision - 1, action: pass("east"), at: 600 }, seededRandom(1));
    expect(ignored.state).toBe(t);
    expect(reduce(t, { type: "bot", revision: t.revision, action: pass("south"), at: 600 }, seededRandom(1)).state).toBe(t);
    const done = await playOut(t);
    expect(["complete", "passed-out"]).toContain(done.game!.phase);
  });

  it("adds the trick pause right after a completed trick", async () => {
    const t = sendOk(tableWithBots(), "alice", { type: "deal" }, 1, seededRandom(1));
    let sawTrick = false;
    await playOut(t, (s, action) => {
      if (s.trickJustCompleted && botToAct(s)) {
        sawTrick = true;
        expect(botWake(s)).toBe(s.turnSince + 3000);
      } else if (action.type === "play" && botToAct(s) && !s.trickJustCompleted) {
        expect(botWake(s)).toBe(s.turnSince + 1000);
      }
    });
    expect(sawTrick).toBe(true);
  });
});
