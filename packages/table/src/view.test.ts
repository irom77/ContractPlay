import { SEATS, cardId } from "@contractplay/core";
import type { Card, Seat } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import type { TableState } from "./state.js";
import { fourHumans, newTable, playOut, seededRandom, sendOk, tableWithBots } from "./test-helpers.js";
import { summaryOf, viewFor } from "./view.js";

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
          if (dummy && played.length > 0) original[dummy].forEach((c) => allowed.add(cardId(c)));
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
