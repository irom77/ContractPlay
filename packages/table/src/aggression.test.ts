import type { Aggression, Hand, Suit } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./hand.js";
import { createTable, type TableState } from "./state.js";
import { sendOk, tableWithBots } from "./test-helpers.js";
import { summaryOf } from "./view.js";

const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
/** A hand written spades.hearts.diamonds.clubs. */
const hand = (text: string): Hand => text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: suitOrder[index]!, rank }))) as unknown as Hand;

/** Dealt, with any opening pass from the human at north, and the first bot to call holding a light two-suiter that only an aggressive bot opens. */
function firstBotToCall(aggression: Aggression): TableState {
  let t = sendOk({ ...tableWithBots(), aggression }, "alice", { type: "deal" });
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
});
