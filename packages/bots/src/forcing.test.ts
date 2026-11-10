import { SEATS, type Bid, type Hand, type PublicBid, type Seat, type Suit } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { forcedContinuation } from "./forcing.js";
import { createBot } from "./player.js";

const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
/** A hand written as spades.hearts.diamonds.clubs, for example "AK76.AQ.AQJ65.J2". */
const hand = (text: string): Hand => text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: suitOrder[index]!, rank }))) as unknown as Hand;
const strains: Readonly<Record<string, string>> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades", N: "notrump" };
const call = (text: string): Bid => (text === "P" ? "pass" : text === "X" ? "double" : `${text[0]}${strains[text[1]!]}`) as Bid;
/** An auction written as "1D P 1S P", starting with the given dealer. */
const auctionFrom = (dealer: Seat, text: string): PublicBid[] =>
  text.split(" ").map((entry, index) => ({ seat: SEATS[(SEATS.indexOf(dealer) + index) % 4]!, bid: call(entry) }));
const nextSeat = (auction: readonly PublicBid[]): Seat => SEATS[(SEATS.indexOf(auction.at(-1)!.seat) + 1) % 4]!;

async function bidOf(cards: string, auctionText: string, config: { skill?: "beginner" | "intermediate" | "expert"; style?: "SAYC" | "2/1"; dealer?: Seat } = {}) {
  const auction = auctionFrom(config.dealer ?? "north", auctionText);
  const bot = createBot({ skill: config.skill ?? "expert", biddingStyle: config.style ?? "SAYC" });
  return bot.chooseBid(hand(cards), auction, nextSeat(auction));
}

describe("forcing continuations", () => {
  it.each(["beginner", "intermediate", "expert"] as const)("has the %s opener jump shift with 20 points instead of passing a forcing response", async (skill) => {
    expect(await bidOf("2.AQ4.AK532.AQJ2", "1D P 1S P", { skill })).toBe("3clubs");
  });

  it("jumps in a second suit that the rules would show cheaply when opener holds 19 or more", async () => {
    expect(await bidOf("AK76.AQ.AQJ65.J2", "1D P 1H P")).toBe("2spades");
    expect(await bidOf("AK76.Q2.AJ765.32", "1D P 1H P")).toBe("1spades");
  });

  it("rebids 2NT over a two-level response with a balanced minimum and no cheaper suit to show", async () => {
    expect(await bidOf("KT63.A953.AJ3.Q6", "1D P 2C P")).toBe("2notrump");
  });

  it("answers partner's negative double with a four-card major, or notrump with their suit stopped", async () => {
    expect(await bidOf("32.AQ54.K32.AJ32", "1C 1S X P")).toBe("2hearts");
    expect(await bidOf("AQ2.K32.32.AJ432", "1C 1S X P")).toBe("1notrump");
  });

  it("gives preference rather than pass opener's reverse with a weak hand", async () => {
    expect(await bidOf("Q973.T43.KQ4.852", "1C P 1S P 2H P")).toBe("3clubs");
  });

  it("bids on over opener's new suit after a two-level response", async () => {
    expect(await bidOf("5.A75.A543.AQ962", "1S P 2C P 2H P")).toBe("3notrump");
  });

  it("answers a cue-bid raise instead of passing it", async () => {
    expect(await bidOf("AK4.AQJT4.932.83", "1H 1S 2S P")).toBe("4hearts");
    expect(await bidOf("A76.7.AQ732.KQ65", "1D 1H 2H P")).toBe("3diamonds");
  });

  it("leaves opener free to pass a passed partner's response", () => {
    const auction = auctionFrom("north", "P P 1D P 1S P");
    expect(forcedContinuation(hand("K2.A652.KJ432.72"), auction, "south")).toBeUndefined();
  });
});

describe("responses the rules have no shape for", () => {
  it("responds 1NT with nine points and no suit to show at the one level", async () => {
    expect(await bidOf("A.KJ973.J7652.62", "1S P")).toBe("1notrump");
  });

  it("raises partner's 1NT to game with an unbalanced eleven count", async () => {
    expect(await bidOf("T95.T.KJ95.AQJT3", "1N P")).toBe("3notrump");
  });

  it("keeps a passed hand's response within its limits", async () => {
    expect(await bidOf("62.J.A762.Q98642", "P P 1D P")).toBe("2diamonds");
  });
});

describe("game with known values", () => {
  it("bids game in opener's rebid major rather than pass with fifteen points", async () => {
    expect(await bidOf("KQ32.Q4.AK32.J32", "1H P 1S P 2H P", { style: "SAYC", skill: "intermediate" })).toBe("4hearts");
  });

  it("does not turn an invitational hand into a game bid", async () => {
    expect(await bidOf("KQ32.Q4.K432.432", "1H P 1S P 2H P", { skill: "intermediate" })).toBe("pass");
  });
});

describe("passes before the opening bid", () => {
  it.each(["beginner", "intermediate", "expert"] as const)("makes the same %s overcall whether or not the dealer passed first", async (skill) => {
    const direct = await bidOf("98.AJ7.AQT43.Q32", "1S", { skill });
    expect(await bidOf("98.AJ7.AQT43.Q32", "P 1S", { skill, dealer: "west" })).toBe(direct);
  });

  it("overcalls and balances after a leading pass", async () => {
    expect(await bidOf("98.AJ7.AQT43.Q32", "P 1S", { dealer: "west" })).toBe("2diamonds");
    expect(await bidOf("AJ54.AT32.J64.97", "P 1C P P", { dealer: "west" })).toBe("double");
  });

  it("still treats opener's partner as a passed hand", async () => {
    // Drury: a passed hand's 2♣ over a third-seat major opening shows a fit, which an unpassed hand's 2♣ does not.
    const passedHand = await bidOf("K32.Q4.A432.5432", "P P 1S P", { style: "SAYC" });
    const unpassedHand = await bidOf("K32.Q4.A432.5432", "1S P", { style: "SAYC" });
    expect(passedHand).not.toBe(unpassedHand);
  });
});
