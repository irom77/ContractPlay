import { applyAction, claimSeatFor, createGameState, deal, validatePlay, type GameAction, type HandRecord } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { deleteSavedHand, exportSavedHand, loadSoloData, saveSoloData, type BoardSet, type SoloData } from "./index.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const game = createGameState({ deal: deal(), dealer: "east", vulnerability: "NS" });
function finishHand() {
  let state = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
  for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
    const result = applyAction(state, { type: "bid", seat: state.currentActor, bid });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  while (state.phase === "play") {
    const seat = state.currentActor;
    const ledSuit = state.currentTrick[0]?.card.suit;
    const card = state.hands[seat].find((candidate) => validatePlay(state.hands[seat], candidate, ledSuit).legal)!;
    const result = applyAction(state, { type: "play", seat, card });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}
function claimedHand() {
  let state = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
  for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
    const result = applyAction(state, { type: "bid", seat: state.currentActor, bid });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  const claim = applyAction(state, { type: "claim", seat: claimSeatFor(state)!, tricks: 5 });
  if (!claim.ok) throw new Error(claim.error.message);
  return claim.state;
}
const record = { id: "hand-1", game: finishHand(), savedAt: "2026-10-25T12:00:00.000Z" };
const emptyData: SoloData = { version: 1, currentHandId: null, currentGame: null, completedHands: [] };

describe("local solo store", () => {
  it("returns an empty versioned session when no save exists", () => {
    expect(loadSoloData(new MemoryStorage())).toEqual(emptyData);
  });

  it("migrates a version zero current game and writes the upgraded schema", () => {
    const storage = new MemoryStorage();
    storage.setItem("bridgelab.solo", JSON.stringify({ version: 0, currentGame: game }));

    expect(loadSoloData(storage)).toEqual({ ...emptyData, currentGame: game });
    expect(JSON.parse(storage.getItem("contractplay.solo")!).version).toBe(1);
    expect(storage.getItem("bridgelab.solo")).toBeNull();
  });

  it("migrates existing BridgeLab saves to the ContractPlay storage key", () => {
    const storage = new MemoryStorage();
    const data: SoloData = { version: 1, currentHandId: null, currentGame: game, completedHands: [] };
    storage.setItem("bridgelab.solo", JSON.stringify(data));

    expect(loadSoloData(storage)).toEqual(data);
    expect(JSON.parse(storage.getItem("contractplay.solo")!)).toEqual(data);
    expect(storage.getItem("bridgelab.solo")).toBeNull();
  });

  it("round-trips current and completed games", () => {
    const storage = new MemoryStorage();
    const pbnMetadata = { tags: [{ name: "Event", value: "Club Night" }], comments: ["Imported note"] };
    const data: SoloData = {
      version: 1,
      currentHandId: "hand-1",
      currentGame: game,
      currentPbnMetadata: pbnMetadata,
      completedHands: [{ ...record, pbnMetadata }]
    };

    saveSoloData(storage, data);

    expect(loadSoloData(storage)).toEqual(data);
  });

  it("keeps a saved hand's name and still loads hands saved without one", () => {
    const storage = new MemoryStorage();
    const data: SoloData = { ...emptyData, completedHands: [{ ...record, name: "Bold Finesse" }, { ...record, id: "hand-2" }] };
    saveSoloData(storage, data);

    expect(loadSoloData(storage).completedHands.map((hand) => hand.name)).toEqual(["Bold Finesse", undefined]);
  });

  it("remembers the seat used for a saved hand", () => {
    const storage = new MemoryStorage();
    const data: SoloData = { ...emptyData, completedHands: [{ ...record, playerSeat: "east" }] };
    saveSoloData(storage, data);
    expect(loadSoloData(storage).completedHands[0]?.playerSeat).toBe("east");
  });

  it("keeps the rubber in progress and drops a malformed one", () => {
    const storage = new MemoryStorage();
    const rubber = { hands: [{ handId: "h1", below: { NS: 60, EW: 0 }, above: { NS: 30, EW: 0 } }], lastDealer: "east" as const, activeHandId: "h2" };
    saveSoloData(storage, { version: 1, currentHandId: null, currentGame: null, completedHands: [], rubber });
    expect(loadSoloData(storage).rubber).toEqual(rubber);

    storage.setItem("contractplay.solo", JSON.stringify({ version: 1, currentHandId: null, currentGame: null, completedHands: [], rubber: { hands: [{ handId: "h1", below: 60 }] } }));
    expect(loadSoloData(storage).rubber).toBeUndefined();
  });

  it("keeps a rubber hand's score breakdown and drops a malformed one without losing the points", () => {
    const storage = new MemoryStorage();
    const detail = { contract: { level: 2, strain: "spades", declarer: "north", doubled: 0 }, tricksTaken: 9, vulnerable: false,
      items: [{ side: "NS", line: "below", kind: "contract", points: 60 }, { side: "NS", line: "above", kind: "overtricks", points: 30, count: 1 }] };
    const good = { handId: "h1", below: { NS: 60, EW: 0 }, above: { NS: 30, EW: 0 }, detail };
    const bad = { handId: "h2", below: { NS: 0, EW: 0 }, above: { NS: 0, EW: 50 }, detail: { contract: "4S", items: 3 } };
    storage.setItem("contractplay.solo", JSON.stringify({ version: 1, currentHandId: null, currentGame: null, completedHands: [], rubber: { hands: [good, bad] } }));
    expect(loadSoloData(storage).rubber?.hands).toEqual([good, { handId: "h2", below: { NS: 0, EW: 0 }, above: { NS: 0, EW: 50 } }]);
  });

  it("recovers from malformed saved JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem("contractplay.solo", "{bad json");

    expect(loadSoloData(storage)).toEqual(emptyData);
  });

  it("discards a structurally invalid current game and its hand id", () => {
    const storage = new MemoryStorage();
    storage.setItem("contractplay.solo", JSON.stringify({
      version: 1,
      currentHandId: "broken-hand",
      currentGame: { phase: "unknown", history: { actions: [] } },
      completedHands: []
    }));

    expect(loadSoloData(storage)).toEqual(emptyData);
  });

  it("deletes one completed hand and persists the remaining list", () => {
    const storage = new MemoryStorage();
    saveSoloData(storage, { ...emptyData, completedHands: [record, { ...record, id: "hand-2" }] });

    expect(deleteSavedHand(storage, "hand-1").completedHands.map((hand) => hand.id)).toEqual(["hand-2"]);
    expect(loadSoloData(storage).completedHands.map((hand) => hand.id)).toEqual(["hand-2"]);
  });

  it("exports the selected completed hand as portable JSON", () => {
    const json = exportSavedHand({ ...emptyData, completedHands: [record] }, "hand-1");

    expect(JSON.parse(json!).game).toEqual(record.game);
    expect(exportSavedHand(emptyData, "missing")).toBeUndefined();
  });

  it("round-trips a hand that ended in a claim and rejects a malformed claim", () => {
    const storage = new MemoryStorage();
    const claimed = claimedHand();
    const data: SoloData = { version: 1, currentHandId: null, currentGame: null, completedHands: [{ id: "claimed", game: claimed, savedAt: record.savedAt }] };
    saveSoloData(storage, data);
    expect(loadSoloData(storage)).toEqual(data);

    const bad = structuredClone(data);
    (bad.completedHands[0]!.game.history.actions as GameAction[])[4] = { type: "claim", seat: "north", tricks: 2.5 };
    saveSoloData(storage, bad);
    expect(loadSoloData(storage).completedHands).toEqual([]);
  });
  describe("board sets and hand records", () => {
    const handRecord: HandRecord = {
      board: "1", event: "Club night", scoring: "MP", dealer: "north", vulnerability: "None", deal: deal(),
      original: [{ type: "bid", seat: "north", bid: "1clubs" }, { type: "bid", seat: "east", bid: "pass" }],
      field: [{ nsScore: 90, contract: "1C", declarer: "north", tricks: 8, multiplicity: 2, artificial: false }, { multiplicity: 1, artificial: true }]
    };
    const boardSet: BoardSet = { name: "Club night", records: [handRecord, { ...handRecord, board: "2" }], position: 1 };

    it("round-trips a board set, current record and saved hand record", () => {
      const storage = new MemoryStorage();
      const data: SoloData = { ...emptyData, boardSet, currentRecord: handRecord, completedHands: [{ ...record, record: handRecord }] };
      saveSoloData(storage, data);
      expect(loadSoloData(storage)).toEqual(data);
    });

    it("drops an invalid board set and keeps the rest", () => {
      const badDeal = { ...handRecord, deal: { ...handRecord.deal, north: handRecord.deal.north.slice(1) } };
      for (const bad of [{ ...boardSet, records: [] }, { ...boardSet, position: 2 }, { ...boardSet, position: -1 }, { ...boardSet, position: 0.5 }, { ...boardSet, records: [badDeal] }]) {
        const storage = new MemoryStorage();
        saveSoloData(storage, { ...emptyData, boardSet: bad as BoardSet, completedHands: [record] });
        const loaded = loadSoloData(storage);
        expect(loaded.boardSet).toBeUndefined();
        expect(loaded.completedHands).toEqual([record]);
      }
    });

    it("drops a malformed current record or saved hand record but keeps the hand", () => {
      const storage = new MemoryStorage();
      const bad = { ...handRecord, field: [{ multiplicity: 0, artificial: false }] } as HandRecord;
      saveSoloData(storage, { ...emptyData, currentRecord: bad, completedHands: [{ ...record, record: bad }] });
      const loaded = loadSoloData(storage);
      expect(loaded.currentRecord).toBeUndefined();
      expect(loaded.completedHands).toEqual([record]);
    });

    it("drops a record whose traveller row has an out-of-range multiplicity", () => {
      const storage = new MemoryStorage();
      const bad = { ...handRecord, field: [{ nsScore: 90, multiplicity: 1001, artificial: false }] } as HandRecord;
      saveSoloData(storage, { ...emptyData, currentRecord: bad, completedHands: [record] });
      expect(loadSoloData(storage).currentRecord).toBeUndefined();
    });

    it("does not throw when the storage rejects a save", () => {
      const storage = { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new Error("QuotaExceededError"); } };
      expect(() => saveSoloData(storage, emptyData)).not.toThrow();
    });

    it("loads data saved before board sets existed unchanged", () => {
      const storage = new MemoryStorage();
      const data: SoloData = { ...emptyData, currentHandId: "x", currentGame: game, completedHands: [record] };
      saveSoloData(storage, data);
      expect(loadSoloData(storage)).toEqual(data);
    });
  });
});
