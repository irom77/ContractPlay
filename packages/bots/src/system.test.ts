import { SEATS, type Bid, type Hand, type PublicBid, type Seat, type SkillLevel, type Suit } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { createView, evaluate } from "./auction.js";
import { shownBy } from "./inference.js";
import { createBot, createRuleBot } from "./player.js";

const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const skills: readonly SkillLevel[] = ["beginner", "intermediate", "advanced", "expert"];
const strains: Readonly<Record<string, string>> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades", N: "notrump" };
/** A hand written as spades.hearts.diamonds.clubs, for example "AK76.AQ.AQJ65.J2". */
const hand = (text: string): Hand => text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: suitOrder[index]!, rank }))) as unknown as Hand;
const call = (text: string): Bid => (text === "P" ? "pass" : text === "X" ? "double" : text === "R" ? "redouble" : `${text[0]}${strains[text[1]!]}`) as Bid;
const short = (bid: Bid): string => bid === "pass" ? "P" : bid === "double" ? "X" : bid === "redouble" ? "R" : `${bid[0]}${bid[1]!.toUpperCase() === "N" ? "N" : bid[1]!.toUpperCase()}`;
/** An auction written as "1D P 1S P", dealt by north. */
const auctionFrom = (text: string, dealer: Seat = "north"): PublicBid[] =>
  text === "" ? [] : text.split(" ").map((entry, index) => ({ seat: SEATS[(SEATS.indexOf(dealer) + index) % 4]!, bid: call(entry) }));
const nextSeat = (auction: readonly PublicBid[], dealer: Seat = "north"): Seat => SEATS[(SEATS.indexOf(dealer) + auction.length) % 4]!;

/**
 * Each row is a hand, the auction so far, and the expected call — one call for every level, or four separated by
 * slashes for Beginner / Intermediate / Advanced / Expert. A fourth entry gives the 2/1 calls where they differ from SAYC.
 */
type Row = readonly [cards: string, auction: string, sayc: string, twoOverOne?: string];

function check(rows: readonly Row[]): void {
  const table = rows.map(([cards, auctionText, sayc, twoOverOne]) => ({ cards, auctionText, sayc, twoOverOne: twoOverOne ?? sayc }));
  it.each(table)("$cards after \"$auctionText\" bids $sayc", async ({ cards, auctionText, sayc, twoOverOne }) => {
    const auction = auctionFrom(auctionText);
    for (const [style, expected] of [["SAYC", sayc], ["2/1", twoOverOne]] as const) {
      const perSkill = expected.includes("/") ? expected.split("/") : skills.map(() => expected);
      const actual = await Promise.all(skills.map((skill) => createBot({ skill, biddingStyle: style }).chooseBid(hand(cards), auction, nextSeat(auction))));
      expect(actual.map(short), style).toEqual(perSkill);
    }
  });
}

