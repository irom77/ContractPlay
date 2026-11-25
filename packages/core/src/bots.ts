import { cardId, type Card, type Hand, type Seat, type Suit } from "./cards.js";
import type { Bid } from "./history.js";

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";
export type BiddingStyle = "SAYC" | "2/1" | (string & {});
/** How readily a bot bids and how boldly it plays; Normal is the skill level's own rules. */
export type Aggression = "conservative" | "normal" | "aggressive";
export const AGGRESSIONS: readonly Aggression[] = ["conservative", "normal", "aggressive"];
/** How far one trait dial bends a bot's play from its skill's rules; Standard leaves them alone. */
export type TraitLevel = "cautious" | "standard" | "bold";
export const TRAIT_LEVELS: readonly TraitLevel[] = ["cautious", "standard", "bold"];
/**
 * A bot's style, one dial at a time: how lightly it opens, how hard it competes, how wildly it preempts, how often it
 * doubles for penalty, how it leads as a defender, and whether second hand plays high or low.
 */
export type BotTraits = Readonly<{
  openings: TraitLevel;
  competing: TraitLevel;
  preempts: TraitLevel;
  doubles: TraitLevel;
  leads: TraitLevel;
  secondHand: TraitLevel;
}>;
export const TRAIT_NAMES: readonly (keyof BotTraits)[] = ["openings", "competing", "preempts", "doubles", "leads", "secondHand"];
const dials = (levels: Partial<BotTraits>): BotTraits => ({ ...Object.fromEntries(TRAIT_NAMES.map((name) => [name, "standard"])) as BotTraits, ...levels });
/** Each aggressiveness is a setting of the dials, playing exactly as aggressiveness always has. */
export const TRAIT_PRESETS: Readonly<Record<Aggression, BotTraits>> = {
  conservative: dials({ openings: "cautious", competing: "cautious", preempts: "cautious", leads: "cautious", secondHand: "cautious" }),
  normal: dials({}),
  aggressive: dials({ openings: "bold", competing: "bold", leads: "bold", secondHand: "bold" })
};
/**
 * `aggression` is missing from callers that predate it, and then means Normal. `traits` sets single dials over the
 * aggressiveness preset.
 */
export type BotConfig = Readonly<{ skill: SkillLevel; biddingStyle: BiddingStyle; aggression?: Aggression; traits?: Partial<BotTraits> }>;

/** The dials a bot plays with: its aggressiveness preset, then each dial its config sets. */
export function resolveTraits(config: Pick<BotConfig, "aggression" | "traits">): BotTraits {
  const set = Object.entries(config.traits ?? {}).filter(([, level]) => level !== undefined);
  return { ...TRAIT_PRESETS[config.aggression ?? "normal"], ...Object.fromEntries(set) };
}
export type PublicBid = Readonly<{ seat: Seat; bid: Bid }>;
export type PlayContext = Readonly<{
  seat: Seat;
  hand: Hand;
  currentTrick: readonly Readonly<{ seat: Seat; card: Card }>[];
  ledSuit?: Suit;
  trump?: Suit;
  /** The declarer, once the contract is set. */
  declarer?: Seat;
  /**
   * The other hand this player can see: dummy's cards once the opening lead is made, or declarer's own cards when
   * declarer chooses a card from dummy.
   */
  visibleHand?: Hand;
  /** Every card played to the tricks already completed. */
  played?: readonly Card[];
}>;

export interface BotPlayer {
  readonly config: BotConfig;
  chooseBid(hand: Hand, auction: readonly PublicBid[], seat: Seat): Promise<Bid>;
  chooseCard(context: PlayContext): Promise<Card>;
}

export interface Solver {
  recommendPlays(context: PlayContext): Promise<readonly Card[]>;
}

export async function requestHint(context: PlayContext, solver?: Solver): Promise<readonly Card[]> {
  const legalCards = context.ledSuit && context.hand.some((card) => card.suit === context.ledSuit)
    ? context.hand.filter((card) => card.suit === context.ledSuit)
    : context.hand;
  if (!solver) return legalCards;
  const legalIds = new Set(legalCards.map(cardId));
  return (await solver.recommendPlays(context)).filter((card) => legalIds.has(cardId(card)));
}
