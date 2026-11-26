import { SEATS, TRAIT_PRESETS, cardId, createDeck, deal } from "@contractplay/core";
import type { Card, Seat } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import type { TableState } from "./state.js";
import { afterOnePassedOut, fourHumans, newTable, othersReady, playOut, replayRecord, seededRandom, sendOk, tableInPlay, tableWithBots } from "./test-helpers.js";
import { observerViewFor, summaryOf, viewFor } from "./view.js";

/** Every card object found anywhere in a JSON value. */
function cardsIn(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => cardsIn(v, found));
  else if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.suit === "string" && typeof o.rank === "string") found.add(cardId(o as unknown as Card));
    else Object.values(o).forEach((v) => cardsIn(v, found));
  }
  return found;
}

describe("viewFor", () => {
  it("shows everyone your character but only you its id", () => {
    const custom = { id: "own-abc123", name: "Gentle Gina", skill: "advanced" as const, traits: TRAIT_PRESETS.conservative };
    const t = sendOk(tableWithBots(), "alice", { type: "setBot", seat: "east", skill: "beginner", custom });
    expect(summaryOf(t).seats.east).toEqual({ kind: "bot", skill: "advanced", custom: { name: "Gentle Gina", traits: custom.traits } });
    expect(viewFor(t, "alice").seats.east).toMatchObject({ kind: "bot", custom: { id: custom.id } });
    expect(viewFor(t, "bob").seats.east).toMatchObject({ kind: "bot", custom: { name: "Gentle Gina" } });
    expect("id" in (viewFor(t, "bob").seats.east as { custom?: object }).custom!).toBe(false);
    expect("id" in (viewFor(t, undefined).seats.east as { custom?: object }).custom!).toBe(false);
  });

  it("never reveals a card the viewer may not see (seeds 1-30, one human and four humans)", async () => {
    for (const humans of [1, 4]) for (let seed = 1; seed <= 30; seed++) {
      const start = humans === 1 ? tableWithBots() : fourHumans();
      let t = sendOk(start, humans === 1 ? "alice" : "p0", { type: "deal" }, 1, seededRandom(seed));
      const original = t.game!.initialDeal;
      const players = humans === 1 ? ["alice"] : ["p0", "p1", "p2", "p3"];
      const check = (s: TableState): void => {
        const g = s.game!;
        const played = [...g.completedTricks.flat(), ...g.currentTrick].map((p) => cardId(p.card));
        const dummy: Seat | undefined = g.contract ? SEATS[(SEATS.indexOf(g.contract.declarer) + 2) % 4] : undefined;
        for (const viewer of [...players, "mallory", undefined]) {
          const view = viewFor(s, viewer);
          const cards = cardsIn(JSON.parse(JSON.stringify(view)));
          if (viewer === undefined || !players.includes(viewer)) {
            expect("game" in view).toBe(false);
            expect(cards.size).toBe(0);
            continue;
          }
          const own = SEATS[players.indexOf(viewer)]!;
          const allowed = new Set([...original[own].map(cardId), ...played]);
          if (dummy && played.length > 0) {
            original[dummy].forEach((c) => allowed.add(cardId(c)));
            if (dummy === own && g.contract && s.seats[g.contract.declarer].kind === "bot") {
              original[g.contract.declarer].forEach((c) => allowed.add(cardId(c)));
            }
          }
          for (const id of cards) expect(allowed.has(id)).toBe(true);
          expect("revealed" in view).toBe(false);
        }
      };
      check(t);
      t = await playOut(t, (s) => { if (s.game!.phase === "auction" || s.game!.phase === "play") check(s); });
      for (const viewer of players) expect(viewFor(t, viewer).revealed).toEqual(original);
      for (const viewer of ["mallory", undefined]) {
        const view = viewFor(t, viewer);
        expect("revealed" in view).toBe(false);
        expect("game" in view).toBe(false);
      }
    }
  }, 120_000);

  it("shows own hand, hides others, and reports canDeal and host", async () => {
    let t = sendOk(tableWithBots(), "alice", { type: "deal" }, 1, seededRandom(3));
    const view = viewFor(t, "alice");
    expect(view.game!.hands.north).toHaveLength(13);
    for (const seat of ["east", "south", "west"] as const) expect(view.game!.hands[seat]).toEqual([]);
    expect(view).toMatchObject({ yourSeat: "north", host: "north", canDeal: false, handNumber: 1 });
    expect(summaryOf(t).handInProgress).toBe(true);
    t = await playOut(t);
    expect(viewFor(t, "alice").canDeal).toBe(true);
    expect(viewFor(t, "nobody").canDeal).toBe(false);
    expect(viewFor(t, undefined).canDeal).toBe(false);
  });

  it("reveals declarer to the human dummy only when a bot is declarer", () => {
    let t = sendOk(newTable(), "alice", { type: "sit", seat: "south" });
    for (const seat of ["north", "east", "west"] as const) t = sendOk(t, "alice", { type: "setBot", seat, skill: "advanced" });
    t = sendOk(t, "alice", { type: "deal" }, 1, seededRandom(11));
    const game = {
      ...t.game!, phase: "play" as const,
      contract: { level: 1 as const, strain: "spades" as const, declarer: "north" as const, doubled: 0 as const },
      currentActor: "south" as const,
      currentTrick: [{ seat: "east" as const, card: t.game!.hands.east[0]! }]
    };
    const state: TableState = { ...t, game };

    expect(viewFor(state, "alice").game!.hands.north).toHaveLength(13);
    expect(viewFor(state, "alice").game!.hands.south).toHaveLength(13);
  });

  it("reveals the claimer's hand to the opponents only, and only while the claim is pending", () => {
    const t = tableInPlay({ north: "human", east: "human", south: "human", west: "human" });
    expect(viewFor(t, "east").game!.hands.south).toEqual([]);
    // East is to play after dummy: East claims, and South (declarer) and North (dummy) are the opponents.
    let east = sendOk(t, "south", { type: "act", handNumber: t.handNumber, revision: t.revision,
      action: { type: "play", seat: "north", card: t.game!.hands.north.find((c) => c.suit === t.game!.currentTrick[0]!.card.suit) ?? t.game!.hands.north[0]! } });
    east = sendOk(east, "east", { type: "claim", tricks: 1 });
    expect(viewFor(east, "south").game!.hands.east).toEqual(east.game!.hands.east);
    expect(viewFor(east, "north").game!.hands.east).toEqual(east.game!.hands.east);
    expect(viewFor(east, "west").game!.hands.east).toEqual([]);

    const pending = sendOk(t, "south", { type: "claim", tricks: 9 });
    expect(viewFor(pending, "east").game!.hands.south).toEqual(t.game!.hands.south);
    expect(viewFor(pending, "west").game!.hands.south).toEqual(t.game!.hands.south);
    expect(viewFor(pending, "north").game!.hands.south).toEqual([]);
    expect(viewFor(pending, "west").game!.hands.east).toEqual([]);
    const rejected = sendOk(pending, "east", { type: "answerClaim", accept: false, claimId: pending.pendingClaim!.madeAt });
    expect(viewFor(rejected, "east").game!.hands.south).toEqual([]);
    expect(viewFor(rejected, "east").claim).toBeUndefined();
  });

  it("tells everyone a hand is a replay, and shows earlier results only once it is over", () => {
    const t = afterOnePassedOut("duplicate");
    const boarded: TableState = { ...t, replayBoard: { index: 1, dealId: "deal-1", record: replayRecord } };
    // The board injected before the deal is never shown.
    for (const viewer of ["p0", "mallory", undefined]) expect(JSON.stringify(viewFor(boarded, viewer))).not.toContain("deal-1");
    let started = sendOk(othersReady(boarded, "p1"), "p1", { type: "deal" });
    const notice = { firstPlayedAt: 1_700_000_000_000 };
    const midHand = (state: TableState): void => {
      for (const viewer of ["p0", "mallory", undefined]) {
        const view = viewFor(state, viewer);
        expect(view.replay).toEqual(notice);
        const json = JSON.stringify(view);
        for (const hidden of ["deal-1", "field", "record", "rescored", "original", "\"4S\"", "620"]) expect(json).not.toContain(hidden);
      }
    };
    midHand(started);
    for (let k = 0; k < 4; k++) {
      const seat = started.game!.currentActor;
      started = sendOk(started, `p${SEATS.indexOf(seat)}`, { type: "act", handNumber: started.handNumber, revision: started.revision, action: { type: "bid", seat, bid: "pass" } });
      if (k < 3) midHand(started);
    }
    const shown = Object.fromEntries(Object.entries(replayRecord).filter(([key]) => key !== "original"));
    for (const viewer of ["p0", "mallory", undefined]) {
      const view = viewFor(started, viewer);
      expect(view.replay).toEqual({ ...notice, rescored: false, original: replayRecord.replay!.original, record: shown });
      expect("original" in view.replay!.record!).toBe(false);
    }
  });

  it("drops the replay when the last human leaves mid-hand, so its results are never shown", () => {
    const t = sendOk(newTable("duplicate"), "alice", { type: "sit", seat: "north" });
    let bots = t;
    for (const seat of SEATS.slice(1)) bots = sendOk(bots, "alice", { type: "setBot", seat, skill: "advanced" });
    const started = sendOk({ ...bots, handNumber: 1, replayBoard: { index: 1, dealId: "deal-1", record: replayRecord } }, "alice", { type: "deal" });
    expect(started.replay?.dealId).toBe("deal-1");
    const left = sendOk(started, "alice", { type: "leave" });
    expect("game" in left).toBe(false);
    expect("replay" in left).toBe(false);
    for (const viewer of ["alice", undefined]) expect(viewFor(left, viewer).replay).toBeUndefined();
  });

  it("marks away humans and shows stand-ins", () => {
    const t = sendOk(newTable(), "alice", { type: "sit", seat: "north" });
    const away: TableState = {
      ...t, awaySince: { alice: 5 },
      seats: { ...t.seats, north: { kind: "human", player: "alice", name: "alice", since: 1, standIn: "expert" } }
    };
    expect(summaryOf(away).seats.north).toEqual({ kind: "human", name: "alice", away: true, standIn: "expert" });
    expect(summaryOf(t).seats.north).toEqual({ kind: "human", name: "Player", away: false });
    expect(JSON.stringify(summaryOf(away))).not.toContain("\"player\"");
  });
});

