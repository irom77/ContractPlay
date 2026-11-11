import { LETTERS, isMajor, isMinor, isSuit, levelOf, rank, type Eval, type Handler, type Letter, type Token, type View } from "./auction.js";
import { fourLevelSuit } from "./twos.js";

/**
 * Uncontested bidding after a one-level suit opening: the agreements that fix what a raise, a rebid or an invitation
 * shows, and natural continuations for hands too good to pass.
 */

interface OneSuit {
  readonly opened: Letter;
  /** The partnership's calls after the opening, oldest first. */
  readonly seq: readonly Token[];
  readonly opener: boolean;
}

function oneSuit(v: View): OneSuit | undefined {
  const found = v.match(/^1([CDHS]) P((?: \S+ P)*)$/);
  if (!found) return undefined;
  const seq = found[2]!.trim().split(" ").filter((token) => token && token !== "P");
  if (found[2]!.trim().split(" ").filter(Boolean).length !== seq.length * 2 || seq.some((token) => rank(token) === 0)) return undefined;
  return { opened: found[1] as Letter, seq, opener: seq.length % 2 === 1 };
}

const isGameBid = (token: Token): boolean => levelOf(token) >= (token[1] === "N" ? 3 : isMajor(token[1]) ? 4 : 5);
const game = (suit: Letter): Token => `${isMajor(suit) ? 4 : 5}${suit}`;
const shortSuit = (h: Eval, trump: Letter): Letter | undefined => LETTERS.find((suit) => suit !== trump && h[suit] <= 1);

/** Opening bids the basic rules leave out: 3NT, four-level preempts and light openings in third and fourth seat. */
export const opening: Handler = (h, v) => {
  if (v.tokens.length > 0) return undefined;
  const { hcp } = h;
  if (h.balanced && hcp >= 25 && hcp <= 27) return "3N";
  void hcp;
  if (v.skill >= 1) {
    const long = fourLevelSuit(h);
    if (long) return `4${long}`;
  }
  return undefined;
};

/** Openings on hands the rules pass: sound distributional hands, and lighter ones opposite a passed partner. */
export const lightOpening: Handler = (h, v) => {
  if (v.tokens.length > 0 || v.skill < 2) return undefined;
  const { hcp } = h;
  const [first, second] = h.byLength as [Letter, Letter];
  const suit = h[first] >= 5 ? ((h.S >= 5 && h.H >= 5) ? "S" : first) : undefined;
  if (!suit || hcp < 10 || hcp > 11) return undefined;
  if (v.leadingPasses === 2 && h.goodSuit(suit)) return `1${suit}`;
  if (v.leadingPasses === 3) return hcp + h.S >= 15 ? `1${suit}` : undefined;
  return hcp + h[first] + h[second] >= 20 && hcp === 11 && h.count(suit, "AKQJ") >= 2 ? `1${suit}` : undefined;
};

/** A hand with nothing passes partner's 2NT opening rather than start a convention it cannot follow up. */
export const weakOppositeTwoNotrump: Handler = (h, v) =>
  v.text === "2N P" && h.hcp < 4 && h.S < 5 && h.H < 5 ? "P" : undefined;

