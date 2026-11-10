import { applyAction, createGameState, deal, validatePlay } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { deleteSavedHand, exportSavedHand, loadSoloData, saveSoloData, type SoloData } from "./index.js";

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
});