describe("system agreements", () => {
  describe("opening bids", () => {
    check([
      ["KQJ854.32.432.32", "", "P/2S/2S/2S"],
      ["32.KQJ854.432.32", "", "P/2H/2H/2H"],
      ["32.432.KQJ854.32", "", "P/2D/2D/2D"],
      ["2.32.KQJ8543.432", "", "P/3D/3D/3D"],
      ["2.AKJ87654.32.32", "", "P/4H/4H/4H"],
      ["AKQ.AKJ.KQJ2.AQ2", "", "2C"],
      ["AKQ.AK2.KQ32.K32", "", "2C"],
      ["K32.A32.Q32.A432", "P P", "1C"],
      ["K32.A32.Q432.432", "P P", "P"],
      ["KQJ32.A32.432.32", "P P", "P/P/1S/1S"],
      ["K432.A32.KQ2.432", "", "1C"],
      ["K432.A32.KQ32.32", "", "1D"],
      ["K432.AQ32.K432.2", "", "1D"],
      ["KJ32.AQ32.2.K432", "", "1C"],
      ["AKQ.AK2.KQ32.KJ2", "", "3N"],
      ["AJ9.AQT72.42.943", "P P", "P/P/1H/1H"],
      ["KQ762.A93.Q84.52", "P P P", "P/P/1S/1S"],
      ["52.A93.Q84.KQ762", "P P P", "P"],
      ["AQ854.KJ762.42.3", "", "P"]
    ]);
  });

  describe("after a 1NT opening", () => {
    check([
      ["K32.QJ854.432.32", "1N P", "2D"],
      ["QJ854.K32.432.32", "1N P", "2H"],
      ["KJ32.QJ54.K32.32", "1N P", "2C"],
      ["32.432.432.QJ8543", "1N P", "2S"],
      ["K32.Q54.K432.432", "1N P", "2N"],
      ["K32.Q54.K432.A32", "1N P", "3N"],
      ["K32.Q54.KQ32.A32", "1N P", "3N"],
      ["K32.A54.KQ32.A32", "1N P", "4N"],
      ["32.432.432.QJ8543", "1N P 2S P 3C P", "P"],
      ["32.432.QJ8543.432", "1N P 2S P 3C P", "3D"],
      ["AQ32.K32.KJ2.Q32", "1N P 2C P", "2S"],
      ["AQ2.K32.KJ32.Q32", "1N P 2C P", "2D"],
      ["AQ32.K432.KJ.Q32", "1N P 2C P", "2H"],
      ["AQ2.K32.KJ32.Q32", "1N P 2D P", "2H"],
      ["AQ2.K32.KJ32.Q32", "1N P 2H P", "2S"],
      ["AQ2.K32.KJ32.Q32", "1N P 2S P", "3C"],
      ["KJ32.Q54.K32.432", "1N P 2C P 2D P", "2N"],
      ["KJ32.Q54.K32.432", "1N P 2C P 2S P", "3S"],
      ["KJ32.Q54.K32.A32", "1N P 2C P 2S P", "4S"],
      ["KJ32.Q54.K32.A32", "1N P 2C P 2H P", "2S"],
      ["K32.QJ854.432.32", "1N P 2D P 2H P", "P"],
      ["K32.QJ854.K32.32", "1N P 2D P 2H P", "2N"],
      ["K32.QJ854.K32.A2", "1N P 2D P 2H P", "3N"],
      ["K2.QJ8543.K32.A2", "1N P 2D P 2H P", "4H"],
      ["K2.QJ8543.K32.32", "1N P 2D P 2H P", "3H"],
      ["AQ2.K32.KJ32.Q32", "1N P 2D P 2H P 2N P", "3H"],
      ["AQ2.K32.KJ32.A32", "1N P 2D P 2H P 2N P", "4H"],
      ["AQ2.K2.KJ32.Q432", "1N P 2D P 2H P 3N P", "P"],
      ["AQ2.K32.KJ32.Q32", "1N P 2D P 2H P 3N P", "4H"],
      ["AQ2.K32.KJ32.Q32", "1N P 2N P", "P"],
      ["AQ2.K32.KJ32.A32", "1N P 2N P", "3N"],
      ["32.432.KQ8543.32", "1N P", "2S"],
      ["32.A32.KJ8543.32", "1N P", "2N"],
      ["A2.K2.432.AQJ543", "1N P", "3N"],
      ["AQ2.K32.KJ32.A32", "1N P 4N P", "6N"],
      ["AQ2.K32.KJ32.Q32", "1N P 4N P", "P"],
      ["AQ2.K32.KJ32.A32", "1N P 4C P", "4S"]
    ]);
  });

  describe("interference over 1NT", () => {
    check([
      ["KJ32.QJ54.K32.32", "1N X", "2C"],
      ["K32.QJ854.432.32", "1N X", "2D"],
      ["KQ854.32.432.432", "1N 2H", "2S"],
      ["KJ32.32.KQ32.432", "1N 2H", "P"],
      ["K32.A2.KQ32.5432", "1N 2H", "3N/3N/3N/2N"]
    ]);
  });

  describe("after a 2NT opening", () => {
    check([
      ["K32.QJ854.432.32", "2N P", "3D"],
      ["KJ32.Q854.432.32", "2N P", "3C"],
      ["K32.Q54.5432.432", "2N P", "3N/3N/3N/3C"],
      ["432.654.5432.432", "2N P", "P"],
      ["AQ2.K32.AKJ2.KJ2", "2N P 3D P", "3H"],
      ["AQ32.K2.AKJ2.KJ2", "2N P 3C P", "3S/3S/3S/3D"],
      ["K32.QJ854.432.32", "2N P 3D P 3H P", "4H"],
      ["K32.Q54.J432.432", "2N P", "3N/3N/3N/3C"]
    ]);
  });

  describe("the strong 2C opening", () => {
    check([
      ["432.654.5432.432", "2C P", "2D"],
      ["KQJ54.A54.432.32", "2C P", "2S"],
      ["K32.Q54.K432.432", "2C P", "2N"],
      ["AKQ.AK2.KQ32.K32", "2C P 2D P", "2N"],
      ["AKQJ54.AK2.A32.2", "2C P 2D P", "2S"],
      ["432.654.5432.432", "2C P 2D P 2S P", "4S"],
      ["432.654.5432.432", "2C P 2D P 2N P", "P"],
      ["K32.QJ854.432.32", "2C P 2D P 2N P", "3D"],
      ["Q32.654.K432.432", "2C P 2D P 2S P", "4S"],
      ["AKQJ54.AK2.A32.2", "2C P 2D P 2S P 2N P", "3S"]
    ]);
  });

  describe("weak two bids", () => {
    check([
      ["A32.K432.5432.32", "2S P", "3S"],
      ["A432.K432.K432.2", "2S P", "4S"],
      ["A2.AK32.KQ32.432", "2S P", "2N/3N/3N/3N"],
      ["KQJ854.32.K32.32", "2S P 2N P", "3D"],
      ["KQJ854.32.432.32", "2S P 2N P", "3S"],
      ["2.AKJ854.AQ2.K32", "2S P", "3H"],
      ["KQJ854.32.432.32", "2S P 3H P", "3S"],
      ["KQJ854.Q32.432.2", "2S P 3H P", "4H"],
      ["32.432.K432.5432", "2S P", "P"]
    ]);
  });

  describe("three-level preempts", () => {
    check([
      ["A2.AK32.A432.432", "3D P", "P/5D/5D/5D"],
      ["KQ2.A432.2.A5432", "3S P", "4S"]
    ]);
  });

  describe("major-suit openings", () => {
    check([
      ["K32.Q54.5432.432", "1S P", "P"],
      ["K2.Q754.K32.Q432", "1H P", "3H"],
      ["K32.KJ54.AQ32.32", "1H P", "2N"],
      ["2.KJ543.Q5432.32", "1H P", "4H"],
      ["K32.32.A432.5432", "1H P", "1N"],
      ["K432.32.A432.432", "1H P", "1S"],
      ["K32.32.AQ432.K32", "1H P", "2D", "1N"],
      ["K2.32.AKQ432.A32", "1H P", "2D"],
      ["KJ2.Q2.KJ32.A432", "1H P", "2D"],
      ["32.432.5432.5432", "1H P", "P"],
      ["AKJ54.K32.2.QJ32", "1S P 2N P", "3D"],
      ["AKJ54.K32.32.Q32", "1S P 2N P", "4S"],
      ["AKJ54.K32.A2.K32", "1S P 2N P", "3S"],
      ["AKJ54.K32.K2.Q32", "1S P 2N P", "3N"],
      ["K2.AQJ54.K32.432", "1H P 3H P", "4H"],
      ["K2.AJ654.Q32.Q32", "1H P 3H P", "P"],
      ["A2.AQJ54.KQ32.32", "1H P 2H P", "3H"],
      ["K2.AQJ54.Q32.432", "1H P 2H P", "P"],
      ["K32.K432.32.Q432", "1H P 2H P 3D P", "4H"],
      ["432.Q432.K32.432", "1H P 2H P 3D P", "3H"],
      ["K2.AQJ54.K32.432", "1H P 1N P", "P", "2C"],
      ["K2.AQJ654.K32.32", "1H P 1N P", "2H"],
      ["AK2.AQJ54.K32.32", "1H P 1N P", "2N", "2D"],
      ["2.AQJ54.KQ32.432", "1H P 1N P", "2D"],
      ["2.AQJ54.KQ32.432", "1H P 1S P", "2D"],
      ["K2.AQJ54.Q32.432", "1H P 1S P", "1N"],
      ["KQ54.Q2.K432.432", "1H P 1S P 2H P", "P"],
      ["KQ54.Q2.K432.Q32", "1H P 1S P 2H P", "3H"],
      ["KQ54.Q2.KJ32.Q32", "1H P 1S P 2H P", "4H"],
      ["KQ54.2.K432.Q432", "1H P 1S P 1N P", "P"],
      ["KQ654.2.K432.432", "1H P 1S P 1N P", "2S"],
      ["KQJ654.2.K432.A2", "1H P 1S P 1N P", "4S"],
      ["KQJ654.2.K432.32", "1H P 1S P 1N P", "2S"]
    ]);
  });

  describe("two-over-one responses", () => {
    check([
      ["K32.32.AQ432.KQ2", "1H P", "2D"],
      ["K2.AQJ54.Q32.432", "1H P 2D P", "2H"],
      ["K32.32.AQ432.KQ2", "1H P 2D P 2H P", "3D", "3N"],
      ["K2.AQJ54.Q32.432", "1H P 2D P 2H P 2N P", "P", "3N"],
      ["K32.Q2.AQ432.KQ2", "1H P 2D P 2H P", "3D", "3N"],
      ["AQJ54.K2.Q32.432", "1S P 2H P", "2S"],
      ["AQJ54.K32.Q32.32", "1S P 2H P", "3H"],
      ["A2.KQ32.432.KQ32", "1S P 2C P 2S P", "3N", "3H"],
      ["AQJ54.K2.Q32.432", "1S P 2C P 2S P 2N P", "P", "3N"],
      ["AQJ654.K2.Q32.32", "1S P 2C P 2S P 2N P", "P", "3N"],
      ["K32.32.A432.5432", "1S P 1N P 2C P", "2S"],
      ["32.K32.A432.Q432", "1S P 1N P 2C P", "P"],
      ["32.KJ8543.A32.32", "1S P 1N P 2C P", "2H"],
      ["K32.32.AQ32.Q432", "1S P 1N P 2C P", "3S"],
      ["32.K32.AQ32.Q432", "1S P 1N P 2S P", "2N"]
    ]);
  });

  describe("minor-suit openings", () => {
    check([
      ["K32.Q2.432.Q5432", "1C P", "2C"],
      ["K32.Q2.A32.Q5432", "1C P", "3C"],
      ["K32.Q32.432.Q432", "1C P", "1N"],
      ["KJ2.Q32.A32.Q432", "1C P", "2N"],
      ["KJ2.KQ2.A32.Q432", "1C P", "3N"],
      ["K432.Q432.32.432", "1C P", "P"],
      ["K432.32.Q5432.32", "1C P", "P"],
      ["K432.K2.32.AQJ32", "1C P 1D P", "1S"],
      ["K32.K32.Q2.AQJ32", "1C P 1D P", "1N"],
      ["KQ2.AQ2.K32.AJ32", "1C P 1H P", "2N"],
      ["KQ2.K2.32.AQJ432", "1C P 1H P", "2C"],
      ["K2.K2.A32.AQJ432", "1C P 1H P", "3C"],
      ["K2.KQ32.32.AQJ32", "1C P 1H P", "2H"],
      ["K2.KQ32.A2.AQJ32", "1C P 1H P", "4H"],
      ["2.AQ54.K32.AKJ32", "1C P 1S P", "2H"],
      ["K2.Q754.K32.5432", "1C P 1H P 1N P", "P"],
      ["K2.AQ754.432.K32", "1C P 1H P 1N P", "3H/3H/3H/2C", "3H/3H/3H/2D"],
      ["K2.AQ754.K32.K32", "1C P 1H P 1N P", "3N/3N/3N/2C", "3N/3N/3N/2D"],
      ["AQ543.432.K2.AJ2", "1D P 1S P 2C P", "2H"],
      ["AQ543.432.32.432", "1D P 1S P 2C P", "2D"],
      ["Q543.K32.32.K432", "1D P 1S P 2C P", "P"],
      ["K2.A2.AQJ32.Q432", "1D P 1S P 2C P 2H P", "3N"],
      ["K432.Q2.KQ2.Q432", "1C P 1H P 2N P", "3N"],
      ["AK2.K2.432.KQ432", "1C P 2N P", "3N"],
      ["K2.Q32.AJ432.K32", "1D P 3D P", "P"],
      ["K2.A32.AJ432.K32", "1D P 3D P", "3N"]
    ]);
  });

  describe("slam bidding", () => {
    check([
      ["KQ32.A2.KQ2.K432", "1S P", "2N"],
      ["AKJ54.KQ2.A2.Q32", "1S P 3S P", "4S"],
      ["Q432.A2.K432.432", "1S P 3S P 4N P", "5D"],
      ["Q432.32.KQ32.Q32", "1S P 3S P 4N P", "5C"],
      ["AKJ54.KQ2.A2.Q32", "1S P 3S P 4N P 5D P", "6S"],
      ["AKJ54.KQ2.A2.K32", "1S P 3S P 4N P 5H P", "6S"],
      ["AKJ54.KQ2.A2.Q32", "1S P 3S P 4N P 5C P", "5S"],
      ["AKJ54.KQ2.A2.K32", "1S P 3S P 4N P 5S P", "6S"],
      ["Q432.K2.K432.432", "1S P 3S P 4N P 5D P 5N P", "6H"],
      ["AKJ54.KQ2.A2.K32", "1S P 2N P 3S P", "4N"],
      ["KQ32.A2.KQ2.K432", "1S P 2N P 3S P", "4N"],
      ["KQ32.A2.KQ2.K432", "1S P 2N P 4S P", "P"]
    ]);
  });

  describe("the opening side in competition", () => {
    check([
      ["32.KJ54.K432.432", "1C 1S", "X"],
      ["K32.32.AQ32.Q432", "1H X", "R"],
      ["K32.Q432.A32.432", "1H X", "2H"],
      ["32.Q432.K32.5432", "1H X", "2H"],
      ["2.Q5432.K32.5432", "1H X", "4H"],
      ["K432.32.AQ32.K32", "1S 2H", "3H"],
      ["K32.32.Q432.5432", "1S 2H", "2S"],
      ["32.A32.KQ432.432", "1S 2H", "X"],
      ["K2.KJ2.Q432.5432", "1S 2H", "X"],
      ["32.432.KQ5432.A2", "1S 2H", "X"],
      ["32.432.AKQ432.A2", "1S 2H", "3D"],
      ["K32.Q32.K432.432", "1D 1S", "1N"],
      ["32.AQ54.K32.AJ32", "1C 1S X P", "2H"],
      ["32.AQ54.K2.AKJ32", "1C 1S X P", "3H"],
      ["AQ2.K32.32.AJ432", "1C 1S X P", "1N"],
      ["2.KQ32.A432.K432", "1D 1S P P", "P/P/X/X"],
      ["K2.AQJ54.K32.432", "1H 1S 2H 2S", "P"],
      ["K2.AQJ54.KQ2.A32", "1H 1S 2H 2S", "4H"],
      ["K2.AQJ54.KQ2.432", "1H 1S 2H 2S", "P"],
      ["2.AQJ654.K32.432", "1H 1S 2H 2S", "3H"]
    ]);
  });

  describe("overcalls, doubles and advances", () => {
    check([
      ["AQJ54.32.K32.432", "1H", "P/1S/1S/1S"],
      ["32.K2.AQJ543.432", "1S", "P/2D/2D/2D"],
      ["KJ2.AQ2.KJ32.Q32", "1S", "P/1N/1N/1N"],
      ["A432.2.KQ32.K432", "1H", "P/X/X/X"],
      ["AKJ54.A2.KQ2.432", "1H", "P/1N/1N/1N"],
      ["KQJ854.2.432.432", "1H", "P/2S/2S/2S"],
      ["KQJ54.2.KQJ54.32", "1H", "P/2H/2H/2H"],
      ["KQJ54.KQJ54.2.32", "1D", "P/2D/2D/2D"],
      ["2.32.KQJ54.KQJ54", "1H", "P/2N/2N/2N"],
      ["K32.A32.Q432.432", "1H", "P"],
      ["J754.432.432.432", "1H X P", "1S"],
      ["KJ54.432.A32.432", "1H X P", "1S"],
      ["KJ54.432.A32.K32", "1H X P", "2S"],
      ["K32.KJ2.Q432.432", "1H X P", "1N"],
      ["K32.KJ2.K432.Q32", "1H X P", "2H"],
      ["K32.KJ2.K432.A32", "1H X P", "3N"],
      ["432.5432.432.432", "1H X P", "2C"],
      ["2.KQJT9.A32.5432", "1H X P", "P"],
      ["J754.432.432.432", "1H X 2H", "P"],
      ["KJ54.432.A32.432", "1H X 2H", "2S"],
      ["A432.2.KQ32.K432", "1H X P 1S P", "P"],
      ["AQ32.2.KQ32.K432", "1H X P 1S P", "2S"],
      ["AQ32.2.AKQ2.K432", "1H X P 1S P", "3S"],
      ["A432.2.KQ32.K432", "1H X P 2S P", "4S"],
      ["AQ32.2.KQ32.KQ32", "1H X P 2S P", "4S"],
      ["AKJ54.A2.KQ2.432", "1H X P 2C P", "2S"],
      ["K32.432.32.KJ432", "1D 1S P", "2S"],
      ["K32.A32.32.KJ432", "1D 1S P", "2D"],
      ["K432.2.432.K5432", "1D 1S P", "3S"],
      ["32.KJ2.Q432.Q432", "1D 1S P", "1N"],
      ["32.AQJ54.432.K32", "1D 1S P", "2H"],
      ["32.432.5432.5432", "1D 1S P", "P"],
      ["AQJ54.32.K32.432", "1D 1S P 2S P", "P"],
      ["AQJ54.32.AK2.432", "1D 1S P 2S P", "3S"],
      ["AQJ54.32.K32.432", "1D 1S P 2D P", "2S"],
      ["AQJ54.32.AK2.432", "1D 1S P 2D P", "4S"],
      ["K32.Q32.432.KJ32", "1S 1N P", "2N"],
      ["K32.QJ854.432.32", "1S 1N P", "2H"],
      ["KJ54.32.A32.Q432", "1H P P", "P/X/X/X"],
      ["KJ2.A32.Q432.Q32", "1H P P", "P/P/1N/1N"],
      ["AQJ54.32.432.432", "1H P P", "P"],
      ["KJ54.32.A32.Q432", "1H P 2H P P", "P/P/X/X"]
    ]);
  });

  describe("defending against preempts", () => {
    check([
      ["2.AQ54.KQ32.AJ32", "3S", "P/X/X/X"],
      ["A2.AQ54.KQ32.432", "2S", "P/X/X/X"],
      ["A2.AKJ543.K32.32", "2S", "P/3H/3H/3H"],
      ["AQ2.K32.KQ32.K32", "2S", "P/2N/2N/2N"],
      ["AQ2.K32.KQ32.K32", "3S", "P/3N/3N/3N"],
      ["K32.A32.Q432.432", "2S", "P"],
      ["A2.AQ54.KQ32.432", "2H P P", "P/2N/2N/2N"],
      ["A2.32.KQJ543.A32", "2H", "P/3D/3D/3D"],
      ["A2.AKJ543.K32.32", "3D", "P/3H/3H/3H"],
      ["KJ54.2.A432.Q432", "2H P P", "P/X/X/X"],
      ["J754.432.432.432", "2H X P", "2S"],
      ["KJ54.432.A32.K32", "2H X P", "4S"],
      ["KJ54.432.A32.432", "2H X P", "3S"],
      ["432.KJ2.A432.K32", "2H X P", "3N"],
      ["J754.432.432.432", "3D X P", "3S"],
      ["KJ54.432.A2.K432", "3D X P", "4S"],
      ["2.AQ54.KQ32.AJ32", "2S P 3S", "P/X/X/X"]
    ]);
  });

  describe("defending against 1NT", () => {
    check([
      ["32.AQJ543.K32.32", "1N", "P/2H/2H/2H"],
      ["KQJ854.2.432.432", "1N", "P"],
      ["AQ2.K32.KQJ32.A2", "1N", "P/X/X/X"],
      ["K32.A32.Q432.432", "1N", "P"],
      ["32.AQJ543.K32.32", "1N P P", "P/2H/2H/2H"],
      ["K32.32.A432.5432", "1N 2H P", "P"],
      ["K32.K32.A432.432", "1N 2H P", "P"],
      ["K32.K32.432.5432", "1N X P", "P"],
      ["32.432.432.J5432", "1N X P", "2C"]
    ]);
  });

  describe("after a 3NT opening", () => {
    check([
      ["432.654.5432.432", "3N P", "P"],
      ["K32.Q54.K432.432", "3N P", "6N"]
    ]);
  });

  describe("forcing and invitational sequences", () => {
    check([
      ["AQJ54.KQ92.2.Q43", "1S P 2D P 2H P 3C P", "3N"],
      ["K2.AJ3.K8.KQJ832", "1C P 1S P 2C P 2D P", "3N"],
      ["AQT83.QJT9.92.Q5", "1D P 1S P 2C P 2H P 3D P", "P"],
      ["A865.AKJ3.KJ42.9", "1D P 1S P 2H P 3D P", "4S"],
      ["84.KQ94.A3.AKQJT", "1C P 1S P 2H P 2S P", "3N"],
      ["AKQT9.AK83.A86.K", "2C P 2D P 2S P 2N P 3H P 3S P", "4S"],
      ["852.T7.J8764.QJ3", "2C P 2D P 2S P 2N P 3S P", "4S"],
      ["KJT72.T3.J97.K62", "1H P 1S P 3D P", "3N"],
      ["AKQ9.K.K843.KJ75", "1D P 2D P", "3N"],
      ["A64.T96.AT962.96", "1D P 2D P 2N P", "3N"],
      ["AKJ87.A4.AKT2.72", "1S P 1N P", "3D"],
      ["A7.AKQJ4.8.KJ854", "1H P 1N P", "2C"],
      ["AQT94.AK.KQT5.T7", "1S P 1N P 2D P 2S P", "2N"],
      ["J7.J843.763.AKQ2", "1S P 1N P 2D P 2S P 2N P", "3N"],
      ["T.AT872.QJT8.Q95", "1S P 1N P 2H P", "3H"],
      ["A7.AJ8.QJ9.J9543", "1D P 2C P 2D P", "3N"],
      ["A7.J83.QJ9.Q9543", "1D P 2C P 2D P", "2N"],
      ["AQJ42.AK854.6.K5", "1N P 2C P 2D P", "3S"],
      ["J.AK6.A6542.AK54", "P P 1D P 1S P", "3C"]
    ]);
  });

  describe("competitive follow-ups", () => {
    check([
      ["K92.AKT.73.AT854", "1C 1D 1S P", "2C"],
      ["Q4.2.JT432.AKQ87", "1C 2H 2S P", "3C"],
      ["QT763.9.QT3.AK82", "1H 1S 2H 3H P", "3S"],
      ["AK964.32.T5.QT95", "1D 1S X 2D P", "2S"],
      ["K97.Q2.AKJ985.A6", "1D 1H 2H P", "5D"],
      ["KQ.Q654.A92.AKT9", "1C 2S X P", "4H"],
      ["AK4.A876.A742.A4", "1D 2C 2D P", "3N"],
      ["K4.AQJ76.K42.A43", "1H 2C 2H 3C", "3H"],
      ["KJ98.432.Q32.432", "1D 1S P P X P", "2D"],
      ["32.Q432.K32.Q432", "1D 1S P P X P", "2H"],
      ["AKQ.QJ3.AK9743.A", "1C", "P/X/X/X"],
      ["AKQ.QJ3.AK9743.A", "1C X P 1H P", "3D"],
      ["A2.9.AQT5432.A75", "2H 2S P", "4S"],
      ["A2.954.KQT54.A75", "2H 2S P", "4S"],
      ["A7.KQ96.94.Q8432", "1S 2H 3S", "P/4H/4H/4H"],
      ["KQ32.AQ4.A32.432", "1D X 1S", "2D"],
      ["A2.KJ932.63.J732", "1C 2S", "X"],
      ["Q.Q74.AT42.AK742", "1C 1H X P 2C P", "3N"],
      ["AJ94.AKJ83.876.3", "1C 1D X P 2C P", "2D"],
      ["KQ4.K32.Q432.432", "1N 2H", "3N/3N/3N/2N"],
      ["AQ2.K32.KJ32.Q32", "1N 2H 3S P", "4S"],
      ["AQ32.K2.KJ32.Q32", "1N 2H 3H P", "3S"],
      ["K32.A32.Q432.432", "1N 2S", "2N/2N/2N/P"],
      ["T7.AKQ92.K84.J62", "2S X P", "4H"],
      ["A2.AQ54.KQ32.432", "2S X P 3H P", "P"]
    ]);
  });
});