/** Agreements that decide the call outright after a one-level suit opening. */
export const constructiveAgreements: Handler = (h, v) => {
  const auction = oneSuit(v);
  if (!auction) return undefined;
  const { opened, seq } = auction;
  const { hcp } = h;
  const [response, rebid, third] = seq;

  if (seq.length === 1) {
    // A limit raise of a major: game with anything better than a minimum.
    if (response === `3${opened}` && isMajor(opened)) return hcp >= 13 ? `4${opened}` : "P";
    // Jacoby 2NT without a short suit: 3M with 18 or more, 3NT with 15–17, 4M with a minimum.
    if (response === "2N" && isMajor(opened) && !v.partnerPassed && !shortSuit(h, opened)) return hcp >= 18 ? `3${opened}` : hcp >= 15 ? "3N" : `4${opened}`;
    const strain = response![1]!;
    if (levelOf(response!) === 1 && isSuit(strain) && h[opened] >= 6 && hcp >= 16 && hcp <= 18 && h[strain] < 4) return `3${opened}`;
    if (response === "1N" && isMajor(opened) && h[opened] === 5) {
      const forcing = v.style === "2/1" && !v.partnerPassed;
      const side = LETTERS.filter((suit) => suit !== opened && h[suit] >= 4).sort((a, b) => h[b] - h[a] || LETTERS.indexOf(a) - LETTERS.indexOf(b))[0];
      if (side && hcp >= 19) return rank(`2${side}`) > rank(`2${opened}`) ? `2${side}` : `3${side}`;
      if (side && (rank(`2${side}`) < rank(`2${opened}`) || hcp >= 16)) return `2${side}`;
      if (hcp >= 20) return "3N";
      if (hcp >= 18) return "2N";
      if (!forcing) return hcp >= 16 && !side ? "2N" : "P";
      return h.C >= h.D && h.C >= 3 ? "2C" : h.D >= 3 ? "2D" : "2C";
    }
  }

  if (seq.length === 2 && response === `2${opened}` && isMajor(opened)) {
    // Opener's game try after a single raise: accept with a maximum or with help in the suit named.
    if (rebid === `3${opened}`) return hcp >= 8 || (hcp === 7 && h[opened] >= 4) ? `4${opened}` : "P";
    if (rebid === "2N") return hcp >= 8 ? (h.balanced && h[opened] === 3 ? "3N" : `4${opened}`) : `3${opened}`;
    const tried = rebid![1];
    if (isSuit(tried) && tried !== opened && levelOf(rebid!) <= 3) {
      const help = h.count(tried, "AKQ") >= 1 || (h[tried] <= 1 && h[opened] >= 4);
      return hcp >= 8 || (hcp >= 7 && help) ? `4${opened}` : `3${opened}`;
    }
  }
  void third;
  return undefined;
};

