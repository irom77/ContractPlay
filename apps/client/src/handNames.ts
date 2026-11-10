const adjectives = [
  "Bold", "Quiet", "Golden", "Lucky", "Crafty", "Daring", "Gentle", "Hidden", "Nimble", "Patient", "Silver", "Steady",
  "Swift", "Wily", "Bright", "Clever", "Royal", "Velvet", "Midnight", "Sunny", "Brave", "Sly", "Grand", "Rapid"
] as const;
const nouns = [
  "Finesse", "Squeeze", "Ruff", "Endplay", "Overtrick", "Slam", "Trump", "Lead", "Rubber", "Signal", "Tenace", "Singleton",
  "Void", "Honor", "Crossruff", "Discard", "Holdup", "Gambit", "Stopper", "Entry", "Overcall", "Sacrifice", "Jump", "Double"
] as const;
const nameCount = adjectives.length * nouns.length;
const nameAt = (index: number): string => `${adjectives[index % adjectives.length]!} ${nouns[Math.floor(index / adjectives.length) % nouns.length]!}`;

/** A random two-word name for a played hand, avoiding the names already in the history where possible. */
export function createHandName(taken: ReadonlySet<string> = new Set(), random: () => number = Math.random): string {
  const start = Math.floor(random() * nameCount);
  for (let offset = 0; offset < nameCount; offset += 1) {
    const name = nameAt((start + offset) % nameCount);
    if (!taken.has(name)) return name;
  }
  return nameAt(start);
}

/** A stable name for a hand saved before hands were named, derived from its id. */
export function handNameFromId(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return nameAt(hash % nameCount);
}
