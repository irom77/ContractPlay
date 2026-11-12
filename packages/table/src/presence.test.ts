import type { GameAction, Seat } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { botToAct, chooseBotAction } from "./hand.js";
import { nextWake } from "./presence.js";
import { reduce } from "./reduce.js";
import { EMPTY_TABLE_MS, HOST_AWAY_MS, IDLE_MS, UNVISITED_TABLE_MS, type TableEvent, type TableState } from "./state.js";
import { fourHumans, newTable, playOut, seededRandom, send, sendOk, tableWithBots } from "./test-helpers.js";
import { viewFor } from "./view.js";

const random = seededRandom(1);
const apply = (state: TableState, event: TableEvent) => reduce(state, event, random);
const connect = (state: TableState, player: string, at = 1, name = player.toUpperCase()) =>
  apply(state, { type: "connect", player, name, at }).state;
const disconnect = (state: TableState, player: string, at = 1) => apply(state, { type: "disconnect", player, at }).state;
const act = (state: TableState, action: GameAction) =>
  ({ type: "act" as const, handNumber: state.handNumber, revision: state.revision, action });
const pass = (seat: Seat): GameAction => ({ type: "bid", seat, bid: "pass" });

/** Four connected humans p0..p3 at north, east, south, west. */
function connectedFour(): TableState {
  let t = fourHumans();
  for (const p of ["p0", "p1", "p2", "p3"]) t = connect(t, p);
  return t;
}

/** Deals with p0 north; north bids 1 spade, everyone else passes, so p0 (north) declares and p2 (south) is dummy. */
function northDeclares(start: TableState): TableState {
  let t = sendOk(start, "p0", { type: "deal" }, 1, seededRandom(5));
  t = sendOk(t, "p0", act(t, { type: "bid", seat: "north", bid: "1spades" }));
  for (const [p, seat] of [["p1", "east"], ["p2", "south"], ["p3", "west"]] as const) t = sendOk(t, p, act(t, pass(seat)));
  expect(t.game!.contract!.declarer).toBe("north");
  return t;
}

describe("connections", () => {
  it("keeps a seat present while any connection remains (two tabs, one closed)", () => {
    let t = connect(connect(sendOk(newTable(), "alice", { type: "sit", seat: "north" }), "alice", 5), "alice", 6);
    expect(t.connections.alice).toBe(2);
    t = disconnect(t, "alice", 7);
    expect(t.connections.alice).toBe(1);
    expect(t.awaySince.alice).toBeUndefined();
    t = disconnect(t, "alice", 8);
    expect(t.awaySince.alice).toBe(8);
    expect(t.lastHumanAt).toBe(8);
  });

  it("records the name, renames the seat, clears away, and sets lastHumanAt on connect", () => {
    let t = connect(newTable(), "alice", 3, "Alice");
    expect(t.names.alice).toBe("Alice");
    expect(t.lastHumanAt).toBe(3);
    t = sendOk(t, "alice", { type: "sit", seat: "north" });
    expect(t.seats.north).toMatchObject({ name: "Alice" });
    t = disconnect(t, "alice", 4);
    expect(t.awaySince.alice).toBe(4);
    t = connect(t, "alice", 9, "Ally");
    expect(t.seats.north).toMatchObject({ name: "Ally" });
    expect(t.awaySince.alice).toBeUndefined();
    expect(t.lastHumanAt).toBe(9);
  });

  it("does not mark an unseated visitor away and ignores a disconnect with no connection", () => {
    const t = disconnect(connect(newTable(), "zed"), "zed", 5);
    expect(t.awaySince).toEqual({});
    expect(t.connections).toEqual({});
    expect(apply(t, { type: "disconnect", player: "zed", at: 6 }).state).toBe(t);
  });

  it("forgets an unseated player's name on their last disconnect and keeps a seated player's", () => {
    let t = connect(connect(newTable(), "zed", 1, "Zed"), "zed", 2, "Zed");
    t = connect(t, "alice", 3, "Alice");
    t = sendOk(t, "alice", { type: "sit", seat: "north" });
    t = disconnect(t, "zed", 4);
    expect(t.names.zed).toBe("Zed");
    t = disconnect(disconnect(t, "zed", 5), "alice", 6);
    expect(t.names).toEqual({ alice: "Alice" });
  });
});