/** Responder's second call: sign off, invite or bid game according to strength. */
function responderRebid(h: Eval, v: View, opened: Letter, response: Token, rebid: Token): Token | undefined {
  const { hcp } = h;
  const own = response[1]!;
  const strain = rebid[1]!;
  const level = levelOf(rebid);
  const unbid = LETTERS.filter((suit) => suit !== opened && suit !== own && suit !== strain);
  const stopped = unbid.every((suit) => h.stopper(suit));
  const ownSuit = isSuit(own) ? own : undefined;
  const sixCard = ownSuit && h[ownSuit] >= 6 ? ownSuit : undefined;

  if (response === "1N") {
    // Responder is limited to 10 points, or 12 when 1NT was forcing.
    const maximum = hcp >= 10;
    if (strain === "N") return level === 2 && hcp >= 8 ? "3N" : "P";
    if (strain === opened) {
      if (level === 3) return hcp >= (v.style === "2/1" && !v.iPassed ? 10 : 8) ? (isMajor(opened) ? game(opened) : "3N") : "P";
      return maximum && h[opened] >= 2 ? `3${opened}` : "P";
    }
    if (!isSuit(strain)) return undefined;
    const jumped = level === 3 && rank(`2${strain}`) > rank("1N");
    if (jumped) {
      if (isMajor(opened) && h[opened] >= 3) return game(opened);
      if (stopped) return "3N";
      return h[strain] >= 4 ? v.cheapest(strain) : v.legal(`3${opened}`) ? `3${opened}` : "3N";
    }
    if (maximum && isMajor(opened) && h[opened] >= 3) return `3${opened}`;
    if (h[strain] >= 5 ? hcp >= 9 : h[strain] === 4 && isMajor(strain) && hcp >= 8) return `3${strain}`;
    if (maximum && stopped && h[opened] <= 2 && h[strain] <= 3) return "2N";
    const long = LETTERS.find((suit) => suit !== opened && suit !== strain && h[suit] >= 6 && rank(`2${suit}`) > rank(rebid) && rank(`2${suit}`) < rank(`2${opened}`));
    if (long && hcp <= 9) return `2${long}`;
    if (h[opened] >= 3 || (h[opened] === 2 && h[strain] <= 3)) return v.legal(`2${opened}`) ? `2${opened}` : "P";
    return "P";
  }
  if (!ownSuit) return undefined;
  if (levelOf(response) === 2) {
    // A two-level response promised a second call: invite with 10–12, bid game with more.
    if (rank(response) > rank(`2${opened}`) || level >= 3 || hcp < 10) return undefined;
    const majorFit = isMajor(opened) && h[opened] >= (strain === opened ? 2 : 3) ? opened : isMajor(strain) && strain !== opened && h[strain] >= 4 ? strain : undefined;
    if (hcp >= 13) return majorFit ? game(majorFit) : sixCard && isMajor(sixCard) ? game(sixCard) : "3N";
    if (majorFit) return v.cheapest(majorFit, levelOf(v.cheapest(majorFit)) === 2 ? 1 : 0);
    if (stopped && v.legal("2N")) return "2N";
    if (sixCard) return v.cheapest(sixCard);
    if (isSuit(strain) && h[strain] >= 4 && strain !== opened) return v.cheapest(strain);
    return v.legal("2N") ? "2N" : undefined;
  }
  if (levelOf(response) !== 1) return undefined;
  if (isSuit(strain) && strain !== opened && strain !== ownSuit && level === 3 && rank(`2${strain}`) > rank(response) && hcp < 13) {
    // Opener's jump shift is forcing to game.
    if (isMajor(opened) && h[opened] >= 3) return v.cheapest(opened);
    if (sixCard) return v.cheapest(sixCard);
    if (unbid.every((suit) => h.stopper(suit))) return "3N";
    if (h[strain] >= 4) return v.cheapest(strain);
    return v.legal(`3${opened}`) ? `3${opened}` : "3N";
  }

  if (strain === "N") {
    if (level === 1) {
      const longMajor = (["S", "H"] as const).find((suit) => h[suit] >= 6);
      if (hcp >= 13 && longMajor) return game(longMajor);
      if (hcp >= 19 && h.balanced) return "4N";
      if (hcp >= 13) return sixCard && isMajor(sixCard) ? game(sixCard) : isMajor(ownSuit) && h[ownSuit] === 5 ? `3${ownSuit}` : "3N";
      if (hcp >= 11) return sixCard ? `3${sixCard}` : "2N";
      return sixCard ? `2${sixCard}` : "P";
    }
    if (level === 2) {
      if (hcp < 8) return "P";
      return sixCard && isMajor(sixCard) ? game(sixCard) : isMajor(ownSuit) && h[ownSuit] === 5 ? `3${ownSuit}` : "3N";
    }
    return "P";
  }
  if (strain === opened) {
    // Opener rebid the suit: a minimum with six cards, or 16–18 when it was a jump.
    const fit = h[opened] >= 2;
    if (level === 3) return hcp >= 8 ? (isMajor(opened) && fit ? game(opened) : sixCard && isMajor(sixCard) ? game(sixCard) : "3N") : "P";
    if (hcp >= 13) return isMajor(opened) && fit ? game(opened) : sixCard && isMajor(sixCard) ? game(sixCard) : "3N";
    if (hcp >= 11) return isMajor(opened) && fit ? `3${opened}` : sixCard ? `3${sixCard}` : stopped ? "2N" : fit ? `3${opened}` : "2N";
    return "P";
  }
  if (strain === ownSuit) {
    // Opener raised: 12–15 for a single raise, 16–18 for a jump.
    if (level >= 4) return "P";
    if (level === 3) return hcp >= 8 ? (isMajor(ownSuit) ? game(ownSuit) : "3N") : "P";
    if (hcp >= 13) return isMajor(ownSuit) ? game(ownSuit) : "3N";
    if (hcp >= 11 || (hcp === 10 && h[ownSuit] >= 5)) return isMajor(ownSuit) ? `3${ownSuit}` : stopped ? "2N" : `3${ownSuit}`;
    return "P";
  }
  if (!isSuit(strain)) return undefined;
  // Opener showed a second suit below a reverse.
  const fourth = unbid[0];
  if (hcp >= 13) {
    if (isMajor(strain) && h[strain] >= 4) return game(strain);
    if (isMajor(opened) && h[opened] >= 3) return game(opened);
    if (sixCard && isMajor(sixCard)) return game(sixCard);
    if (h.stopper(fourth)) return "3N";
    return fourth ? v.cheapest(fourth) : "3N";
  }
  if (hcp >= 11) {
    if (h[strain] >= 4) return v.cheapest(strain);
    if (isMajor(opened) && h[opened] >= 3) return v.cheapest(opened, levelOf(v.cheapest(opened)) === 2 ? 1 : 0);
    if (sixCard) return v.cheapest(sixCard, levelOf(v.cheapest(sixCard)) === 2 ? 1 : 0);
    if (h.stopper(fourth)) return v.cheapest("N", levelOf(v.cheapest("N")) === 1 ? 1 : 0);
    return h[opened] >= 3 ? v.cheapest(opened, levelOf(v.cheapest(opened)) === 2 ? 1 : 0) : v.cheapest("N");
  }
  if (level !== 2 || rank(rebid) > rank(`2${opened}`)) return undefined;
  if (sixCard && v.legal(`2${sixCard}`)) return `2${sixCard}`;
  if (h[strain] > h[opened] && h[strain] >= 4) return "P";
  return v.legal(`2${opened}`) && h[opened] >= 2 ? `2${opened}` : "P";
}

