import { checkClaim } from "@contractplay/bots";
import { rewindTo, type GameAction } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { botToAct } from "./hand.js";
import type { TableState } from "./state.js";
import { send, sendOk, tableInPlay } from "./test-helpers.js";
import { viewFor } from "./view.js";

const act = (state: TableState, action: GameAction) =>
  ({ type: "act" as const, handNumber: state.handNumber, revision: state.revision, action });
/** An answer to the claim pending in `state`. */
const answer = (state: TableState, accept: boolean) =>
  ({ type: "answerClaim" as const, accept, claimId: state.pendingClaim?.madeAt ?? 0 });

/** South human declarer, North bot dummy, East and West human defenders; dummy to play to the opening lead. */
const humanDefenders = () => tableInPlay({ north: "bot", east: "human", south: "human", west: "human" });
/** As above but West is a bot. */
const robotWest = () => tableInPlay({ north: "bot", east: "human", south: "human", west: "bot" });

/** The controller of the seat to play plays its first legal card. */
function playNext(t: TableState, player: string): TableState {
  const game = t.game!;
  const seat = game.currentActor;
  const led = game.currentTrick[0]?.card.suit;
  const hand = game.hands[seat];
  const card = hand.find((c) => c.suit === led) ?? hand[0]!;
  return sendOk(t, player, act(t, { type: "play", seat, card }));
}
/** South plays dummy's card to the opening lead, so East is to play. */
const dummyPlays = (t: TableState) => playNext(t, "south");

