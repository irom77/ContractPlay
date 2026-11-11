import { describe, expect, it } from "vitest";
import { createDeck, deal, type Card, type Seat } from "./cards.js";
import { applyAction, createGameState, playContextFor, redoAction, replayActions, undoAction } from "./game.js";
import { trickWinner } from "./rules.js";

const initial = () => createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
const bid = (state: ReturnType<typeof initial>, seat: Seat, call: "pass" | "double" | "redouble" | "1hearts" | "1clubs") => {
  const result = applyAction(state, { type: "bid", seat, bid: call });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
const play = (state: ReturnType<typeof initial>, seat: Seat, card: Card) => {
  const result = applyAction(state, { type: "play", seat, card });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};

describe("immutable bridge game transitions", () => {
  it("ends a passed-out auction after four passes", () => {
    const start = initial();
    const end = bid(bid(bid(bid(start, "north", "pass"), "east", "pass"), "south", "pass"), "west", "pass");
    expect(end.phase).toBe("passed-out");
    expect(end.contract).toBeUndefined();
    expect(start.auction).toHaveLength(0);
  });

  it("resolves the first bidder in the declaring partnership as declarer", () => {
    const state = [
      ["north", "1hearts"], ["east", "pass"], ["south", "pass"], ["west", "pass"]
    ].reduce((current, [seat, call]) => bid(current, seat as Seat, call as "1hearts" | "pass"), initial());
    expect(state.phase).toBe("play");
    expect(state.contract).toMatchObject({ level: 1, strain: "hearts", declarer: "north", doubled: 0 });
    expect(state.currentActor).toBe("east");
  });

  it("accepts a double and redouble, while rejecting a contract bid that does not outrank", () => {
    const first = bid(initial(), "north", "1hearts");
    const doubled = bid(first, "east", "double");
    const redoubled = bid(doubled, "south", "redouble");
    const invalid = applyAction(redoubled, { type: "bid", seat: "west", bid: "1clubs" });
    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid-bid" } });
    expect(redoubled.auction).toHaveLength(3);
    const final = bid(bid(bid(redoubled, "west", "pass"), "north", "pass"), "east", "pass");
    expect(final.contract?.doubled).toBe(2);
  });

  it("rejects doubles and redoubles without the required opposing call", () => {
    const start = initial();
    expect(applyAction(start, { type: "bid", seat: "north", bid: "double" })).toMatchObject({
      ok: false, error: { code: "illegal-double" }
    });
    const contract = bid(start, "north", "1hearts");
    expect(applyAction(contract, { type: "bid", seat: "east", bid: "redouble" })).toMatchObject({
      ok: false, error: { code: "illegal-redouble" }
    });
    expect(contract.auction).toHaveLength(1);
  });

  it("rejects a play by the wrong actor without changing the prior state", () => {
    const auctioned = ["pass", "pass", "1clubs", "pass", "pass", "pass"].reduce(
      (current, call, index) => bid(current, (["north", "east", "south", "west", "north", "east"] as Seat[])[index]!, call as "pass" | "1clubs"), initial()
    );
    const result = applyAction(auctioned, { type: "play", seat: "north", card: auctioned.hands.north[0]! });
    expect(result).toMatchObject({ ok: false, error: { code: "wrong-actor" } });
    expect(auctioned.currentTrick).toHaveLength(0);
  });

  it("undoes and redoes actions, then discards the abandoned future on a new action", () => {
    const start = initial();
    const afterOne = bid(start, "north", "1clubs");
    const afterTwo = bid(afterOne, "east", "pass");
    const undone = undoAction(afterTwo);
    expect(undone.currentActor).toBe("east");
    expect(redoAction(undone).auction).toEqual(afterTwo.auction);
    const branched = bid(undone, "east", "double");
    expect(replayActions(branched).map((action) => action.type === "bid" ? action.bid : "play")).toEqual(["1clubs", "double"]);
  });

  it("allows a discard only when a player is void in the led suit", () => {
    const auctioned = ["pass", "pass", "1clubs", "pass", "pass", "pass"].reduce(
      (current, call, index) => bid(current, (["north", "east", "south", "west", "north", "east"] as Seat[])[index]!, call as "pass" | "1clubs"), initial()
    );
    const leader = auctioned.currentActor;
    const leadCard = auctioned.hands[leader].find((card) => card.suit === "clubs")!;
    const led = play(auctioned, leader, leadCard);
    const next = led.currentActor;
    const hasClubs = led.hands[next].some((card) => card.suit === "clubs");
    const wrongSuit = led.hands[next].find((card) => card.suit !== "clubs")!;
    const illegal = applyAction(led, { type: "play", seat: next, card: wrongSuit });
    expect(illegal).toMatchObject({ ok: false, error: { code: "must-follow-suit" } });
    expect(hasClubs).toBe(true);
  });

  it("completes all 13 tricks and scores the contract", () => {
    let state = ["pass", "pass", "1clubs", "pass", "pass", "pass"].reduce(
      (current, call, index) => bid(current, (["north", "east", "south", "west", "north", "east"] as Seat[])[index]!, call as "pass" | "1clubs"), initial()
    );
    while (state.phase === "play") {
      const ledSuit = state.currentTrick[0]?.card.suit;
      const hand = state.hands[state.currentActor];
      const card = (ledSuit ? hand.find((candidate) => candidate.suit === ledSuit) : undefined) ?? hand[0]!;
      state = play(state, state.currentActor, card);
    }
    expect(state.phase).toBe("complete");
    expect(state.completedTricks).toHaveLength(13);
    const declaringTricks = state.completedTricks.filter((trick) => {
      const winner = trickWinner(trick, "clubs");
      return winner === "north" || winner === "south";
    }).length;
    expect(state.score?.tricksTaken).toBe(declaringTricks);
    expect(Object.values(state.hands).flat()).toHaveLength(0);
  });
});

describe("playContextFor", () => {
  it("shows dummy only after the opening lead, and declarer's hand when dummy is to play", () => {
    let state = bid(initial(), "north", "1hearts");
    for (const seat of ["east", "south", "west"] as const) state = bid(state, seat, "pass");
    expect(state.phase).toBe("play");

    const beforeLead = playContextFor(state);
    expect(beforeLead).toMatchObject({ seat: "east", declarer: "north", played: [] });
    expect(beforeLead.visibleHand).toBeUndefined();
    expect(beforeLead.trump).toBe("hearts");

    const lead = state.hands.east[0]!;
    const afterLead = play(state, "east", lead);
    const dummyToPlay = playContextFor(afterLead);
    expect(dummyToPlay.seat).toBe("south");
    expect(dummyToPlay.hand).toEqual(afterLead.hands.south);
    expect(dummyToPlay.visibleHand).toEqual(afterLead.hands.north);
    expect(dummyToPlay.ledSuit).toBe(lead.suit);
    expect(playContextFor(afterLead, "west").visibleHand).toEqual(afterLead.hands.south);
  });
});
