import type { Seat, SkillLevel } from "@contractplay/core";

export type SoloOpponents = "bots" | "manual";
export type SoloScoring = "rubber" | "single";
/** How the next solo hand is set up; the lobby's Play panel writes it and solo reads it. */
export type SoloSetup = Readonly<{ opponents: SoloOpponents; seat: Seat; botSkill: SkillLevel; biddingStyle: "SAYC" | "2/1"; scoring: SoloScoring }>;

export const defaultSoloSetup: SoloSetup = { opponents: "bots", seat: "north", botSkill: "beginner", biddingStyle: "SAYC", scoring: "rubber" };

const setupKey = "contractplay.soloSetup";
/** Scoring keeps the key it had before the rest of the setup was remembered. */
const scoringKey = "contractplay.scoring";
const seats: readonly Seat[] = ["north", "east", "south", "west"];
const skills: readonly SkillLevel[] = ["beginner", "intermediate", "advanced", "expert"];

function read(storage: Pick<Storage, "getItem">, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

/** Reads the stored setup; any missing or unreadable field takes its default. */
export function loadSoloSetup(storage: Pick<Storage, "getItem">): SoloSetup {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(read(storage, setupKey) ?? "{}");
    if (parsed && typeof parsed === "object") stored = parsed as Record<string, unknown>;
  } catch { /* unreadable: defaults */ }
  return {
    opponents: pick<SoloOpponents>(stored.opponents, ["bots", "manual"], defaultSoloSetup.opponents),
    seat: pick(stored.seat, seats, defaultSoloSetup.seat),
    botSkill: pick(stored.botSkill, skills, defaultSoloSetup.botSkill),
    biddingStyle: pick<"SAYC" | "2/1">(stored.biddingStyle, ["SAYC", "2/1"], defaultSoloSetup.biddingStyle),
    scoring: read(storage, scoringKey) === "single" ? "single" : "rubber"
  };
}

/** Whether any setup has been remembered yet (it has not for hands started before setups were remembered). */
export function soloSetupStored(storage: Pick<Storage, "getItem">): boolean {
  return read(storage, setupKey) !== null;
}

export function saveSoloSetup(storage: Pick<Storage, "setItem">, setup: SoloSetup): void {
  const { scoring, ...rest } = setup;
  try {
    storage.setItem(setupKey, JSON.stringify(rest));
    storage.setItem(scoringKey, scoring);
  } catch { /* the choice just won't be remembered */ }
}
