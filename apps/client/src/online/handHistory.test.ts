import { applyAction, createDeck, createGameState, deal, type GameState } from "@contractplay/core";
import { loadSoloData, saveSoloData, type StorageLike } from "@contractplay/persistence";
import { afterEach, expect, it, vi } from "vitest";
import { syncOnlineHands, uploadOnlineHand, uploadSoloHand } from "./handHistory.js";
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
it("imports guest online hands and dealt solo hands on account link and keeps settings local", async () => {
  const storage = storageWith([hand("mf3k2x-ab12cd"), { ...hand("mf3k2x-pbn001"), pbnMetadata: { tags: [] } }, hand("legacy hand"), hand("online-ABC234-1")]);
  const remote: unknown[] = [];
  const posted: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/account/online-hands" + (init?.method === "POST" ? "/import" : ""));
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("X-Expected-Player-ID")).toBe(account.playerId);
    if (init?.method === "POST") { const body = JSON.parse(init.body as string); posted.push(body.hands.map((h: { id: string }) => h.id)); remote.push(...body.hands); }
    return Response.json({ hands: remote });
  }));
  await syncOnlineHands(storage, account);
  expect(posted).toEqual([["online-ABC234-1"], ["mf3k2x-ab12cd"]]);
  expect(loadSoloData(storage).completedHands.map(h => h.id).sort()).toEqual(["legacy hand", "mf3k2x-ab12cd", "mf3k2x-pbn001", "online-ABC234-1"]);
  const stored = loadSoloData(storage).completedHands;
  expect(stored.find(h => h.id === "mf3k2x-ab12cd")?.onlineHistory?.ownerPlayerId).toBe(account.playerId);
  expect(stored.find(h => h.id === "mf3k2x-pbn001")?.onlineHistory).toBeUndefined();
  expect(storage.getItem("settings")).toBe("keep me");
});
it("merges remote solo hands from another device", async () => {
  const storage = storageWith([]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hands: [hand("mf3k2x-remote", 5)] })));
  await syncOnlineHands(storage, account);
  expect(loadSoloData(storage).completedHands.map(h => [h.id, h.onlineHistory?.ownerPlayerId])).toEqual([["mf3k2x-remote", account.playerId]]);
});
it("does not upload solo hands owned by another account", async () => {
  const storage = storageWith([hand("mf3k2x-ab12cd")]);
  let remote: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") remote = JSON.parse(init.body as string).hands;
    return Response.json({ hands: remote });
  }));
  await syncOnlineHands(storage, account);
  const posted: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") posted.push(...JSON.parse(init.body as string).hands);
    return Response.json({ hands: [] });
  }));
  await syncOnlineHands(storage, { playerId: "other-account", displayName: "Other" });
  expect(posted).toEqual([]);
  expect(loadSoloData(storage).completedHands[0]?.onlineHistory?.ownerPlayerId).toBe(account.playerId);
});
it("uploads a finished solo hand and skips imported ones", async () => {
  const storage = storageWith([hand("mf3k2x-ab12cd")]);
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/account/online-hands/mf3k2x-ab12cd"); expect(init?.method).toBe("PUT");
    return Response.json({ hands: [JSON.parse(init?.body as string).hand] });
  });
  vi.stubGlobal("fetch", fetcher);
  await uploadSoloHand(storage, account, hand("mf3k2x-ab12cd"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(loadSoloData(storage).completedHands[0]?.onlineHistory?.ownerPlayerId).toBe(account.playerId);
  await uploadSoloHand(storage, account, { ...hand("mf3k2x-pbn001"), pbnMetadata: { tags: [] } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const before = storage.getItem("contractplay.solo");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  await expect(uploadSoloHand(storage, account, hand("mf3k2x-ab12cd"))).rejects.toThrow();
  expect(storage.getItem("contractplay.solo")).toBe(before);
});
it("merges canonical remote hands on another device without duplicate local ids", async () => {
  const storage = storageWith([hand("online-ABC234-1"), hand("legacy hand")]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hands: [{ ...hand("online-ABC234-1"), name: "Canonical" }, hand("online-XYZ234-2", 2)] })));
  await syncOnlineHands(storage, account); await syncOnlineHands(storage, account);
  const hands = loadSoloData(storage).completedHands;
  expect(hands.filter(h => h.id === "online-ABC234-1")).toHaveLength(1);
  expect(hands.find(h => h.id === "online-ABC234-1")?.name).toBe("Canonical");
  expect(hands.some(h => h.id === "online-XYZ234-2")).toBe(true);
  expect(hands.some(h => h.id === "legacy hand")).toBe(true);
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
  const storage = storageWith([hand("legacy hand"), ...Array.from({ length: 27 }, (_, i) => hand(`online-ABC234-${i}`, i))]);
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
  expect(loadSoloData(storage).completedHands.at(-1)?.id).toBe("legacy hand");
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