describe("stand-ins", () => {
  it("lets another seated human hand an away seat to a bot, which then acts for it", () => {
    let t = sendOk(connectedFour(), "p0", { type: "deal" }, 1, seededRandom(2));
    expect(t.game!.currentActor).toBe("north");
    t = disconnect(t, "p0", 50);
    const out = send(t, "p1", { type: "handToBot", seat: "north" }, 60);
    expect(out.refused).toBeUndefined();
    expect(out.state.seats.north).toMatchObject({ kind: "human", player: "p0", standIn: "intermediate" });
    expect(out.state.revision).toBe(t.revision + 1);
    expect(botToAct(out.state)).toBe("north");
  });

  it("refuses handToBot on a present player by a non-host", () => {
    const t = sendOk(connectedFour(), "p0", { type: "deal" }, 1, seededRandom(2));
    const out = send(t, "p1", { type: "handToBot", seat: "north" }, 999_999);
    expect(out.refused).toBe("not-allowed");
    expect(out.state).toBe(t);
  });

  it("lets the host hand an idle player on turn to a bot only after IDLE_MS", () => {
    // p1 (east) deals hand 2 so east is dealer and on turn; p0 (north) is host
    let t = connectedFour();
    t = sendOk(t, "p0", { type: "deal" }, 100, seededRandom(2));
    for (let k = 0; k < 4; k++) t = sendOk(t, `p${k}`, act(t, pass(t.game!.currentActor)), 100);
    t = sendOk(t, "p1", { type: "deal" }, 1000, seededRandom(3));
    expect(t.game!.currentActor).toBe("east");
    expect(t.host).toBe("p0");
    expect(send(t, "p0", { type: "handToBot", seat: "east" }, 1000 + IDLE_MS - 1).refused).toBe("not-allowed");
    expect(send(t, "p2", { type: "handToBot", seat: "east" }, 1000 + IDLE_MS).refused).toBe("not-allowed");
    expect(send(t, "p0", { type: "handToBot", seat: "south" }, 1000 + IDLE_MS).refused).toBe("not-allowed");
    const ok = send(t, "p0", { type: "handToBot", seat: "east" }, 1000 + IDLE_MS);
    expect(ok.refused).toBeUndefined();
    expect(ok.state.seats.east).toMatchObject({ standIn: "intermediate" });
    expect(send(ok.state, "p0", { type: "handToBot", seat: "east" }, 1000 + IDLE_MS).refused).toBe("not-allowed");
  });

  it("refuses handToBot from an unseated player and on a bot seat", () => {
    const t = sendOk(tableWithBots(), "alice", { type: "deal" }, 1, seededRandom(1));
    expect(send(t, "zed", { type: "handToBot", seat: "north" }).refused).toBe("not-seated");
    expect(send(t, "alice", { type: "handToBot", seat: "east" }).refused).toBe("not-allowed");
  });

  it("a stand-in for a human declarer also plays a bot dummy", async () => {
    let t = sendOk(newTable(), "p0", { type: "sit", seat: "north" });
    t = sendOk(t, "p1", { type: "sit", seat: "east" });
    t = sendOk(t, "p0", { type: "setBot", seat: "south", skill: "advanced" });
    t = sendOk(t, "p0", { type: "setBot", seat: "west", skill: "advanced" });
    for (const p of ["p0", "p1"]) t = connect(t, p);
    t = sendOk(t, "p0", { type: "deal" }, 1, seededRandom(5));
    t = sendOk(t, "p0", act(t, { type: "bid", seat: "north", bid: "1spades" }));
    t = sendOk(t, "p1", act(t, pass("east")));
    t = apply(t, { type: "bot", revision: t.revision, action: pass("south"), at: 2 }).state;
    t = apply(t, { type: "bot", revision: t.revision, action: pass("west"), at: 2 }).state;
    expect(t.game!.contract!.declarer).toBe("north");
    t = sendOk(t, "p1", act(t, { type: "play", seat: "east", card: t.game!.hands.east[0]! }));
    expect(t.game!.currentActor).toBe("south");
    // the human declarer plays the bot dummy until a stand-in takes over
    expect(botToAct(t)).toBeUndefined();
    t = disconnect(t, "p0", 5);
    t = sendOk(t, "p1", { type: "handToBot", seat: "north" }, 6);
    expect(botToAct(t)).toBe("south");
    const action = await chooseBotAction(t);
    expect(action?.seat).toBe("south");
    t = apply(t, { type: "bot", revision: t.revision, action: action!, at: 7 }).state;
    expect(t.game!.currentTrick).toHaveLength(2);
  });

  it("a stand-in for a human declarer also plays a human dummy, who still cannot play", async () => {
    let t = northDeclares(connectedFour());
    t = sendOk(t, "p1", act(t, { type: "play", seat: "east", card: t.game!.hands.east[0]! }));
    expect(t.game!.currentActor).toBe("south");
    expect(botToAct(t)).toBeUndefined();
    t = disconnect(t, "p0", 5);
    t = sendOk(t, "p3", { type: "handToBot", seat: "north" }, 6);
    expect(botToAct(t)).toBe("south");
    const card = t.game!.hands.south[0]!;
    expect(send(t, "p2", act(t, { type: "play", seat: "south", card })).refused).toBe("not-your-turn");
    const action = await chooseBotAction(t);
    expect(action?.seat).toBe("south");
    t = apply(t, { type: "bot", revision: t.revision, action: action!, at: 7 }).state;
    expect(t.game!.currentTrick).toHaveLength(2);
  });

  it("reconnecting removes the stand-in and the player's next act is accepted", () => {
    let t = sendOk(connectedFour(), "p0", { type: "deal" }, 1, seededRandom(2));
    t = disconnect(t, "p0", 5);
    t = sendOk(t, "p1", { type: "handToBot", seat: "north" }, 6);
    expect(send(t, "p0", act(t, pass("north"))).refused).toBe("not-your-turn");
    t = connect(t, "p0", 7);
    expect(t.seats.north).not.toHaveProperty("standIn");
    expect(botToAct(t)).toBeUndefined();
    expect(send(t, "p0", act(t, pass("north"))).refused).toBeUndefined();
  });

  it("resume removes the sender's own stand-in only", () => {
    let t = sendOk(connectedFour(), "p0", { type: "deal" }, 1, seededRandom(2));
    t = disconnect(t, "p0", 5);
    t = sendOk(t, "p1", { type: "handToBot", seat: "north" }, 6);
    expect(send(t, "p1", { type: "resume" }).refused).toBe("not-allowed");
    expect(send(t, "zed", { type: "resume" }).refused).toBe("not-seated");
    const resumed = sendOk(t, "p0", { type: "resume" });
    expect(resumed.seats.north).not.toHaveProperty("standIn");
    expect(resumed.revision).toBe(t.revision + 1);
  });

  it("auto play hands the sender's cards to a bot during card play only", () => {
    const auction = sendOk(connectedFour(), "p0", { type: "deal" }, 1, seededRandom(5));
    expect(send(auction, "p0", { type: "autoPlay" }).refused).toBe("not-allowed");
    const t = northDeclares(connectedFour());
    expect(send(t, "zed", { type: "autoPlay" }).refused).toBe("not-seated");
    const auto = sendOk(t, "p1", { type: "autoPlay" });
    expect(auto.seats.east).toMatchObject({ kind: "human", standIn: "intermediate", autoPlay: true });
    expect(auto.revision).toBe(t.revision + 1);
    expect(botToAct(auto)).toBe("east");
    expect(send(auto, "p1", act(auto, { type: "play", seat: "east", card: auto.game!.hands.east[0]! })).refused).toBe("not-your-turn");
    expect(send(auto, "p1", { type: "autoPlay" }).refused).toBe("not-allowed");
    expect(viewFor(auto, "p2").seats.east).toMatchObject({ standIn: "intermediate", autoPlay: true });
  });

  it("gives an auto-played seat back when the hand ends, but keeps it through a reconnect", async () => {
    let t = sendOk(northDeclares(connectedFour()), "p1", { type: "autoPlay" });
    t = connect(disconnect(t, "p1", 5), "p1", 6);
    expect(t.seats.east).toMatchObject({ standIn: "intermediate", autoPlay: true });
    const done = await playOut(t);
    expect(done.game!.phase).toBe("complete");
    expect(done.seats.east).toEqual({ kind: "human", player: "p1", name: "P1", since: 1 });
    expect(botToAct(done)).toBeUndefined();
  });

  it("ends auto play when the player takes the seat back or the host cancels the hand", () => {
    const t = sendOk(northDeclares(connectedFour()), "p1", { type: "autoPlay" });
    expect(sendOk(t, "p1", { type: "resume" }).seats.east).not.toHaveProperty("standIn");
    const cancelled = sendOk(t, "p0", { type: "cancelHand" });
    expect(cancelled.seats.east).not.toHaveProperty("standIn");
    expect(cancelled.seats.east).not.toHaveProperty("autoPlay");
  });

  it("lets any seated human free an away seat between hands, dropping its stand-in", () => {
    let t = sendOk(connectedFour(), "p0", { type: "deal" }, 1, seededRandom(2));
    t = disconnect(t, "p2", 5);
    t = sendOk(t, "p1", { type: "handToBot", seat: "south" }, 6);
    expect(send(t, "p3", { type: "clearSeat", seat: "south" }).refused).toBe("hand-in-progress");
    for (let k = 0; k < 4; k++) {
      const seat = t.game!.currentActor;
      t = seat === "south"
        ? apply(t, { type: "bot", revision: t.revision, action: pass("south"), at: 7 }).state
        : sendOk(t, `p${["north", "east", "south", "west"].indexOf(seat)}`, act(t, pass(seat)));
    }
    expect(t.game!.phase).toBe("passed-out");
    const freed = sendOk(t, "p3", { type: "clearSeat", seat: "south" });
    expect(freed.seats.south).toEqual({ kind: "empty" });
    expect(freed.awaySince.p2).toBeUndefined();
  });
});

