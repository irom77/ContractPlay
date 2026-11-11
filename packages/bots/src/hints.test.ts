import { applyAction, cardId, createDeck, createGameState, deal, SEATS, shuffle, type Bid, type Hand, type PlayContext, type PublicBid, type Seat } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { explainBid, explainPlay, highCardPoints, suggestBid, suggestPlay } from "./hints.js";
import { createBot } from "./player.js";

const hand = (...cards: string[]): Hand => cards.map((value) => {
  const [suit, rank] = value.split(":") as [Hand[number]["suit"], Hand[number]["rank"]];
  return { suit, rank };
});

/** Builds an auction dealt by North from compact calls such as "1S", "P", "X", "2NT". */
function auction(...calls: string[]): PublicBid[] {
  const strains: Record<string, string> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades", NT: "notrump" };
  return calls.map((call, index) => ({
    seat: SEATS[index % 4]!,
    bid: (call === "P" ? "pass" : call === "X" ? "double" : call === "XX" ? "redouble" : `${call[0]}${strains[call.slice(1)]}`) as Bid
  }));
}

const meaning = (calls: string[], style: "SAYC" | "2/1" = "SAYC", skill: "beginner" | "expert" = "expert") =>
  explainBid(auction(...calls), calls.length - 1, style, skill);

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

describe("highCardPoints", () => {
  it("counts aces, kings, queens and jacks", () => {
    expect(highCardPoints(hand("spades:A", "spades:K", "hearts:Q", "hearts:J", "clubs:T", "clubs:2"))).toBe(10);
  });
});

