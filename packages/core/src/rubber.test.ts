import { describe, expect, it } from "vitest";
import { applyAction, createGameState, type Contract, type GameState } from "./game.js";
import { deal, type Card, type Deal } from "./cards.js";
import { validatePlay } from "./rules.js";
import { emptyRubber, honorsBonus, nextRubberDeal, recordRubberHand, rubberHandItems, scoreRubberHand, summarizeRubber, type Rubber } from "./rubber.js";

const contract = (level: Contract["level"], strain: Contract["strain"], declarer: Contract["declarer"] = "north", doubled: Contract["doubled"] = 0): Contract => ({ level, strain, declarer, doubled });
const rubberOf = (...hands: ReturnType<typeof scoreRubberHand>[]): Rubber => ({ hands });

describe("rubber hand scoring", () => {
  it("puts contract points below the line and overtricks above it", () => {
    expect(scoreRubberHand("a", contract(2, "spades"), 9, "None")).toMatchObject({ handId: "a", below: { NS: 60, EW: 0 }, above: { NS: 30, EW: 0 } });
    expect(scoreRubberHand("b", contract(3, "notrump", "east"), 9, "None")).toMatchObject({ handId: "b", below: { NS: 0, EW: 100 }, above: { NS: 0, EW: 0 } });
  });

  it("gives defenders the undertricks, vulnerable and doubled", () => {
    expect(scoreRubberHand("a", contract(4, "hearts"), 8, "None").above).toEqual({ NS: 0, EW: 100 });
    expect(scoreRubberHand("a", contract(4, "hearts", "north", 1), 8, "NS").above).toEqual({ NS: 0, EW: 500 });
  });

  it("scores doubled contracts with the insult and doubled overtricks above the line", () => {
    // 2♠X making 9 not vulnerable: 120 below, 100 overtrick + 50 insult above.
    expect(scoreRubberHand("a", contract(2, "spades", "north", 1), 9, "None")).toMatchObject({ handId: "a", below: { NS: 120, EW: 0 }, above: { NS: 150, EW: 0 } });
  });

  it("adds slam bonuses above the line", () => {
    expect(scoreRubberHand("a", contract(6, "spades"), 12, "NS").above.NS).toBe(750);
    expect(scoreRubberHand("a", contract(7, "notrump"), 13, "None").above.NS).toBe(1000);
  });

  it("credits honors to whichever side holds them", () => {
    const cards = (suit: Card["suit"], ranks: string): Card[] => [...ranks].map((rank) => ({ suit, rank: rank as Card["rank"] }));
    const honorsDeal = { east: cards("hearts", "AKQJ"), north: [], south: [], west: [] } as unknown as Deal;
    expect(honorsBonus(contract(4, "hearts"), honorsDeal)).toEqual({ side: "EW", points: 100 });
    const acesDeal = { south: [...cards("spades", "A"), ...cards("hearts", "A"), ...cards("diamonds", "A"), ...cards("clubs", "A")], north: [], east: [], west: [] } as unknown as Deal;
    expect(honorsBonus(contract(3, "notrump", "east"), acesDeal)).toEqual({ side: "NS", points: 150 });
    expect(honorsBonus(contract(3, "spades", "east"), acesDeal)).toBeUndefined();
  });
});

describe("rubber hand items", () => {
  it("lists each part of a made doubled slam, and they add up to the hand's score", () => {
    const items = rubberHandItems(contract(6, "spades", "north", 1), 13, "NS");
    expect(items).toEqual([
      { side: "NS", line: "below", kind: "contract", points: 360 },
      { side: "NS", line: "above", kind: "overtricks", points: 200, count: 1 },
      { side: "NS", line: "above", kind: "insult", points: 50 },
      { side: "NS", line: "above", kind: "slam", points: 750 }
    ]);
    const hand = scoreRubberHand("a", contract(6, "spades", "north", 1), 13, "NS");
    expect(hand.below.NS + hand.above.NS).toBe(items.reduce((sum, item) => sum + item.points, 0));
  });

  it("gives a set contract's undertricks to the defenders, with no overtricks or contract points", () => {
    expect(rubberHandItems(contract(4, "hearts", "east"), 8, "EW")).toEqual([{ side: "NS", line: "above", kind: "undertricks", points: 200, count: 2 }]);
  });

  it("adds honors for the side holding them", () => {
    const cards = (suit: Card["suit"], ranks: string): Card[] => [...ranks].map((rank) => ({ suit, rank: rank as Card["rank"] }));
    const honorsDeal = { west: cards("hearts", "AKQJT"), north: [], south: [], east: [] } as unknown as Deal;
    expect(rubberHandItems(contract(2, "hearts"), 8, "None", honorsDeal).at(-1)).toEqual({ side: "EW", line: "above", kind: "honors", points: 150 });
  });
});

