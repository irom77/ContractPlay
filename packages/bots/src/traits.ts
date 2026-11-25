import { SEATS, type Bid, type BotTraits, type Card, type PlayContext, type Seat, type Suit } from "@contractplay/core";
import { isMajor, isSuit, LETTERS, levelOf, rank, toBid, toToken, type Eval, type Letter, type Token, type View } from "./auction.js";
// hints.ts imports player.ts, which imports this module: safe, as neither calls the other while loading.
import { explainBid } from "./hints.js";

/**
 * Trait dials bend the call or card a bot's skill rules chose (the natural choice); Standard leaves it alone. Each dial
 * looks only at the natural choice, never at another dial's: a Cautious dial may only turn a call into a pass, and only
 * where the partnership's agreements allow a pass (the caller says when); a Bold dial may only turn a pass into a call.
 * Aggressiveness is a preset of the dials (`TRAIT_PRESETS`).
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

/** Openings, Bold: open by the Rule of 20 (high-card points plus the two longest suits) with 10–11 points. */
function lightOpening(h: Eval, v: View): Token | undefined {
  if (v.tokens.length > 0) return undefined;
  const [longest, second] = h.byLength;
  return h.hcp >= 10 && h.hcp <= 11 && h.hcp + h[longest!] + h[second!] >= 20 ? `1${longest}` : undefined;
}

/** Competing, Bold: overcall a good five-card suit at the one level on a light hand, or compete one more level in partner's suit. */
function pushOn(h: Eval, v: View): Token | undefined {
  if (v.tokens.length === 0) return undefined;
  if (firstActionOverThem(v) && v.last && levelOf(v.last) === 1 && h.hcp >= 7 && h.hcp <= 10) {
    const suit = h.byLength.find((letter) => h[letter] >= 5 && !v.theirSuits.includes(letter) && h.count(letter, "AKQJ") >= 2);
    if (suit && levelOf(v.cheapest(suit)) === 1) return v.cheapest(suit);
  }
  const shown = partnersSuit(v);
  if (shown && v.last && !v.lastIsOurs && h.len(shown.suit) >= shown.support && h.hcp >= 6) {
    const raise = v.cheapest(shown.suit);
    if (rank(raise) > 0 && levelOf(raise) <= 3) return raise;
  }
  return undefined;
}

/**
 * Preempts, Bold: in first, second or third seat before anyone opens, preempt on 4–10 points with any honour (AKQJT) in
 * the long suit: a weak two with six diamonds, hearts or spades, a three-level preempt with seven or more cards. An
 * outside four-card major does not stop it.
 */
function wildPreempt(h: Eval, v: View): Token | undefined {
  if (v.tokens.length > 0 || v.leadingPasses > 2 || h.hcp < 4 || h.hcp > 10) return undefined;
  const suit = h.byLength[0]!;
  if (h.count(suit, "AKQJT") === 0) return undefined;
  if (h[suit] >= 7) return `3${suit}`;
  return h[suit] === 6 && suit !== "C" ? `2${suit}` : undefined;
}

/** Openings, Cautious: a one-level suit opening needs 12 points. */
const soundOpening = (h: Eval, v: View, token: Token): boolean =>
  v.tokens.length === 0 && !!suitBid(token) && levelOf(token) === 1 && h.hcp < 12;

/** Preempts, Cautious: a preempt needs a suit that will take tricks. */
const soundPreempt = (h: Eval, v: View, token: Token): boolean => {
  const suit = suitBid(token);
  return v.tokens.length === 0 && !!suit && levelOf(token) > 1 && token !== "2C" && (h.count(suit, "AKQ") < 2 || h.hcp < 6);
};

/** Competing, Cautious: overcalls and takeout doubles need more, and no three-level push in partner's suit under 8 points. */
function sellsOut(h: Eval, v: View, token: Token): boolean {
  if (v.tokens.length === 0) return false;
  const suit = suitBid(token);
  if (firstActionOverThem(v)) {
    if (token === "X") return h.hcp < 13;
    if (!suit || v.theirSuits.includes(suit)) return false;
    if (token !== v.cheapest(suit)) return h.count(suit, "AKQ") < 2;
    return h.hcp < (levelOf(token) === 1 ? 10 : 12);
  }
  const shown = partnersSuit(v);
  return !!shown && suit === shown.suit && levelOf(token) === 3 && !v.lastIsOurs && !v.uncontested && h.hcp < 8;
}

/** Whether a double by the player to act now would mean penalties, as the hints explain it. */
const readAsPenalty = (v: View): boolean =>
  explainBid([...v.auction, { seat: v.seat, bid: "double" }], v.auction.length, v.style).startsWith("Penalty double");

