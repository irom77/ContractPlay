import { applyAction, cardId, createDeck, createGameState, deal, SEATS, shuffle, type Hand, type Suit } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { createBot, createRuleBot } from "./player.js";

const hand = (...cards: string[]): Hand => cards.map((value) => {
  const [suit, rank] = value.split(":") as ["spades" | "hearts" | "diamonds" | "clubs", "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A"];
  return { suit, rank };
});

function handWithSuitSupport(suit: Suit, supportLength: number): Hand {
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const cards = ranks.slice(0, supportLength).map((rank) => `${suit}:${rank}`);
  for (const otherSuit of ["clubs", "diamonds", "hearts", "spades"] as const) {
    if (otherSuit === suit) continue;
    for (const rank of ranks) {
      if (cards.length === 13) return hand(...cards);
      cards.push(`${otherSuit}:${rank}`);
    }
  }
  return hand(...cards);
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seededDeal(seed: number) {
  return deal(shuffle(createDeck(), seededRandom(seed)));
}

describe("beginner bot", () => {
  it("uses an artificial fourth-suit forcing bid with 10 HCP even when short in that suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;

    expect(await bot.chooseBid(responder, auction, "south")).toBe("2diamonds");
  });

  it("gives preference rather than force in the fourth suit with fewer than 10 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "hearts:A", "hearts:Q", "hearts:2", "hearts:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;

    expect(await bot.chooseBid(responder, auction, "south")).toBe("2clubs");
  });

  it("responds to fourth-suit forcing by showing three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:2", "clubs:3", "hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:Q", "diamonds:2");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;

    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it("bids 3NT with a stopper and extra values in response to fourth-suit forcing", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("clubs:A", "clubs:K", "clubs:2", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:Q", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;

    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("opens a balanced hand with 15-17 high card points in notrump", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const openingHand = hand("spades:A", "spades:K", "spades:Q", "spades:J", "hearts:A", "hearts:T", "diamonds:Q", "diamonds:9", "diamonds:8", "clubs:9", "clubs:8", "clubs:7", "clubs:6");
    expect(await bot.chooseBid(openingHand, [], "north")).toBe("1notrump");
  });

  it("opens a five-card major instead of a longer four-card major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const openingHand = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(openingHand, [], "north")).toBe("1hearts");
  });

  it("opens a minor when neither major has five cards", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const openingHand = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:2");
    expect(await bot.chooseBid(openingHand, [], "north")).toBe("1diamonds");
  });

  it("prefers diamonds when the minors are tied and no major has five cards", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const openingHand = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:Q", "clubs:2");
    expect(await bot.chooseBid(openingHand, [], "north")).toBe("1diamonds");
  });

  it.each([20, 21])("opens a balanced %i-HCP hand with 2NT", async (expectedHcp) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const handWith20 = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const handWith21 = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:K", "diamonds:J", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(expectedHcp === 20 ? handWith20 : handWith21, [], "north")).toBe("2notrump");
  });

  it("opens a balanced 22-HCP hand with strong 2 clubs", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const strongBalanced = hand("spades:A", "spades:K", "spades:J", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:Q", "diamonds:2", "clubs:J", "clubs:2");
    expect(await bot.chooseBid(strongBalanced, [], "north")).toBe("2clubs");
  });

  it("opens a strong unbalanced hand with 2 clubs", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strongUnbalanced = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "spades:4", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:K", "clubs:Q", "clubs:2");
    expect(await bot.chooseBid(strongUnbalanced, [], "north")).toBe("2clubs");
  });

  it("opens 2 clubs with nine playing tricks below 22 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const nineTrickHand = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "spades:3", "spades:4", "spades:5", "hearts:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(nineTrickHand, [], "north")).toBe("2clubs");
  });

  it("uses a waiting 2 diamonds response to a strong 2 clubs opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2clubs" }], "south")).toBe("2diamonds");
  });

  it("shows a five-card major positively over 2 clubs with 8+ HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2clubs" }], "south")).toBe("2hearts");
  });

  it("shows a balanced positive hand with 2NT over 2 clubs", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2clubs" }], "south")).toBe("2notrump");
  });

  it("uses Stayman after 2 clubs, waiting 2 diamonds, and a balanced 2NT rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3clubs");
  });

  it("raises opener's natural major rebid to game with three-card support after waiting 2 diamonds", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("raises opener's natural minor rebid to game with four-card support after waiting 2 diamonds", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5clubs");
  });

  it("chooses 3NT after opener's natural suit rebid with balanced values and a stopper", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:2", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("keeps the strong 2C auction open with a balanced hand after opener's natural suit rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:2", "hearts:3", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("keeps the strong 2C auction open with a weak waiting hand after opener's natural rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("accepts a heart transfer and places game after a strong 2 clubs balanced rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const afterRebid = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, afterRebid, "south")).toBe("3diamonds");
    const afterTransfer = [...afterRebid, { seat: "south", bid: "3diamonds" as const }, { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3hearts" as const }] as const;
    expect(await bot.chooseBid(responder, afterTransfer, "south")).toBe("4hearts");
  });

  it("denies a major over Stayman and places 3NT after the strong 2 clubs rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const opener = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:Q", "diamonds:2", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const afterStayman = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, afterStayman, "north")).toBe("3diamonds");
    const afterDenial = [...afterStayman, { seat: "north", bid: "3diamonds" as const } ] as const;
    expect(await bot.chooseBid(responder, afterDenial, "south")).toBe("3notrump");
  });

  it("raises a positive major response to game with three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:K", "spades:Q", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4hearts");
  });

  it.each([22, 25])("rebids notrump at the right level after 2 clubs and waiting 2 diamonds with %i HCP", async (expectedHcp) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const handWith22 = hand("spades:A", "spades:K", "spades:J", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:Q", "diamonds:2", "clubs:J", "clubs:2");
    const handWith25 = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:Q", "clubs:2");
    const opener = expectedHcp === 22 ? handWith22 : handWith25;
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expectedHcp === 22 ? "2notrump" : "3notrump");
  });

  it("uses Stayman with a four-card major over partner's 2NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("3clubs");
  });

  it("transfers to a five-card major over partner's 2NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("3diamonds");
  });

  it("transfers to spades and accepts the transfer over a 2NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("3hearts");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3hearts" as const }
    ] as const;
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3spades");
  });

  it("bids 3NT directly over 2NT with a balanced game hand and no major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("3notrump");
  });

  it("shows a four-card major over Stayman after a 2NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [{ seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const }] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("shows responder's spades after 2NT Stayman finds hearts but no heart fit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:2", "spades:3", "hearts:J", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3spades");
  });

  it("raises responder's spades after the 2NT Stayman alternate-major continuation", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3hearts" as const },
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "3spades" as const },
      { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4spades");
  });

  it("denies a four-card major over Stayman after a 2NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:2", "clubs:3", "clubs:4", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "hearts:K", "hearts:J", "hearts:2", "spades:Q", "spades:2");
    const auction = [{ seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const }] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3diamonds");
  });

  it("places 3NT after Stayman denial over a 2NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("accepts a heart transfer and places game with five hearts and game values", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3diamonds" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3hearts" as const },
      { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("accepts either configured convention and passes a weak hand", async () => {
    const weak = deal().north.map(() => ({ suit: "clubs" as const, rank: "2" as const }));
    for (const biddingStyle of ["SAYC", "2/1"] as const) {
      const bot = createBot({ skill: "beginner", biddingStyle });
      expect(bot.config.biddingStyle).toBe(biddingStyle);
      expect(await bot.chooseBid(weak, [], "north")).toBe("pass");
    }
  });

  it("passes with fewer than 8 HCP after partner opens 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const balanced = hand("spades:K", "spades:2", "spades:3", "spades:4", "hearts:Q", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1notrump" }], "south")).toBe("pass");
  });

  it("responds 2NT with 8-9 HCP to partner’s uncontested 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const balanced = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1notrump" }, { seat: "east", bid: "pass" }], "south")).toBe("2notrump");
  });

  it("responds 3NT with 10 or more HCP to partner’s uncontested 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const balanced = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:Q", "hearts:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1notrump" }], "south")).toBe("3notrump");
  });

  it("uses quantitative 4NT with a balanced 16-count and no major fit over 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1notrump" }], "south")).toBe("4notrump");
  });

  it("accepts a quantitative 4NT invitation with a 17-HCP 1NT opener", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("6notrump");
  });

  it("uses quantitative 4NT with a balanced 12-count and no major fit over 2NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("4notrump");
  });

  it("passes when 1NT was opened by an opponent", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strong = hand("spades:A", "spades:K", "spades:Q", "spades:J", "hearts:A", "hearts:K", "hearts:Q", "diamonds:A", "diamonds:K", "diamonds:Q", "clubs:A", "clubs:K", "clubs:Q");
    expect(await bot.chooseBid(strong, [{ seat: "east", bid: "1notrump" }], "south")).toBe("pass");
  });

  it("transfers a long major even on an unbalanced hand after partner opens 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const unbalanced = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:T", "spades:9", "hearts:A", "hearts:K", "hearts:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(unbalanced, [{ seat: "north", bid: "1notrump" }], "south")).toBe("2hearts");
  });

  it("uses Stayman with a four-card major over partner's 1NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1notrump" }], "south")).toBe("2clubs");
  });

  it("transfers to hearts with a five-card major over partner's 1NT opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:2", "hearts:3", "hearts:4", "hearts:5", "hearts:6", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1notrump" }], "south")).toBe("2diamonds");
  });

  it.each(["SAYC", "2/1"] as const)("uses a six-card minor invitation over 1NT in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const clubInvitation = hand("clubs:A", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "hearts:A", "hearts:3", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4");
    const diamondInvitation = hand("diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "hearts:2", "hearts:3", "spades:A", "spades:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(clubInvitation, [{ seat: "north", bid: "1notrump" }], "south")).toBe("3clubs");
    expect(await bot.chooseBid(diamondInvitation, [{ seat: "north", bid: "1notrump" }], "south")).toBe("3diamonds");

    const clubAuction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    const diamondAuction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    const clubAccept = hand("clubs:Q", "clubs:2", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "spades:Q", "spades:J", "spades:2", "spades:3");
    const diamondAccept = hand("diamonds:Q", "diamonds:2", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "clubs:A", "clubs:2", "clubs:3", "spades:Q", "spades:J", "spades:2", "spades:3");
    const clubDecline = hand("clubs:J", "clubs:2", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "spades:A", "spades:K", "spades:2", "spades:3");
    expect(await bot.chooseBid(clubAccept, clubAuction, "north")).toBe("3notrump");
    expect(await bot.chooseBid(diamondAccept, diamondAuction, "north")).toBe("3notrump");
    expect(await bot.chooseBid(clubDecline, clubAuction, "north")).toBe("pass");
  });

  it.each(["SAYC", "2/1"] as const)("uses 2 spades to find a minor-suit partscore in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const clubsHand = hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "diamonds:2", "diamonds:3");
    const diamondsHand = hand("diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "diamonds:7", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "clubs:2", "clubs:3");
    const opening = [{ seat: "north", bid: "1notrump" as const }] as const;
    expect(await bot.chooseBid(clubsHand, opening, "south")).toBe("2spades");
    expect(await bot.chooseBid(diamondsHand, opening, "south")).toBe("2spades");

    const relay = [...opening, { seat: "east", bid: "pass" as const }, { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }] as const;
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(opener, relay, "north")).toBe("3clubs");
    expect(await bot.chooseBid(clubsHand, [...relay, { seat: "north", bid: "3clubs" as const }], "south")).toBe("pass");
    expect(await bot.chooseBid(diamondsHand, [...relay, { seat: "north", bid: "3clubs" as const }], "south")).toBe("3diamonds");
  });

  it("shows a four-card heart suit after Stayman over 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "spades:4", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it("shows a five-card major after Stayman denial over 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:9", "spades:2", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it("raises responder's five-card major after Stayman denial with three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:Q", "hearts:3", "spades:K", "spades:Q", "spades:2", "diamonds:K", "diamonds:J", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it.each([
    ["five spades and four hearts", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3"), "3hearts"],
    ["five hearts and four spades", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:Q", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3"), "3spades"]
  ] as const)("uses Smolen with %s after Stayman denial", async (_shape, responder, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it.each([
    ["spades", hand("hearts:A", "hearts:K", "spades:A", "spades:K", "spades:2", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3")],
    ["hearts", hand("spades:A", "spades:K", "hearts:A", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3")]
  ] as const)("raises the longer Smolen %s suit to game with three-card support", async (major, opener) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: major === "spades" ? "3hearts" as const : "3spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(`4${major}`);
  });

  it("places 3NT when opener lacks three-card support for the longer Smolen major", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "spades:A", "spades:K", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("passes 3NT after opener denies the 5-3 Smolen fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("corrects opener's 3NT to the six-card major after Smolen", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "spades:3", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4spades");
  });

  it("does not use Smolen below game-going strength or in a natural beginner auction", async () => {
    const weakResponder = hand("spades:Q", "spades:J", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const expert = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const beginner = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    expect(await expert.chooseBid(weakResponder, auction, "south")).not.toBe("3hearts");
    expect(await beginner.chooseBid(weakResponder, auction, "south")).toBe("2spades");
  });

  it("does not use Smolen after an opponent intervenes", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("3hearts");
  });

  it("accepts an invitational major raise after Stayman with a maximum and four-card fit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:A", "spades:2", "spades:3", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4hearts");
  });

  it("places game in a six-card major after a transfer and 10+ HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("places 3NT with a five-card major and game values after a transfer", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:Q", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("finds an alternate spade fit after Stayman discovers hearts over 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const responder = hand("spades:Q", "spades:J", "spades:T", "spades:9", "hearts:K", "hearts:Q", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const afterSpadeReveal = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }
    ] as const;
    expect(await bot.chooseBid(opener, afterSpadeReveal, "north")).toBe("3spades");
    const afterRaise = [...afterSpadeReveal, { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3spades" as const } ] as const;
    expect(await bot.chooseBid(responder, afterRaise, "south")).toBe("4spades");
  });

  it("raises partner’s major to the two level with 6-9 HCP and three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const handWithSupport = hand("hearts:A", "hearts:2", "hearts:3", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(handWithSupport, [{ seat: "north", bid: "1hearts" }], "south")).toBe("2hearts");
  });

  it("uses a SAYC strong jump shift with 19+ HCP and a five-card suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strongResponder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(strongResponder, [{ seat: "north", bid: "1clubs" }], "south")).toBe("2hearts");
  });

  it("jumps a two-level new suit response to the three level in SAYC", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strongResponder = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:2", "spades:A", "spades:K", "spades:2", "diamonds:K", "diamonds:2", "hearts:2", "hearts:3", "hearts:4");
    expect(await bot.chooseBid(strongResponder, [{ seat: "north", bid: "1diamonds" }], "south")).toBe("3clubs");
  });

  it("jumps a two-level major response after a spade opening to the three level in SAYC", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strongResponder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(strongResponder, [{ seat: "north", bid: "1spades" }], "south")).toBe("3hearts");
  });

  it("keeps a SAYC 1H-2S strong jump shift separate from a one-level spade response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strongResponder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(strongResponder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("2spades");
  });

  it("uses the one-level spade response below strong SAYC jump-shift strength", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("1spades");
  });

  it("does not jump shift below 19 HCP in SAYC", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:J", "hearts:2", "hearts:3", "spades:A", "spades:K", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1clubs" }], "south")).toBe("1hearts");
  });

  it("keeps the SAYC strong jump shift off after responder has passed", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strongResponder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(strongResponder, auction, "south")).toBe("1hearts");
  });

  it("places a strong major fit in game before showing a side-suit jump shift", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("4hearts");
  });

  it("keeps the direct two-level response at 13 HCP in 2/1", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const strongResponder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(strongResponder, [{ seat: "north", bid: "1clubs" }], "south")).toBe("1hearts");
  });

  it("accepts a SAYC jump shift by raising responder's major fit to game", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:Q", "hearts:2", "spades:A", "spades:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4hearts");
  });

  it("shows a balanced strong hand after a SAYC jump shift", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it("rebids 2NT with a balanced 18-19 HCP hand after a SAYC major and two-level minor response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "spades:A", "spades:Q", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it("also rebids 2NT with a balanced 19-HCP hand after a SAYC major and two-level minor response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "spades:A", "spades:K", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it("places 4M after opener's balanced 2NT rebid when responder has a three-card major fit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("places 3NT after opener's balanced 2NT rebid without a major fit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:Q", "hearts:2", "spades:K", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("jump-raises responder's minor with a maximum SAYC opener and four-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3diamonds");
  });

  it("jump-shifts to a four-card side suit with a maximum SAYC opener", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "spades:2", "spades:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3diamonds");
  });

  it("jump-rebids a six-card opening major with a maximum SAYC opener", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:A", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("raises a natural SAYC 1S-2H response to 3H with three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("rebids a five-card opening major after SAYC 1S-2H without heart support or a side suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2spades");
  });

  it("does not reverse to 2S after SAYC 1H-2D below 16 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:Q", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it("allows a 2S reverse after SAYC 1H-2D with 16+ HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2spades");
  });

  it("shows four-card spade support after SAYC 1H-2D-2S and reaches game", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:9", "spades:7", "spades:6", "spades:5", "hearts:A", "hearts:K", "diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const opener = hand("hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "spades:A", "spades:K", "spades:Q", "spades:2", "diamonds:4", "diamonds:5", "clubs:A", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3spades");
    const afterFit = [...auction, { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterFit, "north")).toBe("4spades");
  });

  it.each([
    [15, "4hearts", hand("spades:A", "spades:J", "spades:2", "spades:3", "spades:4", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3")],
    [16, "4hearts", hand("spades:A", "spades:K", "spades:J", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:J", "hearts:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3")]
  ] as const)("accepts a natural alternate-major invitation after 1S-2D-2H-3H with %i HCP", async (_hcp, expected, opener) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("shows a lower four-card side suit at the three level after SAYC 1S-2H", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:K", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3clubs");
  });

  it.each([11, 12] as const)("shows invitational preference for opener's spades after SAYC 1S-2C-2H with %i HCP", async (hcp) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:2", "hearts:K", "hearts:2", hcp === 12 ? "diamonds:Q" : "diamonds:J", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it("invites with a natural 3C rebid after SAYC 1S-2C-2H", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:2", "hearts:Q", "hearts:2", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3clubs");
  });

  it.each([10, 11] as const)("invites with a three-card heart fit after SAYC opener rebids 2H on %i HCP", async (hcp) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:2", "hearts:Q", "hearts:2", "hearts:3", "diamonds:Q", hcp === 11 ? "diamonds:J" : "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it.each([10, 11, 12] as const)("shows spade preference after SAYC opener rebids 2D on %i HCP", async (hcp) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand(hcp === 10 ? "spades:Q" : "spades:A", "spades:2", "hearts:K", "hearts:2", "hearts:3", hcp === 11 ? "diamonds:J" : "diamonds:Q", "diamonds:3", "diamonds:4", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it.each([
    ["a balanced hand", "2notrump", hand("spades:K", "spades:2", "spades:3", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["a six-card club suit", "3clubs", hand("spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:2", "diamonds:J", "diamonds:2", "clubs:K", "clubs:Q", "clubs:J", "clubs:4", "clubs:3", "clubs:2")],
    ["four-card diamond support", "3diamonds", hand("spades:K", "spades:2", "spades:3", "hearts:J", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4")]
  ] as const)("limits SAYC 1S-2C-2D with %s", async (_shape, expected, responder) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("completes game after opener raises a SAYC 1S-2H response to 3H", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:Q", "hearts:2", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("invites in opener's major after a repeated-major SAYC rebid and accepts the invitation", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:Q", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const opener = hand("spades:A", "spades:J", "spades:T", "spades:9", "spades:8", "spades:7", "hearts:A", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:Q", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3spades");
    const afterInvite = [...auction, { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterInvite, "north")).toBe("4spades");
  });

  it("places game in a minor fit after opener's strong jump raise", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "spades:Q", "spades:2", "hearts:Q", "hearts:2", "hearts:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5diamonds");
  });

  it("keeps a minimum balanced opener's jump-shift rebid in a natural suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3diamonds");
  });

  it("continues a SAYC jump shift to game after opener shows a balanced hand", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("finds game in opener's natural side major after a SAYC jump shift", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:K", "spades:Q", "spades:J", "spades:2", "diamonds:A", "diamonds:2", "clubs:K", "clubs:2");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2spades");
    const afterSideSuit = [...auction, { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterSideSuit, "south")).toBe("4spades");
  });

  it.each(["SAYC", "2/1"] as const)("makes a weak preemptive game raise with five-card support and shortness in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "spades:K", "spades:2", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("4hearts");
  });

  it.each(["SAYC", "2/1"] as const)("keeps a 10-HCP five-card major raise at the three level in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "spades:K", "spades:2", "diamonds:J", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("3hearts");
  });

  it.each([
    ["hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5"), "3hearts"],
    ["spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:2", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5"), "3spades"]
  ] as const)("invites to game after a simple %s raise with 16-18 HCP", async (_major, opener, expected) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const major = expected.slice(1) as "hearts" | "spades";
    const auction = [
      { seat: "north", bid: `1${major}` as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: `2${major}` as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it.each([
    ["SAYC", "hearts", "4hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6")],
    ["2/1", "hearts", "4hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6")],
    ["SAYC", "spades", "4spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6")],
    ["2/1", "spades", "4spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6")]
  ] as const)("places game over a simple raise with 19+ HCP in %s %s", async (biddingStyle, major, expected, opener) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const auction = [
      { seat: "north", bid: `1${major}` as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: `2${major}` as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it.each([
    ["SAYC", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["2/1", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["SAYC", "spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["2/1", "spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5")]
  ] as const)("does not invite after a simple raise with 15 HCP in %s %s", async (biddingStyle, major, opener) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const auction = [
      { seat: "north", bid: `1${major}` as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: `2${major}` as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it.each([
    ["hearts", hand("hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:2", "diamonds:J", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "4hearts"],
    ["spades", hand("spades:K", "spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:J", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "4spades"],
    ["hearts", hand("hearts:Q", "hearts:2", "hearts:3", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "pass"],
    ["spades", hand("spades:Q", "spades:2", "spades:3", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "pass"]
  ] as const)("accepts or passes opener's simple %s raise invitation at the expected HCP boundary", async (major, responder, expected) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: `1${major}` as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: `2${major}` as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: `3${major}` as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it.each([
    ["hearts", 13, "4hearts"], ["hearts", 12, "pass"],
    ["spades", 13, "4spades"], ["spades", 12, "pass"]
  ] as const)("accepts a SAYC %s limit raise with %i HCP only at game values", async (major, hcp, expected) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = major === "hearts"
      ? hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", ...(hcp === 13 ? ["clubs:J"] : ["clubs:6"]), "clubs:2", "clubs:3", "clubs:4")
      : hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", ...(hcp === 13 ? ["clubs:J"] : ["clubs:6"]), "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: `1${major}` as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: `3${major}` as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(opener.reduce((total, card) => total + (({ A: 4, K: 3, Q: 2, J: 1 } as Record<string, number>)[card.rank] ?? 0), 0)).toBe(hcp);
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("makes a limit raise with 10-12 HCP and three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const handWithSupport = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:Q", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "diamonds:Q");
    expect(await bot.chooseBid(handWithSupport, [{ seat: "north", bid: "1spades" }], "south")).toBe("1notrump");
  });

  it("bids game with 13 or more HCP and three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const handWithSupport = hand("hearts:A", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(handWithSupport, [{ seat: "north", bid: "1hearts" }], "south")).toBe("4hearts");
  });

  it("raises an uncontested minor opening with five-card support and 6-9 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const withClubSupport = hand("clubs:A", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "spades:K", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4");
    expect(await bot.chooseBid(withClubSupport, [{ seat: "north", bid: "1clubs" }], "south")).toBe("2clubs");
  });

  it("responds 1NT to a minor opening with a balanced 6-9 HCP hand and no five-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const balanced = hand("spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:J", "clubs:Q", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1clubs" }], "south")).toBe("1notrump");
  });

  it("makes an invitational minor raise with five-card support and 10-12 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const invitational = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "spades:J", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:J", "diamonds:2", "diamonds:3");
    expect(await bot.chooseBid(invitational, [{ seat: "north", bid: "1clubs" }], "south")).toBe("3clubs");
  });

  it("responds 2NT with a balanced 10-12 HCP hand after 1 diamond", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const balanced = hand("diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:K", "clubs:2", "clubs:3", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "spades:4");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1diamonds" }], "south")).toBe("2notrump");
  });

  it("responds 3NT with a balanced 13-15 HCP hand after 1 diamond", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const balanced = hand("diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:2", "clubs:3", "hearts:A", "hearts:2", "hearts:3", "spades:K", "spades:2", "spades:3");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1diamonds" }], "south")).toBe("3notrump");
  });

  it("rebids a six-card opening suit after partner's uncontested one-level response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "spades:A", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it("rebids 1NT rather than pass a forcing one-level response on a balanced hand without a longer suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("1notrump");
  });

  it("shows a four-card higher second suit at the one level", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "spades:A", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("1spades");
  });

  it.each(["SAYC", "2/1"] as const)("rebids a natural lower four-card side suit in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("hearts:A", "hearts:K", "hearts:8", "hearts:4", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:8", "diamonds:4", "spades:Q", "spades:2", "clubs:3", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2diamonds");
  });

  it.each([
    ["SAYC", 7, "pass"], ["SAYC", 8, "3notrump"],
    ["2/1", 7, "pass"], ["2/1", 8, "3notrump"]
  ] as const)("places the notrump game at the 8-HCP acceptance boundary after 1m–1M–2NT in %s (%i HCP)", async (biddingStyle, hcp, expected) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hcp === 7
      ? hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5")
      : hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("does not repeat responder's suit as opener's second suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it("does not make the second-suit rebid after an opponent interferes", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "spades:A", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "2diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it("does not rebid opener's suit after an opponent interferes", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "spades:A", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it("rebids 1NT with a balanced 12-14 HCP hand after a minor opening response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:J", "clubs:2", "clubs:3", "hearts:J", "hearts:2", "hearts:3", "spades:J", "spades:2", "spades:3");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("1notrump");
  });

  it("rebids 1NT with a balanced 12-14 HCP hand after a major opening response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("1notrump");
  });

  it.each(["SAYC", "2/1"] as const)("shows a four-card heart reverse after 1 diamond–1 spade with 16+ HCP in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it.each(["SAYC", "2/1"] as const)("does not show a reverse after 1 diamond–1 spade below 16 HCP in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:2", "spades:3", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).not.toBe("2hearts");
  });

  it("rebids 2NT with a balanced 18-19 HCP hand after a one-level response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it("shows a four-card lower side suit after a major opening and 1NT response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it("shows a four-card higher side suit as a reverse with 16+ HCP after 1H-1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2spades");
  });

  it("does not reverse into a higher side suit below 16 HCP after 1H-1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it("shows a four-card spade fit after opener reverses to 2 spades", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3spades");
  });

  it("continues in notrump without a major fit after opener reverses to 2 spades", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:2", "hearts:2", "hearts:3", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it.each([
    ["SAYC", "1hearts", "2clubs", hand("hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["2/1", "1hearts", "2clubs", hand("hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["SAYC", "1spades", "2diamonds", hand("spades:K", "spades:Q", "spades:J", "hearts:A", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["2/1", "1spades", "2diamonds", hand("spades:K", "spades:Q", "spades:J", "hearts:A", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4", "clubs:5")]
  ] as const)("raises opener's major to game under %s after %s–1NT–%s", async (biddingStyle, opening, rebid, responder) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const auction = [
      { seat: "north", bid: opening }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: rebid }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(opening === "1hearts" ? "4hearts" : "4spades");
  });

  it("keeps the three-card major raise invitational with 11–12 HCP after a minor rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it("does not apply the major game raise after a minor opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "spades:A", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4hearts");
  });

  it("rebids a six-card major after 1NT when no lower side suit is available", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:T", "spades:9", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2spades");
  });

  it.each(["Q", "K", "A"] as const)("makes an invitational jump rebid with a six-card major and %s diamond", async (diamondHonor) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:A", "spades:2", "spades:3", `diamonds:${diamondHonor}`, "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it.each([
    ["SAYC", ["hearts:K", "hearts:2", "spades:K", "spades:2", "spades:3", "spades:4", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4"], ["hearts:K", "hearts:2", "spades:Q", "spades:2", "spades:3", "spades:4", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4"]],
    ["2/1", ["hearts:K", "hearts:2", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:J", "clubs:2", "clubs:3"], ["hearts:K", "hearts:2", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4"]]
  ] as const)("accepts a major jump rebid at the style-specific threshold and declines below it", async (biddingStyle, acceptCards, declineCards) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(hand(...acceptCards), auction, "south")).toBe("4hearts");
    expect(await bot.chooseBid(hand(...declineCards), auction, "south")).toBe("pass");
  });

  it.each(["2/1", "SAYC"] as const)("places game with a six-card opening major and 19+ HCP after 1NT in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4hearts");
  });

  it("passes a non-forcing 1NT response with a balanced minimum and only five cards in the major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:A", "spades:2", "spades:3", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it.each(["2/1", "SAYC"] as const)("invites with a three-card heart fit after 1S-1NT-2H in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it.each(["2/1", "SAYC"] as const)("places game in hearts with 13+ HCP after 1S-1NT-2H in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "spades:K", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "clubs:A", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("invites in notrump without a heart fit after 1S-1NT-2H", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("rebids 2NT with a balanced 18-19 HCP hand after a major opening and 1NT response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it.each(["SAYC", "2/1"] as const)("rebids 3NT with a balanced 20-21 HCP hand after a major opening and 1NT response in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("spades:A", "spades:K", "spades:J", "spades:8", "spades:2", "hearts:A", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("rebids 2NT with a balanced 18-19 HCP hand after a minor opening and 1NT response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "spades:A", "spades:K", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it.each(["SAYC", "2/1"] as const)("rebids a six-card minor with an opening hand after 1m-1NT in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "spades:K", "spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2clubs");
  });

  it.each(["SAYC", "2/1"] as const)("does not repeat a five-card minor after 1m-1NT in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:A", "hearts:2", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it("accepts opener's 2NT rebid with 8 HCP after a minor opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("declines game after opener's 2NT rebid with fewer than 8 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:2", "spades:3", "spades:4", "hearts:Q", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("raises responder's major with four-card support and 12-15 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2hearts");
  });

  it.each(["SAYC", "2/1"] as const)("places game with four-card support and 19+ HCP after a one-level major response in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("clubs:A", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "spades:K", "spades:Q", "spades:3", "spades:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4hearts");
  });

  it("does not raise responder's major with only three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("1notrump");
  });

  it("responds 1NT to a major opening with a balanced 6-9 HCP hand and no support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const balanced = hand("spades:A", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1spades" }], "south")).toBe("1notrump");
  });

  it.each([
    [15, "2diamonds", hand("spades:Q", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:A", "clubs:J", "clubs:2", "clubs:3")],
    [16, "3notrump", hand("spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:A", "clubs:J", "clubs:2", "clubs:3")],
    [17, "3notrump", hand("spades:Q", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:A", "clubs:J", "clubs:2", "clubs:3")],
    [18, "3notrump", hand("spades:K", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:A", "clubs:J", "clubs:2", "clubs:3")]
  ] as const)("uses the SAYC direct 3NT response at %i HCP", async (_hcp, expected, balanced) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1spades" }], "south")).toBe(expected);
  });

  it("keeps a 15-17 HCP balanced hand in a 2/1 game-forcing response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const balanced = hand("spades:Q", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:A", "clubs:Q", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1spades" }], "south")).toBe("2diamonds");
  });

  it("uses an invitational rather than minimum raise with 16 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("makes an invitational jump raise with four-card major support and 16-18 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:2", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:2", "spades:3", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it.each(["SAYC", "2/1"] as const)("accepts opener's invitational major jump raise with 10+ HCP in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("declines opener's invitational major jump raise with fewer than 10 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("keeps a balanced 18-19 HCP hand in the 2NT rebid range despite four-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it("shows four clubs after 1 diamond–1 spade with a five-card diamond suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "hearts:2", "hearts:3", "spades:2", "spades:3");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2clubs");
  });

  it("does not make the opener raise after an opponent interferes", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "2diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it("rebids 1NT rather than pass a forcing response with a 5-3-3-2 minor opener", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:J", "clubs:2", "clubs:3", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("1notrump");
  });

  it("prefers an available one-level new suit over raising a minor", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const withDiamondSupportAndHeartSuit = hand("diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(withDiamondSupportAndHeartSuit, [{ seat: "north", bid: "1diamonds" }], "south")).toBe("1hearts");
  });

  it("does not raise a minor without five-card support or enough points", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const weakSupport = hand("clubs:K", "clubs:2", "clubs:3", "clubs:4", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    const weakPoints = hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "spades:K", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4");
    expect(await bot.chooseBid(weakSupport, [{ seat: "north", bid: "1clubs" }], "south")).toBe("pass");
    expect(await bot.chooseBid(weakPoints, [{ seat: "north", bid: "1clubs" }], "south")).toBe("pass");
  });

  it("responds at the two level in a four-card lower suit with at least 10 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const lowerSuit = hand("clubs:A", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "spades:2", "spades:3");
    expect(await bot.chooseBid(lowerSuit, [{ seat: "north", bid: "1spades" }], "south")).toBe("2clubs");
  });

  it("keeps a one-level new-suit response ahead of a longer two-level suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const twoSuits = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3");
    expect(await bot.chooseBid(twoSuits, [{ seat: "north", bid: "1hearts" }], "south")).toBe("1spades");
  });

  it("requires four cards and 10 HCP for a two-level new-suit response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const threeCardSuit = hand("clubs:A", "clubs:K", "clubs:Q", "spades:2", "spades:3", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4");
    const weak = hand("clubs:K", "clubs:Q", "clubs:2", "clubs:3", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4");
    expect(await bot.chooseBid(threeCardSuit, [{ seat: "north", bid: "1spades" }], "south")).toBe("2hearts");
    expect(await bot.chooseBid(weak, [{ seat: "north", bid: "1spades" }], "south")).toBe("pass");
  });

  it("uses forcing 1NT with 12 HCP rather than making a game-forcing 2/1 response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const twelvePoints = hand("spades:A", "spades:K", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4");
    expect(await bot.chooseBid(twelvePoints, [{ seat: "north", bid: "1spades" }], "south")).toBe("1notrump");
  });

  it("uses a non-forcing two-level response with 10+ HCP as a passed hand", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const passedResponder = hand("spades:2", "spades:3", "hearts:A", "hearts:J", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(passedResponder, auction, "north")).toBe("2clubs");

    const minimumOpener = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "clubs:K", "clubs:2", "clubs:3", "diamonds:Q", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3");
    expect(await bot.chooseBid(minimumOpener, [...auction, { seat: "north", bid: "2clubs" }, { seat: "east", bid: "pass" }], "south")).toBe("pass");

    const passedAuction = [
      ...auction,
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const minimumBalancedOpener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "clubs:K", "clubs:2", "clubs:3", "diamonds:Q", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3");
    expect(await bot.chooseBid(minimumBalancedOpener, passedAuction, "south")).toBe("pass");
  });

  it("continues an uncontested 2/1 sequence to game", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const thirteenPoints = hand("spades:A", "spades:K", "spades:Q", "spades:J", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4");
    const openerAuction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(opener, openerAuction, "north")).toBe("2spades");
    const responderAuction = [
      ...openerAuction,
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(thirteenPoints, responderAuction, "south")).toBe("4spades");
  });

  it("uses 2 spades as a game-forcing response to 1 heart with five spades and 13+ HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("2spades");
  });

  it("keeps the same 13-HCP five-spade hand at a one-level response in SAYC", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("1spades");
  });

  it("raises a 1H-2S game-forcing response with three-card spade support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3spades");
  });

  it("completes the 1H-2S game force in spades after opener raises", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4spades");
  });

  it("places 1H-2S in notrump after opener's balanced 2NT rebid without a major fit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("raises a 1S-2H game-forcing response with three-card heart support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("places game in responder's hearts after opener raises a 1S-2H game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:A", "spades:K", "spades:2", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("rebids 2NT with a balanced 18-19 HCP opener after a direct 2/1 response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it("shows a four-card side major after a direct 2/1 response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2spades");
  });

  it("shows a side major and finds opener's fit after 1S-2C-2D in a 2/1 game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:K", "diamonds:Q", "diamonds:4", "diamonds:5", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2hearts");
    const afterHeart = [...auction, { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterHeart, "north")).toBe("3hearts");
    const afterRaise = [...afterHeart, { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterRaise, "south")).toBe("4hearts");
  });

  it("places 3NT when opener has no fit for responder's side major in a 2/1 game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:10", "hearts:4", "hearts:5", "diamonds:K", "diamonds:Q", "diamonds:4", "diamonds:5", "clubs:A", "clubs:Q");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2hearts");
    const afterHeart = [...auction, { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterHeart, "north")).toBe("3notrump");
  });

  it("shows and places a spade fit after 1H-2C-2D in a 2/1 game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:A", "clubs:K", "clubs:Q", "clubs:2");
    const opener = hand("spades:4", "spades:5", "spades:6", "hearts:A", "hearts:K", "hearts:4", "hearts:5", "hearts:6", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:4", "clubs:10");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
    const afterSpades = [...auction, { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterSpades, "north")).toBe("3spades");
    const afterRaise = [...afterSpades, { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterRaise, "south")).toBe("4spades");
  });

  it.each([
    ["2clubs", "clubs", hand("spades:A", "spades:Q", "spades:2", "spades:3", "spades:4", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:A", "clubs:Q", "clubs:2", "clubs:3"), hand("spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3")],
    ["2diamonds", "diamonds", hand("spades:A", "spades:Q", "spades:2", "spades:3", "spades:4", "hearts:Q", "hearts:2", "diamonds:A", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2"), hand("spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4")]
  ] as const)("shows and raises a four-card %s fit at the three level in a 2/1 game force", async (response, suit, opener, responder) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const auction = [
      { seat: "north" as const, bid: "1spades" as const }, { seat: "east" as const, bid: "pass" as const },
      { seat: "south" as const, bid: response as "2clubs" | "2diamonds" }, { seat: "west" as const, bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(`3${suit}`);
    const afterRaise = [...auction, { seat: "north" as const, bid: `3${suit}` as "3clubs" | "3diamonds" }, { seat: "east" as const, bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterRaise, "south")).toBe(`5${suit}`);
  });

  it("shows a four-card minor fit with an unbalanced 18-19 HCP opener in a 2/1 game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:J", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3diamonds");
  });

  it("shows four diamonds after 1H-2C in a direct 2/1 game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "spades:2", "spades:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2diamonds");
  });

  it("shows a natural club suit at the three level after a direct 2/1 diamond response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:K", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3clubs");
  });

  it.each([
    ["1H-2C-3C", "1hearts", "2clubs", "3clubs", "hearts", hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "clubs:A", "clubs:2", "clubs:3", "clubs:4", "diamonds:K", "diamonds:2", "diamonds:3", "spades:2"), hand("hearts:A", "hearts:J", "hearts:9", "clubs:K", "clubs:Q", "clubs:J", "clubs:8", "diamonds:A", "diamonds:5", "diamonds:6", "diamonds:7", "spades:5", "spades:6")],
    ["1H-2D-3D", "1hearts", "2diamonds", "3diamonds", "hearts", hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:K", "clubs:2", "clubs:3", "spades:2"), hand("hearts:A", "hearts:J", "hearts:9", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "spades:A", "spades:6")],
    ["1S-2C-3C", "1spades", "2clubs", "3clubs", "spades", hand("spades:K", "spades:Q", "spades:2", "spades:3", "spades:4", "clubs:A", "clubs:2", "clubs:3", "clubs:4", "hearts:K", "diamonds:2", "diamonds:3", "diamonds:4"), hand("spades:A", "spades:J", "spades:9", "clubs:K", "clubs:Q", "clubs:J", "clubs:8", "hearts:A", "hearts:6", "diamonds:5", "diamonds:6", "diamonds:7", "diamonds:8")],
    ["1S-2D-3D", "1spades", "2diamonds", "3diamonds", "spades", hand("spades:K", "spades:Q", "spades:2", "spades:3", "spades:4", "diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "hearts:K", "clubs:2", "clubs:3", "clubs:4"), hand("spades:A", "spades:J", "spades:9", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "hearts:A", "clubs:5", "clubs:6", "clubs:7", "clubs:8", "clubs:9")]
  ] as const)("shows the three-card major fit below game after %s with 15+ HCP", async (_label, opening, response, minorRebid, major, opener, responder) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: opening }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: response }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(minorRebid);

    const afterMinorRaise = [...auction, { seat: "north", bid: minorRebid }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterMinorRaise, "south")).toBe(`3${major}`);

    const afterFitShow = [...afterMinorRaise, { seat: "south", bid: `3${major}` }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterFitShow, "north")).toBe(`4${major}`);
  });

  it.each([
    ["13 HCP", hand("hearts:K", "hearts:Q", "hearts:J", "diamonds:A", "diamonds:5", "diamonds:6", "diamonds:7", "clubs:K", "spades:3", "spades:4", "spades:5", "spades:6", "spades:7")],
    ["14 HCP", hand("hearts:A", "hearts:J", "hearts:9", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "spades:K", "spades:6")]
  ] as const)("uses fast arrival to place game with %s after a 2/1 minor raise", async (_label, responder) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("keeps fast arrival after a 2/1 continuation that is not an opener's minor raise", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("limits the slow major-fit raise to an unpassed, uncontested 2/1 response with three-card support", async () => {
    const responder = hand("hearts:A", "hearts:J", "hearts:9", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "spades:A", "spades:6");
    const unpassedAuction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const twoOverOne = createBot({ skill: "beginner", biddingStyle: "2/1" });
    expect(await twoOverOne.chooseBid(responder, unpassedAuction, "south")).toBe("3hearts");

    const sayc = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    expect(await sayc.chooseBid(responder, unpassedAuction, "south")).not.toBe("3hearts");

    const passedAuction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await twoOverOne.chooseBid(responder, passedAuction, "north")).not.toBe("3hearts");

    const interferedAuction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1spades" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await twoOverOne.chooseBid(responder, interferedAuction, "south")).not.toBe("3hearts");

    const withoutFit = hand("hearts:A", "hearts:J", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "spades:A", "spades:6");
    expect(await twoOverOne.chooseBid(withoutFit, unpassedAuction, "south")).not.toBe("3hearts");
  });

  it("places a 2/1 game force in clubs with three-card support for opener's natural 3 clubs", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:A", "clubs:K", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5clubs");
  });

  it("continues the 2/1 force in diamonds after opener shows clubs when responder has six diamonds", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3diamonds");
  });

  it("completes the 2/1 game force in diamonds after opener raises responder's six-card suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:K", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3");
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4diamonds");
    const afterRaise = [...auction, { seat: "north", bid: "4diamonds" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterRaise, "south")).toBe("5diamonds");
  });

  it("shows a four-card side major after opener's natural 3 clubs rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:K", "clubs:2", "clubs:3");
    const opener = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:A", "spades:2", "spades:3", "diamonds:K", "clubs:Q", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3spades");
    expect(await bot.chooseBid(opener, [
      ...auction, { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const }
    ], "north")).toBe("4spades");
  });

  it("places the 2/1 force in notrump after opener shows clubs without a major fit or a long diamond suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("shows a four-card diamond suit after 1S-2C in a direct 2/1 game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2diamonds");
  });

  it("keeps a 1S-2D game force alive after responder rebids diamonds", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "hearts:2", "hearts:3", "clubs:K", "clubs:2");
    const responder = hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "spades:2", "spades:3", "hearts:A", "hearts:2", "clubs:K", "clubs:Q", "clubs:2");
    const openerAuction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, openerAuction, "north")).toBe("4diamonds");
    expect(await bot.chooseBid(responder, [
      ...openerAuction, { seat: "north", bid: "4diamonds" as const }, { seat: "east", bid: "pass" as const }
    ], "south")).toBe("5diamonds");
  });

  it("places a 2/1 game force in 3NT when opener cannot support responder's rebid minor", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3", "hearts:4", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("raises opener's shown diamonds in a 1S-2C game force with four-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "hearts:A", "hearts:2", "hearts:3", "spades:2", "spades:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5diamonds");
  });

  it("raises opener's shown side major to game with four-card support in a 2/1 force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "hearts:2", "hearts:3", "clubs:K", "clubs:Q", "clubs:J", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4spades");
  });

  it("starts a 2/1 game force with a four-card suit even with three-card major support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:2", "hearts:A", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1spades" }], "south")).toBe("2diamonds");
  });

  it.each(["SAYC", "2/1"] as const)("uses Jacoby 2NT with 13+ HCP and four-card support in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("2notrump");
  });

  it("shows a singleton spade after a Jacoby 2NT major raise", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:2", "diamonds:A", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3spades");
  });

  it("shows 15-17 points with 3NT after a Jacoby 2NT raise when opener has no shortness", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:K", "spades:Q", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("places game in opener's major after a Jacoby shortness rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("continues a 2/1 game force in notrump without major support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "hearts:A", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("rebids a six-card 2/1 suit after opener repeats the major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3diamonds");
  });

  it("shows a four-card side major while continuing a 2/1 game force", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "diamonds:A", "diamonds:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it("raises responder's four-card side major to game after a 2/1 rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4hearts");
    const afterGame = [...auction, { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "diamonds:A", "diamonds:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, afterGame, "south")).toBe("pass");
  });

  it("places 3NT after a side-major rebid in a 2/1 force without three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:2", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
    const afterGame = [...auction, { seat: "north", bid: "3notrump" as const }, { seat: "east", bid: "pass" as const }] as const;
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "diamonds:A", "diamonds:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, afterGame, "south")).toBe("pass");
  });

  it("stops at four of a major after opener raises responder's six-card suit to game", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "spades:2", "spades:3", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("reaches game in opener's major after a balanced 2NT rebid with three-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:2", "hearts:A", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4spades");
  });

  it("reaches 3NT after a balanced 2NT rebid without major support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "hearts:Q", "hearts:J", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("places 3NT after a balanced 2NT rebid without a major fit even with a six-card 2/1 minor", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:9", "diamonds:8", "diamonds:7", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("shows a four-card side major after opener's balanced 2NT rebid without a fit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it("shows a side major at the three level after opener repeats the major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it("raises a side-major fit after responder shows it over a repeated major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
    const afterRaise = [...auction, { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    const responder = hand("spades:A", "spades:K", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:Q", "clubs:2");
    expect(await bot.chooseBid(responder, afterRaise, "south")).toBe("4hearts");
  });

  it("places 3NT when opener has no fit for responder's side major after repeating the major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
    const afterNotrump = [...auction, { seat: "north", bid: "3notrump" as const }, { seat: "east", bid: "pass" as const }] as const;
    const responder = hand("spades:A", "spades:K", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:Q", "clubs:2");
    expect(await bot.chooseBid(responder, afterNotrump, "south")).toBe("pass");
  });

  it("shows and raises the reciprocal spade fit after 1H-2C-2H", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:K", "hearts:2", "diamonds:A", "diamonds:Q", "diamonds:2", "clubs:K", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
    const opener = hand("spades:J", "spades:T", "spades:9", "hearts:A", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "diamonds:K", "diamonds:J", "diamonds:T", "clubs:A", "clubs:2");
    const afterResponse = [...auction, { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterResponse, "north")).toBe("3spades");
    const afterRaise = [...afterResponse, { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterRaise, "south")).toBe("4spades");
  });

  it("places game in a side major after opener raises a three-card fit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("chooses 3NT when opener has no fit for responder's side major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:J", "hearts:A", "hearts:J", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("uses a forcing 1NT response with 6-12 HCP in 2/1 when no other response fits", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:J", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:J", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1spades" }], "south")).toBe("1notrump");
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally with 1NT after an opponent's double in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "double" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("1notrump");
  });

  it("redoubles an opponent's double of partner's one-level opening with 10+ HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const strong = hand("spades:A", "spades:K", "spades:2", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "double" as const }] as const;
    expect(await bot.chooseBid(strong, auction, "south")).toBe("redouble");
  });

  it.each(["2/1", "SAYC"] as const)("uses 2NT for a four-card major limit raise after a takeout double in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "double" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it.each(["2/1", "SAYC"] as const)("uses 2NT for a five-card minor limit raise after a takeout double in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "spades:K", "spades:2", "hearts:2", "hearts:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "double" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it.each(["2/1", "SAYC"] as const)("shows a minimum or maximum after a major 2NT limit raise in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const minimum = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:A", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const maximum = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:A", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "double" as const }, { seat: "south", bid: "2notrump" as const }] as const;
    expect(await bot.chooseBid(minimum, auction, "north")).toBe("3spades");
    expect(await bot.chooseBid(maximum, auction, "north")).toBe("4spades");
  });

  it.each(["2/1", "SAYC"] as const)("accepts the major game after opener shows a maximum over a 2NT limit raise in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4spades");
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally with a stopper after a one-level overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("1notrump");
  });

  it.each(["2/1", "SAYC"] as const)("makes a simple major raise after a one-level overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it("raises responder's natural second major with a three-card fit and maximum values", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:8", "hearts:7", "hearts:4", "spades:Q", "spades:J", "spades:2", "clubs:A", "clubs:Q", "clubs:4", "diamonds:3", "diamonds:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3spades");
  });

  it("returns to the opening major when the responder's second major is unsupported", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:8", "hearts:7", "hearts:4", "spades:Q", "spades:2", "clubs:K", "clubs:4", "clubs:2", "diamonds:4", "diamonds:3", "diamonds:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it.each([
    ["SAYC", 9, "4spades"],
    ["2/1", 9, "pass"]
  ] as const)("uses the %s invitation threshold after opener raises the second major (%i HCP)", async (style, _hcp, expected) => {
    const bot = createBot({ skill: "beginner", biddingStyle: style });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:8", "spades:2", "hearts:Q", "hearts:4", "hearts:3", "diamonds:J", "diamonds:4", "diamonds:3", "clubs:4", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("accepts the 2/1 invitation after opener raises the second major with 10 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:8", "spades:2", "hearts:Q", "hearts:4", "hearts:3", "diamonds:J", "diamonds:4", "diamonds:3", "clubs:J", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4spades");
  });

  it.each(["2/1", "SAYC"] as const)("raises a major to the three level with 6-9 HCP after a two-level overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2clubs" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3spades");
  });

  it.each(["2/1", "SAYC"] as const)("cue-bids one- and two-level overcalls to show a strong major raise in %s", async (biddingStyle) => {
    const responder = hand("spades:A", "spades:K", "spades:2", "hearts:Q", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const bot = createBot({ skill: "beginner", biddingStyle });
    const oneLevelAuction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    const twoLevelAuction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2clubs" as const }] as const;
    expect(await bot.chooseBid(responder, oneLevelAuction, "south")).toBe("2hearts");
    expect(await bot.chooseBid(responder, twoLevelAuction, "south")).toBe("3clubs");
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally at the two level with 10+ HCP and five cards after a one-level overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("clubs:A", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "diamonds:K", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2clubs");
  });

  it.each(["2/1", "SAYC"] as const)("does not make a direct two-level new-suit response with only four cards in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("clubs:A", "clubs:K", "clubs:2", "clubs:3", "diamonds:K", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it.each(["2/1", "SAYC"] as const)("raises partner's major with three-card support after a double in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "double" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it.each(["2/1", "SAYC"] as const)("does not respond 1NT without a stopper in the overcalled suit in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "hearts:2", "hearts:3", "hearts:4", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("pass");
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally with 2NT after a two-level overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2clubs" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("2notrump");
  });

  it.each(["2/1", "SAYC"] as const)("does not respond 2NT without a stopper after a two-level overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2clubs" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("pass");
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally with 1NT after a double of a minor opening in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("1notrump");
  });

  it.each(["2/1", "SAYC"] as const)("bids a four-card major naturally after a takeout double when available in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("1hearts");
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally with 1NT and a stopper after a minor opening overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("1notrump");
  });

  it.each(["2/1", "SAYC"] as const)("raises a minor opening after a one-level overcall with five-card support and 6-9 HCP in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("clubs:A", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "spades:K", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2clubs");
  });

  it.each(["2/1", "SAYC"] as const)("cue-bids the overcall to show a strong minor raise in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("diamonds:K", "diamonds:2", "diamonds:3", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2hearts");
  });

  it.each(["2/1", "SAYC"] as const)("makes a negative double with four cards in the other major after a minor opening in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:K", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("double");
  });

  it.each(["2/1", "SAYC"] as const)("makes a negative double with four hearts after a minor opening and 1-spade overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1spades" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("double");
  });

  it.each(["2/1", "SAYC"] as const)("responds in an available five-card major at the one level after a major overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:K", "spades:2", "spades:3", "spades:4", "spades:5", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("1spades");
  });

  it.each(["2/1", "SAYC"] as const)("does not raise a minor opening after an overcall with only four-card support in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("clubs:A", "clubs:2", "clubs:3", "clubs:4", "spades:K", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally with 2NT after a two-level overcall of a minor opening in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const balanced = hand("spades:K", "spades:2", "spades:3", "spades:4", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "2hearts" as const }] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("2notrump");
  });

  it.each(["2/1", "SAYC"] as const)("uses a negative double with four diamonds after 1 spade and a 2 heart overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const responder = hand("spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("double");
  });

  it.each(["2/1", "SAYC"] as const)("uses a negative double with four diamonds after a one-level major overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const responder = hand("diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auctions = [
      [{ seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1spades" as const }],
      [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "1hearts" as const }]
    ] as const;
    for (const auction of auctions) {
      expect(await bot.chooseBid(responder, auction, "south")).toBe("double");
    }
  });

  it.each(["2/1", "SAYC"] as const)("uses negative doubles after a major opening and two-level minor overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const cases = [
      ["1hearts", "2diamonds", ["spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5"]],
      ["1spades", "2clubs", ["hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "diamonds:2", "diamonds:3", "diamonds:4"]]
    ] as const;
    for (const [openingBid, overcall, cards] of cases) {
      const responder = hand(...cards);
      const auction = [
        { seat: "north", bid: openingBid }, { seat: "east", bid: overcall }
      ] as const;
      expect(await bot.chooseBid(responder, auction, "south")).toBe("double");
    }
  });

  it.each(["2/1", "SAYC"] as const)("responds naturally at the one level with four spades after 1 heart and 1 diamond in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:A", "spades:J", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:K", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("1spades");
  });

  it.each(["2/1", "SAYC"] as const)("bids an available four-card suit at the one level after a major opening and one-level overcall in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const cases = [
      ["1hearts", "1clubs", "1spades", ["spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5"]],
      ["1spades", "1diamonds", "1hearts", ["hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6"]],
      ["1spades", "1clubs", "1hearts", ["hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "diamonds:2", "diamonds:3", "diamonds:4"]]
    ] as const;
    for (const [openingBid, overcall, expectedBid, cards] of cases) {
      const responder = hand(...cards);
      const auction = [
        { seat: "north", bid: openingBid }, { seat: "east", bid: overcall }
      ] as const;
      expect(await bot.chooseBid(responder, auction, "south")).toBe(expectedBid);
    }
  });

  it.each(["2/1", "SAYC"] as const)("raises responder's one-spade bid after 1 heart and 1 diamond interference in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:Q", "spades:2", "spades:3", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1diamonds" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2spades");
  });

  it.each(["2/1", "SAYC"] as const)("shows invitational and game-strength spade raises after the same interference in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1diamonds" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    const invitational = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:K", "spades:Q", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3");
    const gameValues = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(invitational, auction, "north")).toBe("3spades");
    expect(await bot.chooseBid(gameValues, auction, "north")).toBe("4spades");
  });

  it.each(["2/1", "SAYC"] as const)("rebids 1NT with a balanced minimum and a diamond stopper after 1H-(1D)-1S in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:J", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1diamonds" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("1notrump");
  });

  it.each(["2/1", "SAYC"] as const)("rebids 2NT with a balanced 18-19 HCP hand after 1H-(1D)-1S in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:Q", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1diamonds" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2notrump");
  });

  it.each(["2/1", "SAYC"] as const)("rebids a six-card heart suit after 1H-(1D)-1S in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1diamonds" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    const minimum = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:Q", "spades:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const invitational = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "spades:K", "spades:Q", "spades:2", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(minimum, auction, "north")).toBe("2hearts");
    expect(await bot.chooseBid(invitational, auction, "north")).toBe("3hearts");
  });

  it.each(["2/1", "SAYC"] as const)("places responder's invitation or game after 1H-(1D)-1S-1NT in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1diamonds" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const balancedInvitation = hand("spades:K", "spades:Q", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const balancedGame = hand("spades:K", "spades:Q", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3");
    const spadeInvitation = hand("spades:K", "spades:Q", "spades:J", "spades:4", "spades:2", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3");
    const spadeGame = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(balancedInvitation, auction, "south")).toBe("2notrump");
    expect(await bot.chooseBid(balancedGame, auction, "south")).toBe("3notrump");
    expect(await bot.chooseBid(spadeInvitation, auction, "south")).toBe("3spades");
    expect(await bot.chooseBid(spadeGame, auction, "south")).toBe("4spades");
  });

  it("makes an artificial three-card minor rebid instead of passing a minimum after 2/1 forcing 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "clubs:K", "clubs:2", "clubs:3", "diamonds:Q", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2clubs");
  });

  it("invites with 2NT after a 2/1 forcing 1NT and natural two-level rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:J", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("shows a three-card limit raise after using forcing 1NT in 2/1", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3spades");
  });

  it("rebids a five-card second major below the direct 2/1 response strength", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2hearts");
  });

  it.each([
    ["SAYC", 9, "2clubs", hand("spades:K", "spades:Q", "spades:J", "spades:8", "spades:2", "hearts:Q", "hearts:4", "hearts:3", "diamonds:J", "diamonds:4", "diamonds:3", "clubs:4", "clubs:2")],
    ["SAYC", 9, "2diamonds", hand("spades:K", "spades:Q", "spades:J", "spades:8", "spades:2", "hearts:Q", "hearts:4", "hearts:3", "diamonds:J", "diamonds:4", "diamonds:3", "clubs:4", "clubs:2")],
    ["2/1", 10, "2clubs", hand("spades:K", "spades:Q", "spades:J", "spades:9", "spades:2", "hearts:4", "hearts:3", "diamonds:A", "diamonds:4", "diamonds:3", "clubs:4", "clubs:3", "clubs:2")],
    ["2/1", 10, "2diamonds", hand("spades:K", "spades:Q", "spades:J", "spades:9", "spades:2", "hearts:4", "hearts:3", "diamonds:A", "diamonds:4", "diamonds:3", "clubs:4", "clubs:3", "clubs:2")]
  ] as const)("rebids five spades naturally after 1 heart–1NT–%s with %i HCP", async (style, _hcp, openerRebid, responder) => {
    const bot = createBot({ skill: "beginner", biddingStyle: style });
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: openerRebid }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it("bids a four-card higher suit with at least 6 HCP after partner opens one club", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const handWithSuit = hand("hearts:A", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(handWithSuit, [{ seat: "north", bid: "1clubs" }], "south")).toBe("1hearts");
  });

  it("chooses the longest new suit and prefers the higher suit on a tie", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const handWithTwoSuits = hand("hearts:A", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(handWithTwoSuits, [{ seat: "north", bid: "1clubs" }], "south")).toBe("1spades");
  });

  it("does not respond at the one level in a lower suit below partner’s opening", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const lowerSuitOnly = hand("diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "hearts:K", "hearts:2", "hearts:3", "spades:2", "spades:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(lowerSuitOnly, [{ seat: "north", bid: "1spades" }], "south")).toBe("1notrump");
  });

  it("uses the balanced 1NT response without a four-card higher suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const shortSuit = hand("hearts:A", "hearts:K", "hearts:Q", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(shortSuit, [{ seat: "north", bid: "1clubs" }], "south")).toBe("1notrump");
  });

  it("passes with fewer than 6 HCP even when a four-card new suit is available", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const weakHand = hand("hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(weakHand, [{ seat: "north", bid: "1clubs" }], "south")).toBe("pass");
  });

  it("bids a new suit without three-card support for partner’s major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const noSupport = hand("spades:A", "spades:K", "spades:Q", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "clubs:A", "clubs:K", "clubs:Q", "clubs:J");
    expect(await bot.chooseBid(noSupport, [{ seat: "north", bid: "1hearts" }], "south")).toBe("2diamonds");
  });

  it("passes if an opponent has bid after partner’s 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const balanced = hand("spades:A", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1notrump" }, { seat: "east", bid: "2clubs" }], "south")).toBe("pass");
  });

  it("invites game with a balanced 10-12 HCP hand after opener rebids 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const balanced = hand("spades:A", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:J", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("2notrump");
  });

  it("invites game in its five-card major with 10-12 HCP after opener rebids 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const fiveCardHeartInvite = hand("hearts:A", "hearts:K", "hearts:J", "hearts:2", "hearts:3", "spades:Q", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(fiveCardHeartInvite, auction, "south")).toBe("3hearts");
  });

  it("makes a three-card major limit raise after opener repeats the major over 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:2", "hearts:3", "hearts:4", "spades:A", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:J", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it("invites in notrump with a balanced 10-12 HCP hand after opener repeats the major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("places game with a balanced 13+ HCP hand after opener rebids 1NT", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const balanced = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:J", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(balanced, auction, "south")).toBe("3notrump");
  });

  it("raises opener's balanced 2NT rebid to game with 6+ HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("rebids a five-card major with a minimum hand after opener's 1NT rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const handWithFiveHearts = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(handWithFiveHearts, auction, "south")).toBe("2hearts");
  });

  it("prefers opener's major over a notrump invitation without stoppers after a minor rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "clubs:Q", "clubs:J", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it.each(["SAYC", "2/1"] as const)("invites in opener's minor with five-card support and an unbalanced 11-HCP hand in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "hearts:Q", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "spades:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3clubs");
  });

  it.each(["SAYC", "2/1"] as const)("shows a doubleton preference for opener's major after a minor rebid in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:2", "spades:3", "hearts:2", "hearts:3", "hearts:4", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2spades");
  });

  it.each(["SAYC", "2/1"] as const)("passes opener's minor rebid with four-card support in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:2", "spades:3", "hearts:2", "hearts:3", "hearts:4", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it.each(["SAYC", "2/1"] as const)("shows a five-card alternate major instead of preferring opener's major in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "beginner", biddingStyle });
    const responder = hand("spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2hearts");
  });

  it("accepts a long-minor invitation in 3NT with a strong opener and stoppers", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "clubs:K", "clubs:J", "clubs:2", "clubs:3", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it.each([
    ["fewer than 16 HCP", hand("spades:K", "spades:2", "spades:3", "spades:4", "spades:5", "clubs:A", "clubs:J", "clubs:2", "clubs:3", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2")],
    ["a missing diamond stopper", hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "clubs:K", "clubs:J", "clubs:2", "clubs:3", "hearts:A", "hearts:2", "diamonds:2", "diamonds:3")]
  ] as const)("does not accept a long-minor invitation with %s", async (_reason, opener) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it("bids game in a six-card major instead of a notrump continuation with an unbalanced game-going hand", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const unbalanced = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:T", "spades:9", "hearts:A", "hearts:K", "hearts:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(unbalanced, auction, "south")).toBe("4spades");
  });

  it.each(["2/1", "SAYC"] as const)("uses a support double with exactly three-card major support in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "hearts:2", "hearts:3", "spades:K", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "1spades" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("double");
  });

  it.each([
    ["1hearts", "2spades"],
    ["2hearts", "3spades"]
  ] as const)("raises responder's major with four-card support after a %s overcall", async (overcall, expected) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "spades:K", "spades:Q", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: overcall as "1hearts" },
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("does not use a support double with fewer than three cards in responder's major", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "hearts:A", "hearts:2", "spades:K", "spades:Q", "spades:J", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "1spades" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).not.toBe("double");
  });

  it("does not use a support double after a major opening", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).not.toBe("double");
  });

  it("makes a natural one-level overcall with 8+ HCP and a five-card suit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("hearts:A", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1diamonds" }], "east")).toBe("1hearts");
  });

  it.each([
    ["a spade opening", "1spades", hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "hearts:2", "hearts:3", "hearts:4")],
    ["a diamond opening", "1diamonds", hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "hearts:6", "spades:2", "spades:3", "diamonds:7")]
  ] as const)("uses the Unusual 2NT overcall over %s", async (_opening, openingBid, overcaller) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: openingBid }], "east")).toBe("2notrump");
  });

  it.each([
    ["1clubs", "hearts", "diamonds", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "spades:2", "spades:3", "spades:4", "clubs:7", "clubs:8", "clubs:9")],
    ["1spades", "clubs", "diamonds", hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "diamonds:K", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3")]
  ] as const)("prefers a shown suit after partner's Unusual 2NT over %s", async (openingBid, preferredSuit, _otherSuit, advancer) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: openingBid }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe(`3${preferredSuit}`);
  });

  it("places 3NT with a balanced game hand after partner's Unusual 2NT", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:K", "spades:Q", "spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:A", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("3notrump");
  });

  it("preempts at the four level with a six-card minor fit and fewer than 10 HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "clubs:7", "clubs:8");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("4diamonds");
  });

  it("keeps a simple suit preference with a short fit after partner's Unusual 2NT", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("diamonds:A", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "spades:4", "spades:5", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("3diamonds");
  });

  it("cue-bids opener's suit with game-invitational values after partner's Unusual 2NT", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:K", "hearts:Q", "diamonds:A", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("3clubs");
  });

  it("accepts a game-invitational cue with a strong two-suited Unusual 2NT hand", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "hearts:2", "hearts:3", "spades:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "3spades" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("5clubs");
  });

  it("shows the best minor after a game-invitational cue with a minimum Unusual 2NT hand", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "hearts:2", "hearts:3", "spades:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "3spades" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("4clubs");
  });

  it("declines game after a minimum Unusual 2NT rebid with 13–15 HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:K", "spades:Q", "spades:2", "spades:3", "spades:4", "spades:5", "hearts:Q", "diamonds:A", "diamonds:J", "diamonds:2", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "3spades" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "3clubs" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("pass");
  });

  it("accepts game after a minimum Unusual 2NT rebid with 16+ HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:K", "spades:Q", "spades:2", "spades:3", "spades:4", "spades:5", "hearts:A", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "3spades" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "3clubs" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("5clubs");
  });

  it("passes to defend when an opponent competes over partner's Unusual 2NT", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:K", "spades:Q", "spades:3", "spades:2", "hearts:Q", "hearts:4", "hearts:2", "diamonds:J", "diamonds:3", "diamonds:2", "clubs:4", "clubs:3", "clubs:2");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "3spades" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("pass");
  });

  it.each([15, 18])("makes a natural 1NT overcall with a balanced %i-HCP hand and opener-suit stopper", async (expectedHcp) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = expectedHcp === 15
      ? hand("spades:K", "spades:J", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4")
      : hand("spades:K", "spades:J", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:J", "clubs:2");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1spades" }], "east")).toBe("1notrump");
  });

  it.each([
    ["minimum", hand("hearts:A", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4")],
    ["maximum", hand("spades:Q", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3")]
  ] as const)("opens a six-card major weak two with %s SAYC strength", async (_range, weakTwo) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    expect(await bot.chooseBid(weakTwo, [], "north")).toBe("2hearts");
  });

  it("does not open a weak two without a six-card suit of reasonable quality", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const weakSuit = hand("hearts:K", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:Q", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(weakSuit, [], "north")).toBe("pass");
  });

  it.each([
    ["hearts with four spades", hand("hearts:K", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "spades:A", "spades:2", "spades:3", "spades:4", "diamonds:Q", "diamonds:2", "clubs:2")],
    ["diamonds with four hearts", hand("diamonds:A", "diamonds:J", "diamonds:T", "diamonds:9", "diamonds:8", "diamonds:7", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "spades:2", "clubs:2", "clubs:3")],
    ["spades with four hearts", hand("spades:K", "spades:J", "spades:T", "spades:9", "spades:8", "spades:7", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "diamonds:Q", "diamonds:2", "clubs:2")]
  ] as const)("does not open a weak two in the presence of an outside major: %s", async (_shape, cards) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    expect(await bot.chooseBid(cards, [], "north")).toBe("pass");
  });

  it("opens a six-card diamond weak two in 2/1 style", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const weakTwo = hand("diamonds:A", "diamonds:J", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "spades:2", "spades:3", "hearts:2", "hearts:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(weakTwo, [], "north")).toBe("2diamonds");
  });

  it.each([
    ["five HCP in clubs", hand("clubs:K", "clubs:Q", "clubs:T", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "spades:2", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5"), "3clubs", "SAYC"],
    ["ten HCP in spades", hand("spades:K", "spades:Q", "spades:T", "spades:2", "spades:3", "spades:4", "spades:5", "clubs:A", "clubs:J", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5"), "3spades", "2/1"]
  ] as const)("opens a seven-card preempt with %s", async (_label, cards, expected, biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    expect(await bot.chooseBid(cards, [], "north")).toBe(expected);
  });

  it("does not open a three-level preempt above 10 HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const elevenHcp = hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "clubs:A", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    expect(await bot.chooseBid(elevenHcp, [], "north")).not.toBe("3hearts");
  });

  it("does not open a three-level preempt with fewer than five HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const fourHcp = hand("hearts:K", "hearts:J", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(fourHcp, [], "north")).not.toBe("3hearts");
  });

  it("requires two honors in the preemptive suit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const oneHonor = hand("hearts:K", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "hearts:6", "hearts:7", "clubs:A", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    expect(await bot.chooseBid(oneHonor, [], "north")).not.toBe("3hearts");
  });

  it("does not make a weak three-level opening with an outside four-card major", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const outsideMajor = hand("spades:K", "spades:Q", "spades:T", "spades:2", "spades:3", "spades:4", "spades:5", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "diamonds:2", "diamonds:3");
    expect(await bot.chooseBid(outsideMajor, [], "north")).not.toBe("3spades");
  });

  it("does not add weak three-level openings to Beginner", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const weakThree = hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(weakThree, [], "north")).not.toBe("3hearts");
  });

  it("does not use a weak three-level opening after an opponent has opened", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const weakThree = hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(weakThree, [{ seat: "north", bid: "1clubs" }], "east")).not.toBe("3hearts");
  });

  it.each([
    ["hearts", hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "spades:Q", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3"), "3hearts", "4hearts", "SAYC"],
    ["spades", hand("spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3"), "3spades", "4spades", "2/1"]
  ] as const)("raises partner's %s preempt to game with a four-card fit and 15 HCP", async (_major, responder, openingBid, expected, biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const auction = [
      { seat: "north", bid: openingBid }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it.each([
    ["3♥ SAYC", "hearts", hand("spades:A", "spades:K", "spades:8", "spades:6", "hearts:K", "diamonds:A", "diamonds:9", "diamonds:6", "diamonds:4", "clubs:K", "clubs:Q", "clubs:8", "clubs:7"), "SAYC"],
    ["3♥ 2/1", "hearts", hand("spades:A", "spades:K", "spades:8", "spades:6", "hearts:K", "diamonds:A", "diamonds:9", "diamonds:6", "diamonds:4", "clubs:K", "clubs:Q", "clubs:8", "clubs:7"), "2/1"],
    ["3♠ SAYC", "spades", hand("hearts:A", "hearts:K", "hearts:8", "hearts:6", "spades:K", "diamonds:A", "diamonds:9", "diamonds:6", "diamonds:4", "clubs:K", "clubs:Q", "clubs:8", "clubs:7"), "SAYC"],
    ["3♠ 2/1", "spades", hand("hearts:A", "hearts:K", "hearts:8", "hearts:6", "spades:K", "diamonds:A", "diamonds:9", "diamonds:6", "diamonds:4", "clubs:K", "clubs:Q", "clubs:8", "clubs:7"), "2/1"]
  ] as const)("places 4M from 4.5 quick tricks over %s with singleton trump support", async (_label, openedMajor, responder, biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const auction = [
      { seat: "north", bid: `3${openedMajor}` as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(`4${openedMajor}`);
  });

  it("does not place game at the 4.0 quick-trick boundary with singleton trump support", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:8", "spades:6", "hearts:2", "diamonds:A", "diamonds:9", "diamonds:6", "diamonds:4", "clubs:K", "clubs:Q", "clubs:8", "clubs:7");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4hearts");
  });

  it("does not use the quick-trick major game raise after interference", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:8", "spades:6", "hearts:K", "diamonds:A", "diamonds:9", "diamonds:6", "diamonds:4", "clubs:K", "clubs:Q", "clubs:8", "clubs:7");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "double" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4hearts");
  });

  it.each([
    ["14 HCP with four-card support", hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4"), "5hearts"],
    ["three-card support", hand("hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:K", "spades:Q", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4"), "4hearts"]
  ] as const)("uses the preemptive fit raise for %s", async (_case, responder, expected) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("does not apply the uncontested major-game raise after an opponent overcalls", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "spades:Q", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "3spades" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4hearts");
  });

  it("passes after partner's weak three major is raised to game", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const opener = hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it.each([
    ["3♥ SAYC", "hearts", hand("spades:A", "spades:6", "hearts:7", "diamonds:K", "diamonds:8", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7", "clubs:6", "clubs:4"), "SAYC"],
    ["3♥ 2/1", "hearts", hand("spades:A", "spades:6", "hearts:7", "diamonds:K", "diamonds:8", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7", "clubs:6", "clubs:4"), "2/1"],
    ["3♠ SAYC", "spades", hand("spades:7", "hearts:A", "hearts:6", "diamonds:K", "diamonds:8", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7", "clubs:6", "clubs:4"), "SAYC"],
    ["3♠ 2/1", "spades", hand("spades:7", "hearts:A", "hearts:6", "diamonds:K", "diamonds:8", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7", "clubs:6", "clubs:4"), "2/1"],
    ["3♣ SAYC", "clubs", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:7", "spades:6", "spades:4", "hearts:A", "hearts:6", "diamonds:K", "diamonds:8", "clubs:2"), "SAYC"],
    ["3♦ 2/1", "diamonds", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:7", "hearts:6", "hearts:4", "spades:A", "spades:6", "clubs:K", "clubs:8", "diamonds:2"), "2/1"]
  ] as const)("places 3NT over partner's weak three with nine own tricks: %s", async (_label, openedMajor, responder, biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const auction = [
      { seat: "north", bid: `3${openedMajor}` as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("does not bid 3NT over partner's major preempt from a singleton in that major alone", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:6", "hearts:7", "diamonds:K", "diamonds:8", "diamonds:2", "diamonds:3", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("3notrump");
  });

  it("requires stoppers outside the running suit and partner's major for 3NT", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const missingStopper = hand("spades:A", "spades:6", "hearts:7", "diamonds:Q", "diamonds:8", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7", "clubs:6", "clubs:4");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(missingStopper, auction, "south")).not.toBe("3notrump");
  });

  it("requires an outside ace to accompany the running suit for 3NT", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const noOutsideAce = hand("spades:K", "spades:6", "hearts:7", "diamonds:K", "diamonds:8", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7", "clubs:6", "clubs:4");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(noOutsideAce, auction, "south")).not.toBe("3notrump");
  });

  it("does not use the self-sufficient 3NT response after interference", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:6", "hearts:7", "diamonds:K", "diamonds:8", "clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:7", "clubs:6", "clubs:4");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "double" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("3notrump");
  });

  it("passes after responder places 3NT opposite partner's weak three", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const opener = hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it.each([
    ["3♣–3♥ SAYC", "clubs", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:K", "spades:J", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5"), "SAYC"],
    ["3♣–3♠ 2/1", "clubs", "spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:K", "hearts:J", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5"), "2/1"],
    ["3♦–3♥ 2/1", "diamonds", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:K", "spades:J", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5"), "2/1"],
    ["3♦–3♠ SAYC", "diamonds", "spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:K", "hearts:J", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5"), "SAYC"]
  ] as const)("uses a natural forcing major response with 16 HCP and six cards: %s", async (_label, openingSuit, responseMajor, responder, biddingStyle) => {
    const bot = createBot({ skill: "intermediate", biddingStyle });
    const auction = [{ seat: "north", bid: `3${openingSuit}` as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(`3${responseMajor}`);
  });

  it.each(["advanced", "expert"] as const)("inherits the forcing weak-three major response at %s", async (skill) => {
    const bot = createBot({ skill, biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:K", "hearts:J", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "3clubs" }], "south")).toBe("3spades");
  });

  it("prefers the longer major and then spades when both qualify", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "clubs:2");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "3clubs" }], "south")).toBe("3spades");
  });

  it("does not give the forcing response to Beginner", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:K", "spades:J", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "3clubs" }], "south")).not.toBe("3hearts");
  });

  it.each([
    ["15 HCP", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:K", "spades:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "diamonds:2")],
    ["five-card major", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "spades:K", "spades:J", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6")],
    ["a six-card major without two honors", hand("hearts:9", "hearts:8", "hearts:7", "hearts:6", "hearts:5", "hearts:4", "spades:A", "spades:K", "spades:Q", "spades:J", "diamonds:A", "diamonds:K", "clubs:Q")]
  ] as const)("does not force a new major with %s", async (_label, responder) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const auction = [{ seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("3hearts");
  });

  it("does not use the natural major response after interference", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:K", "hearts:J", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "3clubs" }, { seat: "east", bid: "double" }], "south")).not.toBe("3spades");
  });

  it.each([
    ["3♥–3♠", "3hearts", "3spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:K", "hearts:J", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5")],
    ["3♠–4♥", "3spades", "4hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:K", "spades:J", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5")]
  ] as const)("uses a natural forcing new-suit response after %s", async (_label, opening, response, responder) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: opening }, { seat: "east", bid: "pass" }], "south")).toBe(response);
  });

  it.each([
    ["3♥–3♠–4♠", "3hearts", "3spades", "4spades", hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:A", "spades:K", "spades:Q", "diamonds:2", "diamonds:3", "clubs:2")],
    ["3♠–4♥–5♥", "3spades", "4hearts", "5hearts", hand("hearts:A", "hearts:K", "hearts:Q", "spades:K", "spades:Q", "spades:T", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3")],
    ["3♥–3♠–4♥", "3hearts", "3spades", "4hearts", hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3")],
    ["3♠–4♥–4♠", "3spades", "4hearts", "4spades", hand("spades:K", "spades:Q", "spades:T", "spades:2", "spades:3", "spades:4", "spades:5", "hearts:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4")]
  ] as const)("continues a forcing major response after %s", async (_label, opening, response, expected, opener) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const auction = [{ seat: "north", bid: opening }, { seat: "east", bid: "pass" as const }, { seat: "south", bid: response }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("places 4♠ after the no-fit rebid over 3♥, then opener passes", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:K", "hearts:J", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    const afterRebid = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, afterRebid, "south")).toBe("4spades");
    expect(await bot.chooseBid(hand("hearts:K", "hearts:Q", "hearts:T", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3"), [...afterRebid, { seat: "south", bid: "4spades" as const }, { seat: "west", bid: "pass" as const }], "north")).toBe("pass");
  });

  it("passes after the no-fit 4♠ rebid over 3♠–4♥", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:K", "spades:J", "clubs:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5"), auction, "south")).toBe("pass");
  });

  it.each(((["clubs", "diamonds", "hearts", "spades"] as const).flatMap((suit) => [3, 4, 5, 6].map((supportLength) => [suit, supportLength] as const))))(
    "raises a weak three-level %s preempt with %i-card support",
    async (suit, supportLength) => {
      const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
      const auction = [{ seat: "north", bid: `3${suit}` as const }, { seat: "east", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(handWithSuitSupport(suit, supportLength), auction, "south")).toBe(`${supportLength + 1}${suit}`);
    }
  );

  it.each(["clubs", "diamonds", "hearts", "spades"] as const)("passes after partner raises the weak three-level %s preempt", async (suit) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: `3${suit}` as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: `5${suit}` as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(handWithSuitSupport(suit, 7), auction, "north")).toBe("pass");
  });

  it.each(["advanced", "expert"] as const)("inherits preemptive weak-three fit raises in %s", async (skill) => {
    const bot = createBot({ skill, biddingStyle: "2/1" });
    expect(await bot.chooseBid(handWithSuitSupport("hearts", 3), [{ seat: "north", bid: "3hearts" }], "south")).toBe("4hearts");
  });

  it("does not make a preemptive fit raise after interference", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const auction = [{ seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "3spades" as const }] as const;
    expect(await bot.chooseBid(handWithSuitSupport("hearts", 3), auction, "south")).not.toBe("4hearts");
  });

  it.each([
    ["3♣–3♥", hand("clubs:K", "clubs:Q", "clubs:J", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "hearts:A", "hearts:2", "hearts:3", "spades:2", "spades:3", "diamonds:2"), "3clubs", "3hearts", "4hearts"],
    ["3♦–3♠", hand("diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:9", "diamonds:8", "diamonds:7", "diamonds:6", "spades:A", "spades:2", "spades:3", "hearts:2", "clubs:2", "clubs:3"), "3diamonds", "3spades", "4spades"]
  ] as const)("continues a forcing major response by raising three-card support to game: %s", async (_label, opener, openingBid, responseBid, expected) => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: openingBid }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: responseBid }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("repeats its minor without a major fit, then responder places major game", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "hearts:2", "hearts:3", "spades:2", "spades:3", "diamonds:2", "diamonds:3");
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:K", "spades:J", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4clubs");
    const afterMinorRebid = [...auction, { seat: "north", bid: "4clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterMinorRebid, "south")).toBe("4hearts");
  });

  it("passes after responder places game following the forcing major response", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "hearts:2", "hearts:3", "spades:2", "spades:3", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it.each([
    ["clubs", hand("clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:2", "spades:A", "spades:K", "diamonds:K", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3")],
    ["diamonds", hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "spades:A", "spades:K", "clubs:K", "hearts:2", "hearts:3", "hearts:4", "clubs:2", "clubs:3")]
  ] as const)("starts Expert weak-three %s Blackwood with 19+ HCP and five-card support", async (minor, responder) => {
    const auction = [{ seat: "north", bid: `3${minor}` as const }, { seat: "east", bid: "pass" as const }] as const;
    for (const biddingStyle of ["SAYC", "2/1"] as const) {
      const bot = createBot({ skill: "expert", biddingStyle });
      expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
    }
  });

  it.each([
    ["clubs", hand("clubs:A", "clubs:K", "clubs:Q", "clubs:J", "spades:A", "spades:K", "diamonds:K", "diamonds:2", "diamonds:3", "hearts:Q", "hearts:2", "hearts:3", "hearts:4")],
    ["diamonds", hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "spades:A", "spades:K", "clubs:K", "clubs:2", "clubs:3", "hearts:Q", "hearts:2", "hearts:3", "hearts:4")]
  ] as const)("requires five-card fit to start weak-three %s Blackwood", async (minor, responder) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [{ seat: "north", bid: `3${minor}` as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4notrump");
  });

  it("does not use weak-three minor Blackwood after interference or below Expert", async () => {
    const responder = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:2", "spades:A", "spades:K", "diamonds:K", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3");
    const expert = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const intermediate = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    expect(await expert.chooseBid(responder, [
      { seat: "north", bid: "3clubs" }, { seat: "east", bid: "double" }
    ], "south")).not.toBe("4notrump");
    expect(await intermediate.chooseBid(responder, [
      { seat: "north", bid: "3clubs" }, { seat: "east", bid: "pass" }
    ], "south")).not.toBe("4notrump");
  });

  it.each([
    ["clubs", hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "spades:A", "spades:K", "hearts:A", "hearts:K", "diamonds:A", "diamonds:Q", "diamonds:2", "diamonds:3"), hand("clubs:K", "clubs:J", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3")],
    ["diamonds", hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "spades:A", "spades:K", "hearts:A", "hearts:K", "clubs:A", "clubs:Q", "clubs:2", "clubs:3"), hand("diamonds:K", "diamonds:J", "diamonds:T", "diamonds:9", "diamonds:8", "diamonds:7", "diamonds:6", "spades:2", "spades:3", "hearts:2", "hearts:3", "clubs:2", "clubs:3")]
  ] as const)("uses minor %s for the full weak-three Blackwood and king-ask sequence", async (minor, responder, opener) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opening = { seat: "north" as const, bid: `3${minor}` as const };
    expect(await bot.chooseBid(responder, [opening, { seat: "east", bid: "pass" }], "south")).toBe("4notrump");
    const aceAsk = [opening, { seat: "east", bid: "pass" as const }, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, aceAsk, "north")).toBe("5clubs");
    const kingAsk = [...aceAsk, { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, kingAsk, "south")).toBe("5notrump");
    const kingAnswer = [...kingAsk, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, kingAnswer, "north")).toBe("6diamonds");
    const grandSlamPlacement = [...kingAnswer, { seat: "north", bid: "6diamonds" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, grandSlamPlacement, "south")).toBe(`7${minor}`);
  });

  it.each([
    ["3♣–3♥–4♥", "clubs", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:A", "spades:K", "diamonds:A", "diamonds:K", "clubs:A", "clubs:Q", "clubs:2"), hand("clubs:K", "clubs:J", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "hearts:T", "hearts:7", "hearts:6", "spades:2", "spades:3", "diamonds:2")],
    ["3♦–3♥–4♥", "diamonds", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:A", "spades:K", "diamonds:A", "diamonds:K", "clubs:A", "clubs:Q", "clubs:2"), hand("diamonds:Q", "diamonds:J", "diamonds:T", "diamonds:9", "diamonds:8", "diamonds:7", "diamonds:6", "hearts:T", "hearts:7", "hearts:6", "spades:2", "spades:3", "clubs:K")],
    ["3♣–3♠–4♠", "clubs", "spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:A", "hearts:K", "diamonds:A", "diamonds:K", "clubs:A", "clubs:Q", "clubs:2"), hand("clubs:K", "clubs:J", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "spades:T", "spades:7", "spades:6", "hearts:2", "hearts:3", "diamonds:2")],
    ["3♦–3♠–4♠", "diamonds", "spades", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:9", "spades:8", "hearts:A", "hearts:K", "diamonds:A", "diamonds:K", "clubs:A", "clubs:Q", "clubs:2"), hand("diamonds:Q", "diamonds:J", "diamonds:T", "diamonds:9", "diamonds:8", "diamonds:7", "diamonds:6", "spades:T", "spades:7", "spades:6", "hearts:2", "hearts:3", "clubs:K")]
  ] as const)("uses weak-three Blackwood for a confirmed major fit after %s", async (_label, minor, major, responder, opener) => {
    for (const biddingStyle of ["SAYC", "2/1"] as const) {
      const bot = createBot({ skill: "expert", biddingStyle });
      const auction = [
        { seat: "north", bid: `3${minor}` as const }, { seat: "east", bid: "pass" as const },
        { seat: "south", bid: `3${major}` as const }, { seat: "west", bid: "pass" as const },
        { seat: "north", bid: `4${major}` as const }, { seat: "east", bid: "pass" as const }
      ] as const;
      expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");

      const aceAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(opener, aceAsk, "north")).toBe("5clubs");
      const kingAsk = [...aceAsk, { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(responder, kingAsk, "south")).toBe("5notrump");
      const kingAnswer = [...kingAsk, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(opener, kingAnswer, "north")).toBe("6diamonds");
      const grandSlamPlacement = [...kingAnswer, { seat: "north", bid: "6diamonds" as const }, { seat: "east", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(responder, grandSlamPlacement, "south")).toBe(`7${major}`);
      const afterGrandSlam = [...grandSlamPlacement, { seat: "south", bid: `7${major}` as const }, { seat: "west", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(opener, afterGrandSlam, "north")).toBe("pass");
    }
  });

  it("uses Expert Blackwood after 3♥–3♠ confirms the spade fit at game", async () => {
    const opener = hand("spades:2", "spades:3", "spades:4", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "hearts:6", "hearts:7", "diamonds:A", "diamonds:2", "clubs:2");
    const responder = hand("spades:A", "spades:K", "spades:T", "spades:9", "spades:8", "spades:7", "hearts:A", "hearts:8", "diamonds:K", "diamonds:Q", "clubs:A", "clubs:K", "clubs:Q");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    for (const biddingStyle of ["SAYC", "2/1"] as const) {
      const bot = createBot({ skill: "expert", biddingStyle });
      expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");

      const aceAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(opener, aceAsk, "north")).toBe("5diamonds");
      const kingAsk = [...aceAsk, { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(responder, kingAsk, "south")).toBe("5notrump");
      const kingAnswer = [...kingAsk, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(opener, kingAnswer, "north")).toBe("6diamonds");
      const slamPlacement = [...kingAnswer, { seat: "north", bid: "6diamonds" as const }, { seat: "east", bid: "pass" as const }] as const;
      expect(await bot.chooseBid(responder, slamPlacement, "south")).toBe("7spades");
      expect(await bot.chooseBid(opener, [...slamPlacement, { seat: "south", bid: "7spades" as const }, { seat: "west", bid: "pass" as const }], "north")).toBe("pass");
    }
  });

  it("skips the weak-three Blackwood king ask when responder holds no kings", async () => {
    const opener = hand("spades:K", "spades:2", "spades:3", "hearts:K", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "hearts:6", "diamonds:2", "clubs:K", "clubs:2");
    const responder = hand("spades:A", "spades:J", "spades:T", "spades:9", "spades:8", "spades:7", "hearts:A", "diamonds:A", "diamonds:Q", "clubs:A", "clubs:J", "clubs:3", "clubs:4");
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const aceAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
    expect(await bot.chooseBid(opener, aceAsk, "north")).toBe("5clubs");
    const afterAceAnswer = [...aceAsk, { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterAceAnswer, "south")).toBe("6spades");
  });

  it("skips the direct weak-three Blackwood king ask when responder holds no kings", async () => {
    const opener = hand("spades:K", "spades:2", "spades:3", "hearts:K", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "diamonds:K", "diamonds:2", "clubs:2");
    const responder = hand("spades:A", "spades:Q", "spades:4", "hearts:A", "hearts:Q", "hearts:2", "diamonds:A", "diamonds:Q", "diamonds:3", "clubs:A", "clubs:2", "clubs:3", "clubs:4");
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const auction = [{ seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
    const aceAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, aceAsk, "north")).toBe("5clubs");
    const afterAceAnswer = [...aceAsk, { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterAceAnswer, "south")).toBe("6spades");
  });

  it("skips the weak-three heart-fit king ask when responder holds no kings", async () => {
    const opener = hand("clubs:K", "clubs:Q", "clubs:J", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "hearts:K", "hearts:2", "hearts:3", "spades:5", "spades:4", "diamonds:K");
    const responder = hand("hearts:A", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "hearts:7", "spades:A", "spades:Q", "spades:2", "spades:3", "diamonds:A", "diamonds:Q", "clubs:A");
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const aceAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
    expect(await bot.chooseBid(opener, aceAsk, "north")).toBe("5clubs");
    const afterAceAnswer = [...aceAsk, { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterAceAnswer, "south")).toBe("6hearts");
  });

  it("places 7M when a higher Blackwood king response confirms all kings", async () => {
    const opener = hand("clubs:K", "clubs:Q", "clubs:J", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:4", "diamonds:K");
    const responder = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:A", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:A");
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const aceAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
    expect(await bot.chooseBid(opener, aceAsk, "north")).toBe("5clubs");
    const kingAsk = [...aceAsk, { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, kingAsk, "south")).toBe("5notrump");
    const kingAnswer = [...kingAsk, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, kingAnswer, "north")).toBe("6spades");
    expect(await bot.chooseBid(responder, [...kingAnswer, { seat: "north", bid: "6spades" as const }, { seat: "east", bid: "pass" as const }], "south")).toBe("7hearts");
  });

  it("limits weak-three side-major Blackwood to an unpassed, uncontested Expert auction", async () => {
    const responder = hand("spades:A", "spades:K", "spades:T", "spades:9", "spades:8", "spades:7", "hearts:A", "hearts:8", "diamonds:K", "diamonds:Q", "clubs:A", "clubs:K", "clubs:Q");
    const expert = createBot({ skill: "expert", biddingStyle: "2/1" });
    const intermediate = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const uncontested = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await intermediate.chooseBid(responder, uncontested, "south")).not.toBe("4notrump");

    const interfered = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "double" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await expert.chooseBid(responder, interfered, "south")).not.toBe("4notrump");

    const passedResponder = [
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "pass" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3hearts" as const },
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "3spades" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "4spades" as const },
      { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await expert.chooseBid(responder, passedResponder, "south")).not.toBe("4notrump");
  });

  it.each([
    ["two of the top three trump honors", hand("hearts:A", "hearts:Q", "hearts:2", "clubs:K", "clubs:J", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "spades:2", "spades:3", "diamonds:2"), "7hearts"],
    ["fewer than two of the top three trump honors", hand("hearts:A", "hearts:2", "hearts:3", "clubs:K", "clubs:Q", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "spades:2", "spades:3", "diamonds:2"), "6hearts"]
  ] as const)("uses the weak-three-fit Grand Slam Force when opener has %s", async (_label, opener, expected) => {
    const responder = hand("hearts:K", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "hearts:5", "spades:A", "spades:K", "diamonds:A", "clubs:A", "clubs:2", "clubs:3", "clubs:4");
    const fiveCardMajor = hand("hearts:K", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "spades:A", "spades:K", "diamonds:A", "clubs:A", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    for (const biddingStyle of ["SAYC", "2/1"] as const) {
      const bot = createBot({ skill: "expert", biddingStyle });
      expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
      expect(await bot.chooseBid(fiveCardMajor, auction, "south")).not.toBe("5notrump");
      expect(await bot.chooseBid(opener, [...auction, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }], "north")).toBe(expected);
    }
  });

  it.each(["SAYC", "2/1"] as const)("uses the Grand Slam Force after a weak-three major response fit in %s", async (biddingStyle) => {
    const bot = createBot({ skill: "expert", biddingStyle });
    const spadeOpener = hand("spades:A", "spades:Q", "spades:2", "hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "diamonds:2", "clubs:2", "clubs:3");
    const spadeResponder = hand("spades:K", "spades:J", "spades:9", "spades:8", "spades:7", "spades:6", "hearts:A", "hearts:K", "diamonds:A", "clubs:K", "clubs:4", "clubs:5", "clubs:6");
    const spadeFitAuction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(spadeResponder, spadeFitAuction, "south")).toBe("5notrump");
    expect(await bot.chooseBid(spadeOpener, [...spadeFitAuction, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }], "north")).toBe("7spades");

    const heartOpener = hand("spades:Q", "spades:J", "spades:T", "spades:9", "spades:8", "spades:7", "spades:6", "hearts:A", "hearts:Q", "hearts:2", "diamonds:2", "diamonds:3", "clubs:2");
    const heartResponder = hand("hearts:K", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "hearts:5", "spades:A", "spades:K", "diamonds:A", "clubs:A", "clubs:K", "clubs:6", "clubs:5");
    const heartFitAuction = [
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(heartResponder, heartFitAuction, "south")).toBe("5notrump");
    expect(await bot.chooseBid(heartOpener, [...heartFitAuction, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }], "north")).toBe("7hearts");
  });

  it("limits weak-three Grand Slam Force to strong, unpassed, uncontested Expert fits", async () => {
    const expert = createBot({ skill: "expert", biddingStyle: "2/1" });
    const intermediate = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "hearts:5", "spades:A", "spades:K", "diamonds:A", "clubs:A", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const belowStrength = hand("hearts:J", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "hearts:5", "spades:A", "spades:K", "diamonds:A", "clubs:A", "clubs:2", "clubs:3", "clubs:4");
    expect(await expert.chooseBid(belowStrength, auction, "south")).not.toBe("5notrump");
    expect(await intermediate.chooseBid(responder, auction, "south")).not.toBe("5notrump");

    const interferedAuction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "double" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await expert.chooseBid(responder, interferedAuction, "south")).not.toBe("5notrump");

    const passedAuction = [
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "pass" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3clubs" as const },
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "3hearts" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "4hearts" as const },
      { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await expert.chooseBid(responder, passedAuction, "south")).not.toBe("5notrump");
  });

  it("places small slam after the weak-three major-fit king ask when all kings are not known", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:A", "spades:K", "diamonds:A", "diamonds:K", "clubs:A", "clubs:2", "clubs:3");
    const opener = hand("clubs:Q", "clubs:J", "clubs:T", "clubs:9", "clubs:8", "clubs:7", "clubs:6", "hearts:T", "hearts:7", "hearts:6", "spades:2", "spades:3", "diamonds:2");
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("5clubs");
    const kingAsk = [...auction, { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, kingAsk, "south")).toBe("5notrump");
    const kingAnswer = [...kingAsk, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, kingAnswer, "north")).toBe("6clubs");
    const slamPlacement = [...kingAnswer, { seat: "north", bid: "6clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, slamPlacement, "south")).toBe("6hearts");
  });

  it.each([
    ["18 HCP", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:A", "spades:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5")],
    ["five-card major", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "diamonds:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6")]
  ] as const)("does not start weak-three major-fit Blackwood with %s", async (_label, responder) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4notrump");
  });

  it("does not start weak-three major-fit Blackwood below Expert or after interference", async () => {
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:A", "spades:K", "diamonds:A", "diamonds:K", "clubs:A", "clubs:K", "clubs:2");
    const afterFit = [
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const intermediate = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const expert = createBot({ skill: "expert", biddingStyle: "SAYC" });
    expect(await intermediate.chooseBid(responder, afterFit, "south")).not.toBe("4notrump");
    expect(await expert.chooseBid(responder, [...afterFit, { seat: "west", bid: "double" as const }], "south")).not.toBe("4notrump");
  });

  it.each([
    ["hearts SAYC", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "spades:Q", "diamonds:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "SAYC"],
    ["hearts 2/1", "hearts", hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "spades:Q", "diamonds:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "2/1"],
    ["spades SAYC", "spades", hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:Q", "diamonds:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "SAYC"],
    ["spades 2/1", "spades", hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:Q", "diamonds:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7"), "2/1"]
  ] as const)("uses direct Blackwood with 19+ HCP and three-card support after partner's weak three: %s", async (_label, major, responder, biddingStyle) => {
    const bot = createBot({ skill: "expert", biddingStyle });
    const auction = [{ seat: "north", bid: `3${major}` as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it.each([
    ["18 HCP", hand("hearts:A", "hearts:Q", "hearts:J", "spades:A", "spades:K", "diamonds:A", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "clubs:8")],
    ["two-card support", hand("hearts:A", "hearts:K", "spades:A", "spades:K", "spades:Q", "diamonds:K", "diamonds:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7")]
  ] as const)("does not start weak-three Blackwood with %s", async (_label, responder) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [{ seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4notrump");
  });

  it.each([
    ["interference", [{ seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "double" as const }]]
  ] as const)("does not start weak-three Blackwood after %s", async (_label, auction) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:J", "clubs:2", "spades:A", "spades:K", "diamonds:K", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3");
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4notrump");
  });

  it("does not start weak-three Blackwood below Expert", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "spades:Q", "diamonds:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "3hearts" }], "south")).not.toBe("4notrump");
  });

  it.each([
    ["zero", hand("hearts:K", "hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3"), "5clubs"],
    ["one", hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3"), "5diamonds"],
    ["two", hand("hearts:T", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "hearts:5", "hearts:4", "spades:A", "spades:2", "diamonds:A", "diamonds:2", "clubs:2", "clubs:3"), "5hearts"],
    ["three", hand("hearts:T", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "hearts:5", "hearts:4", "spades:A", "spades:2", "diamonds:A", "diamonds:2", "clubs:A", "clubs:3"), "5spades"]
  ] as const)("answers Expert's weak-three Blackwood ask with %s aces", async (_label, opener, answer) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(answer);
  });

  it.each([
    ["0", "5clubs", "5hearts"],
    ["1", "5diamonds", "6hearts"]
  ] as const)("places %s-ace response in the weak-three Blackwood auction", async (_label, answer, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "spades:Q", "diamonds:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: answer }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("asks for kings after all four aces are known in weak-three Blackwood", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "diamonds:A", "clubs:A", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
  });

  it.each([
    ["one", hand("hearts:K", "hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "spades:A", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3"), "6diamonds"],
    ["zero", hand("hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "hearts:6", "spades:A", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3"), "6clubs"]
  ] as const)("answers Expert weak-three king ask with %s kings", async (_label, opener, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it.each([
    ["three combined kings", hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "diamonds:A", "diamonds:2", "clubs:A", "clubs:2", "spades:2", "spades:3", "diamonds:3", "clubs:3"), "6hearts"],
    ["four combined kings", hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "diamonds:A", "diamonds:K", "clubs:Q", "clubs:3", "spades:2", "spades:3", "diamonds:2", "clubs:2"), "7hearts"]
  ] as const)("places weak-three grand slam with %s", async (_label, responder, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "6diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("does not place a weak-three grand slam when the king ask skipped an ace", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "spades:A", "spades:K", "spades:Q", "diamonds:K", "clubs:Q", "spades:2", "spades:3", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "6diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("6hearts");
  });

  it("passes after weak-three Blackwood asker places small slam", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "6hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("pass");
  });

  it("asks for a feature with 2NT over partner's weak two when holding game interest", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:2", "diamonds:K", "diamonds:Q", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2hearts" }], "south")).toBe("2notrump");
  });

  it("uses a forcing natural new-suit response over a weak two and opener continues by strength", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const gameResponder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const minimum = hand("hearts:A", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const maximum = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const opening = [{ seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, opening, "south")).toBe("2spades");

    const auction = [...opening, { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(minimum, auction, "north")).toBe("3hearts");
    expect(await bot.chooseBid(maximum, auction, "north")).toBe("3diamonds");
    expect(await bot.chooseBid(gameResponder, [...auction, { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }], "south")).toBe("4hearts");
  });

  it("raises a weak two to the three level with three-card support and no game interest", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const responder = hand("hearts:Q", "hearts:2", "hearts:3", "spades:J", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2hearts" }], "south")).toBe("3hearts");
  });

  it("raises a weak two preemptively to game with five-card support", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:Q", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2hearts" }], "south")).toBe("4hearts");
  });

  it("plays 3NT directly over a weak two with a balanced hand and no major fit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:J", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2hearts" }], "south")).toBe("3notrump");
  });

  it("rebids a minimum weak two suit after the 2NT feature inquiry", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [{ seat: "north", bid: "2hearts" as const }, { seat: "south", bid: "2notrump" as const }] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("shows a side-suit feature with a maximum weak two after the 2NT inquiry", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const opener = hand("spades:K", "spades:2", "spades:3", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [{ seat: "north", bid: "2hearts" as const }, { seat: "south", bid: "2notrump" as const }] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3spades");
  });

  it("bids 3NT with a maximum weak two and no outside feature", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:Q", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [{ seat: "north", bid: "2hearts" as const }, { seat: "south", bid: "2notrump" as const }] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("places game in a supported weak-two major after opener shows a minimum", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("does not overcall 1NT below 15 HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const overcaller = hand("spades:K", "spades:J", "spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1spades" }], "east")).toBe("pass");
  });

  it("requires an opener-suit stopper for a natural 1NT overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const noStopper = hand("spades:2", "spades:3", "spades:4", "spades:5", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:J", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(noStopper, [{ seat: "north", bid: "1spades" }], "east")).toBe("pass");
  });

  it("uses Stayman with 8+ HCP and a four-card major after partner's 1NT overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("2clubs");
  });

  it("passes Stayman with fewer than 8 HCP after partner's 1NT overcall", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:J", "hearts:2", "hearts:3", "spades:2", "spades:3", "spades:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("pass");
  });

  it("bids a natural five-card major below Stayman strength after a 1NT overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:J", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("2hearts");
  });

  it("bids a natural five-card diamond suit after a 1NT overcall", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "hearts:J", "hearts:2", "hearts:3", "spades:2", "spades:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("2diamonds");
  });

  it("bids three clubs naturally when clubs are responder's only long suit over 1NT", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const responder = hand("clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "hearts:J", "hearts:2", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("3clubs");
  });

  it("invites in notrump after a 1NT overcall with a balanced 8-9 HCP hand and no four-card major", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "spades:J", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("2notrump");
  });

  it("shows a natural five-card minor before inviting in notrump after a 1NT overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "spades:J", "spades:2", "spades:3", "hearts:2", "hearts:3", "clubs:Q", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("2diamonds");
  });

  it("bids 3NT after a 1NT overcall with a balanced 10+ HCP hand and no four-card major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "spades:K", "spades:2", "spades:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("3notrump");
  });

  it("shows a four-card major after responder uses Stayman over a 1NT overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("2hearts");
  });

  it("denies a four-card major after Stayman over a 1NT overcall", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const overcaller = hand("clubs:A", "clubs:2", "clubs:3", "clubs:4", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "hearts:K", "hearts:J", "hearts:2", "spades:Q", "spades:2");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("2diamonds");
  });

  it("invites game in a shown major after Stayman with 8-9 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("3hearts");
  });

  it("places game in a shown major after Stayman with 10+ HCP and support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:Q", "spades:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("4hearts");
  });

  it("invites in notrump when Stayman finds no fit and responder has 8-9 HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2spades" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("2notrump");
  });

  it("places game in notrump after Stayman denial with a balanced 10+ HCP hand", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:Q", "spades:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2diamonds" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("3notrump");
  });

  it("shows four spades after Stayman when partner shows hearts and responder has no heart fit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:2", "spades:3", "hearts:J", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("2spades");
  });

  it("raises responder's alternate major with a fit after Stayman", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const overcaller = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2spades" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("3spades");
  });

  it("places game after the 1NT overcaller raises responder's alternate major", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:J", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2spades" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "3spades" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("4spades");
  });

  it("shows no spade fit after responder's alternate-major Stayman continuation", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("spades:A", "spades:K", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2spades" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("2notrump");
  });

  it("places 3NT with a balanced game hand after the overcaller denies a spade fit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:J", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "1notrump" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2spades" as const },
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "2notrump" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "west")).toBe("3notrump");
  });

  it("requires 10+ HCP for a two-level overcall and shows a five-card suit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const overcaller = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "diamonds:K", "diamonds:2", "diamonds:3", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1spades" }], "east")).toBe("2clubs");
  });

  it("makes a preemptive jump overcall with a six-card major and weak-two values", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "hearts:2", "spades:2", "spades:3", "spades:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1diamonds" }], "east")).toBe("2hearts");
  });

  it("makes a preemptive jump overcall with a seven-card minor", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const overcaller = hand("clubs:A", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1spades" }], "east")).toBe("3clubs");
  });

  it("uses a minor cuebid to show both majors with 8+ HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:2", "spades:3", "spades:4", "spades:5", "diamonds:2", "diamonds:3", "clubs:2");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1diamonds" }], "east")).toBe("2diamonds");
  });

  it("uses a major cuebid to show the other major and a minor with 10+ HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const overcaller = hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "clubs:A", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "hearts:2", "hearts:3", "diamonds:2");
    expect(await bot.chooseBid(overcaller, [{ seat: "north", bid: "1hearts" }], "east")).toBe("2hearts");
  });

  it("shows its longer minor after partner asks with 2NT over a major Michaels cue-bid", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("clubs:A", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "diamonds:A", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "hearts:2", "spades:2", "spades:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2notrump" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("3clubs");
  });

  it("passes a direct overcall with fewer than five cards in every suit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const balanced = hand("spades:A", "spades:2", "spades:3", "spades:4", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(balanced, [{ seat: "north", bid: "1clubs" }], "east")).toBe("pass");
  });

  it("makes a takeout double with opening strength, shortness, and support for the unbid suits", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const doubler = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "spades:2");
    expect(await bot.chooseBid(doubler, [{ seat: "north", bid: "1spades" }], "east")).toBe("double");
  });

  it("makes a balancing takeout double with 10+ total points after two passes", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const doubler = hand("hearts:K", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "spades:2");
    const auction = [
      { seat: "north", bid: "1spades" as const },
      { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(doubler, auction, "west")).toBe("double");
  });

  it("does not make a balancing takeout double below 10 total points", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const weak = hand("hearts:K", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4", "spades:2");
    const auction = [
      { seat: "north", bid: "1spades" as const },
      { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(weak, auction, "west")).toBe("pass");
  });

  it("advances a balancing takeout double in a four-card major after opener passes", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("hearts:A", "hearts:Q", "hearts:2", "hearts:3", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const },
      { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "pass" as const },
      { seat: "west", bid: "double" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "east")).toBe("2hearts");
  });

  it("makes a takeout double of a minor opening with four-card support for both majors", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const doubler = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:A", "spades:2", "spades:3", "spades:4", "clubs:K", "clubs:2", "clubs:3", "diamonds:2", "diamonds:3");
    expect(await bot.chooseBid(doubler, [{ seat: "north", bid: "1diamonds" }], "east")).toBe("double");
  });

  it("does not make a takeout double when an unbid major has fewer than four cards", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const unsuitable = hand("hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:A", "clubs:K", "clubs:2", "clubs:3", "spades:2", "spades:3");
    expect(await bot.chooseBid(unsuitable, [{ seat: "north", bid: "1spades" }], "east")).toBe("pass");
  });

  it("advances partner's takeout double in a four-card major with a minimum hand", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:J", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("1hearts");
  });

  it("jumps in a four-card major with 9-11 HCP after partner's takeout double", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("hearts:A", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2hearts");
  });

  it("responds notrump to partner's takeout double with a balanced hand and stopper", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("clubs:K", "clubs:2", "clubs:3", "hearts:2", "hearts:3", "hearts:4", "diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "spades:K", "spades:2", "spades:3");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("1notrump");
  });

  it("cue-bids opener's suit with 12+ HCP after partner's takeout double", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "double" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2diamonds");
  });

  it("competes naturally in a major after opener's partner raises over a takeout double", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:K", "spades:Q", "spades:2", "spades:3", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2spades");
  });

  it("passes a very weak hand when opener's partner raises over a takeout double", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("spades:K", "spades:2", "spades:3", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("pass");
  });

  it("cue-bids the raised opening suit with a strong hand after partner's takeout double", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("3clubs");
  });

  it("raises a minimum suit advance after a takeout double with medium support points", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const doubler = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "1hearts" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(doubler, auction, "east")).toBe("2hearts");
  });

  it("jump-raises a minimum suit advance after a maximum takeout double", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const doubler = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "diamonds:2", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "1hearts" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(doubler, auction, "east")).toBe("3hearts");
  });

  it("passes with a minimum takeout double after advancer's jump response", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const doubler = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2hearts" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(doubler, auction, "east")).toBe("pass");
  });

  it("accepts game after advancer's jump response when the takeout doubler has extras", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const doubler = hand("hearts:A", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:2", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2hearts" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(doubler, auction, "east")).toBe("4hearts");
  });

  it("names a preferred major after advancer's strong cuebid of the opening suit", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const doubler = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:K", "spades:Q", "spades:2", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(doubler, auction, "east")).toBe("2hearts");
  });

  it("bids notrump with a stopper after a strong cuebid when it has no four-card major", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const doubler = hand("hearts:A", "hearts:K", "hearts:2", "spades:Q", "spades:J", "spades:2", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "double" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2hearts" as const },
      { seat: "north", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(doubler, auction, "east")).toBe("3notrump");
  });

  it("raises partner's one-level overcall with three-card support and 6-10 HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("hearts:K", "hearts:Q", "hearts:2", "spades:J", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2hearts");
  });

  it("raises partner's two-level overcall to the three level with three-card support", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("clubs:K", "clubs:Q", "clubs:J", "spades:A", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2clubs" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("3clubs");
  });

  it("does not raise partner's overcall without three-card support", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("hearts:K", "hearts:Q", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("pass");
  });

  it("cue-bids opener's suit with a strong three-card raise after a one-level overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("hearts:A", "hearts:K", "hearts:2", "spades:Q", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2clubs");
  });

  it("cue-bids at the two level when opener's suit ranks above partner's two-level overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("clubs:A", "clubs:K", "clubs:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "spades:2", "spades:3", "spades:4", "spades:5");
    const auction = [{ seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2clubs" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2spades");
  });

  it("counts a singleton as support points for a simple competitive raise", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("hearts:K", "hearts:Q", "hearts:2", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2hearts");
  });

  it("cue-bids when distribution lifts a three-card raise to 11 support points", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("hearts:K", "hearts:Q", "hearts:2", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [{ seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }, { seat: "south", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2clubs");
  });

  it("repeats a minimum overcall after partner's strong-raise cuebid", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "spades:2", "spades:3", "spades:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("2hearts");
  });

  it("accepts game after partner's strong-raise cuebid with 15+ HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const overcaller = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "spades:K", "spades:2", "spades:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("4hearts");
  });

  it("returns to the overcalled suit with a minimum after partner's strong-raise cuebid", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "spades:Q", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2clubs" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("2hearts");
  });

  it("passes a simple raise of a one-level overcall with a minimum", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "spades:2", "spades:3", "spades:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("pass");
  });

  it("bids game after a simple raise of an overcall with 16+ HCP", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const overcaller = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "spades:2", "spades:3", "spades:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("4hearts");
  });

  it("rebids a minimum two-level overcall above a partner's cuebid", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const overcaller = hand("clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4", "spades:K", "spades:2", "spades:3", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "2clubs" as const },
      { seat: "south", bid: "pass" as const }, { seat: "west", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(overcaller, auction, "east")).toBe("3clubs");
  });

  it("advances partner's one-level overcall with natural 1NT on a balanced hand and stopper", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("clubs:A", "clubs:2", "clubs:3", "clubs:4", "hearts:2", "hearts:3", "diamonds:J", "diamonds:2", "diamonds:3", "spades:K", "spades:2", "spades:3", "spades:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }, { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("1notrump");
  });

  it("does not advance partner's one-level overcall in notrump without an opening-suit stopper", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "spades:K", "spades:Q", "spades:2", "spades:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }, { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("pass");
  });

  it("shows a five-card new suit at the one level with 6+ HCP after partner's overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advancer = hand("spades:A", "spades:K", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "1hearts" as const }, { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("1spades");
  });

  it("shows a five-card new suit at the two level with 11+ HCP after partner's overcall", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const advancer = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "spades:2", "spades:3", "spades:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "2clubs" as const }, { seat: "south", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(advancer, auction, "west")).toBe("2hearts");
  });

  it("selects only a card in hand and follows suit when able", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const cards = hand("spades:2", "hearts:A", "hearts:3");
    const choice = await bot.chooseCard({ seat: "east", hand: cards, currentTrick: [{ seat: "north", card: { suit: "hearts", rank: "2" } }], ledSuit: "hearts" });
    expect(cards).toContainEqual(choice);
    expect(choice.suit).toBe("hearts");
  });

  it("can discard when void in the led suit", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "2/1" });
    const cards = hand("spades:2", "clubs:A");
    const choice = await bot.chooseCard({ seat: "east", hand: cards, currentTrick: [{ seat: "north", card: { suit: "hearts", rank: "2" } }], ledSuit: "hearts" });
    expect(cards).toContainEqual(choice);
  });

  it("plays the top touching honor third hand when partner is winning", async () => {
    const intermediate = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const advanced = createBot({ skill: "advanced", biddingStyle: "SAYC" });
    const cards = hand("hearts:K", "hearts:Q", "hearts:2");
    const context = {
      seat: "south" as const,
      hand: cards,
      currentTrick: [
        { seat: "north" as const, card: { suit: "hearts" as const, rank: "4" as const } },
        { seat: "east" as const, card: { suit: "hearts" as const, rank: "3" as const } }
      ],
      ledSuit: "hearts" as const
    };
    expect(await intermediate.chooseCard(context)).toEqual({ suit: "hearts", rank: "2" });
    expect(await advanced.chooseCard(context)).toEqual({ suit: "hearts", rank: "K" });
  });

  it("plays third hand high when it has no touching honor sequence", async () => {
    const advanced = createBot({ skill: "advanced", biddingStyle: "2/1" });
    const cards = hand("hearts:A", "hearts:Q", "hearts:2");
    const choice = await advanced.chooseCard({
      seat: "south",
      hand: cards,
      currentTrick: [
        { seat: "north", card: { suit: "hearts", rank: "4" } },
        { seat: "east", card: { suit: "hearts", rank: "3" } }
      ],
      ledSuit: "hearts"
    });
    expect(choice).toEqual({ suit: "hearts", rank: "A" });
  });

  it("delegates Advanced bidding to Intermediate with the selected convention", async () => {
    const advanced = createBot({ skill: "advanced", biddingStyle: "2/1" });
    const weakTwo = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:9", "hearts:8", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await advanced.chooseBid(weakTwo, [], "north")).toBe("2hearts");
  });

  it("lets an intermediate bot win with its cheapest card when partner is not winning", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const cards = hand("hearts:3", "hearts:Q", "hearts:A");
    const choice = await bot.chooseCard({
      seat: "south",
      hand: cards,
      currentTrick: [
        { seat: "north", card: { suit: "hearts", rank: "2" } },
        { seat: "east", card: { suit: "hearts", rank: "9" } }
      ],
      ledSuit: "hearts"
    });
    expect(choice).toEqual({ suit: "hearts", rank: "Q" });
  });

  it("plays low as second hand instead of overtaking an opponent's lead", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const cards = hand("hearts:3", "hearts:Q", "hearts:A");
    const choice = await bot.chooseCard({
      seat: "east",
      hand: cards,
      currentTrick: [{ seat: "north", card: { suit: "hearts", rank: "9" } }],
      ledSuit: "hearts"
    });
    expect(choice).toEqual({ suit: "hearts", rank: "3" });
  });

  it.each(["intermediate", "advanced", "expert"] as const)("covers a led honor with the cheapest higher honor in second hand for %s", async (skill) => {
    const bot = createBot({ skill, biddingStyle: "SAYC" });
    const cards = hand("hearts:K", "hearts:A", "hearts:3");
    const choice = await bot.chooseCard({
      seat: "east",
      hand: cards,
      currentTrick: [{ seat: "north", card: { suit: "hearts", rank: "Q" } }],
      ledSuit: "hearts"
    });
    expect(choice).toEqual({ suit: "hearts", rank: "K" });
  });

  it("does not cover partner's led honor in second hand", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const cards = hand("hearts:K", "hearts:A", "hearts:3");
    const choice = await bot.chooseCard({
      seat: "north",
      hand: cards,
      currentTrick: [{ seat: "south", card: { suit: "hearts", rank: "Q" } }],
      ledSuit: "hearts"
    });
    expect(choice).toEqual({ suit: "hearts", rank: "3" });
  });

  it("conserves high cards when partner is already winning", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "2/1" });
    const cards = hand("hearts:3", "hearts:A");
    const choice = await bot.chooseCard({
      seat: "south",
      hand: cards,
      currentTrick: [
        { seat: "north", card: { suit: "hearts", rank: "K" } },
        { seat: "east", card: { suit: "hearts", rank: "2" } }
      ],
      ledSuit: "hearts"
    });
    expect(choice).toEqual({ suit: "hearts", rank: "3" });
  });

  it("leads the top honor from a touching sequence", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const cards = hand("hearts:K", "hearts:Q", "hearts:3", "clubs:2");
    const choice = await bot.chooseCard({ seat: "south", hand: cards, currentTrick: [] });
    expect(choice).toEqual({ suit: "hearts", rank: "K" });
  });

  it("leads fourth-highest from the longest suit when no honor sequence applies", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    const cards = hand("hearts:A", "hearts:8", "hearts:6", "hearts:4", "hearts:2", "spades:K", "spades:10", "spades:3", "clubs:5", "diamonds:7", "diamonds:3", "clubs:2", "diamonds:2");
    const choice = await bot.chooseCard({ seat: "south", hand: cards, currentTrick: [] });
    expect(choice).toEqual({ suit: "hearts", rank: "4" });
  });

  it("does not underlead an ace on an Expert opening lead against a suit contract", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const cards = hand("spades:A", "spades:8", "spades:6", "spades:4", "spades:2", "hearts:K", "hearts:3", "diamonds:Q", "diamonds:2", "clubs:K", "clubs:3", "clubs:2", "clubs:4");
    const choice = await bot.chooseCard({ seat: "south", hand: cards, currentTrick: [], trump: "hearts" });
    expect(choice).toEqual({ suit: "spades", rank: "A" });
  });

  it("keeps the fourth-highest lead against notrump even when holding the ace", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const cards = hand("spades:A", "spades:8", "spades:6", "spades:4", "spades:2", "hearts:K", "hearts:3", "diamonds:Q", "diamonds:2", "clubs:K", "clubs:3", "clubs:2", "clubs:4");
    const choice = await bot.chooseCard({ seat: "south", hand: cards, currentTrick: [] });
    expect(choice).toEqual({ suit: "spades", rank: "4" });
  });

  it("uses Reverse Drury with a passed-hand limit raise after a third-seat major opening", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "north")).toBe("2clubs");
  });

  it("uses a Lebensohl relay for a weak long-club hand after a natural 2-level overcall of 1NT", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("completes the Lebensohl relay with 3 clubs", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:2", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3clubs");
  });

  it("relays with a weak diamond suit below a natural 2-heart overcall", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("shows a weak diamond suit below a natural 2-spade overcall after the relay", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2spades" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3diamonds");
  });

  it("uses the relay before an invitational suit above the overcall", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:T", "spades:8", "spades:7", "hearts:K", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
    const afterRelay = [
      ...auction, { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, afterRelay, "south")).toBe("3spades");
  });

  it("shows a heart stopper by relaying before bidding 3NT", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
    const afterRelay = [
      ...auction, { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, afterRelay, "south")).toBe("3notrump");
  });

  it("bids 3NT directly without a stopper in the overcalled suit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:2", "hearts:2", "hearts:3", "hearts:4", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("makes a direct three-level new-suit response game-forcing after 1NT interference", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:J", "hearts:8", "hearts:7", "spades:Q", "spades:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it("raises a direct game-forcing suit with three-card support", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:J", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2diamonds" as const },
      { seat: "south", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4hearts");
  });

  it("places a direct game-forcing new-suit response in 3NT without a fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:2", "hearts:3", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2diamonds" as const },
      { seat: "south", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("uses a direct cue-bid as Stayman without a stopper in the overcalled suit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:2", "hearts:3", "hearts:4", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
  });

  it("shows a four-card spade suit after responder's Lebensohl Stayman cue-bid", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:K", "hearts:Q", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3spades");
  });

  it("places spade game after Stayman finds a four-card fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:2", "hearts:3", "hearts:4", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4spades");
  });

  it("uses the relay before a Stayman cue-bid when responder has the overcalled-suit stopper", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:K", "hearts:Q", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
    const afterRelay = [
      ...auction, { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, afterRelay, "south")).toBe("3hearts");
    const afterCue = [
      ...afterRelay, { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, afterCue, "north")).toBe("3spades");
    const afterSpadeReply = [
      ...afterCue, { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, afterSpadeReply, "south")).toBe("4spades");
  });

  it("signs off in the major after a Reverse Drury response with a minimum", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "south")).toBe("2spades");
  });

  it("shows a sound major opening after Reverse Drury", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:A", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "south")).toBe("2diamonds");
  });

  it("accepts the sound opening at game with a maximum passed-hand raise", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "north")).toBe("4spades");
  });

  it("invites in the major with a minimum passed-hand raise after Reverse Drury", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:Q", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "north")).toBe("3spades");
  });

  it("accepts a passed-hand major invitation with a sound opener", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:K", "hearts:Q", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "south")).toBe("4spades");
  });

  it("uses Gerber with a balanced 19-HCP hand over a 1NT opening", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1notrump" }], "south")).toBe("4clubs");
  });

  it("uses the unbid minor as a forcing ask after an uncontested minor opening and major response", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2diamonds");
  });

  it("uses 2 clubs as the forcing ask after a diamond opening", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:Q", "spades:J", "diamonds:2", "diamonds:3", "clubs:4", "clubs:5", "clubs:6", "clubs:7");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2clubs");
  });

  it("keeps the existing Expert SAYC checkback call after a club opening", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2clubs");
  });

  it("does not use the forcing ask below invitational strength", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:8", "spades:2", "hearts:Q", "hearts:4", "hearts:3", "diamonds:J", "diamonds:4", "diamonds:3", "clubs:4", "clubs:2");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("2diamonds");
  });

  it.each([
    ["three-card major support", hand("spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3"), "2spades"],
    ["a four-card side major", hand("spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4"), "2hearts"],
    ["neither major", hand("spades:K", "spades:Q", "hearts:K", "hearts:Q", "diamonds:J", "diamonds:4", "diamonds:3", "diamonds:2", "clubs:J", "clubs:4", "clubs:3", "clubs:2", "clubs:5"), "2notrump"]
  ] as const)("answers the forcing ask by showing %s", async (_shape, opener, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it.each([
    ["13 HCP and an eight-card fit", hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:8", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4"), "4spades"],
    ["10 HCP and a seven-card fit", hand("spades:K", "spades:Q", "spades:J", "spades:8", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3"), "pass"]
  ] as const)("responds after the forcing ask shows spade support with %s", async (_strength, responder, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("places game in a four-card side-major fit found by the forcing ask", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it.each([
    ["10 HCP", hand("spades:K", "spades:8", "spades:4", "spades:3", "spades:2", "hearts:K", "hearts:3", "diamonds:Q", "diamonds:3", "diamonds:2", "clubs:Q", "clubs:3", "clubs:2"), "pass"],
    ["13 HCP", hand("spades:K", "spades:Q", "spades:J", "spades:3", "spades:2", "hearts:K", "hearts:3", "diamonds:Q", "diamonds:3", "diamonds:2", "clubs:Q", "clubs:3", "clubs:2"), "3notrump"]
  ] as const)("places notrump after the forcing ask denies both majors with %s", async (_strength, responder, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("does not use New Minor Forcing after an opponent intervenes", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "2hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("2diamonds");
  });

  it.each([
    [14, "4spades", hand("spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3")],
    [13, "pass", hand("spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:2", "hearts:3", "hearts:4", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:2", "clubs:3")]
  ] as const)("accepts a forcing-ask fit invitation with the opener's right strength (%i HCP)", async (_hcp, expected, opener) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "1clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("uses a splinter raise with four-card support and shortness over a major opening", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "clubs:K", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).toBe("3clubs");
  });

  it("shows a short major splinter after a 1-spade opening", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:K", "clubs:A", "clubs:K", "clubs:2", "clubs:3", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1spades" }], "south")).toBe("4hearts");
  });

  it("asks for aces with 4NT after Jacoby shortness with a strong responder", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it("asks for aces after opener accepts an expert splinter with game", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:J", "hearts:2", "hearts:3", "spades:A", "spades:K", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it("uses the Grand Slam Force after opener accepts a splinter with game", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:A", "spades:K", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "clubs:2");
    const minimumResponder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:2", "spades:3", "spades:4", "spades:5", "spades:6", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
    expect(await bot.chooseBid(minimumResponder, auction, "south")).not.toBe("5notrump");
  });

  it("does not treat a natural 1S-3H response as a splinter", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:A", "diamonds:2", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("5notrump");
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4notrump");

    const naturalJumpBlackwoodAuction = [
      ...auction,
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    // Holding all four aces between the hands and 35 points, the king ask is natural Blackwood, not a splinter follow-up.
    expect(await bot.chooseBid(responder, naturalJumpBlackwoodAuction, "south")).toBe("5notrump");
  });

  it.each([
    ["hearts:A", "hearts:K", "7hearts"],
    ["hearts:Q", "hearts:J", "6hearts"]
  ] as const)("answers a splinter Grand Slam Force with %s and %s", async (firstHonor, secondHonor, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand(firstHonor, secondHonor, "hearts:2", "hearts:3", "spades:A", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("answers ace-asking after accepting a splinter", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:Q", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("5hearts");
  });

  it("places a splinter slam when three aces are known", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("6hearts");
  });

  it("uses Blackwood after a 2/1 game force establishes a major fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it("uses Blackwood after a 2/1 game force establishes a minor fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it("uses Blackwood after a diamond fit is raised in a 2/1 game force", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6", "clubs:A");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it("does not treat a same-major raise as a direct 2/1 minor fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4notrump");
  });

  it("asks for kings and places a minor grand slam after all aces and kings are known", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:A", "diamonds:2", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
    const afterKingAsk = [...auction, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    const opener = hand("spades:K", "spades:Q", "spades:2", "hearts:Q", "hearts:3", "hearts:4", "diamonds:K", "diamonds:Q", "diamonds:3", "clubs:A", "clubs:Q", "clubs:7", "clubs:6");
    expect(await bot.chooseBid(opener, afterKingAsk, "north")).toBe("6hearts");
    const afterKingAnswer = [...afterKingAsk, { seat: "north", bid: "6hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterKingAnswer, "south")).toBe("7clubs");
  });

  it("settles in 6NT when the king reply has gone past the minor small slam", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:J", "spades:2", "hearts:A", "hearts:Q", "hearts:2", "diamonds:Q", "diamonds:3", "clubs:K", "clubs:Q", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "6hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("6notrump");
  });

  it("passes at five clubs when Blackwood reveals too few aces for slam", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:2", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("uses Blackwood after a side-major fit is found in a 2/1 game force", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "hearts:A", "hearts:K", "hearts:Q", "hearts:J", "diamonds:K", "diamonds:Q", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const opener = hand("spades:Q", "spades:J", "spades:10", "spades:9", "spades:8", "hearts:2", "hearts:3", "hearts:4", "diamonds:A", "diamonds:J", "diamonds:6", "diamonds:7", "clubs:A", "clubs:6");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
    const afterAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterAsk, "north")).toBe("5hearts");
    const afterAceAnswer = [...afterAsk, { seat: "north", bid: "5hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterAceAnswer, "south")).toBe("5notrump");
    const afterKingAsk = [...afterAceAnswer, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterKingAsk, "north")).toBe("6clubs");
    const afterKingAnswer = [...afterKingAsk, { seat: "north", bid: "6clubs" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterKingAnswer, "south")).toBe("7hearts");
  });

  it("asks the Grand Slam Force after Jacoby game with two top trump honors", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
  });

  it("asks the Grand Slam Force after a 2/1 major fit reaches game", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:K", "diamonds:2", "clubs:A", "clubs:K", "clubs:Q", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("5notrump");
  });

  it("does not use the 2/1 Grand Slam Force in SAYC or below 18 HCP", async () => {
    const saycBot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const twoOverOneBot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const strongOpener = hand("hearts:A", "hearts:K", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:K", "diamonds:2", "clubs:A", "clubs:K", "clubs:Q", "clubs:3", "clubs:4");
    const minimumOpener = hand("hearts:A", "hearts:K", "hearts:2", "spades:A", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await saycBot.chooseBid(strongOpener, auction, "north")).not.toBe("5notrump");
    expect(await twoOverOneBot.chooseBid(minimumOpener, auction, "north")).not.toBe("5notrump");
  });

  it.each([
    ["hearts:A", "hearts:K", "7hearts"],
    ["hearts:Q", "hearts:J", "6hearts"]
  ] as const)("answers a 2/1 Grand Slam Force with %s and %s", async (firstHonor, secondHonor, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand(firstHonor, secondHonor, "hearts:2", "hearts:3", "spades:A", "spades:2", "spades:3", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it("keeps the 2/1 Grand Slam Force separate from the Blackwood king ask", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
  });

  it.each([
    ["hearts:A", "hearts:K", "7hearts"],
    ["hearts:Q", "hearts:J", "6hearts"]
  ] as const)("answers the Grand Slam Force with %s and %s", async (firstHonor, secondHonor, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand(firstHonor, secondHonor, "hearts:2", "hearts:3", "spades:Q", "spades:2", "spades:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:Q", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("answers Blackwood after a 2/1 game-forcing major raise", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:2", "spades:3", "hearts:A", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("5hearts");
  });

  it("uses Blackwood after a 2/1 side-major rebid is raised to game", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "hearts:2", "hearts:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "diamonds:8", "diamonds:2", "spades:2", "spades:3", "spades:4", "spades:5", "clubs:A", "clubs:4", "clubs:5");
    const afterAsk = [...auction, { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterAsk, "north")).toBe("5hearts");
    const afterAnswer = [...afterAsk, { seat: "north", bid: "5hearts" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterAnswer, "south")).toBe("5notrump");
    const afterKingAsk = [...afterAnswer, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(opener, afterKingAsk, "north")).toBe("6diamonds");
    const afterKingAnswer = [...afterKingAsk, { seat: "north", bid: "6diamonds" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(responder, afterKingAnswer, "south")).toBe("6spades");
  });

  it("does not use the 2/1 Blackwood route after responder has passed", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "spades:J", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:T", "hearts:2", "hearts:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "north")).not.toBe("4notrump");
  });

  it("does not use minor-fit Blackwood after responder has passed", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5", "clubs:6");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1spades" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "north")).not.toBe("4notrump");
  });

  it("does not use side-major Blackwood after responder has passed", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:K", "spades:Q", "spades:J", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "pass" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "1hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2diamonds" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "north")).not.toBe("4notrump");
  });

  it("places a 2/1 slam when the Blackwood response confirms three aces", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("6hearts");
  });

  it("uses Expert Blackwood after a SAYC strong jump shift finds a major fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "spades:A", "spades:K", "spades:Q", "diamonds:K", "diamonds:Q", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it("uses the Expert Grand Slam Force before Blackwood after a SAYC jump-shift major fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
  });

  it.each([
    ["hearts:A", "hearts:K", "7hearts"],
    ["hearts:Q", "hearts:J", "6hearts"]
  ] as const)("answers the SAYC jump-shift Grand Slam Force with %s and %s", async (firstHonor, secondHonor, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand(firstHonor, secondHonor, "hearts:2", "spades:K", "spades:Q", "spades:J", "diamonds:A", "diamonds:Q", "diamonds:5", "diamonds:6", "clubs:Q", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("answers and places Blackwood after a SAYC strong jump-shift major fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("hearts:2", "hearts:3", "hearts:4", "spades:J", "spades:T", "spades:9", "diamonds:A", "diamonds:J", "diamonds:T", "diamonds:6", "clubs:Q", "clubs:J", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("5diamonds");
    const afterAnswer = [...auction, { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(hand("hearts:A", "hearts:T", "hearts:9", "hearts:8", "hearts:7", "spades:A", "spades:K", "spades:Q", "diamonds:K", "diamonds:Q", "clubs:K", "clubs:2", "clubs:3"), afterAnswer, "south")).toBe("6hearts");
  });

  it("asks for kings after a SAYC jump-shift Blackwood response confirms all four aces", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "spades:A", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
    const kingAsk = [...auction, { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }] as const;
    expect(await bot.chooseBid(hand("hearts:2", "hearts:3", "hearts:4", "spades:K", "spades:Q", "spades:J", "diamonds:A", "diamonds:Q", "diamonds:5", "diamonds:6", "clubs:Q", "clubs:4", "clubs:5"), kingAsk, "north")).toBe("6diamonds");
  });

  it("does not treat a SAYC strong jump shift without a confirmed major fit as Blackwood", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:T", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4notrump");
  });

  it("asks for kings after Blackwood confirms all four aces", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
  });

  it("does not ask for kings when the 5-club ace response is ambiguous", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5clubs" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("6hearts");
  });

  it.each(["Jacoby shortness", "accepted splinter"] as const)("asks for kings after an all-ace %s auction", async (auctionType) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    const jacobyAuction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    const splinterAuction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auctionType === "Jacoby shortness" ? jacobyAuction : splinterAuction, "south")).toBe("5notrump");
  });

  it("answers a Blackwood king ask with one king", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:Q", "spades:2", "spades:3", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("6diamonds");
  });

  it("places a grand slam only when Blackwood king count confirms all four kings", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:K", "spades:2", "diamonds:A", "diamonds:K", "diamonds:2", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2hearts" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "5notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "6notrump" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("7hearts");
  });

  it("answers ace-asking after Jacoby shortness", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:Q", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("5hearts");
  });

  it("uses the ambiguous 5 clubs response for zero aces", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:K", "spades:Q", "spades:J", "spades:2", "diamonds:K", "diamonds:Q", "diamonds:J", "diamonds:2", "clubs:K");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("5clubs");
  });

  it("asks for kings when Jacoby Blackwood confirms all four aces", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "spades:A", "spades:K", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "3clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4notrump" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "5hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("5notrump");
  });

  it("does not splinter a three-card major fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:2", "clubs:K", "spades:A", "spades:K", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "diamonds:4", "diamonds:5", "diamonds:6");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1hearts" }], "south")).not.toBe("3clubs");
  });

  it.each([
    ["1hearts", "3clubs", "4hearts", ["hearts:A", "hearts:K", "hearts:2", "hearts:3", "spades:Q", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4"]],
    ["1spades", "4hearts", "4spades", ["spades:A", "spades:K", "spades:Q", "spades:J", "hearts:A", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3"]]
  ] as const)("completes game after partner's splinter raise", async (openingBid, splinterBid, expected, cards) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: openingBid }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: splinterBid }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(hand(...cards), auction, "north")).toBe(expected);
  });

  it.each([
    ["hearts", "4diamonds"],
    ["spades", "4hearts"]
  ] as const)("uses Texas to transfer a six-card %s suit to game in Expert", async (major, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = major === "hearts"
      ? hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4")
      : hand("spades:K", "spades:Q", "spades:2", "spades:3", "spades:4", "spades:5", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe(expected);
  });

  it("prefers the spade Texas transfer when both majors are six cards long", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:2", "spades:3", "spades:4", "spades:5", "spades:6", "spades:7", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "hearts:6", "hearts:7", "clubs:2");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("4hearts");
  });

  it.each([
    ["4diamonds", "4hearts"],
    ["4hearts", "4spades"]
  ] as const)("accepts the Expert Texas transfer %s with %s", async (transfer, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: transfer as "4diamonds" },
    ] as const;
    expect(await bot.chooseBid(hand(), auction, "north")).toBe(expected);
  });

  it("passes after opener accepts an Expert Texas transfer", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "4diamonds" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "4hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("keeps existing Jacoby transfers for five-card majors and slam values", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("3diamonds");
  });

  it("does not use a Texas transfer after interference over 2NT", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "3clubs" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("4diamonds");
  });

  it.each([
    ["hearts", "4diamonds"],
    ["spades", "4hearts"]
  ] as const)("uses Texas over 1NT for a six-card %s suit with 8–9 HCP", async (major, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = major === "hearts"
      ? hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:2", "spades:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4")
      : hand("spades:A", "spades:K", "spades:Q", "spades:2", "spades:3", "spades:4", "hearts:2", "hearts:3", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1notrump" }], "south")).toBe(expected);
  });

  it.each([
    ["4diamonds", "4hearts"],
    ["4hearts", "4spades"]
  ] as const)("accepts a Texas transfer over 1NT with %s", async (transfer, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "south", bid: transfer as "4diamonds" },
    ] as const;
    expect(await bot.chooseBid(hand(), auction, "north")).toBe(expected);
  });

  it("keeps the Jacoby transfer route for slam values over 1NT", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "spades:A", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "1notrump" }], "south")).toBe("2diamonds");
  });

  it("uses Puppet Stayman over 2NT with three-card support for a possible five-card major", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:Q", "spades:6", "spades:4", "hearts:8", "hearts:7", "diamonds:A", "diamonds:9", "diamonds:4", "diamonds:2", "clubs:Q", "clubs:5", "clubs:3", "clubs:2");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("3clubs");
  });

  it.each([
    ["hearts", "3hearts"],
    ["spades", "3spades"]
  ] as const)("shows a five-card %s major to Expert Puppet Stayman", async (major, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = major === "hearts"
      ? hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:2", "spades:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2", "clubs:3")
      : hand("spades:A", "spades:K", "spades:Q", "spades:J", "spades:2", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("shows four-card major holdings with 3 diamonds in response to Puppet Stayman", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:2", "spades:A", "spades:K", "spades:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3diamonds");
  });

  it("denies four- and five-card majors with 3NT over Puppet Stayman", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:2", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:2", "hearts:K", "hearts:2", "spades:Q", "spades:2", "spades:3");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3notrump");
  });

  it("places game in a five-card major when Puppet Stayman finds a three-card fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("hearts:Q", "hearts:8", "hearts:7", "spades:K", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4hearts");
  });

  it("chooses notrump when the five-card major doesn't fit responder", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:2", "hearts:3", "spades:A", "spades:K", "spades:Q", "spades:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("shows a four-card major through Puppet Stayman and accepts a discovered fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:Q", "spades:7", "spades:4", "hearts:8", "hearts:7", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3diamonds" as const },
      { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3hearts");
    const fitAuction = [...auction, { seat: "south" as const, bid: "3hearts" as const }, { seat: "west" as const, bid: "pass" as const }] as const;
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(opener, fitAuction, "north")).toBe("4spades");
  });

  it("lets opener choose between four-card major fits after Puppet Stayman", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:2", "hearts:A", "hearts:K", "hearts:Q", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3diamonds" as const },
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "4diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("4spades");
  });

  it("transfers to a six-card major after Puppet Stayman denies an opener fit", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:K", "spades:Q", "spades:2", "spades:3", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3notrump" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4diamonds");
  });

  it("accepts a Texas transfer after Puppet Stayman denial", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3notrump" as const },
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "4diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(hand(), auction, "north")).toBe("4hearts");
  });

  it("passes after opener accepts a Texas transfer following Puppet Stayman", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const responder = hand("hearts:K", "hearts:Q", "hearts:2", "hearts:3", "hearts:4", "hearts:5", "spades:K", "spades:Q", "spades:2", "spades:3", "diamonds:2", "clubs:2", "clubs:3");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "south", bid: "3clubs" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "3notrump" as const },
      { seat: "east", bid: "pass" as const }, { seat: "south", bid: "4diamonds" as const },
      { seat: "west", bid: "pass" as const }, { seat: "north", bid: "4hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("pass");
  });

  it("does not use Puppet Stayman after interference over 2NT", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:Q", "spades:6", "spades:4", "hearts:8", "hearts:7", "diamonds:A", "diamonds:9", "diamonds:4", "diamonds:2", "clubs:Q", "clubs:5", "clubs:3", "clubs:2");
    const auction = [
      { seat: "north", bid: "2notrump" as const }, { seat: "east", bid: "3diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).not.toBe("3clubs");
  });

  it("uses Gerber instead of a quantitative invitation with 16 HCP over a 2NT opening", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("4clubs");
  });

  it.each([
    [["spades:K", "spades:J", "spades:2", "hearts:K", "hearts:J", "hearts:2", "diamonds:K", "diamonds:J", "diamonds:2", "clubs:K", "clubs:2", "clubs:3", "clubs:4"], "4diamonds"],
    [["spades:A", "spades:J", "spades:2", "hearts:K", "hearts:J", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4"], "4hearts"],
    [["spades:A", "spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "diamonds:K", "diamonds:J", "diamonds:2", "clubs:K", "clubs:2", "clubs:3", "clubs:4"], "4spades"],
    [["spades:A", "spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4"], "4notrump"],
    [["spades:A", "spades:2", "spades:3", "hearts:A", "hearts:2", "hearts:3", "diamonds:A", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2", "clubs:3", "clubs:4"], "4diamonds"]
  ] as const)("answers Gerber with %s for that ace count", async (cards, expected) => {
    const bot = createBot({ skill: "expert", biddingStyle: "SAYC" });
    const opener = hand(...cards);
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it("places 6NT when its hand and a Gerber reply confirm at least three aces", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4hearts" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("6notrump");
  });

  it("stops in 4NT on an ambiguous 0-or-4 ace reply without three known aces", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:K", "spades:Q", "hearts:A", "hearts:K", "hearts:2", "diamonds:K", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "4clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "4diamonds" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("4notrump");
  });

  it("keeps the quantitative 4NT invitation after a 2NT opening below the Gerber range", async () => {
    const bot = createBot({ skill: "expert", biddingStyle: "2/1" });
    const responder = hand("spades:A", "spades:2", "spades:3", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    expect(await bot.chooseBid(responder, [{ seat: "north", bid: "2notrump" }], "south")).toBe("4notrump");
  });
});

  it("rebids a natural five-card diamond suit after SAYC 1 diamond–2 clubs", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:8", "diamonds:4", "spades:A", "spades:3", "hearts:K", "hearts:4", "clubs:Q", "clubs:8", "clubs:5", "clubs:2");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2diamonds");
  });

  it("raises opener’s natural diamond rebid with four-card support and 10+ HCP", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:8", "diamonds:A", "diamonds:K", "diamonds:7", "diamonds:4", "spades:3", "spades:4", "hearts:5", "hearts:6", "hearts:7");
    const auction = [
      { seat: "north", bid: "1diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3diamonds");
  });

  it("shows a natural four-card diamond suit after SAYC 1 heart–2 clubs", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:8", "hearts:7", "hearts:6", "diamonds:A", "diamonds:Q", "diamonds:8", "diamonds:4", "spades:K", "spades:3", "clubs:Q", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("2diamonds");
  });

  it("does not invent a second suit after SAYC 1 heart–2 clubs", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:K", "hearts:8", "hearts:7", "hearts:6", "diamonds:Q", "diamonds:8", "diamonds:4", "spades:K", "spades:3", "clubs:Q", "clubs:8", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).not.toBe("2diamonds");
  });

  it("finds a spade fit after SAYC 1 heart–2 clubs–2 diamonds", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:J", "spades:T", "hearts:K", "hearts:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const opener = hand("hearts:Q", "hearts:J", "hearts:T", "hearts:3", "hearts:4", "diamonds:A", "diamonds:K", "diamonds:Q", "diamonds:4", "spades:A", "spades:9", "spades:8", "spades:7");
    const beforeResponder = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, beforeResponder, "south")).toBe("2spades");

    const beforeOpener = [
      ...beforeResponder, { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, beforeOpener, "north")).toBe("4spades");
  });

  it("accepts a spade invitation after SAYC opener raises the alternate major", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:Q", "spades:T", "spades:9", "hearts:K", "hearts:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:K", "clubs:2", "clubs:3", "clubs:4");
    const opener = hand("hearts:Q", "hearts:J", "hearts:T", "hearts:3", "hearts:4", "diamonds:K", "diamonds:Q", "diamonds:4", "diamonds:5", "spades:K", "spades:J", "spades:8", "spades:7");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3spades");
    expect(await bot.chooseBid(responder, [...auction, { seat: "north", bid: "3spades" as const }, { seat: "east", bid: "pass" as const }], "south")).toBe("4spades");
  });

  it("continues in hearts when SAYC opener has no spade fit after responder shows spades", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hand("hearts:A", "hearts:Q", "hearts:J", "hearts:2", "hearts:3", "hearts:4", "diamonds:K", "diamonds:Q", "diamonds:2", "diamonds:3", "spades:2", "clubs:K", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("raises opener’s natural diamond rebid with four-card support", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("clubs:A", "clubs:K", "clubs:Q", "clubs:8", "diamonds:A", "diamonds:K", "diamonds:7", "diamonds:4", "spades:3", "spades:4", "hearts:5", "hearts:6", "hearts:7");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3diamonds");
  });

  it("places 3NT after a natural second-suit rebid with balanced values and stoppers", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:K", "spades:3", "hearts:K", "hearts:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2", "clubs:3", "clubs:4", "clubs:5");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("3notrump");
  });

  it("invites in notrump after SAYC 1 heart–2 clubs–2 diamonds with balanced values", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:Q", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("shows preference for opener’s hearts after SAYC 1 heart–2 clubs–2 diamonds", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:A", "spades:2", "hearts:K", "hearts:Q", "hearts:8", "hearts:4", "hearts:2", "diamonds:K", "diamonds:2", "clubs:Q", "clubs:8", "clubs:4", "clubs:2");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2hearts");
  });

  it("invites in notrump after a SAYC 1 spade–2 clubs–2 diamonds rebid", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:J", "spades:2", "hearts:K", "hearts:2", "hearts:3", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:J", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1spades" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2diamonds" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it("invites in notrump after SAYC opener repeats the major following a two-level response", async () => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const responder = hand("spades:K", "spades:2", "spades:3", "hearts:Q", "hearts:2", "diamonds:Q", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:A", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe("2notrump");
  });

  it.each([
    [10, "3hearts", hand("spades:2", "spades:3", "spades:4", "hearts:K", "hearts:Q", "hearts:2", "diamonds:J", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:A", "clubs:2", "clubs:3")],
    [11, "3hearts", hand("spades:2", "spades:3", "spades:4", "hearts:K", "hearts:Q", "hearts:2", "diamonds:A", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:Q", "clubs:2", "clubs:3")],
    [12, "3hearts", hand("spades:2", "spades:3", "spades:4", "hearts:K", "hearts:Q", "hearts:2", "diamonds:5", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:A", "clubs:K", "clubs:2")],
    [13, "4hearts", hand("spades:2", "spades:3", "spades:4", "hearts:K", "hearts:Q", "hearts:2", "diamonds:J", "diamonds:2", "diamonds:3", "diamonds:4", "clubs:A", "clubs:K", "clubs:2")]
  ] as const)("shows the appropriate SAYC heart raise after 1 heart–2 clubs–2 hearts with %i HCP", async (_hcp, expected, responder) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(responder, auction, "south")).toBe(expected);
  });

  it.each([[15, "4hearts"], [16, "4hearts"]] as const)("accepts the responder’s SAYC 3-heart invitation with extra values (%i HCP)", async (hcp, expected) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hcp === 16
      ? hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4")
      : hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3hearts" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });

  it.each([[15, "3notrump"], [16, "3notrump"]] as const)("accepts the responder’s SAYC 2NT invitation after a major rebid with extra values (%i HCP)", async (hcp, expected) => {
    const bot = createBot({ skill: "beginner", biddingStyle: "SAYC" });
    const opener = hcp === 16
      ? hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:Q", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4")
      : hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:2", "spades:A", "spades:2", "diamonds:J", "diamonds:2", "diamonds:3", "clubs:2", "clubs:3", "clubs:4");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2notrump" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await bot.chooseBid(opener, auction, "north")).toBe(expected);
  });


describe("seeded bot behavior", () => {
  const suits: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  const seeds = [1, 7, 42, 2026, 65537];

  it("creates the same deal from the same seed", () => {
    for (const seed of seeds) {
      expect(seededDeal(seed)).toEqual(seededDeal(seed));
    }
  });

  it.each(["beginner", "intermediate", "advanced", "expert"] as const)("keeps %s bidding and card choices stable, private, and legal", async (skill) => {
    for (const seed of seeds) {
      const board = seededDeal(seed);
      for (const seat of SEATS) {
        const bot = createBot({ skill, biddingStyle: seed % 2 === 0 ? "SAYC" : "2/1" });
        const openingBid = await bot.chooseBid(board[seat], [], seat);
        expect(await bot.chooseBid(board[seat], [], seat)).toBe(openingBid);

        const previousSeat = SEATS[(SEATS.indexOf(seat) + SEATS.length - 1) % SEATS.length]!;
        for (const suit of suits) {
          const lead = board[previousSeat].find((card) => card.suit === suit);
          if (!lead) continue;

          const context = {
            seat,
            hand: board[seat],
            currentTrick: [{ seat: previousSeat, card: lead }],
            ledSuit: suit
          } as const;
          expect(Object.keys(context).sort()).toEqual(["currentTrick", "hand", "ledSuit", "seat"]);

          const choice = await bot.chooseCard(context);
          expect(board[seat].map(cardId)).toContain(cardId(choice));
          if (board[seat].some((card) => card.suit === suit)) expect(choice.suit).toBe(suit);
          expect(await bot.chooseCard(context)).toEqual(choice);
        }
      }
    }
  });


});

describe("call legality", () => {
  const south = hand("spades:A", "spades:K", "spades:3", "hearts:K", "hearts:Q", "hearts:4", "hearts:2", "diamonds:9", "diamonds:5", "clubs:8", "clubs:6", "clubs:4", "clubs:2");

  it("does not show four hearts below opener's 2 spades Stayman answer", async () => {
    const auction = [
      { seat: "north", bid: "1notrump" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2clubs" as const }, { seat: "west", bid: "pass" as const },
      { seat: "north", bid: "2spades" as const }, { seat: "east", bid: "pass" as const }
    ] as const;
    expect(await createRuleBot({ skill: "beginner", biddingStyle: "SAYC" }).chooseBid(south, auction, "south")).toBe("3notrump");
  });

  it("rebids the opened major above a 2/1 jump to 2 spades", async () => {
    const opener = hand("hearts:A", "hearts:K", "hearts:J", "hearts:7", "hearts:5", "spades:4", "spades:2", "diamonds:K", "diamonds:8", "diamonds:3", "clubs:Q", "clubs:7", "clubs:5");
    const auction = [
      { seat: "north", bid: "1hearts" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "2spades" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await createRuleBot({ skill: "beginner", biddingStyle: "2/1" }).chooseBid(opener, auction, "north")).toBe("3hearts");
  });

  it("shows the strong hand's side suit above a three-level positive response", async () => {
    const opener = hand("hearts:A", "hearts:K", "hearts:Q", "hearts:J", "hearts:5", "spades:A", "spades:K", "spades:Q", "spades:4", "spades:2", "diamonds:A", "clubs:K", "clubs:5");
    const auction = [
      { seat: "north", bid: "2clubs" as const }, { seat: "east", bid: "pass" as const },
      { seat: "south", bid: "3diamonds" as const }, { seat: "west", bid: "pass" as const }
    ] as const;
    expect(await createRuleBot({ skill: "beginner", biddingStyle: "SAYC" }).chooseBid(opener, auction, "north")).toBe("3spades");
  });

  it("makes only legal calls in seeded auctions at every level and style", async () => {
    for (const skill of ["beginner", "intermediate", "advanced", "expert"] as const) {
      for (const biddingStyle of ["SAYC", "2/1"] as const) {
        const bot = createRuleBot({ skill, biddingStyle });
        for (let seed = 1; seed <= 400; seed++) {
          let game = createGameState({ deal: seededDeal(seed), dealer: SEATS[seed % 4]!, vulnerability: "None" });
          while (game.phase === "auction") {
            const seat = game.currentActor;
            const bid = await bot.chooseBid(game.hands[seat], game.auction, seat);
            const result = applyAction(game, { type: "bid", seat, bid });
            if (!result.ok) throw new Error(`${skill} ${biddingStyle} seed ${seed}: ${bid} after ${game.auction.map((call) => call.bid).join(" ")}`);
            game = result.state;
          }
        }
      }
    }
  });

  it("passes rather than return a call the auction does not allow", async () => {
    const auction = [{ seat: "north", bid: "7notrump" as const }] as const;
    for (const skill of ["beginner", "expert"] as const) {
      const bid = await createBot({ skill, biddingStyle: "SAYC" }).chooseBid(south, auction, "east");
      expect(["pass", "double"]).toContain(bid);
    }
  });
});
