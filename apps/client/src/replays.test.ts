import { deal } from "@contractplay/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReplay, postResult, replayNotice } from "./replays.js";

afterEach(() => vi.unstubAllGlobals());
afterEach(() => vi.useRealTimers());

describe("replayNotice", () => {
  it("names when the deal was first played", () => {
    const at = new Date(2026, 10, 12, 14, 32).getTime();
    expect(replayNotice(at, false)).toBe("Replayed deal · first played 12 Nov 2026, 14:32 · some of you may have played it before.");
    expect(replayNotice(at, true)).toBe("Replayed deal · first played 12 Nov 2026, 14:32 · you may have played it before.");
  });
});

describe("fetchReplay", () => {
  it("resolves undefined when fetch rejects, the status is not 200, or fetch is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchReplay()).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 204 }));
    expect(await fetchReplay("NS")).toBeUndefined();
    vi.stubGlobal("fetch", undefined);
    expect(await fetchReplay()).toBeUndefined();
  });
  const row = { nsScore: 620, contract: "4S", declarer: "south", tricks: 10, multiplicity: 1, artificial: false };
  const record = () => ({ dealer: "south", vulnerability: "EW", deal: deal(), field: [row], replay: { dealId: "d1", firstPlayedAt: 1, original: row, rescored: false } });

  it("returns the deal and passes the vulnerability", async () => {
    const replay = { dealId: "d1", record: record() };
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => replay });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchReplay("EW")).toEqual(replay);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/deals/replay?vulnerability=EW");
  });

  it("resolves undefined for a malformed replay", async () => {
    const malformed = [
      { dealId: "d1", record: {} },
      { dealId: "d1", record: { ...record(), dealer: "middle" } },
      { dealId: "d1", record: { ...record(), deal: { ...record().deal, north: record().deal.south } } },
      { dealId: "d1", record: { ...record(), replay: undefined } },
      { record: record() },
      null
    ];
    for (const body of malformed) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => body }));
      expect(await fetchReplay()).toBeUndefined();
    }
  });

  it("gives up on a request that has not answered within three seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise(() => {}); }));
    const pending = fetchReplay();
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeUndefined();
    expect(signal?.aborted).toBe(true);
  });
});

describe("postResult", () => {
  it("never rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(postResult({} as never)).resolves.toBeUndefined();
  });
});