describe("tick", () => {
  it("passes host to the earliest-seated present human after HOST_AWAY_MS away", () => {
    let t = newTable();
    for (const [p, seat, at] of [["p0", "north", 1], ["p1", "east", 3], ["p2", "south", 2]] as const) {
      t = connect(t, p);
      t = sendOk(t, p, { type: "sit", seat }, at);
    }
    t = disconnect(t, "p2", 100);
    t = disconnect(t, "p0", 100);
    expect(nextWake(t)).toBe(100 + HOST_AWAY_MS);
    expect(apply(t, { type: "tick", at: 100 + HOST_AWAY_MS - 1 }).state).toBe(t);
    const moved = apply(t, { type: "tick", at: 100 + HOST_AWAY_MS }).state;
    expect(moved.host).toBe("p1");
    expect(nextWake(moved)).toBeUndefined();
  });

  it("expires a table with no connections for EMPTY_TABLE_MS", () => {
    let t = connect(sendOk(newTable(), "alice", { type: "sit", seat: "north" }), "alice", 10);
    expect(apply(t, { type: "tick", at: 10 + EMPTY_TABLE_MS }).expired).toBeUndefined();
    t = disconnect(t, "alice", 20);
    expect(nextWake(t)).toBe(20 + EMPTY_TABLE_MS);
    expect(apply(t, { type: "tick", at: 20 + EMPTY_TABLE_MS - 1 }).expired).toBeUndefined();
    expect(apply(t, { type: "tick", at: 20 + EMPTY_TABLE_MS }).expired).toBe(true);
  });

  it("expires a table nobody ever connected to after UNVISITED_TABLE_MS", () => {
    const t = newTable();
    expect(t.unvisited).toBe(true);
    expect(nextWake(t)).toBe(UNVISITED_TABLE_MS);
    expect(apply(t, { type: "tick", at: UNVISITED_TABLE_MS - 1 }).expired).toBeUndefined();
    expect(apply(t, { type: "tick", at: UNVISITED_TABLE_MS }).expired).toBe(true);
  });

  it("gives a visited-then-empty table the full EMPTY_TABLE_MS", () => {
    const t = disconnect(connect(newTable(), "zed", 5), "zed", 6);
    expect(t).not.toHaveProperty("unvisited");
    expect(nextWake(t)).toBe(6 + EMPTY_TABLE_MS);
    expect(apply(t, { type: "tick", at: 6 + UNVISITED_TABLE_MS }).expired).toBeUndefined();
    expect(apply(t, { type: "tick", at: 6 + EMPTY_TABLE_MS - 1 }).expired).toBeUndefined();
    expect(apply(t, { type: "tick", at: 6 + EMPTY_TABLE_MS }).expired).toBe(true);
  });

  it("treats a state stored without the unvisited field as visited", () => {
    const legacy = Object.fromEntries(Object.entries(newTable()).filter(([key]) => key !== "unvisited")) as TableState;
    expect(nextWake(legacy)).toBe(EMPTY_TABLE_MS);
    expect(apply(legacy, { type: "tick", at: UNVISITED_TABLE_MS }).expired).toBeUndefined();
    expect(apply(legacy, { type: "tick", at: EMPTY_TABLE_MS }).expired).toBe(true);
  });

  it("wakes for a bot turn before the expiry", () => {
    let t = sendOk(tableWithBots(), "alice", { type: "deal" }, 100, seededRandom(1));
    t = sendOk(t, "alice", act(t, pass("north")), 500);
    expect(nextWake(t)).toBe(1500);
  });
});
