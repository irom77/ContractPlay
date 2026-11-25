import { describe, expect, it } from "vitest";
import { activeBenchmarkProfiles, benchmarkProfileVersionId, createBenchmarkProfile } from "./profiles.js";

const strategy = {
  skill: "beginner",
  aggression: "conservative",
  biddingStyle: "SAYC",
  version: "1",
  engineVersion: "test-engine-1"
} as const;

describe("benchmark profiles", () => {
  it("keeps the built-in profile ID stable across strategy versions", () => {
    const first = createBenchmarkProfile(strategy);
    const second = createBenchmarkProfile({ ...strategy, version: "2", engineVersion: "test-engine-2" });
    expect(first.profileId).toBe("tess");
    expect(second.profileId).toBe(first.profileId);
    expect(benchmarkProfileVersionId(second)).not.toBe(benchmarkProfileVersionId(first));
    expect(benchmarkProfileVersionId(createBenchmarkProfile(strategy))).toBe(benchmarkProfileVersionId(first));
    expect(createBenchmarkProfile({ ...strategy, aggression: "aggressive" }).profileId).toBe("eddie");
  });

  it("captures an immutable copy of the versioned strategy", () => {
    const input = { ...strategy, engineVersion: "test-engine-1" };
    const snapshot = createBenchmarkProfile(input);
    input.engineVersion = "test-engine-2";
    expect(snapshot).toEqual({ profileId: "tess", ...strategy });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it.each([
    { skill: "champion" },
    { aggression: "reckless" },
    { biddingStyle: "Acol" },
    { version: " " },
    { engineVersion: "" }
  ])("rejects unsupported or missing strategy settings %j", (invalid) => {
    expect(() => createBenchmarkProfile({ ...strategy, ...invalid } as typeof strategy)).toThrow();
  });

  it("selects active versions without removing historical roster entries", () => {
    const retired = createBenchmarkProfile(strategy);
    const active = createBenchmarkProfile({ ...strategy, version: "2" });
    const roster = [{ profile: retired, status: "retired" }, { profile: active, status: "active" }] as const;
    expect(activeBenchmarkProfiles(roster)).toEqual([active]);
    expect(roster[0].profile).toBe(retired);
  });
});
