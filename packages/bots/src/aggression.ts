import { SEATS, type Aggression, type Bid, type Card, type PlayContext, type Seat, type Suit } from "@contractplay/core";
import { isMajor, isSuit, levelOf, rank, toBid, toToken, type Eval, type Letter, type Token, type View } from "./auction.js";

/**
 * Aggressiveness bends the call or card a bot's skill rules chose. Normal leaves every choice alone. An Aggressive bot
 * opens, overcalls and competes on less, and grabs tricks; a Conservative bot needs more to act and waits for its tricks.
 * Neither ever passes where the partnership's agreements forbid a pass: the caller says when a pass is allowed.
 */

const nonPass = (tokens: readonly Token[]): Token[] => tokens.filter((token) => token !== "" && token !== "P");
const suitBid = (token: Token | undefined): Letter | undefined => token && rank(token) > 0 && isSuit(token[1]) ? token[1] : undefined;

/** The suit partner has shown naturally or raised, with how many cards it takes to compete in it; undefined when there is none. */
function partnersSuit(v: View): { suit: Letter; support: number } | undefined {
  // Partner raised the suit this player bid first: a fit already found, so a fifth card is reason to compete.
  const mine = suitBid(nonPass(v.mine)[0]);
  if (mine && !v.theirSuits.includes(mine) && nonPass(v.partners).some((token) => suitBid(token) === mine)) return { suit: mine, support: 5 };
  const first = nonPass(v.partners)[0];
  const suit = suitBid(first);
  if (!first || !suit || v.theirSuits.includes(suit) || levelOf(first) > 2) return undefined;
  if (!v.opened) return { suit, support: 3 };
  if (first === v.tokens[0]) return levelOf(first) === 1 ? { suit, support: isMajor(suit) ? 3 : 5 } : undefined;
  return levelOf(first) === 1 ? { suit, support: 4 } : undefined;
}

/** The opponents opened and our side has not yet made a call other than pass. */
const firstActionOverThem = (v: View): boolean => !v.opened && v.tokens.length > 0 && nonPass(v.ours).length === 0 && !v.lastIsOurs;

function aggressiveCall(h: Eval, v: View): Token | undefined {
  // Open by the Rule of 20: high-card points plus the two longest suits.
  if (v.tokens.length === 0) {
    const [longest, second] = h.byLength;
    if (h.hcp >= 10 && h.hcp <= 11 && h.hcp + h[longest!] + h[second!] >= 20) return `1${longest}`;
    return undefined;
  }
  // Overcall a good five-card suit at the one level on a light hand.
  if (firstActionOverThem(v) && v.last && levelOf(v.last) === 1 && h.hcp >= 7 && h.hcp <= 10) {
    const suit = h.byLength.find((letter) => h[letter] >= 5 && !v.theirSuits.includes(letter) && h.count(letter, "AKQJ") >= 2);
    if (suit && levelOf(v.cheapest(suit)) === 1) return v.cheapest(suit);
  }
  // Compete one more level in partner's suit rather than sell out.
  const shown = partnersSuit(v);
  if (shown && v.last && !v.lastIsOurs && h.len(shown.suit) >= shown.support && h.hcp >= 6) {
    const raise = v.cheapest(shown.suit);
    if (rank(raise) > 0 && levelOf(raise) <= 3) return raise;
  }
  return undefined;
}

/** Whether a Conservative bot would rather pass than make this call. */
function conservativePasses(h: Eval, v: View, token: Token): boolean {
  const suit = suitBid(token);
  if (v.tokens.length === 0) {
    if (!suit) return false;
    if (levelOf(token) === 1) return h.hcp < 12;
    // A preempt needs a suit that will take tricks.
    if (token === "2C") return false;
    return h.count(suit, "AKQ") < 2 || h.hcp < 6;
  }
  if (firstActionOverThem(v)) {
    if (token === "X") return h.hcp < 13;
    if (!suit || v.theirSuits.includes(suit)) return false;
    if (token !== v.cheapest(suit)) return h.count(suit, "AKQ") < 2;
    return h.hcp < (levelOf(token) === 1 ? 10 : 12);
  }
  const shown = partnersSuit(v);
  return !!shown && suit === shown.suit && levelOf(token) === 3 && !v.lastIsOurs && !v.uncontested && h.hcp < 8;
}