describe("auctions read from the opening bid", () => {
  const positions: readonly (readonly [string, string])[] = [
    ["A432.2.KQ32.K432", "1H"], ["KJ54.432.A32.K32", "1H X P"], ["AQ2.K32.KJ32.A32", "1N P 2N P"], ["32.AQ54.K32.AJ32", "1C 1S X P"],
    ["K2.AQJ54.K32.432", "1H P 3H P"], ["2.AQ54.KQ32.AJ32", "3S"], ["AQJ54.32.K32.432", "1D 1S P 2S P"]
  ];

  it.each(positions)("gives the same call with %s after \"%s\" whoever dealt, in the rule classes themselves", async (cards, auctionText) => {
    for (const skill of skills) {
      const bot = createRuleBot({ skill, biddingStyle: "SAYC" });
      const plain = auctionFrom(auctionText);
      const expected = await bot.chooseBid(hand(cards), plain, nextSeat(plain));
      // One pass by the dealer before the opening changes nobody's status on the defending side or the opener's.
      const delayed = auctionFrom(`P ${auctionText}`, "west");
      const seat = nextSeat(delayed, "west");
      const openerPartnerPassed = delayed[0]!.seat === SEATS[(SEATS.indexOf(delayed[1]!.seat) + 2) % 4];
      expect(openerPartnerPassed).toBe(false);
      expect(await bot.chooseBid(hand(cards), delayed, seat), skill).toBe(expected);
    }
  });

  it("reads a recorded auction that skips a seat as if that seat had passed", () => {
    const view = createView([{ seat: "north", bid: "1hearts" }], "south", "SAYC", "expert");
    expect(view.text).toBe("1H P");
    expect(view.opened).toBe(true);
  });
});

