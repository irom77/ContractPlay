import { SEATS, shuffle, type Seat } from "@contractplay/core";
import { benchmarkProfileVersionId, type BenchmarkProfileSnapshot } from "./profiles.js";

export const BENCHMARK_ROTATION_VERSION = "round-robin-v1";
export type BenchmarkTableAssignment = Readonly<Record<Seat, BenchmarkProfileSnapshot>>;

function greatestCommonDivisor(left: number, right: number): number {
  while (right !== 0) [left, right] = [right, left % right];
  return left;
}

function rotationSize(profileCount: number, maxTables: number) {
  if (!Number.isSafeInteger(profileCount) || profileCount < 4) throw new RangeError("A rotation requires at least four profiles");
  if (!Number.isInteger(maxTables) || maxTables < 2 || maxTables > 8) throw new RangeError("The table cap must be 2–8");
  const pairCount = Math.floor(profileCount / 2);
  const pairsPerBatch = 2 * Math.min(maxTables, Math.floor(pairCount / 2));
  // Consecutive windows advance by their width around the circle, giving each pair the same number of starts.
  const batches = pairCount / greatestCommonDivisor(pairCount, pairsPerBatch);
  const matchings = profileCount - 1 + profileCount % 2;
  const rounds = matchings * batches * SEATS.length;
  if (!Number.isSafeInteger(rounds)) throw new RangeError("The rotation cycle is too large");
  return { pairsPerBatch, batches, matchings, rounds };
}

/** The number of rounds required to give every profile equal seat and partner exposure. */
export function rotationCycleLength(profileCount: number, maxTables: number): number {
  return rotationSize(profileCount, maxTables).rounds;
}

/** Mulberry32 PRNG. The seed shuffles a canonical order, so roster input order does not affect replay. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round robin pairs every profile with every other; a missing slot represents a bye for an odd roster. */
function partnerships(profiles: readonly BenchmarkProfileSnapshot[], matchings: number, matching: number) {
  const at = (index: number) => profiles[index === 0 ? 0 : 1 + (index - 1 + matching) % matchings];
  const pairs: [BenchmarkProfileSnapshot, BenchmarkProfileSnapshot][] = [];
  for (let index = 0; index < (matchings + 1) / 2; index++) {
    const first = at(index);
    const second = at(matchings - index);
    if (first && second) pairs.push([first, second]);
  }
  return pairs;
}

/** Use one bounded batch of partnerships and rotate all four compass seats before moving to the next batch. */
export function createRotation(
  profiles: readonly BenchmarkProfileSnapshot[], seed: number, roundIndex: number, maxTables: number
): readonly BenchmarkTableAssignment[] {
  const { pairsPerBatch, batches, matchings, rounds } = rotationSize(profiles.length, maxTables);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new RangeError("The rotation seed must be an unsigned 32-bit integer");
  if (!Number.isSafeInteger(roundIndex) || roundIndex < 0) throw new RangeError("The round index must be a non-negative integer");

  const byId = new Map(profiles.map((profile) => [benchmarkProfileVersionId(profile), profile]));
  if (byId.size !== profiles.length) throw new RangeError("Duplicate benchmark profile version in rotation");
  const sortedProfiles = [...byId.keys()].sort().map((id) => byId.get(id)!);
  const shuffled = shuffle(sortedProfiles, seededRandom(seed));
  const round = roundIndex % rounds;
  const compassOffset = round % SEATS.length;
  const batchIndex = Math.floor(round / SEATS.length);
  const pairs = partnerships(shuffled, matchings, Math.floor(batchIndex / batches));
  const start = (batchIndex % batches) * pairsPerBatch;
  const tables: BenchmarkTableAssignment[] = [];

  for (let offset = 0; offset < pairsPerBatch; offset += 2) {
    const [first, third] = pairs[(start + offset) % pairs.length]!;
    const [second, fourth] = pairs[(start + offset + 1) % pairs.length]!;
    const seats = [first, second, third, fourth];
    tables.push(Object.freeze({
      north: seats[compassOffset]!,
      east: seats[(compassOffset + 1) % SEATS.length]!,
      south: seats[(compassOffset + 2) % SEATS.length]!,
      west: seats[(compassOffset + 3) % SEATS.length]!
    }));
  }
  return Object.freeze(tables);
}
