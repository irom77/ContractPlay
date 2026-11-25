import { TRAIT_PRESETS } from "@contractplay/core";
import type { Aggression, BotTraits, Hand, Suit } from "@contractplay/core";
import type { CustomBot } from "@contractplay/protocol";
import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./hand.js";
import { createTable, type TableState } from "./state.js";
import { newTable, send, sendOk, tableWithBots } from "./test-helpers.js";
import { summaryOf } from "./view.js";

const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
/** A hand written spades.hearts.diamonds.clubs. */
const hand = (text: string): Hand => text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: suitOrder[index]!, rank }))) as unknown as Hand;

/** Dealt, with any opening pass from the human at north, and the first bot to call holding a light two-suiter that only an aggressive bot opens. */
function firstBotToCall(aggression: Aggression, character?: string, custom?: CustomBot): TableState {
  let t: TableState = { ...tableWithBots(), aggression };
  // A named bot in every bot seat, so whichever calls first is one.
  if (character || custom) for (const seat of ["east", "south", "west"] as const) t = sendOk(t, "alice", { type: "setBot", seat, skill: "beginner", ...(character ? { character } : {}), ...(custom ? { custom } : {}) });
  t = sendOk(t, "alice", { type: "deal" });
  if (t.game!.currentActor === "north") {
    t = sendOk(t, "alice", { type: "act", handNumber: t.handNumber, revision: t.revision, action: { type: "bid", seat: "north", bid: "pass" } });
  }
  const game = t.game!;
  const seat = game.currentActor;
  return { ...t, game: { ...game, hands: { ...game.hands, [seat]: hand("KQJ54.KJ543.32.4") } } };
}

describe("table bot aggressiveness", () => {
  it("is Normal for new tables unless chosen, and for tables stored before it existed", () => {
    expect(createTable({ id: "t", name: "T", style: "SAYC", listed: true, at: 0 }).aggression).toBe("normal");
    expect(summaryOf(createTable({ id: "t", name: "T", style: "SAYC", aggression: "conservative", listed: true, at: 0 })).aggression).toBe("conservative");
    const stored = createTable({ id: "t", name: "T", style: "SAYC", listed: true, at: 0 });
    const legacy = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== "aggression")) as TableState;
    expect(summaryOf(legacy).aggression).toBe("normal");
  });

  it("makes the table's bots call the way it was set", async () => {
    const normal = firstBotToCall("normal");
    const bold = firstBotToCall("aggressive");
    const seat = normal.game!.currentActor;
    expect(seat).not.toBe("north");
    expect(await chooseBotAction(normal)).toEqual({ type: "bid", seat, bid: "pass" });
    expect(await chooseBotAction(bold)).toEqual({ type: "bid", seat, bid: "1spades" });
  });

  it("seats a named bot at its own skill, and it calls by its own aggressiveness rather than the table's", async () => {
    const t = sendOk(tableWithBots(), "alice", { type: "setBot", seat: "east", skill: "beginner", character: "bea" });
    expect(t.seats.east).toEqual({ kind: "bot", skill: "advanced", character: "bea" });
    expect(summaryOf(t).seats.east).toEqual({ kind: "bot", skill: "advanced", character: "bea" });
    // Bold Bea opens the light two-suiter at a Normal table; Careful Cora passes it at an Aggressive one.
    const bea = firstBotToCall("normal", "bea");
    expect(await chooseBotAction(bea)).toEqual({ type: "bid", seat: bea.game!.currentActor, bid: "1spades" });
    const cora = firstBotToCall("aggressive", "cora");
    expect(await chooseBotAction(cora)).toEqual({ type: "bid", seat: cora.game!.currentActor, bid: "pass" });
  });

  it("refuses an unknown character and turns a named bot back into a plain one", () => {
    expect(send(tableWithBots(), "alice", { type: "setBot", seat: "east", skill: "expert", character: "nobody" }).refused).toBe("not-allowed");
    const named = sendOk(tableWithBots(), "alice", { type: "setBot", seat: "east", skill: "beginner", character: "dex" });
    expect(sendOk(named, "alice", { type: "setBot", seat: "east", skill: "intermediate" }).seats.east).toEqual({ kind: "bot", skill: "intermediate" });
  });
});

describe("your own character at the table", () => {
  const custom: CustomBot = { id: "own-abc123", name: "Gentle Gina", skill: "beginner", traits: TRAIT_PRESETS.aggressive };

  it("plays with its own dials, not the table's", async () => {
    const t = firstBotToCall("normal", undefined, custom);
    expect(await chooseBotAction(t)).toEqual({ type: "bid", seat: t.game!.currentActor, bid: "1spades" });
    const oneDial = firstBotToCall("normal", undefined, { ...custom, traits: { ...TRAIT_PRESETS.normal, openings: "bold" } as BotTraits });
    expect(await chooseBotAction(oneDial)).toEqual({ type: "bid", seat: oneDial.game!.currentActor, bid: "1spades" });
  });

  it("keeps playing as seated after its owner leaves", async () => {
    let t: TableState = newTable();
    t = sendOk(t, "alice", { type: "sit", seat: "north" });
    t = sendOk(t, "bob", { type: "sit", seat: "south" });
    for (const seat of ["east", "west"] as const) t = sendOk(t, "alice", { type: "setBot", seat, skill: "advanced", custom });
    t = sendOk(t, "alice", { type: "leave" });
    t = sendOk(t, "bob", { type: "setBot", seat: "north", skill: "advanced" });
    expect(t.seats.east).toMatchObject({ kind: "bot", custom: { id: custom.id, owner: "alice" } });
    t = sendOk(t, "bob", { type: "deal" });
    const game = t.game!;
    const withLightHand = { ...t, game: { ...game, auction: [{ seat: "north" as const, bid: "pass" as const }], currentActor: "east" as const,
      hands: { ...game.hands, east: hand("KQJ54.KJ543.32.4") } } };
    expect(await chooseBotAction(withLightHand)).toEqual({ type: "bid", seat: "east", bid: "1spades" });
  });

  it("keeps legacy bot seats on today's table aggression", async () => {
    const normal = firstBotToCall("normal");
    expect(await chooseBotAction(normal)).toEqual({ type: "bid", seat: normal.game!.currentActor, bid: "pass" });
  });
});
