import { SEATS, type Card, type PlayContext, type Aggression, type Bid, type Hand, type PublicBid, type Seat, type SkillLevel, type Suit } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { adjustCall } from "./aggression.js";
import { createView, evaluate } from "./auction.js";
import { createBot } from "./player.js";

const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const strains: Readonly<Record<string, string>> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades", N: "notrump" };
/** A hand written spades.hearts.diamonds.clubs: "KQJ54.KJ543.32.4". */
const hand = (text: string): Hand => text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: suitOrder[index]!, rank }))) as unknown as Hand;
const call = (text: string): Bid => (text === "P" ? "pass" : text === "X" ? "double" : `${text[0]}${strains[text[1]!]}`) as Bid;
const auctionFrom = (text: string): PublicBid[] => text === "" ? [] : text.split(" ").map((entry, index) => ({ seat: SEATS[index % 4]!, bid: call(entry) }));

async function bid(cards: string, auction: string, aggression: Aggression, skill: SkillLevel = "intermediate"): Promise<Bid> {
  const calls = auctionFrom(auction);
  const seat: Seat = SEATS[calls.length % 4]!;
  return createBot({ skill, biddingStyle: "SAYC", aggression }).chooseBid(hand(cards), calls, seat);
}
const all = (cards: string, auction: string, skill?: SkillLevel) =>
  Promise.all((["conservative", "normal", "aggressive"] as const).map((level) => bid(cards, auction, level, skill)));

/** Conservative, Normal and Aggressive calls, written short: "P", "1S", "X". */
const short = (bid: Bid): string => bid === "pass" ? "P" : bid === "double" ? "X" : `${bid[0]}${bid.slice(1) === "notrump" ? "N" : bid[1]!.toUpperCase()}`;
const calls = async (cards: string, auction: string, skill?: SkillLevel) => (await all(cards, auction, skill)).map(short);

describe("bot aggressiveness in the auction", () => {
  it("opens a light distributional hand only when aggressive", async () => {
    expect(await calls("KQJ54.KJ543.32.4", "")).toEqual(["P", "P", "1S"]);
  });

  it("overcalls a good suit on a light hand only when aggressive, and needs more when conservative", async () => {
    expect(await calls("KJ954.Q32.J2.432", "1D")).toEqual(["P", "P", "1S"]);
    expect(await calls("AQJ54.432.Q2.432", "1D")).toEqual(["P", "1S", "1S"]);
  });

  it("makes a minimum takeout double only when not conservative", async () => {
    expect(await calls("KQ32.4.KJ32.Q432", "1H")).toEqual(["P", "X", "X"]);
  });

  it("preempts only with a suit that has two of the top three honours when conservative", async () => {
    expect(await calls("QJT987.4.K32.432", "")).toEqual(["P", "2S", "2S"]);
    expect(await calls("AQT987.4.K32.432", "")).toEqual(["2S", "2S", "2S"]);
  });

  it("competes one more level in a found fit only when aggressive", async () => {
    expect(await calls("Q9.KQ854.A32.Q32", "1H P 2H 3C")).toEqual(["P", "P", "3H"]);
  });

  it("leaves a sound call alone at every level", async () => {
    expect(await calls("AQ5.KJ4.Q432.432", "")).toEqual(["1D", "1D", "1D"]);
  });

  it("never passes where the agreements make a pass impossible", () => {
    const auction = auctionFrom("1H 2C");
    const h = evaluate(hand("T9.KJ4.QJ32.7432"));
    const v = createView(auction, "south", "SAYC", "intermediate");
    expect(adjustCall("3hearts", h, v, "conservative", () => true)).toBe("pass");
    expect(adjustCall("3hearts", h, v, "conservative", () => false)).toBe("3hearts");
  });

  it("treats a missing setting as normal", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    expect(await bot.chooseBid(hand("KQJ54.KJ543.32.4"), [], "north")).toBe("pass");
  });
});

const suitNames: Readonly<Record<string, Suit>> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
/** Cards written as "SA SK H2". */
const cards = (text: string): Hand => text.split(" ").map((value) => ({ suit: suitNames[value[0]!]!, rank: value[1]! })) as unknown as Hand;
const card = (text: string): Card => cards(text)[0]!;
const play = (aggression: Aggression, context: PlayContext, skill: SkillLevel = "advanced") =>
  createBot({ skill, biddingStyle: "SAYC", aggression }).chooseCard(context);

describe("bot aggressiveness in the play", () => {
  const lead: PlayContext = { seat: "west", declarer: "south", trump: "spades", currentTrick: [], played: [],
    hand: cards("S5 S4 HA HK H3 DK D7 D4 CQ CJ C8 C3 C2") };

  it("cashes the ace from ace-king against a suit contract when aggressive", async () => {
    expect(await play("aggressive", lead)).toEqual(card("HA"));
  });

  it("leads the top of a sequence, or from a suit without the ace or king, when conservative", async () => {
    const queenJack: PlayContext = { ...lead, hand: cards("S5 S4 HA H7 H3 DK D7 D4 CQ CJ C8 C3 C2") };
    expect(await play("conservative", queenJack)).toEqual(card("CQ"));
    const noSequence: PlayContext = { ...lead, hand: cards("S5 S4 HA H7 H3 DK D7 D4 C9 C6 C5 C3 C2") };
    expect(await play("conservative", noSequence)).toEqual(card("C2"));
  });

  it("wins second hand when aggressive and plays low when conservative", async () => {
    const second: PlayContext = { seat: "west", declarer: "north", trump: "spades", ledSuit: "hearts", played: [],
      currentTrick: [{ seat: "south", card: card("H5") }], hand: cards("HK HT H2 D4") };
    expect(await play("aggressive", second)).toEqual(card("HT"));
    expect(await play("conservative", second)).toEqual(card("H2"));
  });

  it("leaves declarer's leads to the skill rules", async () => {
    const declaring: PlayContext = { ...lead, seat: "south" };
    expect(await play("aggressive", declaring)).toEqual(await play("normal", declaring));
  });
});
