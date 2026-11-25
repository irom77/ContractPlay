import type { BotResult, StorageLike } from "@contractplay/persistence";
import { afterEach, expect, it, vi } from "vitest";
import { loadPartnerResults, savePartnerResults } from "../partnerResults.js";
import { syncBotResults, uploadBotResult } from "./botResultsSync.js";

const account = { playerId: "account-player", displayName: "Owner" };
const result = (handId: string, at?: number, extra: Partial<BotResult> = {}): BotResult =>
  ({ handId, partner: "bea", left: "cora", right: "custom", score: 420, declared: true, made: true, ...(at === undefined ? {} : { at }), ...extra });
function storageWith(results: BotResult[]): StorageLike {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) };
  savePartnerResults(storage, results);
  return storage;
}
/** A service holding `remote`, recording each batch it is sent. */
function service(remote: BotResult[]) {
  const posted: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/account/bot-results");
    expect(new Headers(init?.headers).get("X-Expected-Player-ID")).toBe(account.playerId);
    if (init?.method === "POST") {
      const sent = (JSON.parse(init.body as string) as { results: BotResult[] }).results;
      posted.push(sent.map(entry => entry.handId));
      for (const entry of sent) { const at = remote.findIndex(known => known.handId === entry.handId); if (at >= 0) remote.splice(at, 1); remote.push(entry); }
    }
    return Response.json({ results: remote });
  }));
  return posted;
}
afterEach(() => vi.unstubAllGlobals());

it("sends this device's results the account lacks, without the device's tags, and keeps the account's from other devices", async () => {
  const storage = storageWith([result("h1", 1), result("h2", 2, { online: true })]);
  const posted = service([result("h0", 0), result("h1", 1)]);
  const kept = await syncBotResults(storage, account);
  expect(posted).toEqual([["h2"]]);
  expect(kept.map(entry => entry.handId)).toEqual(["h0", "h1", "h2"]);
  expect(loadPartnerResults(storage).every(entry => entry.owner === account.playerId)).toBe(true);
  // Synced again, nothing goes up.
  await syncBotResults(storage, account);
  expect(posted).toEqual([["h2"]]);
});

it("sends a later finish of a hand, and leaves another account's results on the device alone", async () => {
  const storage = storageWith([result("h1", 5, { score: -50, made: false }), result("theirs", 1, { owner: "someone-else" })]);
  const posted = service([result("h1", 1)]);
  const kept = await syncBotResults(storage, account);
  expect(posted).toEqual([["h1"]]);
  expect(kept.find(entry => entry.handId === "h1")).toMatchObject({ score: -50, owner: account.playerId });
  expect(kept.find(entry => entry.handId === "theirs")?.owner).toBe("someone-else");
});

it("sends a long history in batches the service takes", async () => {
  const storage = storageWith(Array.from({ length: 1200 }, (_, i) => result(`h${i}`, i)));
  const posted = service([]);
  await syncBotResults(storage, account);
  expect(posted.map(batch => batch.length)).toEqual([500, 500, 200]);
});

it("uploads a newly recorded result, and keeps it locally when the service fails", async () => {
  const storage = storageWith([result("h1", 1)]);
  const posted = service([]);
  await uploadBotResult(storage, account, result("h1", 1));
  expect(posted).toEqual([["h1"]]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
  savePartnerResults(storage, [...loadPartnerResults(storage), result("h2", 2)]);
  await expect(uploadBotResult(storage, account, result("h2", 2))).rejects.toThrow();
  expect(loadPartnerResults(storage).map(entry => entry.handId)).toEqual(["h1", "h2"]);
});
