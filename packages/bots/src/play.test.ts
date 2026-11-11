import type { Card, Hand, PlayContext, Suit } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { createBot } from "./player.js";

const suitNames: Readonly<Record<string, Suit>> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
/** Cards written as "SA SK H2". */
const cards = (text: string): Hand => text.split(" ").filter(Boolean).map((value) => ({ suit: suitNames[value[0]!]!, rank: value[1]! })) as unknown as Hand;
const card = (text: string): Card => cards(text)[0]!;
const play = (skill: "beginner" | "intermediate" | "advanced" | "expert", context: PlayContext) =>
  createBot({ skill, biddingStyle: "SAYC" }).chooseCard(context);
/** The 52 cards except those listed, for positions late in the play. */
const allExcept = (text: string): Card[] => {
  const kept = new Set(cards(text).map((value) => `${value.suit}${value.rank}`));
  return Object.values(suitNames).flatMap((suit) => [..."23456789TJQKA"].map((rank) => ({ suit, rank }) as Card)).filter((value) => !kept.has(`${value.suit}${value.rank}`));
};

describe("advanced card play", () => {
  it("draws trumps as declarer while the defenders still hold some", async () => {
    const context: PlayContext = {
      seat: "south", declarer: "south", trump: "spades", currentTrick: [], played: cards("H4 H5 H6 H7"),
      hand: cards("SA SJ S5 S4 S3 HK HQ"), visibleHand: cards("SQ S7 S6 H2 D3 C2 C3")
    };
    expect(await play("advanced", context)).toEqual(card("SA"));
    expect(await play("intermediate", context)).not.toEqual(card("SA"));
  });

  it("stops leading trumps once the defenders have none", async () => {
    const hand = cards("SA S5 HK D2");
    const dummy = cards("SQ S7 H2 D3");
    const context: PlayContext = {
      seat: "south", declarer: "south", trump: "spades", currentTrick: [], hand, visibleHand: dummy,
      played: allExcept("SA S5 HK D2 SQ S7 H2 D3 HA HQ D4 D5 C2 C3 C4 C5")
    };
    expect((await play("advanced", context)).suit).not.toBe("spades");
  });

  it("ruffs an opponent's winner with its lowest trump and discards on partner's", async () => {
    const hand = cards("S9 S2 D7 D3 C4");
    const opponentWinning: PlayContext = {
      seat: "south", trump: "spades", ledSuit: "hearts", hand,
      currentTrick: [{ seat: "west", card: card("HA") }, { seat: "north", card: card("H3") }, { seat: "east", card: card("H5") }]
    };
    expect(await play("advanced", opponentWinning)).toEqual(card("S2"));
    const partnerWinning: PlayContext = {
      seat: "south", trump: "spades", ledSuit: "hearts", hand,
      currentTrick: [{ seat: "north", card: card("HA") }, { seat: "east", card: card("H5") }]
    };
    expect(await play("advanced", partnerWinning)).toEqual(card("D3"));
  });

  it("plays third hand high where Intermediate plays low", async () => {
    const context: PlayContext = {
      seat: "south", ledSuit: "hearts", hand: cards("HK HJ H2 C4"),
      currentTrick: [{ seat: "north", card: card("H4") }, { seat: "east", card: card("H3") }]
    };
    expect(await play("advanced", context)).toEqual(card("HK"));
    expect(await play("intermediate", context)).toEqual(card("H2"));
  });

  it("plays only as high as needed when dummy is last to play", async () => {
    const context: PlayContext = {
      seat: "south", declarer: "east", ledSuit: "hearts", hand: cards("HA HQ H2 C4"), visibleHand: cards("HJ H5 S2 S3"),
      currentTrick: [{ seat: "north", card: card("H4") }, { seat: "east", card: card("H3") }]
    };
    expect(await play("advanced", context)).toEqual(card("HQ"));
    expect(await play("advanced", { ...context, visibleHand: cards("HK H5 S2 S3") })).toEqual(card("HA"));
  });
});

describe("expert card play", () => {
  it("cashes a card that the play so far has made a winner", async () => {
    const context: PlayContext = {
      seat: "west", declarer: "south", currentTrick: [], hand: cards("HQ H3 C7 C4 D8"), visibleHand: cards("H9 H8 S4 S3 D2"),
      played: cards("HA HK H2 H4 SA SK S2 S5")
    };
    expect(await play("expert", context)).toEqual(card("HQ"));
    expect(await play("advanced", context)).not.toEqual(card("HQ"));
  });

  it("leads a singleton against a suit contract when it holds a few trumps", async () => {
    const context: PlayContext = {
      seat: "west", declarer: "south", trump: "spades", currentTrick: [], played: [],
      hand: cards("S7 S4 H9 DK D8 D6 D4 D2 CQ C9 C7 C5 C3")
    };
    expect(await play("expert", context)).toEqual(card("H9"));
    expect(await play("advanced", context)).not.toEqual(card("H9"));
  });

  it("keeps its winners when it has to discard", async () => {
    const context: PlayContext = {
      seat: "west", declarer: "south", ledSuit: "spades", hand: cards("D2 C9 C8"), visibleHand: cards("S4 H7 C3"),
      currentTrick: [{ seat: "south", card: card("SA") }],
      played: allExcept("D2 C9 C8 S4 H7 C3 SA S6 CA CK H2 H3 H4 H5 H6")
    };
    // Every higher diamond has gone, so the two is a winner; a club that cannot win is thrown instead.
    expect(await play("expert", context)).toEqual(card("C8"));
    expect(await play("advanced", context)).toEqual(card("D2"));
  });
});
