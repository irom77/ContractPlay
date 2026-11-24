import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReplay, postResult, replayNotice } from "./replays.js";

afterEach(() => vi.unstubAllGlobals());

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
  it("returns the deal and passes the vulnerability", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ dealId: "d1", record: {} }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchReplay("EW")).toEqual({ dealId: "d1", record: {} });
    expect(fetchMock).toHaveBeenCalledWith("/api/deals/replay?vulnerability=EW");
  });
});

describe("postResult", () => {
  it("never rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(postResult({} as never)).resolves.toBeUndefined();
  });
});