describe("claims", () => {
  it("lets the human on turn claim and waits on both human defenders", () => {
    const start = humanDefenders();
    let t = sendOk(start, "south", { type: "claim", tricks: 7 });
    expect(t.pendingClaim).toEqual({ seat: "south", tricks: 7, responders: ["east", "west"], accepted: [], madeAt: start.revision + 1 });
    expect(viewFor(t, "east").claim).toEqual({ seat: "south", tricks: 7, waitingOn: ["east", "west"], madeAt: start.revision + 1 });
    t = sendOk(t, "east", answer(t, true));
    expect(viewFor(t, "south").claim!.waitingOn).toEqual(["west"]);
    expect(t.game!.phase).toBe("play");
    t = sendOk(t, "west", answer(t, true));
    expect(t.game!.phase).toBe("complete");
    expect(t.game!.claim).toEqual({ seat: "south", tricks: 7 });
    expect(t.pendingClaim).toBeUndefined();
    // The claimed hand is scored on the rubber.
    expect(t.rubber!.hands.map((hand) => hand.handId)).toEqual([t.rubber!.activeHandId]);
    expect(viewFor(t, "east").claim).toBeUndefined();
  });

  it("cancels on the first rejection and records who rejected", () => {
    let t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 13 });
    const pending = t;
    t = sendOk(t, "east", answer(t, false));
    expect(t.pendingClaim).toBeUndefined();
    expect(t.claimRejected).toEqual({ seat: "south", tricks: 13, by: "east" });
    expect(viewFor(t, "south").claimRejected).toEqual({ seat: "south", tricks: 13, by: "east" });
    expect(t.game!.phase).toBe("play");
    expect(send(t, "west", answer(pending, true)).refused).toBe("not-allowed");
    t = dummyPlays(t);
    expect(t.claimRejected).toBeUndefined();
  });

  it("refuses an answer that names another claim as stale", () => {
    const t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 7 });
    const out = send(t, "east", { type: "answerClaim", accept: true, claimId: t.pendingClaim!.madeAt - 1 });
    expect(out.refused).toBe("stale");
    expect(out.state.pendingClaim!.accepted).toEqual([]);
  });

  it("has a robot defender answer at once with the check", () => {
    // Claiming none of the remaining tricks always holds.
    let t = sendOk(robotWest(), "south", { type: "claim", tricks: 0 });
    expect(t.pendingClaim).toMatchObject({ seat: "south", tricks: 0, accepted: ["west"] });
    expect(viewFor(t, "east").claim!.waitingOn).toEqual(["east"]);
    t = sendOk(t, "east", answer(t, true));
    expect(t.game!.claim).toEqual({ seat: "south", tricks: 0 });

    const start = robotWest();
    expect(checkClaim(start.game!, { seat: "south", tricks: 13 })).not.toBe("proven");
    t = sendOk(start, "south", { type: "claim", tricks: 13 });
    expect(t.pendingClaim).toBeUndefined();
    expect(t.claimRejected).toEqual({ seat: "south", tricks: 13, by: "west" });
    expect(t.game!.phase).toBe("play");
  });

  it("refuses claims off turn, from a dummy, while pending, and outside play", () => {
    const t = humanDefenders();
    expect(send(t, "east", { type: "claim", tricks: 1 }).refused).toBe("not-your-turn");
    const humanDummy = tableInPlay({ north: "human", east: "human", south: "human", west: "human" });
    expect(send(humanDummy, "north", { type: "claim", tricks: 1 }).refused).toBe("not-your-turn");
    const pending = sendOk(t, "south", { type: "claim", tricks: 1 });
    expect(send(pending, "south", { type: "claim", tricks: 2 }).refused).toBe("not-allowed");
    const auction: TableState = { ...t, game: rewindTo(t.game!, 2) };
    expect(auction.game!.phase).toBe("auction");
    expect(send(auction, "south", { type: "claim", tricks: 1 }).refused).toBe("not-allowed");
    expect(send(t, "south", { type: "claim", tricks: 14 }).refused).toBe("illegal");
    expect(send(t, "nobody", { type: "claim", tricks: 1 }).refused).toBe("not-seated");
  });

  it("lets a side claim once per trick: after a rejection or withdrawal it waits for the trick to complete", () => {
    const start = humanDefenders();
    const claimed = sendOk(start, "south", { type: "claim", tricks: 13 });
    const rejected = sendOk(claimed, "east", answer(claimed, false));
    expect(send(rejected, "south", { type: "claim", tricks: 1 }).refused).toBe("not-allowed");
    const withdrawn = sendOk(sendOk(start, "south", { type: "claim", tricks: 9 }), "south", { type: "withdrawClaim" });
    expect(send(withdrawn, "south", { type: "claim", tricks: 1 }).refused).toBe("not-allowed");

    // The other side may still claim in the same trick.
    let t = dummyPlays(rejected);
    expect(sendOk(t, "east", { type: "claim", tricks: 0 }).pendingClaim).toBeDefined();
    // Once the trick completes, North-South (on lead with dummy's winner) may claim again.
    t = playNext(t, "east");
    t = playNext(t, "south");
    expect(t.game!.completedTricks).toHaveLength(1);
    expect(["north", "south"]).toContain(t.game!.currentActor);
    expect(sendOk(t, "south", { type: "claim", tricks: 1 }).pendingClaim).toBeDefined();
    // A block from another hand does not apply.
    expect(sendOk({ ...rejected, handNumber: rejected.handNumber + 1 }, "south", { type: "claim", tricks: 1 }).pendingClaim).toBeDefined();
  });

  it("freezes play while a claim is pending", () => {
    const t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 7 });
    const card = t.game!.hands.north[0]!;
    expect(send(t, "south", act(t, { type: "play", seat: "north", card })).refused).toBe("not-allowed");
    // A bot to act (West's opening lead) does not act while a claim is pending.
    const lead = tableInPlay({ north: "bot", east: "human", south: "human", west: "bot" }, false);
    expect(botToAct(lead)).toBe("west");
    expect(botToAct({ ...lead, pendingClaim: { seat: "west", tricks: 1, responders: ["south"], accepted: [], madeAt: 0 } })).toBeUndefined();
  });

  it("clears a pending claim on take-back, cancel, leave, resume, and Auto play", () => {
    // East (a defender) claims after South plays dummy's card: South answers for the declaring side.
    const t = sendOk(dummyPlays(humanDefenders()), "east", { type: "claim", tricks: 0 });
    expect(t.pendingClaim).toMatchObject({ seat: "east", responders: ["south"], accepted: [] });
    expect(viewFor(t, "east").claim!.waitingOn).toEqual(["south"]);

    expect(sendOk(t, "south", { type: "takeBack" }).pendingClaim).toBeUndefined();
    expect(sendOk(t, "south", { type: "cancelHand" }).pendingClaim).toBeUndefined();
    const left = sendOk(t, "west", { type: "leave" });
    expect(left.pendingClaim).toBeUndefined();
    expect(left.game!.phase).toBe("play");
    const auto = sendOk(t, "south", { type: "autoPlay" });
    expect(auto.pendingClaim).toBeUndefined();
    expect(auto.game!.phase).toBe("play");

    // West (East's partner, not a responder) is on Auto play when East claims, then takes the seat back.
    const westAuto = sendOk(dummyPlays(humanDefenders()), "west", { type: "autoPlay" });
    const claimed = sendOk(westAuto, "east", { type: "claim", tricks: 0 });
    expect(claimed.pendingClaim).toBeDefined();
    expect(sendOk(claimed, "west", { type: "resume" }).pendingClaim).toBeUndefined();

    // Seats can only be cleared between hands, so a pending claim is never cleared that way: it is refused.
    const clear = send(t, "south", { type: "clearSeat", seat: "west" });
    expect(clear.refused).toBe("hand-in-progress");
    expect(clear.state.pendingClaim).toBeDefined();
  });

  it("keeps a pending claim when an away responder is handed to a bot, and its stand-in answers at once", () => {
    const t = sendOk(dummyPlays(humanDefenders()), "east", { type: "claim", tricks: 0 });
    const handed = sendOk({ ...t, awaySince: { south: 5 } }, "west", { type: "handToBot", seat: "south" });
    expect(handed.pendingClaim).toBeUndefined();
    expect(handed.game!.phase).toBe("complete");
    expect(handed.game!.claim).toEqual({ seat: "east", tricks: 0 });
  });

  it("clears a pending claim when the claimer or a seat that does not answer is handed to a bot", () => {
    const t = sendOk(dummyPlays(humanDefenders()), "east", { type: "claim", tricks: 0 });
    const claimer = sendOk({ ...t, awaySince: { east: 5 } }, "south", { type: "handToBot", seat: "east" });
    expect(claimer.pendingClaim).toBeUndefined();
    expect(claimer.claimRejected).toBeUndefined();
    expect(claimer.game!.phase).toBe("play");
    const partner = sendOk({ ...t, awaySince: { west: 5 } }, "south", { type: "handToBot", seat: "west" });
    expect(partner.pendingClaim).toBeUndefined();
    // A responder that already accepted is not asked again: handing them over clears the claim.
    const both = sendOk(humanDefenders(), "south", { type: "claim", tricks: 7 });
    const eastAccepted = sendOk(both, "east", answer(both, true));
    const handedEast = sendOk({ ...eastAccepted, awaySince: { east: 5 } }, "west", { type: "handToBot", seat: "east" });
    expect(handedEast.pendingClaim).toBeUndefined();
  });

  it("fixes who must answer when the claim is made, so an away human dummy holds it open", () => {
    // South is a bot declarer and North a human dummy who decides for both hands.
    let t = tableInPlay({ north: "human", east: "human", south: "bot", west: "human" });
    t = playNext(t, "north");
    t = sendOk(t, "east", { type: "claim", tricks: 0 });
    expect(t.pendingClaim!.responders).toEqual(["north"]);
    const away: TableState = { ...t, awaySince: { north: 5 } };
    expect(viewFor(away, "east").claim!.waitingOn).toEqual(["north"]);
    const done = sendOk(away, "north", answer(away, true));
    expect(done.game!.claim).toEqual({ seat: "east", tricks: 0 });
  });

  it("lets the claimer withdraw", () => {
    const t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 9 });
    expect(send(t, "east", { type: "withdrawClaim" }).refused).toBe("not-allowed");
    const withdrawn = sendOk(t, "south", { type: "withdrawClaim" });
    expect(withdrawn.pendingClaim).toBeUndefined();
    expect(withdrawn.claimRejected).toBeUndefined();
    expect(withdrawn.game!.phase).toBe("play");
    expect(send(withdrawn, "south", { type: "withdrawClaim" }).refused).toBe("not-allowed");
  });

  it("refuses answers from the claimer's side and from those who already answered", () => {
    const t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 9 });
    expect(send(t, "south", answer(t, true)).refused).toBe("not-allowed");
    const once = sendOk(t, "east", answer(t, true));
    expect(send(once, "east", answer(once, true)).refused).toBe("not-allowed");
    expect(send(humanDefenders(), "east", answer(t, true)).refused).toBe("not-allowed");
  });
});
