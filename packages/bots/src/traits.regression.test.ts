import { AGGRESSIONS, applyAction, createDeck, createGameState, deal, playContextFor, SEATS, shuffle,
  type BotConfig, type Card, type GameState, type Seat, type SkillLevel, type Vulnerability } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { createBot } from "./player.js";

/** mulberry32, as the table tests use: the same seed always deals the same cards. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const short = (seat: Seat): string => seat[0]!.toUpperCase();
const cardText = (card: Card): string => `${card.suit[0]!.toUpperCase()}${card.rank}`;
const VULNERABILITIES: readonly Vulnerability[] = ["None", "NS", "EW", "Both"];

/** The whole auction and play of one seeded deal, as one line, with each seat's bot from `config`. */
async function playDeal(seed: number, config: (seat: Seat) => BotConfig): Promise<string> {
  const bots = Object.fromEntries(SEATS.map((seat) => [seat, createBot(config(seat))]));
  let state: GameState = createGameState({ deal: deal(shuffle(createDeck(), seededRandom(seed))),
    dealer: SEATS[seed % 4]!, vulnerability: VULNERABILITIES[seed % 4]! });
  const calls: string[] = [];
  const cards: string[] = [];
  while (state.phase === "auction" || state.phase === "play") {
    const seat = state.currentActor;
    if (state.phase === "auction") {
      const bid = await bots[seat]!.chooseBid(state.hands[seat], state.auction, seat);
      calls.push(`${short(seat)}:${bid}`);
      const result = applyAction(state, { type: "bid", seat, bid });
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    } else {
      const card = await bots[seat]!.chooseCard(playContextFor(state));
      cards.push(`${short(seat)}:${cardText(card)}`);
      const result = applyAction(state, { type: "play", seat, card });
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
  }
  return state.phase === "passed-out" ? `${calls.join(" ")} | passed out` : `${calls.join(" ")} | ${cards.join(" ")}`;
}

const SKILLS: readonly SkillLevel[] = ["beginner", "intermediate", "advanced", "expert"];
const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

/** Every preset must keep playing exactly as aggressiveness did before the trait dials. */
describe("seeded deals as recorded", () => {
  for (const skill of SKILLS) {
    for (const aggression of AGGRESSIONS) {
      it(`${skill} ${aggression} plays the seeded deals as recorded`, async () => {
        const lines: string[] = [];
        for (const seed of SEEDS) lines.push(await playDeal(seed, () => ({ skill, biddingStyle: "SAYC", aggression })));
        expect(lines).toMatchSnapshot();
      }, 60_000);
    }
  }
});
