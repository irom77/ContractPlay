import { describe, expect, it } from "vitest";
import { applyAction, createDeck, createGameState, deal, legalCards, type Card, type GameAction, type GameState, type Seat } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
import { queuedPlay, queueStillValid, type QueuedCard } from "./queuedCard.js";

function apply(game: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce((state, action) => {
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  }, game);
}

/** 1NT by North, all pass: North declares, South is dummy, East leads. */
const oneNoTrump = () => apply(
  createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" }),
  { type: "bid", seat: "north", bid: "1notrump" }, { type: "bid", seat: "east", bid: "pass" },
  { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "pass" }
);

function playOne(game: GameState): GameState {
  const seat = game.currentActor;
  return apply(game, { type: "play", seat, card: legalCards(game.hands[seat], game.currentTrick[0]?.card.suit)[0]! });
}

const queue = (seat: Seat, card: Card, handKey = "hand-1"): QueuedCard => ({ handKey, seat, card });

/** A card of `seat` that may not be played to the current trick, if any. */
const illegalCard = (game: GameState, seat: Seat): Card | undefined => {
  const led = game.currentTrick[0]?.card.suit;
  return game.hands[seat].find((card) => !legalCards(game.hands[seat], led).includes(card));
};

/** Plays from East's lead until `seat` must follow a suit it holds while also holding another suit. */
function followingWithChoice(seat: Seat): GameState {
  let game = playOne(oneNoTrump());
  for (let guard = 0; guard < 52; guard += 1) {
    if (game.currentActor === seat && game.currentTrick.length > 0 && illegalCard(game, seat)) return game;
    game = playOne(game);
  }
  throw new Error("no such position");
}

describe("queuedPlay", () => {
  it("returns the queued card on its seat's turn", () => {
    const game = playOne(oneNoTrump()); // East led; South (dummy) is to play.
    const card = legalCards(game.hands.south, game.currentTrick[0]!.card.suit)[0]!;
    expect(queuedPlay(game as PublicGame, queue("south", card), "south")).toEqual(card);
  });

  it("returns nothing on the partner seat's turn: declarer's own card waits while dummy is to act", () => {
    const game = playOne(oneNoTrump());
    expect(game.currentActor).toBe("south");
    const declarerCard = game.hands.north[0]!;
    expect(queuedPlay(game as PublicGame, queue("north", declarerCard), "south")).toBeUndefined();
    expect(queuedPlay(game as PublicGame, queue("north", declarerCard), "north")).toBeUndefined();
  });

  it("returns nothing when the card is illegal because the player must follow suit", () => {
    const game = followingWithChoice("south");
    const card = illegalCard(game, "south")!;
    expect(queuedPlay(game as PublicGame, queue("south", card), "south")).toBeUndefined();
  });

  it("returns nothing without a queued card or an acting seat", () => {
    const game = playOne(oneNoTrump());
    expect(queuedPlay(game as PublicGame, undefined, "south")).toBeUndefined();
    expect(queuedPlay(game as PublicGame, queue("south", game.hands.south[0]!), undefined)).toBeUndefined();
  });
});

describe("queueStillValid", () => {
  it("holds a card still in hand while another seat is to act", () => {
    const game = playOne(oneNoTrump());
    expect(queueStillValid(game as PublicGame, queue("north", game.hands.north[0]!), "hand-1", false)).toBe(true);
  });

  it("is false on a new hand", () => {
    const game = playOne(oneNoTrump());
    expect(queueStillValid(game as PublicGame, queue("north", game.hands.north[0]!), "hand-2", false)).toBe(false);
  });

  it("is false while a claim is pending", () => {
    const game = playOne(oneNoTrump());
    expect(queueStillValid(game as PublicGame, queue("north", game.hands.north[0]!), "hand-1", true)).toBe(false);
  });

  it("is false outside card play and once the card has left the hand", () => {
    const auction = createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
    expect(queueStillValid(auction as PublicGame, queue("north", auction.hands.north[0]!), "hand-1", false)).toBe(false);
    const before = oneNoTrump();
    const after = playOne(before);
    const led = after.currentTrick[0]!.card;
    expect(queueStillValid(after as PublicGame, queue("east", led), "hand-1", false)).toBe(false);
    const hidden = { ...after, hands: { ...after.hands, north: [] } } as PublicGame;
    expect(queueStillValid(hidden, queue("north", after.hands.north[0]!), "hand-1", false)).toBe(false);
  });

  it("is false when its seat is to act and the card is illegal, true for a legal one", () => {
    const game = followingWithChoice("south");
    expect(queueStillValid(game as PublicGame, queue("south", illegalCard(game, "south")!), "hand-1", false)).toBe(false);
    const legal = legalCards(game.hands.south, game.currentTrick[0]!.card.suit)[0]!;
    expect(queueStillValid(game as PublicGame, queue("south", legal), "hand-1", false)).toBe(true);
  });
});
