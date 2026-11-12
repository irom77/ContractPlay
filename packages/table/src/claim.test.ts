import { checkClaim } from "@contractplay/bots";
import { rewindTo, type GameAction } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { botToAct } from "./hand.js";
import type { TableState } from "./state.js";
import { send, sendOk, tableInPlay } from "./test-helpers.js";
import { viewFor } from "./view.js";

const act = (state: TableState, action: GameAction) =>
  ({ type: "act" as const, handNumber: state.handNumber, revision: state.revision, action });

/** South human declarer, North bot dummy, East and West human defenders; dummy to play to the opening lead. */
const humanDefenders = () => tableInPlay({ north: "bot", east: "human", south: "human", west: "human" });
/** As above but West is a bot. */
const robotWest = () => tableInPlay({ north: "bot", east: "human", south: "human", west: "bot" });

/** South plays dummy's first legal card, so East is to play. */
function dummyPlays(t: TableState): TableState {
  const led = t.game!.currentTrick[0]!.card.suit;
  const hand = t.game!.hands.north;
  const card = hand.find((c) => c.suit === led) ?? hand[0]!;
  return sendOk(t, "south", act(t, { type: "play", seat: "north", card }));
}

describe("claims", () => {
  it("lets the human on turn claim and waits on both human defenders", () => {
    let t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 7 });
    expect(t.pendingClaim).toEqual({ seat: "south", tricks: 7, accepted: [] });
    expect(viewFor(t, "east").claim).toEqual({ seat: "south", tricks: 7, waitingOn: ["east", "west"] });
    t = sendOk(t, "east", { type: "answerClaim", accept: true });
    expect(viewFor(t, "south").claim!.waitingOn).toEqual(["west"]);
    expect(t.game!.phase).toBe("play");
    t = sendOk(t, "west", { type: "answerClaim", accept: true });
    expect(t.game!.phase).toBe("complete");
    expect(t.game!.claim).toEqual({ seat: "south", tricks: 7 });
    expect(t.pendingClaim).toBeUndefined();
    const score = t.game!.score!.score;
    expect(t.totals).toEqual(score >= 0 ? { ns: score, ew: 0 } : { ns: 0, ew: -score });
    expect(viewFor(t, "east").claim).toBeUndefined();
  });

  it("cancels on the first rejection and records who rejected", () => {
    let t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 13 });
    t = sendOk(t, "east", { type: "answerClaim", accept: false });
    expect(t.pendingClaim).toBeUndefined();
    expect(t.claimRejected).toEqual({ seat: "south", tricks: 13, by: "east" });
    expect(viewFor(t, "south").claimRejected).toEqual({ seat: "south", tricks: 13, by: "east" });
    expect(t.game!.phase).toBe("play");
    expect(send(t, "west", { type: "answerClaim", accept: true }).refused).toBe("not-allowed");
    t = dummyPlays(t);
    expect(t.claimRejected).toBeUndefined();
  });

  it("has a robot defender answer at once with the check", () => {
    // Claiming none of the remaining tricks always holds.
    let t = sendOk(robotWest(), "south", { type: "claim", tricks: 0 });
    expect(t.pendingClaim).toEqual({ seat: "south", tricks: 0, accepted: ["west"] });
    expect(viewFor(t, "east").claim!.waitingOn).toEqual(["east"]);
    t = sendOk(t, "east", { type: "answerClaim", accept: true });
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

  it("freezes play while a claim is pending", () => {
    const t = sendOk(humanDefenders(), "south", { type: "claim", tricks: 7 });
    const card = t.game!.hands.north[0]!;
    expect(send(t, "south", act(t, { type: "play", seat: "north", card })).refused).toBe("not-allowed");
    // A bot to act (West's opening lead) does not act while a claim is pending.
    const lead = tableInPlay({ north: "bot", east: "human", south: "human", west: "bot" }, false);
    expect(botToAct(lead)).toBe("west");
    expect(botToAct({ ...lead, pendingClaim: { seat: "west", tricks: 1, accepted: [] } })).toBeUndefined();
  });

  it("clears a pending claim on take-back, cancel, and leave, but keeps it when an away responder is handed to a bot", () => {
    // East (a defender) claims after South plays dummy's card: South answers for the declaring side.
    const t = sendOk(dummyPlays(humanDefenders()), "east", { type: "claim", tricks: 0 });
    expect(t.pendingClaim).toEqual({ seat: "east", tricks: 0, accepted: [] });
    expect(viewFor(t, "east").claim!.waitingOn).toEqual(["south"]);

    expect(sendOk(t, "south", { type: "takeBack" }).pendingClaim).toBeUndefined();
    expect(sendOk(t, "south", { type: "cancelHand" }).pendingClaim).toBeUndefined();
    const left = sendOk(t, "west", { type: "leave" });
    expect(left.pendingClaim).toBeUndefined();
    expect(left.game!.phase).toBe("play");

    const away: TableState = { ...t, awaySince: { south: 5 } };
    const handed = sendOk(away, "west", { type: "handToBot", seat: "south" });
    expect(handed.pendingClaim).toBeUndefined();
    expect(handed.game!.phase).toBe("complete");
    expect(handed.game!.claim).toEqual({ seat: "east", tricks: 0 });
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
    expect(send(t, "south", { type: "answerClaim", accept: true }).refused).toBe("not-allowed");
    const once = sendOk(t, "east", { type: "answerClaim", accept: true });
    expect(send(once, "east", { type: "answerClaim", accept: true }).refused).toBe("not-allowed");
    expect(send(humanDefenders(), "east", { type: "answerClaim", accept: true }).refused).toBe("not-allowed");
  });
});
