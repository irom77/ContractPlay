import { BOT_CHARACTERS, type Aggression, type SkillLevel } from "@contractplay/core";
import type { TableStyle } from "@contractplay/protocol";

export type BenchmarkProfileId = string;
export type BenchmarkProfileSnapshot = Readonly<{
  profileId: BenchmarkProfileId;
  version: string;
  skill: SkillLevel;
  aggression: Aggression;
  biddingStyle: TableStyle;
  engineVersion: string;
}>;

export type BenchmarkRosterEntry = Readonly<{
  profile: BenchmarkProfileSnapshot;
  status: "active" | "retired";
}>;

/** Capture the named built-in bot's strategy. Changing its settings requires a new version. */
export function createBenchmarkProfile(input: Omit<BenchmarkProfileSnapshot, "profileId">): BenchmarkProfileSnapshot {
  const { skill, aggression, biddingStyle, version, engineVersion } = input;
  const character = BOT_CHARACTERS.find((bot) => bot.skill === skill && bot.aggression === aggression);
  if (!character) throw new RangeError("Unknown built-in bot skill and aggression");
  if (biddingStyle !== "SAYC" && biddingStyle !== "2/1") throw new RangeError("Unknown benchmark bidding style");
  if (typeof version !== "string" || version.trim() === "") throw new RangeError("Benchmark profile version is required");
  if (typeof engineVersion !== "string" || engineVersion.trim() === "") throw new RangeError("Benchmark engine version is required");
  return Object.freeze({ profileId: character.id, version, skill, aggression, biddingStyle, engineVersion });
}

/** The version-specific identity to use for comparisons and ratings. */
export function benchmarkProfileVersionId(profile: Pick<BenchmarkProfileSnapshot, "profileId" | "version">): string {
  return JSON.stringify([profile.profileId, profile.version]);
}

export function activeBenchmarkProfiles(roster: readonly BenchmarkRosterEntry[]): readonly BenchmarkProfileSnapshot[] {
  return roster.filter((entry) => entry.status === "active").map((entry) => entry.profile);
}
