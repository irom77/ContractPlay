import type { Aggression, SkillLevel } from "./bots.js";

/**
 * The bot cast: one named character for each skill level and temperament, so players can get to know them and pick
 * favourite partners and opponents. Each plays the table's bidding system; only skill and aggressiveness differ.
 */
export type BotCharacter = Readonly<{ id: string; name: string; skill: SkillLevel; aggression: Aggression; blurb: string }>;

export const BOT_CHARACTERS: readonly BotCharacter[] = [
  { id: "tess", name: "Timid Tess", skill: "beginner", aggression: "conservative", blurb: "New to the game and shy of the bidding box." },
  { id: "ray", name: "Rookie Ray", skill: "beginner", aggression: "normal", blurb: "Still learning; bids by the book." },
  { id: "eddie", name: "Eager Eddie", skill: "beginner", aggression: "aggressive", blurb: "New, keen, and quick to overbid." },
  { id: "cora", name: "Careful Cora", skill: "intermediate", aggression: "conservative", blurb: "Won't bid without the goods." },
  { id: "will", name: "Weekly Will", skill: "intermediate", aggression: "normal", blurb: "A sound club player who never misses a Tuesday." },
  { id: "wes", name: "Wild Wes", skill: "intermediate", aggression: "aggressive", blurb: "Never sells out cheaply." },
  { id: "sam", name: "Steady Sam", skill: "advanced", aggression: "conservative", blurb: "Patient; waits for your mistakes." },
  { id: "pia", name: "Polished Pia", skill: "advanced", aggression: "normal", blurb: "Plays a clean, sound game." },
  { id: "bea", name: "Bold Bea", skill: "advanced", aggression: "aggressive", blurb: "Competes on every hand." },
  { id: "pat", name: "Patient Pat", skill: "expert", aggression: "conservative", blurb: "An expert who never gives a trick away." },
  { id: "kim", name: "Sharp Kim", skill: "expert", aggression: "normal", blurb: "Expert; does everything right." },
  { id: "dex", name: "Daring Dex", skill: "expert", aggression: "aggressive", blurb: "An expert who pushes you to the limit." }
];

export function botCharacter(id: string | undefined): BotCharacter | undefined {
  return BOT_CHARACTERS.find((character) => character.id === id);
}
