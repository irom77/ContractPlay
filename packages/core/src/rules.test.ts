import { describe, expect, it } from "vitest";
import type { Card, Hand, Seat } from "./cards.js";
import { forcedCard } from "./rules.js";

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });
const empty: Hand = [];
const position = (hand: Hand, lead?: Card, phase = "play") => ({
  phase,
  currentActor: "east" as Seat,
  hands: { north: empty, east: hand, south: empty, west: empty },
  currentTrick: lead ? [{ seat: "north" as Seat, card: lead }] : []
});

describe("forcedCard", () => {
  it("returns a singleton in the led suit", () => {
    expect(forcedCard(position([c("5", "hearts"), c("A", "spades"), c("2", "clubs")], c("K", "hearts")))).toEqual(c("5", "hearts"));
  });

  it("returns the last card in hand, on lead or not", () => {
    expect(forcedCard(position([c("7", "diamonds")]))).toEqual(c("7", "diamonds"));
    expect(forcedCard(position([c("7", "diamonds")], c("A", "clubs")))).toEqual(c("7", "diamonds"));
  });

  it("leaves a real choice to the player", () => {
    expect(forcedCard(position([c("5", "hearts"), c("9", "hearts")], c("K", "hearts")))).toBeUndefined();
    expect(forcedCard(position([c("5", "spades"), c("9", "clubs")], c("K", "hearts")))).toBeUndefined();
    expect(forcedCard(position([c("5", "spades"), c("9", "clubs")]))).toBeUndefined();
  });

  it("does nothing outside card play", () => {
    expect(forcedCard(position([c("7", "diamonds")], undefined, "auction"))).toBeUndefined();
    expect(forcedCard(position([c("7", "diamonds")], undefined, "complete"))).toBeUndefined();
  });
});
