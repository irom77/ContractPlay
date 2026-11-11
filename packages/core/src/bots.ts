import { cardId, type Card, type Hand, type Seat, type Suit } from "./cards.js";
import type { Bid } from "./history.js";

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";
export type BiddingStyle = "SAYC" | "2/1" | (string & {});
export type BotConfig = Readonly<{ skill: SkillLevel; biddingStyle: BiddingStyle }>;
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
