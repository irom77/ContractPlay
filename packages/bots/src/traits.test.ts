import { AGGRESSIONS, SEATS, TRAIT_PRESETS, type Aggression, type Bid, type BotTraits, type Card, type Hand, type PlayContext, type PublicBid, type Seat, type SkillLevel, type Suit } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { adjustCall, penaltyDouble } from "./traits.js";
import { createView, evaluate } from "./auction.js";
import { createBot } from "./player.js";

const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const strains: Readonly<Record<string, string>> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades", N: "notrump" };
/** A hand written spades.hearts.diamonds.clubs: "KQJ54.KJ543.32.4". */
const hand = (text: string): Hand => text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: suitOrder[index]!, rank }))) as unknown as Hand;
const call = (text: string): Bid => (text === "P" ? "pass" : text === "X" ? "double" : `${text[0]}${strains[text[1]!]}`) as Bid;
const auctionFrom = (text: string): PublicBid[] => text === "" ? [] : text.split(" ").map((entry, index) => ({ seat: SEATS[index % 4]!, bid: call(entry) }));

/** The setting a test gives a bot: an aggressiveness, or single dials over Normal. */
type Style = Aggression | Partial<BotTraits>;
const configOf = (style: Style) => typeof style === "string" ? { aggression: style } : { traits: style };

async function bid(cards: string, auction: string, style: Style, skill: SkillLevel = "intermediate"): Promise<Bid> {
  const calls = auctionFrom(auction);
  const seat: Seat = SEATS[calls.length % 4]!;
  return createBot({ skill, biddingStyle: "SAYC", ...configOf(style) }).chooseBid(hand(cards), calls, seat);
}
const all = (cards: string, auction: string, skill?: SkillLevel) =>
  Promise.all((["conservative", "normal", "aggressive"] as const).map((level) => bid(cards, auction, level, skill)));

/** Conservative, Normal and Aggressive calls, written short: "P", "1S", "X". */
const short = (bid: Bid): string => bid === "pass" ? "P" : bid === "double" ? "X" : `${bid[0]}${bid.slice(1) === "notrump" ? "N" : bid[1]!.toUpperCase()}`;
const calls = async (cards: string, auction: string, skill?: SkillLevel) => (await all(cards, auction, skill)).map(short);
const one = async (cards: string, auction: string, style: Style, skill?: SkillLevel) => short(await bid(cards, auction, style, skill));

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
    expect(adjustCall("3hearts", h, v, TRAIT_PRESETS.conservative, () => true)).toBe("pass");
    expect(adjustCall("3hearts", h, v, TRAIT_PRESETS.conservative, () => false)).toBe("3hearts");
  });

  it("treats a missing setting as normal", async () => {
    const bot = createBot({ skill: "intermediate", biddingStyle: "SAYC" });
    expect(await bot.chooseBid(hand("KQJ54.KJ543.32.4"), [], "north")).toBe("pass");
  });
});

