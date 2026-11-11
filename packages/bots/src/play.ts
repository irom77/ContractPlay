import { SEATS, cardId, type Card, type Hand, type PlayContext, type Seat, type Suit } from "@contractplay/core";

/**
 * Card play beyond following suit and winning cheaply. Advanced play manages trumps and plays third hand high;
 * Expert play also counts the cards that have gone, so it knows which of its cards are now winners.
 */

const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = "23456789TJQKA";
const value = (card: Card): number => RANKS.indexOf(card.rank);
const partnerOf = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!;
const nextSeat = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 1) % SEATS.length]!;
const lowest = (cards: readonly Card[]): Card => [...cards].sort((a, b) => value(a) - value(b) || a.suit.localeCompare(b.suit))[0]!;
const highest = (cards: readonly Card[]): Card => [...cards].sort((a, b) => value(b) - value(a) || a.suit.localeCompare(b.suit))[0]!;

function legalCards(context: PlayContext): Hand {
  const ledSuit = context.ledSuit ?? context.currentTrick[0]?.card.suit;
  const following = ledSuit ? context.hand.filter((card) => card.suit === ledSuit) : [];
  return following.length ? following : context.hand;
}

function beats(card: Card, current: Card, ledSuit: Suit, trump?: Suit): boolean {
  if ((card.suit === trump) !== (current.suit === trump)) return card.suit === trump;
  if (card.suit === current.suit) return value(card) > value(current);
  return card.suit === ledSuit && current.suit !== ledSuit;
}

function currentWinner(context: PlayContext, ledSuit: Suit) {
  return context.currentTrick.reduce((best, play) => beats(play.card, best.card, ledSuit, context.trump) ? play : best);
}

/** Cards nobody has shown yet: not in this hand, not in the visible hand, and not played. */
function unseenCards(context: PlayContext): Card[] {
  const seen = new Set([...context.hand, ...(context.visibleHand ?? []), ...(context.played ?? []), ...context.currentTrick.map((play) => play.card)].map(cardId));
  return SUITS.flatMap((suit) => [...RANKS].map((rank) => ({ suit, rank }) as Card)).filter((card) => !seen.has(cardId(card)));
}

/** Whether the player belongs to the declaring side and can see both of its hands. */
function declaring(context: PlayContext): boolean {
  return !!context.declarer && !!context.visibleHand && SEATS.indexOf(context.seat) % 2 === SEATS.indexOf(context.declarer) % 2;
}

/** The lowest card of the run of touching cards that ends in the given one: with K-Q, the queen does the king's work. */
function bottomOfSequence(card: Card, cards: readonly Card[]): Card {
  let chosen = card;
  for (;;) {
    const below = cards.find((other) => other.suit === chosen.suit && value(other) === value(chosen) - 1);
    if (!below) return chosen;
    chosen = below;
  }
}