describe("rubber summary", () => {
  it("writes each hand's scores on the pad above and below the line, ending with the rubber bonus", () => {
    const summary = summarizeRubber(rubberOf(
      scoreRubberHand("1", contract(4, "spades"), 11, "None"),
      scoreRubberHand("2", contract(3, "notrump", "east"), 8, "NS"),
      scoreRubberHand("3", contract(3, "notrump"), 9, "NS"),
      scoreRubberHand("4", contract(1, "clubs"), 7, "None")
    ));
    expect(summary.aboveEntries).toEqual({ NS: [{ handId: "1", points: 30 }, { handId: "2", points: 50 }, { handId: "rubber-bonus", points: 700 }], EW: [] });
    expect(summary.games.map((game) => game.wonOn)).toEqual(["1", "3"]);
    expect(summary.wonOn).toBe("3");
    // The hand after the rubber was won is not part of it.
    expect(summary.totals.NS).toBe(120 + 30 + 50 + 100 + 700);
  });

  it("carries part scores until a side reaches 100 and then makes it vulnerable", () => {
    const partScores = rubberOf(scoreRubberHand("1", contract(2, "hearts"), 8, "None"), scoreRubberHand("2", contract(2, "clubs", "east"), 8, "None"));
    expect(summarizeRubber(partScores)).toMatchObject({ games: [{ below: { NS: 60, EW: 40 } }], gamesWon: { NS: 0, EW: 0 }, vulnerability: "None" });

    const game = rubberOf(...partScores.hands, scoreRubberHand("3", contract(2, "diamonds"), 8, "None"));
    const summary = summarizeRubber(game);
    expect(summary.games).toEqual([
      { below: { NS: 100, EW: 40 }, winner: "NS", wonOn: "3", entries: { NS: [{ handId: "1", points: 60 }, { handId: "3", points: 40 }], EW: [{ handId: "2", points: 40 }] } },
      { below: { NS: 0, EW: 0 }, entries: { NS: [], EW: [] } }
    ]);
    expect(summary.vulnerability).toBe("NS");
    expect(summary.winner).toBeUndefined();
  });

  it("ends when a side wins two games, with 700 for two games to none", () => {
    const summary = summarizeRubber(rubberOf(
      scoreRubberHand("1", contract(4, "spades"), 10, "None"),
      scoreRubberHand("2", contract(3, "notrump"), 9, "NS")
    ));
    expect(summary.winner).toBe("NS");
    expect(summary.rubberBonus).toBe(700);
    expect(summary.totals).toEqual({ NS: 120 + 100 + 700, EW: 0 });
    expect(summary.vulnerability).toBe("NS");
  });

  it("gives 500 for a rubber won two games to one", () => {
    const summary = summarizeRubber(rubberOf(
      scoreRubberHand("1", contract(4, "spades"), 10, "None"),
      scoreRubberHand("2", contract(4, "hearts", "east"), 10, "NS"),
      scoreRubberHand("3", contract(5, "clubs"), 11, "Both")
    ));
    expect(summary.gamesWon).toEqual({ NS: 2, EW: 1 });
    expect(summary.rubberBonus).toBe(500);
    expect(summary.vulnerability).toBe("Both");
  });
});

function playOut(game: GameState): GameState {
  while (game.phase === "play") {
    const seat = game.currentActor;
    const lead = game.currentTrick[0]?.card.suit;
    const card = game.hands[seat].find((candidate) => validatePlay(game.hands[seat], candidate, lead).legal)!;
    const result = applyAction(game, { type: "play", seat, card });
    if (!result.ok) throw new Error(result.error.message);
    game = result.state;
  }
  return game;
}

describe("rubber progress", () => {
  it("rotates the dealer and starts a new rubber after one is won", () => {
    let next = nextRubberDeal(emptyRubber(), "east");
    expect(next.dealer).toBe("east");
    next = nextRubberDeal(next.rubber, "east");
    expect(next.dealer).toBe("south");

    const won: Rubber = { ...rubberOf(
      scoreRubberHand("1", contract(4, "spades"), 10, "None"),
      scoreRubberHand("2", contract(4, "spades"), 10, "NS")
    ), lastDealer: "west" };
    const fresh = nextRubberDeal(won, "north");
    expect(fresh.rubber.hands).toEqual([]);
    expect(fresh.dealer).toBe("north");
    expect(fresh.vulnerability).toBe("None");
  });

  it("scores the active hand once when it ends and drops the score if it is taken back", () => {
    let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
    for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
      const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }
    const finished = playOut(game);
    const rubber: Rubber = { hands: [], activeHandId: "h1" };

    const scored = recordRubberHand(rubber, "h1", finished);
    expect(scored.hands).toHaveLength(1);
    expect(recordRubberHand(scored, "h1", finished)).toBe(scored);
    expect(recordRubberHand(scored, "h1", game).hands).toEqual([]);
    expect(recordRubberHand(rubber, "other", finished)).toBe(rubber);
  });
});