/** Opener's third call facing an invitation or a forcing rebid. */
function openerThird(h: Eval, v: View, opened: Letter, seq: readonly Token[]): Token | undefined {
  const [response, rebid, second] = seq as [Token, Token, Token];
  const { hcp } = h;
  const extra = hcp >= 14;
  const strain = second[1]!;
  const level = levelOf(second);
  if (level >= 4 || second === "3N") return undefined;
  const responded = response[1]!;
  const bidSuits = [opened, responded, rebid[1]];
  if (isSuit(strain) && !bidSuits.includes(strain) && isSuit(responded) && !v.partnerPassed) {
    // Responder's new suit — natural, or the artificial fourth suit — is forcing: describe the hand once more.
    const fourthSuit = new Set(bidSuits).size === 3 && bidSuits.every(isSuit);
    const unbid = LETTERS.filter((suit) => !bidSuits.includes(suit) && (fourthSuit || suit !== strain));
    const stoppedFor = fourthSuit ? h.stopper(strain) : unbid.every((suit) => h.stopper(suit));
    if (isMajor(responded) && h[responded] >= 3) return v.cheapest(responded, hcp >= 15 && levelOf(v.cheapest(responded)) < 4 ? 1 : 0);
    if (!fourthSuit && h[strain] >= 4) return v.cheapest(strain);
    if (stoppedFor) return hcp >= 15 || !v.legal("2N") ? "3N" : "2N";
    if (h[opened] >= 6) return v.cheapest(opened);
    const second5 = isSuit(rebid[1]) && rebid[1] !== opened && h[rebid[1]] >= 5 ? rebid[1] : undefined;
    if (second5) return v.cheapest(second5);
    return h[responded] >= 2 ? v.cheapest(responded) : v.cheapest(opened);
  }
  if (response === `2${opened}` || response === `3${opened}`) return undefined;
  if (strain === "N") {
    if (level !== 2) return undefined;
    if (!extra) return "P";
    return isMajor(responded) && h.len(responded) >= 3 && rebid[1] !== "N" ? "3N" : "3N";
  }
  if (isSuit(strain) && level === 2 && response === "1N" && hcp >= 17 && v.legal("2N")) return "2N";
  if (!isSuit(strain) || level !== 3) return undefined;
  // A jump to three of responder's own major after a 1NT rebid is forcing; other three-level calls invite.
  const forcing = rebid === "1N" && strain === responded && isMajor(strain);
  const fit = strain === opened || strain === rebid[1] || h[strain] >= (strain === responded ? 2 : 4);
  if (forcing) return h[strain] >= 3 ? game(strain) : "3N";
  if (!extra) return "P";
  if (isMajor(strain) && fit) return game(strain);
  return LETTERS.filter((suit) => suit !== strain).every((suit) => h.stopper(suit)) && hcp >= 16 ? "3N" : "P";
}

