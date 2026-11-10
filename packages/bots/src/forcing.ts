import { SEATS, type Bid, type Hand, type PublicBid, type Seat, type Suit } from "@contractplay/core";

/**
 * Natural continuations for calls that partner may not pass.
 *
 * The rule bots cover the common shapes of each auction and pass when no rule fits. Three of those passes break a
 * forcing agreement: opener passing an unpassed partner's new-suit response, opener passing partner's negative double,
 * and responder passing opener's reverse. This module supplies a natural call for exactly those positions.
 */

type Strain = Suit | "notrump";
type Contract = Readonly<{ level: number; strain: Strain; seat: Seat }>;

const strainOrder: readonly Strain[] = ["clubs", "diamonds", "hearts", "spades", "notrump"];
const suitsHighToLow: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const honorPoints: Readonly<Record<string, number>> = { A: 4, K: 3, Q: 2, J: 1 };
const isMajor = (strain: Strain): boolean => strain === "hearts" || strain === "spades";
const order = (level: number, strain: Strain): number => level * 5 + strainOrder.indexOf(strain);
const partnerOf = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!;

function parse({ bid, seat }: PublicBid): Contract | undefined {
  const match = /^([1-7])(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? { level: Number(match[1]), strain: match[2] as Strain, seat } : undefined;
}

function shape(hand: Hand) {
  const length = (suit: Suit): number => hand.filter((card) => card.suit === suit).length;
  const hcp = hand.reduce((total, card) => total + (honorPoints[card.rank] ?? 0), 0);
  const counts = suitsHighToLow.map(length);
  const balanced = counts.every((count) => count >= 2) && counts.filter((count) => count === 2).length <= 1;
  const stopper = (suit: Suit): boolean => {
    const ranks = hand.filter((card) => card.suit === suit).map((card) => card.rank);
    return ranks.includes("A") || (ranks.length >= 2 && ranks.includes("K")) || (ranks.length >= 3 && ranks.includes("Q")) || (ranks.length >= 4 && ranks.includes("J"));
  };
  return { length, hcp, balanced, stopper };
}

/** Opener's rebid after 1x – (pass) – new suit – (pass). */
function openerRebid(hand: Hand, opening: Contract, response: Contract): Bid {
  const { length, hcp, balanced, stopper } = shape(hand);
  const opened = opening.strain as Suit;
  const responded = response.strain as Suit;
  const floor = order(response.level, responded);
  const bid = (level: number, strain: Strain): Bid => `${level}${strain}` as Bid;
  /** The lowest level at which a strain can be bid over the response, plus optional jumps. */
  const cheapest = (strain: Strain, jump = 0): Bid => bid((order(response.level, strain) > floor ? response.level : response.level + 1) + jump, strain);
  const secondSuits = suitsHighToLow
    .filter((suit) => suit !== opened && suit !== responded && length(suit) >= 4)
    .sort((a, b) => length(b) - length(a));
  const unbid = suitsHighToLow.filter((suit) => suit !== opened && suit !== responded);
  const unbidStopped = unbid.every(stopper);

  if (response.level === 1) {
    if (length(responded) >= 4) {
      if (hcp <= 15) return bid(2, responded);
      if (hcp <= 18 || !isMajor(responded)) return bid(3, responded);
      return bid(4, responded);
    }
    if (balanced) return hcp <= 16 ? "1notrump" : hcp <= 19 ? "2notrump" : "3notrump";
    for (const suit of secondSuits) {
      const natural = cheapest(suit);
      // A new suit above two of the opened suit is a reverse and needs extra strength.
      const isReverse = order(Number(natural[0]), suit) > order(2, opened);
      if (hcp >= 19) return isReverse ? natural : cheapest(suit, 1);
      if (!isReverse || hcp >= 17) return natural;
    }
    if (length(opened) >= 6) return bid(hcp <= 15 ? 2 : 3, opened);
    if (hcp >= 18) return unbidStopped ? (hcp >= 20 ? "3notrump" : "2notrump") : bid(3, length(opened) >= 5 ? opened : responded);
    if (length(responded) === 3) return bid(2, responded);
    if (length(opened) >= 5) return bid(2, opened);
    return "1notrump";
  }

  // A two-level response in a lower suit: ten or more points in SAYC, game forcing in 2/1.
  const support = length(responded);
  if (responded === "hearts" && support >= 3) return bid(hcp >= 16 ? 4 : 3, "hearts");
  if (support >= 4 && !balanced) return bid(3, responded);
  for (const suit of secondSuits) {
    const natural = cheapest(suit);
    if (order(Number(natural[0]), suit) < order(2, opened) || hcp >= 15) return natural;
  }
  if (length(opened) >= 6) return bid(hcp <= 15 ? 2 : 3, opened);
  if (balanced || length(opened) < 5) return hcp >= 15 && unbidStopped ? "3notrump" : support >= 4 && !unbidStopped ? bid(3, responded) : "2notrump";
  return bid(2, opened);
}

/** Opener's rebid after 1x – (overcall) – double – (pass): the double asks opener to choose a strain. */
function afterNegativeDouble(hand: Hand, opening: Contract, overcall: Contract): Bid {
  const { length, hcp, balanced, stopper } = shape(hand);
  const opened = opening.strain as Suit;
  const theirs = overcall.strain as Suit;
  const floor = order(overcall.level, theirs);
  const cheapestLevel = (strain: Strain): number => order(overcall.level, strain) > floor ? overcall.level : overcall.level + 1;
  const bid = (strain: Strain, jump = 0): Bid => `${Math.min(7, cheapestLevel(strain) + jump)}${strain}` as Bid;
  const gameLevel = (strain: Strain): number => strain === "notrump" ? 3 : isMajor(strain) ? 4 : 5;
  const unbid = suitsHighToLow.filter((suit) => suit !== opened && suit !== theirs);

  const major = unbid.filter((suit) => isMajor(suit) && length(suit) >= 4).sort((a, b) => length(b) - length(a))[0];
  if (major) {
    if (hcp >= 19) return `${Math.max(gameLevel(major), cheapestLevel(major))}${major}` as Bid;
    return bid(major, hcp >= 16 && cheapestLevel(major) + 1 < gameLevel(major) ? 1 : 0);
  }
  if (stopper(theirs) && (balanced || length(opened) < 5)) {
    if (hcp >= 18) return `${Math.max(3, cheapestLevel("notrump"))}notrump` as Bid;
    return bid("notrump");
  }
  if (length(opened) >= 6) return bid(opened, hcp >= 16 ? 1 : 0);
  const minor = unbid.filter((suit) => !isMajor(suit) && length(suit) >= 4)[0];
  if (minor && (order(cheapestLevel(minor), minor) < order(cheapestLevel(opened), opened) || hcp >= 16)) return bid(minor);
  if (length(opened) >= 5) return bid(opened);
  if (stopper(theirs)) return bid("notrump");
  const longest = [...unbid].sort((a, b) => length(b) - length(a) || cheapestLevel(a) - cheapestLevel(b))[0]!;
  return length(longest) >= 3 ? bid(longest) : bid(opened);
}

/** Responder's rebid after 1x – 1y – two of a higher suit (a reverse), which is forcing for one round. */
function afterReverse(hand: Hand, opening: Contract, response: Contract, reverse: Contract): Bid {
  const { length, hcp, stopper } = shape(hand);
  const opened = opening.strain as Suit;
  const responded = response.strain as Suit;
  const second = reverse.strain as Suit;
  const fourth = suitsHighToLow.find((suit) => suit !== opened && suit !== responded && suit !== second)!;
  const rebidOwn = order(2, responded) > order(2, second) ? `2${responded}` as Bid : undefined;

  if (hcp >= 9) {
    if (length(second) >= 4) return `${isMajor(second) ? 4 : 3}${second}` as Bid;
    if (length(responded) >= 6 && isMajor(responded)) return `3${responded}` as Bid;
    if (stopper(fourth)) return "3notrump";
    if (length(opened) >= 3) return `3${opened}` as Bid;
    return rebidOwn && length(responded) >= 5 ? rebidOwn : "2notrump";
  }
  if (rebidOwn && length(responded) >= 5) return rebidOwn;
  if (length(opened) >= 3 && length(opened) >= length(second)) return `3${opened}` as Bid;
  if (length(second) >= 4) return `3${second}` as Bid;
  return "2notrump";
}

/** Responder's rebid after 1x – two of a lower suit – a new suit by opener, which responder may not pass. */
function afterOpenerNewSuit(hand: Hand, opening: Contract, response: Contract, rebid: Contract): Bid {
  const { length, hcp, stopper } = shape(hand);
  const opened = opening.strain as Suit;
  const responded = response.strain as Suit;
  const second = rebid.strain as Suit;
  const floor = order(rebid.level, second);
  const cheapest = (strain: Strain): Bid => `${order(rebid.level, strain) > floor ? rebid.level : rebid.level + 1}${strain}` as Bid;
  const fourth = suitsHighToLow.find((suit) => suit !== opened && suit !== responded && suit !== second)!;
  const game = hcp >= 13;

  if (length(second) >= 4) return isMajor(second) && game ? `4${second}` as Bid : cheapest(second);
  if (isMajor(opened) && length(opened) >= 3) return game ? `4${opened}` as Bid : cheapest(opened);
  if (stopper(fourth)) return game ? "3notrump" : cheapest("notrump");
  if (length(responded) >= 6) return cheapest(responded);
  if (length(opened) >= 2) return cheapest(opened);
  return cheapest(responded);
}

/** Responder's rebid with eight to twelve points after 1x – 1y – 1z: too much to pass, not enough to insist on game. */
function afterOneLevelRebid(hand: Hand, opening: Contract, response: Contract, rebid: Contract): Bid | undefined {
  const { length, hcp, stopper } = shape(hand);
  if (hcp < 8 || hcp > 12) return undefined;
  const opened = opening.strain as Suit;
  const responded = response.strain as Suit;
  const second = rebid.strain as Suit;
  const fourth = suitsHighToLow.find((suit) => suit !== opened && suit !== responded && suit !== second)!;
  const level = hcp <= 10 ? 2 : 3;
  if (length(second) >= 4) return `${level}${second}` as Bid;
  if (length(responded) >= 6) return `${level}${responded}` as Bid;
  if (stopper(fourth)) return hcp <= 10 ? "1notrump" : "2notrump";
  if (length(opened) >= (isMajor(opened) ? 3 : 4)) return `${level}${opened}` as Bid;
  return length(responded) >= 5 ? `2${responded}` as Bid : "1notrump";
}

/** The bidder's call after partner cue-bids the opponents' suit to show a fit and at least invitational values. */
function afterCueRaise(hand: Hand, ownSuit: Suit, theirSuit: Suit, cue: Contract): Bid {
  const { hcp, stopper } = shape(hand);
  const floor = order(cue.level, cue.strain);
  const cheapest = (strain: Strain): Bid => `${order(cue.level, strain) > floor ? cue.level : cue.level + 1}${strain}` as Bid;
  if (isMajor(ownSuit)) return hcp >= 14 && order(4, ownSuit) > floor ? `4${ownSuit}` as Bid : cheapest(ownSuit);
  if (stopper(theirSuit)) return hcp >= 14 && order(3, "notrump") > floor ? "3notrump" : cheapest("notrump");
  return cheapest(ownSuit);
}

/** Responder's first call with six or more points after partner's one-of-a-suit opening and a pass. */
function firstResponse(hand: Hand, opening: Contract, style: BiddingStyle, passedHand: boolean): Bid | undefined {
  const { length, hcp, balanced } = shape(hand);
  if (hcp < 6) return undefined;
  const opened = opening.strain as Suit;
  const bid = (level: number, strain: Strain): Bid => `${level}${strain}` as Bid;
  const support = length(opened);
  const fits = isMajor(opened) ? support >= 3 : support >= (opened === "diamonds" ? 4 : 5);
  const oneLevel = suitsHighToLow
    .filter((suit) => order(1, suit) > order(1, opened) && length(suit) >= 4)
    .sort((a, b) => length(b) - length(a) || order(1, a) - order(1, b))[0];
  // With a fit for a major, raise at once; with a fit for a minor, show a major first.
  if (fits && isMajor(opened) && hcp <= 12) return bid(hcp <= 10 ? 2 : 3, opened);
  if (oneLevel) return bid(1, oneLevel);
  if (fits && hcp <= 12) return bid(hcp <= 10 ? 2 : 3, opened);
  const twoLevelMinimum = passedHand ? 10 : style === "2/1" && isMajor(opened) ? 13 : 10;
  const twoLevel = suitsHighToLow
    .filter((suit) => order(1, suit) < order(1, opened) && length(suit) >= (suit === "hearts" || passedHand ? 5 : 4))
    .sort((a, b) => length(b) - length(a))[0];
  if (twoLevel && hcp >= twoLevelMinimum && !(passedHand && hcp > 11)) return bid(2, twoLevel);
  if (fits) return bid(isMajor(opened) ? 4 : 3, opened);
  if (hcp <= 10 || (style === "2/1" && isMajor(opened) && hcp <= 12 && !passedHand)) return "1notrump";
  if (hcp <= 12) return balanced || !twoLevel ? "2notrump" : bid(2, twoLevel);
  return hcp <= 15 ? "3notrump" : twoLevel ? bid(2, twoLevel) : "3notrump";
}

/** Responder's call with game or invitational values after partner's 1NT opening and a pass, when no convention fits. */
function notrumpResponse(hand: Hand): Bid | undefined {
  const { hcp } = shape(hand);
  if (hcp < 8) return undefined;
  if (hcp <= 9) return "2notrump";
  if (hcp <= 15) return "3notrump";
  return hcp <= 17 ? "4notrump" : "6notrump";
}

/** The fewest high-card points each of partner's calls has promised in an auction the opponents stayed out of. */
function partnerMinimum(calls: readonly (Contract | undefined)[], partner: Seat, style: BiddingStyle, partnerPassedFirst: boolean): number {
  const opening = calls[0]!;
  const ours = calls.filter((call): call is Contract => !!call);
  if (opening.seat === partner) {
    if (opening.level === 1) {
      const rebid = ours.filter((call) => call.seat === partner)[1];
      const reversed = rebid && opening.strain !== "notrump" && rebid.strain !== "notrump" && rebid.strain !== opening.strain && rebid.level === 2 && order(2, rebid.strain) > order(2, opening.strain) && ours[1]?.level === 1;
      if (opening.strain === "notrump") return 15;
      // Opener's jump to 2NT over a one-level response shows 18-19; a jump in a suit already bid shows extras.
      const jumped = rebid && ours[1]?.level === 1 && (rebid.strain === "notrump" ? rebid.level === 2 : rebid.level === 3 && (rebid.strain === opening.strain || rebid.strain === ours[1].strain));
      return jumped ? (rebid.strain === "notrump" ? 18 : 16) : reversed ? 16 : partnerPassedFirst ? 11 : 12;
    }
    if (opening.level === 2) return opening.strain === "notrump" ? 20 : opening.strain === "clubs" ? 22 : 5;
    return 5;
  }
  const response = ours[1];
  if (!response || response.seat !== partner) return 0;
  if (opening.level === 1 && opening.strain !== "notrump") {
    if (response.strain === opening.strain) return response.level === 3 ? 10 : 6;
    if (response.strain === "notrump") return response.level === 1 ? 6 : response.level === 2 ? 11 : 13;
    if (response.level === 1) return 6;
    if (response.level === 2 && order(2, response.strain) < order(2, opening.strain)) return style === "2/1" && isMajor(opening.strain) && !partnerPassedFirst ? 12 : 10;
    return 0;
  }
  if (opening.level === 2 && opening.strain === "clubs") return response.level === 2 && response.strain === "diamonds" ? 0 : 8;
  if (opening.strain === "notrump" && response.strain === "notrump" && response.level === opening.level + 1) return opening.level === 1 ? 8 : 4;
  return 0;
}

/** Game when the partnership is known to hold the values for it and partner's call would otherwise be passed out below game. */
function gameWithKnownValues(hand: Hand, calls: readonly (Contract | undefined)[], seat: Seat, style: BiddingStyle, partnerPassedFirst: boolean): Bid | undefined {
  const partner = partnerOf(seat);
  const { length, hcp, stopper } = shape(hand);
  const ours = calls.filter((call): call is Contract => !!call);
  const current = ours.at(-1)!;
  const isGame = (level: number, strain: Strain): boolean => level >= (strain === "notrump" ? 3 : isMajor(strain) ? 4 : 5);
  if (isGame(current.level, current.strain) || hcp + partnerMinimum(calls, partner, style, partnerPassedFirst) < 26) return undefined;
  const legal = (level: number, strain: Strain): boolean => order(level, strain) > order(current.level, current.strain);

  // Lengths partner has shown by natural suit bids; conventional openings and their replies show none.
  const opening = ours[0]!;
  const natural = opening.level === 1 && opening.strain !== "notrump";
  const shown = (suit: Suit): number => {
    if (!natural) return 0;
    let cards = 0;
    ours.forEach((call, index) => {
      if (call.strain !== suit) return;
      const earlier = ours.slice(0, index);
      const firstBySide = !earlier.some((other) => other.strain === suit);
      if (call.seat === partner) {
        if (firstBySide) cards = index === 0 ? (isMajor(suit) ? 5 : 3) : index === 1 && call.level === 2 && suit === "hearts" ? 5 : 4;
        else if (earlier.some((other) => other.strain === suit && other.seat === partner)) cards = Math.max(cards + 1, index >= 2 && ours[0]!.seat === partner && ours[0]!.strain === suit ? 6 : 5);
        else cards = Math.max(cards, 3);
      }
    });
    return cards;
  };
  const majorFit = (["spades", "hearts"] as const).filter((suit) => shown(suit) > 0 && length(suit) + shown(suit) >= 8).sort((a, b) => length(b) + shown(b) - length(a) - shown(a))[0];
  if (majorFit) return legal(4, majorFit) ? `4${majorFit}` as Bid : undefined;
  // A six-card major plays well opposite a partner who has shown a balanced hand; a seven-card major opposite anything.
  const partnerBalanced = ours.some((call) => call.seat === partner && call.strain === "notrump");
  const ownMajor = (["spades", "hearts"] as const).find((suit) => length(suit) >= (partnerBalanced ? 6 : 7));
  if (ownMajor && legal(4, ownMajor)) return `4${ownMajor}` as Bid;
  if (legal(3, "notrump")) {
    const unbid = suitsHighToLow.filter((suit) => !ours.some((call) => call.strain === suit));
    const minorFit = (["diamonds", "clubs"] as const).find((suit) => shown(suit) > 0 && length(suit) + shown(suit) >= 9);
    if (!natural || !minorFit || unbid.every(stopper) || hcp + partnerMinimum(calls, partner, style, partnerPassedFirst) < 28) return "3notrump";
    return `5${minorFit}` as Bid;
  }
  return undefined;
}

export type BiddingStyle = "SAYC" | "2/1";

/**
 * A natural call for a position where passing would break a forcing agreement or give up a game the partnership is
 * known to have the values for; undefined when a pass is allowed.
 */
export function forcedContinuation(hand: Hand, auction: readonly PublicBid[], seat: Seat, style: BiddingStyle = "SAYC"): Bid | undefined {
  const partner = partnerOf(seat);
  const first = auction.findIndex(({ bid }) => bid !== "pass");
  if (first < 0) return undefined;
  const live = auction.slice(first);
  const calls = live.map(parse);
  const passes = (index: number): boolean => live[index]?.bid === "pass";
  const opening = calls[0];
  if (!opening) return undefined;
  const partnerPassedFirst = (bidder: Seat): boolean => auction.slice(0, first).some((call) => call.seat === partnerOf(bidder));
  const forced = forcedByAgreement();
  if (forced) return forced;
  // The remaining nets are for auctions the opponents have stayed out of, with partner's call about to be passed out.
  const uncontested = live.every((call, index) => index % 2 === 0 || call.bid === "pass") && live.every((call) => call.bid !== "double" && call.bid !== "redouble");
  if (!uncontested || live.length % 2 !== 0 || !calls.at(-2) || calls.at(-2)!.seat !== partner) return undefined;
  if (live.length === 2 && opening.level === 1) {
    const response = opening.strain === "notrump" ? notrumpResponse(hand) : firstResponse(hand, opening, style, auction.slice(0, first).some((call) => call.seat === seat));
    if (response) return response;
  }
  const [, , response, , rebid] = calls;
  if (
    live.length === 6 && opening.seat === partner && opening.level === 1 && opening.strain !== "notrump" && response?.level === 1 &&
    response.strain !== "notrump" && rebid?.level === 1 && rebid.strain !== "notrump"
  ) {
    const natural = afterOneLevelRebid(hand, opening, response, rebid);
    if (natural) return natural;
  }
  return gameWithKnownValues(hand, calls, seat, style, partnerPassedFirst(seat));

  function forcedByAgreement(): Bid | undefined {
  if (!opening || opening.level !== 1 || opening.strain === "notrump") return undefined;

  // 1x – (overcall) – cue-bid by responder, or (1x) – overcall – (pass) – cue-bid by advancer: a raise that cannot be passed.
  const overcalled = calls[1];
  if (overcalled && overcalled.strain !== "notrump" && overcalled.strain !== opening.strain && overcalled.seat !== partnerOf(opening.seat)) {
    const cue = calls[2];
    if (live.length === 4 && opening.seat === seat && passes(3) && cue && cue.seat === partner && cue.strain === overcalled.strain) {
      return afterCueRaise(hand, opening.strain as Suit, overcalled.strain as Suit, cue);
    }
    const advance = calls[3];
    if (live.length === 5 && overcalled.seat === seat && passes(2) && passes(4) && advance && advance.seat === partner && advance.strain === opening.strain) {
      return afterCueRaise(hand, overcalled.strain as Suit, opening.strain as Suit, advance);
    }
  }

  if (live.length === 4 && opening.seat === seat && passes(3)) {
    const response = calls[2];
    if (
      passes(1) && response && response.seat === partner && response.strain !== "notrump" && response.strain !== opening.strain &&
      order(response.level, response.strain) < order(2, opening.strain) && !auction.slice(0, first).some((call) => call.seat === partner)
    ) return openerRebid(hand, opening, response);
    const overcall = calls[1];
    if (overcall && overcall.strain !== "notrump" && overcall.strain !== opening.strain && overcall.level <= 3 && live[2]?.bid === "double" && live[2].seat === partner) {
      return afterNegativeDouble(hand, opening, overcall);
    }
  }

  if (live.length === 6 && opening.seat === partner && passes(1) && passes(3) && passes(5) && !partnerPassedFirst(seat)) {
    const response = calls[2];
    const reverse = calls[4];
    if (
      response && reverse && response.seat === seat && reverse.seat === partner && response.level === 2 && response.strain !== "notrump" &&
      order(2, response.strain) < order(2, opening.strain) && reverse.level <= 3 && reverse.strain !== "notrump" &&
      reverse.strain !== opening.strain && reverse.strain !== response.strain
    ) return afterOpenerNewSuit(hand, opening, response, reverse);
    if (
      response && reverse && response.seat === seat && reverse.seat === partner && response.level === 1 && response.strain !== "notrump" &&
      reverse.level === 2 && reverse.strain !== "notrump" && reverse.strain !== opening.strain && reverse.strain !== response.strain &&
      order(2, reverse.strain) > order(2, opening.strain)
    ) return afterReverse(hand, opening, response, reverse);
  }
  return undefined;
  }
}

/**
 * Opener's rebid with 19 or more points after a one-level response. The rules show a second suit or rebid the first
 * one cheaply whatever the strength; a hand this strong must jump or reverse so that responder does not pass short of
 * game. Returns undefined when the chosen call already shows the extra values.
 */
export function strongOpenerRebid(hand: Hand, auction: readonly PublicBid[], seat: Seat, chosen: Bid): Bid | undefined {
  const first = auction.findIndex(({ bid }) => bid !== "pass");
  const live = first < 0 ? [] : auction.slice(first);
  if (live.length !== 4 || live[1]!.bid !== "pass" || live[3]!.bid !== "pass") return undefined;
  const [opening, , response] = live.map(parse);
  const planned = parse({ bid: chosen, seat });
  if (
    !opening || !response || !planned || opening.seat !== seat || response.seat !== partnerOf(seat) || opening.level !== 1 ||
    opening.strain === "notrump" || response.level !== 1 || response.strain === "notrump" || shape(hand).hcp < 19
  ) return undefined;
  const cheapSuitBid = planned.strain !== "notrump" && order(planned.level, planned.strain) <= order(2, opening.strain);
  return cheapSuitBid || chosen === "1notrump" ? openerRebid(hand, opening, response) : undefined;
}