/** Defensive quick tricks in a suit: AK 2, AQ 1.5, A or KQ 1, a guarded king 0.5. */
function quickTricks(h: Eval, suit: Letter): number {
  if (h.has(suit, "AK")) return 2;
  if (h.has(suit, "AQ")) return 1.5;
  if (h.has(suit, "A") || h.has(suit, "KQ")) return 1;
  return h.has(suit, "K") && h.len(suit) >= 2 ? 0.5 : 0;
}

/**
 * Penalty doubles, Bold: in the pass-out seat, double the opponents' contract when the double cannot be read as takeout
 * (game level or higher, 3NT, or our side has bid) and the hand holds a good defence: four trumps with two of the top
 * four honours and a quick trick outside, or three quick tricks against notrump. A redouble is never made.
 */
export function penaltyDouble(h: Eval, v: View): Token | undefined {
  const last = v.last;
  if (!last || v.lastIsOurs || v.tokens.slice(-3).join(" ") !== `${last} P P` || !v.legal("X")) return undefined;
  if (levelOf(last) < 4 && last !== "3N" && nonPass(v.ours).length === 0) return undefined;
  if (!readAsPenalty(v)) return undefined;
  const trump = suitBid(last);
  const defence = trump
    ? h.len(trump) >= 4 && h.count(trump, "AKQJ") >= 2 && LETTERS.some((suit) => suit !== trump && quickTricks(h, suit) >= 1)
    : LETTERS.reduce((total, suit) => total + quickTricks(h, suit), 0) >= 3;
  return defence ? "X" : undefined;
}

/** Penalty doubles, Cautious: a double the hints would call a penalty double becomes a pass. */
const rarelyDoubles = (_h: Eval, v: View, token: Token): boolean => token === "X" && readAsPenalty(v);

type Cautious = (h: Eval, v: View, token: Token) => boolean;
type Bold = (h: Eval, v: View) => Token | undefined;
/** The checks each dial makes when Cautious. */
const CAUTIOUS: readonly [keyof BotTraits, Cautious][] = [["openings", soundOpening], ["preempts", soundPreempt], ["competing", sellsOut], ["doubles", rarelyDoubles]];
/** The calls each dial finds when Bold, in the order they take precedence. */
const BOLD: readonly [keyof BotTraits, Bold][] = [["openings", lightOpening], ["preempts", wildPreempt], ["competing", pushOn], ["doubles", penaltyDouble]];

/**
 * The call a bot with these dials makes in place of the one its rules chose. `passAllowed` says whether a pass keeps the
 * partnership's agreements; a Cautious dial only passes when it does.
 */
export function adjustCall(chosen: Bid, h: Eval, v: View, traits: BotTraits, passAllowed: () => boolean): Bid {
  const token = toToken(chosen);
  if (token === "P") {
    for (const [dial, find] of BOLD) {
      if (traits[dial] !== "bold") continue;
      const bolder = find(h, v);
      if (bolder && v.legal(bolder)) return toBid(bolder);
    }
    return chosen;
  }
  if (token === "R") return chosen;
  return CAUTIOUS.some(([dial, holds]) => traits[dial] === "cautious" && holds(h, v, token)) && passAllowed() ? "pass" : chosen;
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
 * The card a bot with these dials plays in place of its rules' choice, or undefined to leave the choice to them.
 * Leads (a defender's lead against a suit contract): Bold cashes the ace from A-K; Cautious leads from a sequence or a
 * suit with no ace or king. Second hand: Bold wins the trick when it can; Cautious plays low.
 */
export function traitCard(context: PlayContext, traits: BotTraits): Card | undefined {
  const { hand, currentTrick, trump, declarer } = context;
  const ledSuit = context.ledSuit ?? currentTrick[0]?.card.suit;
  const defending = !!declarer && !sameSide(context.seat, declarer);

  if (!ledSuit || currentTrick.length === 0) {
    if (traits.leads === "standard" || !defending || !trump) return undefined;
    const side = SUITS.filter((suit) => suit !== trump).map((suit) => hand.filter((card) => card.suit === suit));
    if (traits.leads === "bold") {
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

  if (currentTrick.length !== 1 || traits.secondHand === "standard") return undefined;
  const following = hand.filter((card) => card.suit === ledSuit);
  if (!following.length) return undefined;
  if (traits.secondHand === "cautious") return lowest(following);
  const winners = following.filter((card) => beats(card, currentTrick[0]!.card, ledSuit, trump));
  return winners.length ? lowest(winners) : undefined;
}