describe("explainBid", () => {
  it("describes opening bids", () => {
    expect(meaning(["1S"])).toContain("12–21 points with at least five spades");
    expect(meaning(["P", "1C"])).toContain("at least three clubs");
    expect(meaning(["1NT"])).toContain("15–17 points");
    expect(meaning(["2C"])).toContain("Strong and artificial");
    expect(meaning(["2H"])).toContain("Weak two");
    expect(meaning(["3D"])).toContain("Preempt");
    expect(meaning(["P"])).toContain("Not enough to open");
  });

  it("describes responses to a suit opening in each style", () => {
    expect(meaning(["1H", "P", "1S"])).toContain("four or more spades and 6+ points");
    expect(meaning(["1H", "P", "2H"])).toContain("6–10 points");
    expect(meaning(["1H", "P", "3H"])).toContain("Limit raise");
    expect(meaning(["1S", "P", "1NT"], "SAYC")).toContain("6–10 points");
    expect(meaning(["1S", "P", "1NT"], "2/1")).toContain("Forcing 1NT");
    expect(meaning(["1S", "P", "2D"], "SAYC")).toContain("10+ points");
    expect(meaning(["1S", "P", "2D"], "2/1")).toContain("Forcing to game");
    expect(meaning(["1S", "P", "2NT"])).toContain("Jacoby 2NT");
    expect(meaning(["1H", "P", "P"])).toContain("Fewer than 6 points");
  });

  it("explains Jacoby 2NT answers, a reopening double, and a waiting 2NT after 2C", () => {
    expect(meaning(["1S", "P", "2NT", "P", "3S"])).toContain("18+ points and no short suit");
    expect(meaning(["1S", "P", "2NT", "P", "3NT"])).toContain("15–17 points");
    expect(meaning(["1S", "P", "2NT", "P", "4S"])).toContain("minimum opening");
    expect(meaning(["1S", "P", "2NT", "P", "3D"])).toContain("singleton or void in diamonds");
    expect(meaning(["1D", "1S", "P", "P", "X"])).toContain("Reopening double");
    expect(meaning(["2C", "P", "2D", "P", "2S", "P", "2NT"])).toContain("still forcing");
  });

  it("does not treat a passed hand's two-level response as game forcing", () => {
    expect(meaning(["P", "P", "1S", "P", "2D"], "2/1")).toContain("10+ points");
  });

  it("explains Expert-only conventions only for an Expert bidder", () => {
    expect(meaning(["1H", "P", "3C"], "SAYC", "expert")).toContain("Splinter");
    expect(meaning(["1H", "P", "3C"], "SAYC", "beginner")).toContain("Jump shift");
    expect(meaning(["P", "P", "1S", "P", "2C"], "SAYC", "expert")).toContain("Reverse Drury");
    expect(meaning(["P", "P", "1S", "P", "2C"], "SAYC", "beginner")).toContain("10+ points");
    expect(meaning(["P", "P", "1S", "P", "2C", "P", "2D"])).toContain("sound, full-strength opening");
    expect(meaning(["1NT", "2H", "2NT"], "SAYC", "expert")).toContain("Lebensohl");
    expect(meaning(["1NT", "2H", "2NT"], "SAYC", "beginner")).toContain("Invites game");
  });

  it("explains Stayman, transfers and their answers over notrump", () => {
    expect(meaning(["1NT", "P", "2C"])).toContain("Stayman");
    expect(meaning(["1NT", "P", "2C", "P", "2D"])).toContain("no four-card major");
    expect(meaning(["1NT", "P", "2C", "P", "2H"])).toContain("four hearts");
    expect(meaning(["1NT", "P", "2D"])).toContain("Jacoby transfer: five or more hearts");
    expect(meaning(["1NT", "P", "2D", "P", "2H"])).toContain("Completes the transfer to hearts");
    expect(meaning(["2NT", "P", "3C"])).toContain("Stayman");
    expect(meaning(["1NT", "P", "2NT"])).toContain("8–9 points");
    expect(meaning(["1NT", "P", "4C"])).toContain("Gerber");
    expect(meaning(["1NT", "P", "4C", "P", "4H"])).toContain("one ace");
    expect(meaning(["1NT", "P", "4NT"])).toContain("Quantitative");
  });

  it("explains competitive calls", () => {
    expect(meaning(["1D", "1S"])).toContain("Overcall: five or more spades");
    expect(meaning(["1D", "2S"])).toContain("Weak jump overcall");
    expect(meaning(["1D", "1NT"])).toContain("15–18 points");
    expect(meaning(["1D", "2NT"])).toContain("Unusual 2NT");
    expect(meaning(["1H", "2H"])).toContain("Michaels");
    expect(meaning(["1H", "X"])).toContain("Takeout double");
    expect(meaning(["1H", "X", "P", "1S"])).toContain("Answers the takeout double");
    expect(meaning(["1H", "X", "P", "2S"])).toContain("9–11 points");
    expect(meaning(["1D", "1S", "X"])).toContain("Negative double");
    expect(meaning(["1C", "1H", "1S"])).toContain("five or more spades");
    expect(meaning(["1D", "P", "1H", "1S", "X"])).toContain("Support double");
    expect(meaning(["1H", "X", "XX"])).toContain("10+ points");
    expect(meaning(["1NT", "X"])).toContain("Penalty double");
    expect(meaning(["1D", "1S", "P", "2S"])).toContain("Raises partner's overcall");
    expect(meaning(["1D", "1S", "P", "2D"])).toContain("good raise of partner's spades");
    expect(meaning(["1H", "1S", "2S"])).toContain("good raise of partner's hearts");
  });

  it("explains opener's rebids and ace asking", () => {
    expect(meaning(["1C", "P", "1S", "P", "1NT"])).toContain("12–14 points");
    expect(meaning(["1C", "P", "1S", "P", "2NT"])).toContain("18–19 points");
    expect(meaning(["1D", "P", "1S", "P", "2H"])).toContain("Reverse");
    expect(meaning(["1H", "P", "1S", "P", "2H"])).toContain("Rebids hearts");
    expect(meaning(["1H", "P", "1S", "P", "2S"])).toContain("Raises partner's spades");
    expect(meaning(["1C", "P", "1H", "P", "1S", "P", "2D"])).toContain("Fourth suit");
    expect(meaning(["2C", "P", "2D"])).toContain("Waiting bid");
    expect(meaning(["2C", "P", "2D", "P", "2S"])).toContain("real suit");
    expect(meaning(["2H", "P", "2NT"])).toContain("feature");
    expect(meaning(["2H", "P", "2NT", "P", "3H"])).toContain("minimum weak two");
    expect(meaning(["1S", "P", "3S", "P", "4NT"])).toContain("Blackwood");
    expect(meaning(["1S", "P", "3S", "P", "4NT", "P", "5D"])).toContain("one ace");
    expect(meaning(["1S", "P", "3S", "P", "4NT", "P", "5D", "P", "6S"])).toContain("Small slam");
    expect(meaning(["1S", "P", "2S", "P", "P"])).toContain("content to play in 2♠");
  });

  it("gives a non-empty meaning for every call the bots make", async () => {
    for (const style of ["SAYC", "2/1"] as const) {
      const bot = createBot({ skill: "expert", biddingStyle: style });
      for (let seed = 1; seed <= 60; seed++) {
        let game = createGameState({ deal: deal(shuffle(createDeck(), seededRandom(seed))), dealer: SEATS[seed % 4]!, vulnerability: "None" });
        while (game.phase === "auction") {
          const seat: Seat = game.currentActor;
          const result = applyAction(game, { type: "bid", seat, bid: await bot.chooseBid(game.hands[seat], game.auction, seat) });
          if (!result.ok) break;
          game = result.state;
          expect(explainBid(game.auction, game.auction.length - 1, style).length).toBeGreaterThan(10);
        }
      }
    }
  });
});