/** Natural continuations for positions the rules pass with a hand worth another call. */
export const constructiveContinuations: Handler = (h, v) => {
  const auction = oneSuit(v);
  if (!auction) return undefined;
  const { opened, seq } = auction;
  const { hcp } = h;
  const [response, rebid, second] = seq;

  if (seq.length === 1 && isMinor(opened) && response === `3${opened}`) {
    const stopped = LETTERS.filter((suit) => suit !== opened).every((suit) => h.stopper(suit));
    return hcp >= 14 && (stopped || (h.balanced && hcp >= 15)) ? "3N" : hcp >= 18 ? game(opened) : "P";
  }
  if (seq.length === 1 && isMinor(opened) && response === `2${opened}` && hcp >= 16) {
    // A single raise of a minor: invite with 16–17, bid game with more.
    return hcp >= 18 ? "3N" : "2N";
  }
  if (seq.length === 2 && isMinor(opened) && response === `2${opened}` && rebid === "2N") return hcp >= 8 ? "3N" : `3${opened}`;
  const mine = seq.filter((_, index) => index % 2 === seq.length % 2);
  const partners = seq.filter((_, index) => index % 2 !== seq.length % 2);
  const last = seq.at(-1);
  if (seq.length >= 4 && seq.length % 2 === 0 && last && !isGameBid(last)) {
    // Responder used the fourth suit to force and has heard opener's answer: with opening values, bid the game.
    const suitsBefore = [opened, seq[0]![1], seq[1]![1]];
    const fourth = seq[2]![1];
    const wasFourthSuit = isSuit(fourth) && new Set(suitsBefore).size === 3 && !suitsBefore.includes(fourth) && suitsBefore.every(isSuit);
    if (seq.length === 4 && wasFourthSuit && hcp >= 12) {
      const ownSuit = seq[0]![1] as Letter;
      if (last[1] === ownSuit && isMajor(ownSuit)) return game(ownSuit);
      if (isMajor(opened) && h[opened] >= 3) return game(opened);
      if (isMajor(ownSuit) && h[ownSuit] >= 6) return game(ownSuit);
      return v.legal("3N") ? "3N" : undefined;
    }
  }
  if (seq.length >= 3 && seq.length % 2 === 1 && last && !isGameBid(last) && mine.length >= 1 && partners.length >= 2) {
    // Opener reversed and responder has answered: the reverse promised another call.
    const reverse = mine[0]!;
    const firstResponse = partners[0]!;
    const reversed = seq.length === 3 && isSuit(reverse[1]) && levelOf(reverse) === 2 && levelOf(firstResponse) === 1 && rank(reverse) > rank(`2${opened}`) && reverse[1] !== firstResponse[1];
    if (reversed) {
      const fourth = LETTERS.find((suit) => suit !== opened && suit !== reverse[1] && suit !== firstResponse[1]);
      const strain = last[1]!;
      if (hcp >= 19 || levelOf(last) === 3) {
        const theirMajor = firstResponse[1];
        if (isMajor(theirMajor) && h[theirMajor] >= 3 && strain !== theirMajor) return h[theirMajor] >= 4 ? game(theirMajor) : v.cheapest(theirMajor);
        if (isMajor(strain) && h.len(strain) >= (strain === firstResponse[1] ? 3 : 4)) return game(strain as Letter);
        if (h.stopper(fourth) || strain === "N") return "3N";
        return isSuit(strain) && h[strain] >= 3 ? v.cheapest(strain) : v.cheapest(opened);
      }
      if (strain === "N") return h[opened] >= 6 ? v.cheapest(opened) : "P";
      return h.stopper(fourth) ? v.cheapest("N") : v.cheapest(opened);
    }
  }
  if (seq.length === 4 && response === "1N" && last === "2N" && levelOf(seq[1]!) === 2 && levelOf(seq[2]!) === 2) return hcp >= 9 ? "3N" : "P";
  if (seq.length === 2 && response && rebid) {
    if (response === "2N" && isMajor(opened) && !v.iPassed) {
      // After Jacoby 2NT and opener's description: ask for aces with slam values, otherwise settle in game.
      const promised = rebid === `3${opened}` ? 18 : rebid === "3N" ? 15 : 12;
      const shortness = rebid[0] === "3" && isSuit(rebid[1]) && rebid[1] !== opened ? rebid[1] : undefined;
      const working = shortness && h.count(shortness, "KQJ") === 0 ? 3 : 0;
      if (hcp + promised + working >= 32 && v.legal("4N")) return "4N";
      return v.legal(`4${opened}`) ? `4${opened}` : "P";
    }
    return responderRebid(h, v, opened, response, rebid);
  }
  if (seq.length === 3 && response && rebid && second) return openerThird(h, v, opened, seq);
  return undefined;
};