describe("what the calls have shown", () => {
  const shown = (auctionText: string) => {
    const auction = auctionFrom(auctionText);
    return shownBy(createView(auction, nextSeat(auction), "SAYC", "expert"), "partner");
  };

  it("reads an opening bid, a reverse and a jump rebid", () => {
    expect(shown("1H P")).toMatchObject({ min: 12, len: { H: 5 } });
    expect(shown("1C P 1S P 2H P").min).toBe(16);
    expect(shown("1D P 1S P 3D P")).toMatchObject({ min: 16, len: { D: 6 } });
    expect(shown("1C P 1H P 2N P").min).toBe(18);
  });

  it("reads responses, including a limit raise and a two-level response", () => {
    expect(shown("1S P 3S P").min).toBe(10);
    expect(shown("1S P 2D P").min).toBe(10);
    expect(shownBy(createView(auctionFrom("1S P 2D P"), "north", "2/1", "expert"), "partner").min).toBe(12);
  });

  it("reads the defending side's overcalls, doubles and advances", () => {
    expect(shown("1D 1S P")).toMatchObject({ min: 8, len: { S: 5 } });
    expect(shown("1D X P").min).toBe(12);
    expect(shown("3D X P").min).toBe(14);
    expect(shown("1D X P 2S P").min).toBe(9);
    expect(shown("1D 1S P 2D P").min).toBe(11);
  });

  it("counts shortness and long suits when evaluating a hand", () => {
    const worth = evaluate(hand("KJ54.2.A432.Q432"));
    expect(worth.hcp).toBe(10);
    expect(worth.support("S")).toBe(13);
    expect(worth.balanced).toBe(false);
    expect(evaluate(hand("AKJ87.A4.KT2.732")).goodSuit("S")).toBe(true);
  });
});