describe("suggestBid", () => {
  it("returns the Expert bot's call with its meaning", async () => {
    const opener = hand("spades:A", "spades:K", "spades:Q", "spades:5", "spades:4", "hearts:K", "hearts:3", "diamonds:8", "diamonds:7", "diamonds:2", "clubs:9", "clubs:6", "clubs:3");
    const hint = await suggestBid(opener, [], "north", "SAYC");
    expect(hint.bid).toBe("1spades");
    expect(hint.reason).toContain("five spades");
  });
});

describe("play hints", () => {
  const context = (seat: Seat, cards: Hand, trick: [Seat, string][], trump?: Hand[number]["suit"]): PlayContext => {
    const currentTrick = trick.map(([player, card]) => ({ seat: player, card: hand(card)[0]! }));
    return { seat, hand: cards, currentTrick, ...(currentTrick[0] ? { ledSuit: currentTrick[0].card.suit } : {}), ...(trump ? { trump } : {}) };
  };

  it("leads the top of touching honours and says so", async () => {
    const hint = await suggestPlay(context("west", hand("spades:K", "spades:Q", "spades:4", "hearts:8", "hearts:3"), []));
    expect(cardId(hint.card)).toBe(cardId({ suit: "spades", rank: "K" }));
    expect(hint.reason).toContain("top of touching honours");
  });

  it("plays low when partner is winning the trick", async () => {
    const hint = await suggestPlay(context("south", hand("hearts:K", "hearts:4", "clubs:2"), [["north", "hearts:A"], ["east", "hearts:3"]]));
    expect(cardId(hint.card)).toBe(cardId({ suit: "hearts", rank: "4" }));
    expect(hint.reason).toContain("Partner is already winning");
  });

  it("wins as cheaply as possible when an opponent is winning", async () => {
    const hint = await suggestPlay(context("south", hand("hearts:A", "hearts:J", "hearts:4"), [["west", "hearts:5"], ["north", "hearts:2"], ["east", "hearts:T"]]));
    expect(cardId(hint.card)).toBe(cardId({ suit: "hearts", rank: "J" }));
    expect(hint.reason).toContain("cheapest card");
  });

  it("ruffs an opponent's winner but not partner's", async () => {
    const cards = hand("spades:2", "spades:9", "clubs:3", "clubs:8");
    const ruff = await suggestPlay(context("south", cards, [["west", "hearts:A"]], "spades"));
    expect(ruff.card.suit).toBe("spades");
    expect(ruff.reason).toContain("ruff");
    const discard = await suggestPlay(context("south", cards, [["north", "hearts:A"], ["east", "hearts:3"]], "spades"));
    expect(cardId(discard.card)).toBe(cardId({ suit: "clubs", rank: "3" }));
    expect(discard.reason).toContain("partner is winning");
  });

  it("explains a forced card and a hopeless trick", () => {
    expect(explainPlay(context("south", hand("hearts:4", "clubs:2"), [["west", "hearts:A"]]), { suit: "hearts", rank: "4" })).toContain("only heart");
    expect(explainPlay(context("south", hand("hearts:4", "hearts:6"), [["west", "hearts:K"], ["north", "hearts:2"], ["east", "hearts:A"]]), { suit: "hearts", rank: "4" })).toContain("can't win");
  });

  it("always suggests a legal card", async () => {
    for (let seed = 1; seed <= 25; seed++) {
      let game = createGameState({ deal: deal(shuffle(createDeck(), seededRandom(seed))), dealer: "north", vulnerability: "None" });
      for (const bid of ["1spades", "pass", "pass", "pass"] as const) {
        const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
        if (!result.ok) throw new Error(result.error.message);
        game = result.state;
      }
      while (game.phase === "play") {
        const seat = game.currentActor;
        const hint = await suggestPlay({ seat, hand: game.hands[seat], currentTrick: game.currentTrick, ...(game.currentTrick[0] ? { ledSuit: game.currentTrick[0].card.suit } : {}), trump: "spades" });
        expect(hint.reason.length).toBeGreaterThan(5);
        const result = applyAction(game, { type: "play", seat, card: hint.card });
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        game = result.state;
      }
    }
  });
});
