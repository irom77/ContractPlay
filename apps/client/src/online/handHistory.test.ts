import { applyAction, createDeck, createGameState, deal, type GameState } from "@contractplay/core";
import { loadSoloData, saveSoloData, type StorageLike } from "@contractplay/persistence";
import { afterEach, expect, it, vi } from "vitest";
import { syncOnlineHands, uploadOnlineHand } from "./handHistory.js";
function hand(id: string, at = 1) {
  let game = createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
  for (const action of [{ type: "bid", seat: "north", bid: "1notrump" }, { type: "bid", seat: "east", bid: "pass" }, { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "pass" }, { type: "claim", seat: "east", tricks: 0 }] as const) {
    const result = applyAction(game, action); if (!result.ok) throw new Error(result.error.message); game = result.state as GameState;
  }
  return { id, game, savedAt: new Date(at).toISOString() };
}
function storageWith(hands: ReturnType<typeof hand>[]) {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) };
  saveSoloData(storage, { ...loadSoloData(storage), completedHands: hands }); storage.setItem("settings", "keep me");
  return storage;
}
const account = { playerId: "account-player", displayName: "Owner" };
afterEach(() => vi.unstubAllGlobals());
it("imports only guest online history on account link and leaves solo hands/settings local", async () => {
  const storage = storageWith([hand("solo-1"), hand("online-ABC234-1")]);
  const remote: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/account/online-hands" + (init?.method === "POST" ? "/import" : ""));
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("X-Expected-Player-ID")).toBe(account.playerId);
    if (init?.method === "POST") { const body = JSON.parse(init.body as string); expect(body.hands.map((h: { id: string }) => h.id)).toEqual(["online-ABC234-1"]); remote.push(...body.hands); }
    return Response.json({ hands: remote });
  }));
  await syncOnlineHands(storage, account);
  expect(loadSoloData(storage).completedHands.map(h => h.id)).toEqual(["solo-1", "online-ABC234-1"]);
  expect(storage.getItem("settings")).toBe("keep me");
});
it("merges canonical remote hands on another device without duplicate local ids", async () => {
  const storage = storageWith([hand("online-ABC234-1"), hand("solo-1")]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hands: [{ ...hand("online-ABC234-1"), name: "Canonical" }, hand("online-XYZ234-2", 2)] })));
  await syncOnlineHands(storage, account); await syncOnlineHands(storage, account);
  const hands = loadSoloData(storage).completedHands;
  expect(hands.filter(h => h.id === "online-ABC234-1")).toHaveLength(1);
  expect(hands.find(h => h.id === "online-ABC234-1")?.name).toBe("Canonical");
  expect(hands.some(h => h.id === "online-XYZ234-2")).toBe(true);
  expect(hands.some(h => h.id === "solo-1")).toBe(true);
});
it("saves completed online hands through the account endpoint and keeps local data on failure", async () => {
  const storage = storageWith([hand("online-ABC234-1")]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/account/online-hands/online-ABC234-1"); expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string).hand.id).toBe("online-ABC234-1"); return new Response(null, { status: 503 });
  }));
  await expect(uploadOnlineHand(storage, account, hand("online-ABC234-1"))).rejects.toThrow();
  expect(loadSoloData(storage).completedHands).toHaveLength(1);
});
it("never imports another account's cached history", async () => {
  const storage = storageWith([hand("online-ABC234-1")]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hands: [hand("online-ABC234-1")] })));
  await syncOnlineHands(storage, account);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") expect(JSON.parse(init.body as string).hands).toEqual([]);
    return Response.json({ hands: [] });
  }));
  await syncOnlineHands(storage, { playerId: "other-account", displayName: "Other" });
  expect(loadSoloData(storage).completedHands[0]?.onlineHistory?.ownerPlayerId).toBe(account.playerId);
});
it("merges the canonical response after a completed hand upload", async () => {
  const storage = storageWith([hand("online-ABC234-1")]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/account/online-hands/online-ABC234-1"); expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("X-Expected-Player-ID")).toBe(account.playerId);
    return Response.json({ hands: [{ ...hand("online-ABC234-1"), name: "Saved remotely" }] });
  }));
  await uploadOnlineHand(storage, account, hand("online-ABC234-1"));
  expect(loadSoloData(storage).completedHands[0]?.name).toBe("Saved remotely");
});
it("imports at most the newest 25 online hands while preserving solo data", async () => {
  const storage = storageWith([hand("solo-1"), ...Array.from({ length: 27 }, (_, i) => hand(`online-ABC234-${i}`, i))]);
  let remote: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      remote = JSON.parse(init.body as string).hands;
      expect(remote).toHaveLength(25);
      expect((remote[0] as { id: string }).id).toBe("online-ABC234-26");
      expect((remote[24] as { id: string }).id).toBe("online-ABC234-2");
    }
    return Response.json({ hands: remote });
  }));
  await syncOnlineHands(storage, account);
  expect(loadSoloData(storage).completedHands).toHaveLength(26);
  expect(loadSoloData(storage).completedHands.at(-1)?.id).toBe("solo-1");
});

it("preserves a failed upload when syncing another account without importing it", async () => {
  const local = { ...hand("online-ABC234-1"), onlineHistory: { source: "user-imported" as const, competitive: false as const, ownerPlayerId: account.playerId } };
  const storage = storageWith([local]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  await expect(uploadOnlineHand(storage, account, local)).rejects.toThrow();
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { requests.push(init?.method ?? "GET"); return Response.json({ hands: [hand("online-OTHER2-1", 3)] }); }));
  await syncOnlineHands(storage, { playerId: "other-account", displayName: "Other" });
  expect(requests).toEqual(["GET"]);
  expect(loadSoloData(storage).completedHands.map(h => h.id)).toEqual(["online-OTHER2-1", "online-ABC234-1"]);
  expect(loadSoloData(storage).completedHands[1]?.onlineHistory?.ownerPlayerId).toBe(account.playerId);
});

it("keeps account caches distinct even when both contain the same table hand", async () => {
  const local = { ...hand("online-ABC234-1"), onlineHistory: { source: "user-imported" as const, competitive: false as const, ownerPlayerId: account.playerId } };
  const storage = storageWith([local]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hands: [hand("online-ABC234-1")] })));
  await syncOnlineHands(storage, { playerId: "other-account", displayName: "Other" });
  expect(loadSoloData(storage).completedHands.map(h => h.onlineHistory?.ownerPlayerId).sort()).toEqual([account.playerId, "other-account"].sort());
});