/** Advanced play: draw trumps as declarer, ruff or discard sensibly, and play third hand high. */
export function advancedCard(context: PlayContext): Card | undefined {
  const { trump, hand, currentTrick } = context;
  const ledSuit = context.ledSuit ?? currentTrick[0]?.card.suit;
  const partner = partnerOf(context.seat);

  if (!ledSuit || currentTrick.length === 0) {
    // Declarer draws the opponents' trumps while they still hold some and the declaring side holds more.
    if (trump && declaring(context) && context.played) {
      const mine = hand.filter((card) => card.suit === trump);
      const ours = mine.length + context.visibleHand!.filter((card) => card.suit === trump).length;
      const outstanding = unseenCards(context).filter((card) => card.suit === trump).length;
      if (mine.length > 0 && outstanding > 0 && ours > outstanding) return highest(mine);
    }
    return undefined;
  }

  const winner = currentWinner(context, ledSuit);
  const partnerWinning = winner.seat === partner;
  if (!hand.some((card) => card.suit === ledSuit)) {
    const trumps = trump ? hand.filter((card) => card.suit === trump) : [];
    const side = hand.filter((card) => card.suit !== trump);
    if (!partnerWinning) {
      const ruffs = trumps.filter((card) => beats(card, winner.card, ledSuit, trump));
      if (ruffs.length) return lowest(ruffs);
    }
    return lowest(side.length ? side : hand);
  }

  if (currentTrick.length === 2 && currentTrick[0]!.seat === partner) {
    if (partnerWinning && value(winner.card) >= RANKS.indexOf("J")) return undefined;
    const choices = legalCards(context);
    const winning = choices.filter((card) => beats(card, winner.card, ledSuit, trump));
    if (!winning.length) return undefined;
    const last = nextSeat(context.seat);
    const dummySeat = context.declarer ? partnerOf(context.declarer) : undefined;
    if (context.visibleHand && last === dummySeat && !declaring(context)) {
      // Dummy plays last and its cards are on the table: play just high enough to beat them.
      const dummySuit = context.visibleHand.filter((card) => card.suit === ledSuit);
      const dummyBest = dummySuit.length ? highest(dummySuit) : undefined;
      const enough = dummyBest ? winning.filter((card) => value(card) > value(dummyBest)) : winning;
      return lowest(enough.length ? enough : winning);
    }
    return bottomOfSequence(highest(winning), choices);
  }
  return undefined;
}

/** Expert play: cash cards that the play so far has made winners, lead a singleton against a suit contract, and keep winners when discarding. */
export function expertCard(context: PlayContext): Card | undefined {
  const { trump, hand, currentTrick, played } = context;
  if (!played) return undefined;
  const ledSuit = context.ledSuit ?? currentTrick[0]?.card.suit;
  const unseen = unseenCards(context);
  // Cards that could still beat one of ours: those nobody has shown, and dummy's when dummy is an opponent.
  const against = declaring(context) ? unseen : [...unseen, ...(context.visibleHand ?? [])];
  const isMaster = (card: Card): boolean => !against.some((other) => other.suit === card.suit && value(other) > value(card));

  if (!ledSuit || currentTrick.length === 0) {
    const openingLead = played.length === 0 && !context.visibleHand && hand.length === 13;
    if (openingLead) {
      if (!trump) return undefined;
      const trumps = hand.filter((card) => card.suit === trump).length;
      const singleton = SUITS.filter((suit) => suit !== trump).map((suit) => hand.filter((card) => card.suit === suit))
        .find((cards) => cards.length === 1 && value(cards[0]!) < RANKS.indexOf("Q"));
      return singleton && trumps >= 1 && trumps <= 3 ? singleton[0] : undefined;
    }
    const outstandingTrumps = trump ? unseen.filter((card) => card.suit === trump).length : 0;
    // The declaring side draws trumps before cashing side winners; defenders take theirs while they can.
    if (trump && declaring(context) && outstandingTrumps > 0 && hand.some((card) => card.suit === trump)) return undefined;
    const masters = hand.filter((card) => card.suit !== trump && isMaster(card));
    if (masters.length) {
      const bySuit = SUITS.map((suit) => masters.filter((card) => card.suit === suit)).sort((a, b) => b.length - a.length)[0]!;
      return highest(bySuit);
    }
    return undefined;
  }

  if (!hand.some((card) => card.suit === ledSuit)) {
    const winner = currentWinner(context, ledSuit);
    const partnerWinning = winner.seat === partnerOf(context.seat);
    const canRuff = !!trump && !partnerWinning && hand.some((card) => card.suit === trump && beats(card, winner.card, ledSuit, trump));
    if (canRuff) return undefined;
    // Discard a card that will never win a trick, from the longest suit that has one.
    const spare = hand.filter((card) => card.suit !== trump && !isMaster(card));
    if (!spare.length) return undefined;
    const length = (suit: Suit): number => hand.filter((card) => card.suit === suit).length;
    return [...spare].sort((a, b) => value(a) - value(b) || length(b.suit) - length(a.suit) || a.suit.localeCompare(b.suit))[0];
  }
  return undefined;
}