/**
 * The call a bot of this aggressiveness makes in place of the one its rules chose. `passAllowed` says whether a pass
 * keeps the partnership's agreements; a Conservative bot only passes when it does.
 */
export function adjustCall(chosen: Bid, h: Eval, v: View, aggression: Aggression, passAllowed: () => boolean): Bid {
  if (aggression === "normal") return chosen;
  const token = toToken(chosen);
  if (aggression === "aggressive") {
    if (token !== "P") return chosen;
    const bolder = aggressiveCall(h, v);
    return bolder && v.legal(bolder) ? toBid(bolder) : chosen;
  }
  return token !== "P" && token !== "R" && conservativePasses(h, v, token) && passAllowed() ? "pass" : chosen;
}

const RANKS = "23456789TJQKA";
const value = (card: Card): number => RANKS.indexOf(card.rank);
const lowest = (cards: readonly Card[]): Card => [...cards].sort((a, b) => value(a) - value(b) || a.suit.localeCompare(b.suit))[0]!;
const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const sameSide = (a: Seat, b: Seat): boolean => SEATS.indexOf(a) % 2 === SEATS.indexOf(b) % 2;

function beats(card: Card, current: Card, ledSuit: Suit, trump?: Suit): boolean {
  if ((card.suit === trump) !== (current.suit === trump)) return card.suit === trump;
  if (card.suit === current.suit) return value(card) > value(current);
  return card.suit === ledSuit && current.suit !== ledSuit;
}

/**
 * The card a bot of this aggressiveness plays in place of its rules' choice, or undefined to leave the choice to them.
 * Aggressive: defenders cash the ace from A-K against a suit contract, and second hand wins the trick when it can.
 * Conservative: second hand plays low, and defenders lead against a suit contract from a sequence or a suit with no ace or king.
 */
export function aggressionCard(context: PlayContext, aggression: Aggression): Card | undefined {
  if (aggression === "normal") return undefined;
  const { hand, currentTrick, trump, declarer } = context;
  const ledSuit = context.ledSuit ?? currentTrick[0]?.card.suit;
  const defending = !!declarer && !sameSide(context.seat, declarer);

  if (!ledSuit || currentTrick.length === 0) {
    if (!defending || !trump) return undefined;
    const side = SUITS.filter((suit) => suit !== trump).map((suit) => hand.filter((card) => card.suit === suit));
    if (aggression === "aggressive") {
      const cash = side.find((cards) => cards.some((card) => card.rank === "A") && cards.some((card) => card.rank === "K"));
      return cash?.find((card) => card.rank === "A");
    }
    const tops = side.flatMap((cards) => cards.filter((card) => value(card) >= RANKS.indexOf("T") &&
      cards.some((other) => value(other) === value(card) - 1)));
    if (tops.length) return [...tops].sort((a, b) => value(b) - value(a))[0];
    const safe = side.filter((cards) => cards.length > 0 && !cards.some((card) => card.rank === "A" || card.rank === "K"))
      .sort((a, b) => b.length - a.length)[0];
    return safe ? lowest(safe) : undefined;
  }

  if (currentTrick.length !== 1) return undefined;
  const following = hand.filter((card) => card.suit === ledSuit);
  if (!following.length) return undefined;
  if (aggression === "conservative") return lowest(following);
  const winners = following.filter((card) => beats(card, currentTrick[0]!.card, ledSuit, trump));
  return winners.length ? lowest(winners) : undefined;
}