describe("observerViewFor", () => {
  const benchmark: NonNullable<TableState["benchmark"]> = {
    jobId: "job-1", tableIndex: 0, engineVersion: "contractplay-bots-v1",
    boardSource: "generated",
    profiles: Object.fromEntries(SEATS.map((seat) => [seat, { profileId: `bot-${seat}`, version: "v1" }])) as Record<Seat, { profileId: string; version: string }>
  };

  it("shows auction and played cards while keeping all hands and controls private during every live phase", async () => {
    let state = sendOk(tableWithBots(), "alice", { type: "deal" }, 1, seededRandom(21));
    state = { ...state, benchmark, listed: true, sessionId: "session", sessionBoard: { index: 0, number: 1, deal: state.game!.initialDeal, dealer: "north", vulnerability: "None" } };
    const session = (completedBoards: number) => ({ board: 1, position: 1, boardCount: 2, scoring: "imps" as const, completedBoards, complete: false,
      waitingForTables: true, rank: 1, tableCount: 2, matchpoints: { points: 0, top: 2, percentage: 0 }, crossImps: 0 });
    const check = (s: TableState) => {
      const view = observerViewFor(s, session(0));
      expect(view.observer).toBe(true);
      expect(view.game).toBeDefined();
      for (const seat of SEATS) expect(view.game!.hands[seat]).toEqual([]);
      expect(view).not.toHaveProperty("yourSeat");
      expect(view).not.toHaveProperty("host");
      expect(view).not.toHaveProperty("claim");
      expect(view).not.toHaveProperty("nextHand");
      expect(view).not.toHaveProperty("session");
      expect(view).not.toHaveProperty("replay");
      expect(view.canDeal).toBe(false);
      const allowed = new Set([...s.game!.completedTricks.flat(), ...s.game!.currentTrick].map(({ card }) => cardId(card)));
      expect(cardsIn(JSON.parse(JSON.stringify(view)))).toEqual(allowed);
    };

    check(state);
    state = await playOut(state, (s) => check(s));
    const finished = observerViewFor(state, session(1));
    expect(finished.game!.hands).toEqual({ north: [], east: [], south: [], west: [] });
    expect(finished.revealed).toEqual(state.game!.initialDeal);
  }, 30_000);

  it("keeps a completed generated board hidden until the whole duplicate board is released", async () => {
    const started = sendOk(tableWithBots(), "alice", { type: "deal" }, 1, seededRandom(30));
    const finished = await playOut(started);
    const state = { ...finished, benchmark, listed: true, sessionId: "session", sessionBoard: { index: 0, number: 1,
      deal: finished.game!.initialDeal, dealer: "north" as const, vulnerability: "None" as const } };
    const waiting = { board: 1, position: 1, boardCount: 1, scoring: "imps" as const, completedBoards: 0, complete: false, waitingForTables: true,
      rank: 1, tableCount: 2, matchpoints: { points: 0, top: 2, percentage: 0 }, crossImps: 0 };
    expect(observerViewFor(state, waiting).revealed).toBeUndefined();
    expect(observerViewFor(state, { ...waiting, completedBoards: 1, complete: true, waitingForTables: false }).revealed).toEqual(finished.game!.initialDeal);
  });

  it("never reveals completed imported PBN deals to public observers", async () => {
    const started = sendOk(tableWithBots(), "alice", { type: "deal" }, 1, seededRandom(31));
    const finished = await playOut(started);
    const state: TableState = { ...finished, listed: true, sessionId: "session", sessionBoard: { index: 0, number: 1,
      deal: finished.game!.initialDeal, dealer: "north", vulnerability: "None" }, benchmark: { ...benchmark, boardSource: "imported" } };
    const released = { board: 1, position: 1, boardCount: 1, scoring: "imps" as const, completedBoards: 1, complete: true, waitingForTables: false,
      rank: 1, tableCount: 2, matchpoints: { points: 0, top: 2, percentage: 0 }, crossImps: 0 };
    expect(observerViewFor(state, released).revealed).toBeUndefined();
  });

  it("does not reveal the claimer's hand or pending response controls to an observer", () => {
    const start = tableInPlay({ north: "human", east: "human", south: "human", west: "human" });
    const state = { ...sendOk(start, "south", { type: "claim", tricks: 9 }), benchmark, listed: true };
    const view = observerViewFor(state);
    expect(view.claim).toBeUndefined();
    expect(view.game!.hands).toEqual({ north: [], east: [], south: [], west: [] });
    const allowed = new Set([...state.game!.completedTricks.flat(), ...state.game!.currentTrick].map(({ card }) => cardId(card)));
    expect(cardsIn(JSON.parse(JSON.stringify(view)))).toEqual(allowed);
  });

  it("hides unreleased boards before the first deal and omits player readiness data", () => {
    const state = { ...tableWithBots(), benchmark, listed: true,
      sessionBoard: { index: 0, number: 42, deal: deal(createDeck()), dealer: "north" as const, vulnerability: "Both" as const } };
    const view = observerViewFor(state);
    expect(view.game).toBeUndefined();
    expect(view).not.toHaveProperty("revealed");
    expect(view).not.toHaveProperty("session");
    expect(JSON.stringify(view)).not.toContain("number\":42");
    expect(JSON.stringify(view)).not.toContain("sessionBoard");
  });
});