describe("bot trait dials in the auction", () => {
  it("each dial changes only its own calls", async () => {
    expect(await one("KQ32.4.KJ32.Q432", "1H", { openings: "cautious" })).toBe("X");
    expect(await one("KQ32.4.KJ32.Q432", "1H", { competing: "cautious" })).toBe("P");
    expect(await one("QJT987.4.K32.432", "", { preempts: "cautious" })).toBe("P");
    expect(await one("QJT987.4.K32.432", "", { openings: "cautious" })).toBe("2S");
    expect(await one("KQJ54.KJ543.32.4", "", { openings: "bold" })).toBe("1S");
    expect(await one("KQJ54.KJ543.32.4", "", { competing: "bold" })).toBe("P");
  });

  it("preempts wildly only when the dial is bold", async () => {
    const wild = { preempts: "bold" } as const;
    expect(await one("Q98765.K432.32.4", "", wild)).toBe("2S");
    expect(await calls("Q98765.K432.32.4", "")).toEqual(["P", "P", "P"]);
    expect(await calls("4.32.K876532.Q32", "")).toEqual(["P", "P", "P"]);
    expect(await one("4.32.K876532.Q32", "", wild)).toBe("3D");
    expect(await one("4.32.K876532.Q32", "P P", wild)).toBe("3D");
    expect(await one("4.32.K876532.Q32", "P P P", wild)).toBe("P");
    expect(await one("987654.KQ2.32.32", "", wild)).toBe("P");
    expect(await one("Q98765.K432.32.4", "1C", wild)).toBe("P");
    expect(await one("KQ9876.AK4.32.32", "", wild)).toBe("1S");
  });

  it("doubles for penalty often only when the dial is bold", async () => {
    const often = { doubles: "bold" } as const;
    expect(await one("KJ32.A54.QT98.32", "1S P 4S P P", often, "advanced")).toBe("X");
    expect(await one("KJ32.A54.QT98.32", "1S P 4S P P", "normal", "advanced")).toBe("P");
    // A partscore while our side stayed silent: a double would be for takeout.
    expect(await one("KJ32.A54.QT98.32", "1S P 2S P P", often, "advanced")).toBe("P");
    // Our side competed, so a double of their partscore is for penalty.
    expect(await one("KQT2.A54.Q98.432", "1S 2H 2S P P", often, "advanced")).toBe("X");
    // Against notrump it takes three quick tricks.
    expect(await one("A32.KQ4.K432.432", "1N P 3N P P", often, "advanced")).toBe("P");
    expect(await one("A32.AK4.K432.432", "1N P 3N P P", often, "advanced")).toBe("X");
  });

  it("never doubles partner's contract for penalty", () => {
    const v = createView(auctionFrom("1S P 4S P"), "north", "SAYC", "advanced");
    expect(penaltyDouble(evaluate(hand("KJ32.A54.QT98.32")), v)).toBeUndefined();
  });

  it("doubles for penalty rarely when cautious", async () => {
    const rarely = { doubles: "cautious" } as const;
    expect(await one("KJ2.AQT9.432.432", "1N 2H", "normal", "advanced")).toBe("X");
    expect(await one("KJ2.AQT9.432.432", "1N 2H", rarely, "advanced")).toBe("P");
    // A takeout double stays.
    expect(await one("KQ32.4.KJ32.Q432", "1H", rarely)).toBe("X");
    const v = createView(auctionFrom("1N 2H"), "south", "SAYC", "advanced");
    expect(adjustCall("double", evaluate(hand("KJ2.AQT9.432.432")), v, { ...TRAIT_PRESETS.normal, ...rarely }, () => false)).toBe("double");
  });

  it("a preset given as traits plays like the aggressiveness", async () => {
    for (const aggression of AGGRESSIONS) {
      for (const [cards, auction] of [["KQJ54.KJ543.32.4", ""], ["KJ954.Q32.J2.432", "1D"], ["KQ32.4.KJ32.Q432", "1H"], ["QJT987.4.K32.432", ""]] as const) {
        expect(await one(cards, auction, TRAIT_PRESETS[aggression])).toBe(await one(cards, auction, aggression));
      }
    }
  });
});

const suitNames: Readonly<Record<string, Suit>> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
/** Cards written as "SA SK H2". */
const cards = (text: string): Hand => text.split(" ").map((value) => ({ suit: suitNames[value[0]!]!, rank: value[1]! })) as unknown as Hand;
const card = (text: string): Card => cards(text)[0]!;
const play = (style: Style, context: PlayContext, skill: SkillLevel = "advanced") =>
  createBot({ skill, biddingStyle: "SAYC", ...configOf(style) }).chooseCard(context);

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

  it("card dials act alone", async () => {
    const second: PlayContext = { seat: "west", declarer: "north", trump: "spades", ledSuit: "hearts", played: [],
      currentTrick: [{ seat: "south", card: card("H5") }], hand: cards("HK HT H2 D4") };
    expect(await play({ leads: "bold" }, lead)).toEqual(card("HA"));
    expect(await play({ leads: "bold" }, second)).toEqual(await play("normal", second));
    expect(await play({ secondHand: "cautious" }, second)).toEqual(card("H2"));
    expect(await play({ secondHand: "cautious" }, lead)).toEqual(await play("normal", lead));
  });
});
