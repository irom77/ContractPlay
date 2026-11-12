import {
  SEATS, applyAction, cardId, claimSeatFor, createDeck, createGameState, deal, shuffle,
  type Card, type Contract, type GameState, type Hand, type Seat, type Suit, type TrickCard
} from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { checkClaim } from "./claim.js";

const suitNames: Readonly<Record<string, Suit>> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
/** Cards written as "SA SK H2". */
const cards = (text: string): Hand => text.split(" ").filter(Boolean).map((value) => ({ suit: suitNames[value[0]!]!, rank: value[1]! })) as unknown as Hand;
const card = (text: string): Card => cards(text)[0]!;

/** A play-phase state for an ending: every card not in a hand or the current trick sits in the completed tricks. */
function ending(input: {
  hands: Readonly<Record<Seat, string>>;
  strain: Contract["strain"];
  declarer: Seat;
  actor: Seat;
  currentTrick?: readonly TrickCard[];
}): GameState {
  const hands = Object.fromEntries(SEATS.map((seat) => [seat, cards(input.hands[seat])])) as Record<Seat, Hand>;
  const currentTrick = input.currentTrick ?? [];
  const held = new Set([...SEATS.flatMap((seat) => hands[seat]), ...currentTrick.map((play) => play.card)].map(cardId));
  const gone = createDeck().filter((value) => !held.has(cardId(value)));
  const completedTricks = Array.from({ length: gone.length / 4 }, (_, trick) =>
    SEATS.map((seat, index) => ({ seat, card: gone[trick * 4 + index]! })));
  const base = createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
  return {
    ...base,
    phase: "play",
    contract: { level: 1, strain: input.strain, declarer: input.declarer, doubled: 0 },
    hands,
    currentTrick,
    completedTricks,
    currentActor: input.actor,
    trickLeader: currentTrick[0]?.seat ?? input.actor
  };
}

const topTrumps = (declarer: Seat) => ending({
  hands: { south: "SA SK SQ", north: "H2 H3 H4", east: "HA HK HQ", west: "DA DK DQ" },
  strain: "spades", declarer, actor: "south"
});

/** A fresh 13-card play position from a fixed shuffle, after 1NT by north. */
function fullHand(): GameState {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let state = createGameState({ deal: deal(shuffle(createDeck(), random)), dealer: "north", vulnerability: "None" });
  for (const [seat, bid] of [["north", "1notrump"], ["east", "pass"], ["south", "pass"], ["west", "pass"]] as const) {
    const result = applyAction(state, { type: "bid", seat, bid });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

describe("checkClaim", () => {
  it("proves a claim of all top trumps", () => {
    expect(checkClaim(topTrumps("south"), { seat: "south", tricks: 3 })).toBe("proven");
  });

  it("refutes a claim that loses to best defence", () => {
    const state = ending({
      hands: { south: "SK SQ", west: "SA S3", north: "H2 H3", east: "H4 H5" },
      strain: "notrump", declarer: "south", actor: "south"
    });
    expect(checkClaim(state, { seat: "south", tricks: 2 })).toBe("refuted");
    expect(checkClaim(state, { seat: "south", tricks: 1 })).toBe("proven");
  });

  it("checks a claim from inside a trick", () => {
    const state = ending({
      hands: { north: "S2 D2", east: "H3 D3", south: "DA D5", west: "DK" },
      strain: "spades", declarer: "south", actor: "north",
      currentTrick: [{ seat: "west", card: card("HA") }]
    });
    const before = structuredClone(state);
    expect(checkClaim(state, { seat: "south", tricks: 2 })).toBe("proven");
    expect(checkClaim(state, { seat: "west", tricks: 1 })).toBe("refuted");
    expect(state).toEqual(before);
    // Without the ruff, west's ace takes the trick in progress.
    const noRuff = ending({
      hands: { north: "H2 D2", east: "H3 D3", south: "DA D5", west: "DK" },
      strain: "spades", declarer: "south", actor: "north",
      currentTrick: [{ seat: "west", card: card("HA") }]
    });
    expect(checkClaim(noRuff, { seat: "south", tricks: 2 })).toBe("refuted");
    expect(checkClaim(noRuff, { seat: "south", tricks: 1 })).toBe("proven");
    // The search backtracks into the trick in progress after trying later tricks.
    const deeper = ending({
      hands: { north: "SQ S8 CT C3", east: "S6 H4 H3 C6", south: "H8 C5 C2", west: "S4 D7 C9" },
      strain: "spades", declarer: "north", actor: "north",
      currentTrick: [{ seat: "south", card: card("CK") }, { seat: "west", card: card("C8") }]
    });
    expect(checkClaim(deeper, { seat: "north", tricks: 4 })).toBe("proven");
  });

  it("checks a defender's claim", () => {
    const state = topTrumps("east");
    expect(claimSeatFor(state)).toBe("south");
    expect(checkClaim(state, { seat: "south", tricks: 3 })).toBe("proven");
    expect(checkClaim(state, { seat: "east", tricks: 1 })).toBe("refuted");
  });

  it("gives up as unknown on a full hand with a tiny budget", () => {
    const state = fullHand();
    expect(checkClaim(state, { seat: claimSeatFor(state)!, tricks: 7 }, 50)).toBe("unknown");
  });

  it("stays fast on a full hand at the default budget", () => {
    const state = fullHand();
    const start = performance.now();
    const verdict = checkClaim(state, { seat: claimSeatFor(state)!, tricks: 7 });
    expect(performance.now() - start).toBeLessThan(250);
    expect(["proven", "refuted", "unknown"]).toContain(verdict);
  });
});