/**
 * A 2/1 response to a major by an unpassed hand is forcing to game: with nothing clearer to say, bid on naturally
 * rather than pass below game.
 */
export const gameForce: Handler = (h, v) => {
  const auction = oneSuit(v);
  if (!auction || v.style !== "2/1" || !isMajor(auction.opened) || !v.last || !v.lastIsOurs) return undefined;
  const { opened, seq } = auction;
  const response = seq[0];
  if (!response || levelOf(response) !== 2 || !isSuit(response[1]) || rank(response) >= rank(`2${opened}`)) return undefined;
  if (auction.opener ? v.partnerPassed : v.iPassed) return undefined;
  if (levelOf(v.last) >= (v.last[1] === "N" ? 3 : isMajor(v.last[1]) ? 4 : 5)) return undefined;
  const responded = response[1] as Letter;
  const partnerSuits = seq.filter((_, index) => index % 2 === (auction.opener ? 0 : 1)).map((token) => token[1]);
  const partnerOpenedLength = auction.opener ? 0 : 5 + (partnerSuits.filter((suit) => suit === opened).length > 0 ? 1 : 0);
  if (!auction.opener && h[opened] + partnerOpenedLength >= 8) return game(opened);
  if (auction.opener && partnerSuits.includes(opened)) return game(opened);
  const partnerMajor = (["H", "S"] as const).find((suit) => suit !== opened && partnerSuits.filter((shown) => shown === suit).length >= 1 && h[suit] >= (partnerSuits.filter((shown) => shown === suit).length >= 2 ? 2 : 4));
  if (partnerMajor) return game(partnerMajor);
  const mine = auction.opener ? opened : responded;
  const bidSuits = [opened, ...seq.map((token) => token[1])];
  const unbid = LETTERS.filter((suit) => !bidSuits.includes(suit));
  if (unbid.every((suit) => h.stopper(suit)) || h.balanced) return v.legal("2N") && h.hcp <= 14 ? "2N" : "3N";
  if (h[mine] >= 6 && levelOf(v.cheapest(mine)) <= 3) return v.cheapest(mine);
  const partnerLast = seq.at(-1)![1];
  if (isSuit(partnerLast) && h[partnerLast] >= 3 && levelOf(v.cheapest(partnerLast)) <= 4) return v.cheapest(partnerLast);
  return v.legal("3N") ? "3N" : v.cheapest(mine);
};

/** Opener's answer to responder's fourth-suit force with extra values: game in notrump when the fourth suit is stopped. */
export const afterFourthSuit: Handler = (h, v) => {
  const auction = oneSuit(v);
  if (!auction || auction.seq.length !== 3) return undefined;
  const [response, rebid, fourth] = auction.seq as [Token, Token, Token];
  const suits = [auction.opened, response[1], rebid[1]];
  if (!suits.every(isSuit) || new Set(suits).size !== 3 || !isSuit(fourth[1]) || suits.includes(fourth[1]) || levelOf(fourth) > 3) return undefined;
  return h.hcp >= 15 && h.stopper(fourth[1]) && v.legal("3N") ? "3N" : undefined;
};

/** Responder's game-forcing hand with five cards in each major after Stayman finds no fit: name spades at the three level. */
export const fiveFiveAfterStayman: Handler = (h, v) =>
  v.text === "1N P 2C P 2D P" && h.S >= 5 && h.H >= 5 && h.hcp >= 10 ? "3S" : undefined;
