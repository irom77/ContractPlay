import { LETTERS, isGame, isMajor, isSuit, levelOf, rank, type Eval, type Handler, type Letter, type Token, type View } from "./auction.js";

/**
 * Competitive bidding: takeout doubles and the advances and rebids that follow them, defence to preempts and to a 1NT
 * opening, advances of overcalls, balancing, and the opening side's calls once an opponent has come in.
 */

const nonPass = (tokens: readonly Token[]): Token[] => tokens.filter((token) => token !== "" && token !== "P");
const unbidSuits = (v: View, alsoBid: readonly string[] = []): Letter[] => LETTERS.filter((suit) => !v.theirSuits.includes(suit) && !alsoBid.includes(suit));

/** The last contract bid before a position in the auction. */
function contractBefore(v: View, index: number): Token | undefined {
  for (let at = index - 1; at >= 0; at -= 1) if (rank(v.tokens[at]) > 0) return v.tokens[at];
  return undefined;
}

/** Short in the opponents' suits with support for the others, the shape of a takeout double. */
function takeoutShape(h: Eval, theirs: readonly Letter[]): boolean {
  const unbid = LETTERS.filter((suit) => !theirs.includes(suit));
  const unbidMajors = unbid.filter(isMajor);
  if (!theirs.every((suit) => h[suit] <= 2)) return false;
  if (!unbid.every((suit) => h[suit] >= 3 || (!isMajor(suit) && h[suit] === 2 && h.hcp >= 15))) return false;
  return unbidMajors.length === 0 || unbidMajors.some((suit) => h[suit] >= 4) || h.hcp >= 15;
}

/** The suit an advancer names: a four-card major first, then the longest unbid suit. */
function advanceSuit(h: Eval, unbid: readonly Letter[]): Letter | undefined {
  const major = unbid.filter((suit) => isMajor(suit) && h[suit] >= 4).sort((a, b) => h[b] - h[a] || (a === "S" ? -1 : 1))[0];
  if (major) return major;
  return [...unbid].sort((a, b) => h[b] - h[a] || LETTERS.indexOf(a) - LETTERS.indexOf(b))[0];
}

interface Takeout {
  readonly their: Letter;
  readonly level: number;
  readonly rho: Token;
  readonly balancing: boolean;
}

function partnerTakeout(v: View): Takeout | undefined {
  const at = v.tokens.length - 2;
  if (v.opened || at < 1 || v.tokens[at] !== "X") return undefined;
  if (nonPass(v.partners).length !== 1 || nonPass(v.mine).length !== 0) return undefined;
  const doubled = contractBefore(v, at);
  const suit = doubled?.[1];
  if (!doubled || !isSuit(suit) || rank(doubled) > rank("4H")) return undefined;
  return { their: suit, level: levelOf(doubled), rho: v.tokens[at + 1]!, balancing: v.tokens[at - 1] === "P" && v.tokens[at - 2] === "P" };
}

/** Advancing partner's takeout double: by strength, with a jump on 9–11 points and a cue-bid on 12 or more. */
export const advanceDouble: Handler = (h, v) => {
  const takeout = partnerTakeout(v);
  if (!takeout) return undefined;
  const { their, rho } = takeout;
  const unbid = unbidSuits(v);
  const pick = advanceSuit(h, unbid);
  if (!pick) return undefined;
  const points = h.hcp - (takeout.balancing ? 3 : 0);
  const major = isMajor(pick) && h[pick] >= 4 ? pick : undefined;
  const stopped = v.theirSuits.every((suit) => h.stopper(suit));
  const cheap = v.cheapest(pick);
  const level = levelOf(cheap);
  const game = (suit: Letter): Token => `${isMajor(suit) ? 4 : 5}${suit}`;
  const honors = h.count(their, "AKQJT");

  if (rho !== "P" && rho !== "R") {
    // RHO has bid, so the double is no longer in force: bid with something to say.
    if (points >= 12 && major && h[major] >= 5 && v.legal(game(major))) return game(major);
    if (points >= 12 && levelOf(v.cheapest(their)) <= 3) return v.cheapest(their);
    if (points >= 9 && major && level <= 2) return v.cheapest(major, 1);
    if (points >= 5 && (major || h[pick] >= 5) && level <= 3) return cheap;
    if (points >= 9 && stopped && !major && v.legal("2N") && level <= 3) return v.cheapest("N");
    return "P";
  }
  if (rho === "P") {
    if (takeout.level === 1 && h[their] >= 5 && honors >= 4) return "P";
    if (takeout.level >= 2 && h[their] >= 5 && honors >= 3) return "P";
  }
  if (takeout.level === 1) {
    if (points >= 12) {
      if (major && h[major] >= 5) return game(major);
      if (!major && stopped && points >= 13) return "3N";
      return v.cheapest(their);
    }
    if (points >= 9) {
      if (major) return v.cheapest(major, 1);
      if (stopped) return points >= 11 ? "2N" : v.cheapest("N");
      return h[pick] >= 5 ? v.cheapest(pick, 1) : cheap;
    }
    if (points >= 6 && !major && stopped && h[pick] < 5) return v.cheapest("N");
    return cheap;
  }
  if (takeout.level === 2) {
    if (points >= 11) {
      if (major) return game(major);
      if (stopped) return "3N";
      return h[pick] >= 5 && points >= 13 ? game(pick) : v.cheapest(their);
    }
    if (points >= 8) {
      if (major) return level === 2 ? v.cheapest(major, 1) : points >= 10 ? game(major) : cheap;
      if (stopped && v.legal("2N")) return "2N";
    }
    return cheap;
  }
  if (points >= 9) {
    if (major && v.legal(game(major))) return game(major);
    if (stopped && v.legal("3N")) return "3N";
    if (points >= 12 && h[pick] >= 5 && v.legal(game(pick))) return game(pick);
  }
  return cheap;
};

/** The doubler's rebid after partner's advance. */
export const doublerRebid: Handler = (h, v) => {
  const length = v.tokens.length;
  if (v.opened || nonPass(v.mine).length !== 1 || !v.mine.includes("X") || v.tokens[length - 1] !== "P") return undefined;
  const advances = nonPass(v.partners);
  const advance = advances[0];
  const at = v.tokens.lastIndexOf("X", length - 4);
  if (advances.length !== 1 || !advance || rank(advance) === 0 || v.tokens[length - 2] !== advance || at < 0 || at % 2 !== length % 2) return undefined;
  const doubled = contractBefore(v, at);
  if (!doubled || !isSuit(doubled[1])) return undefined;
  const floor = contractBefore(v, length - 2)!;
  const strain = advance[1]!;
  const { hcp } = h;
  const stopped = v.theirSuits.every((suit) => h.stopper(suit));
  const own = LETTERS.find((suit) => !v.theirSuits.includes(suit) && suit !== strain && h[suit] >= 5 && h.goodSuit(suit));

  if (isGame(advance)) return "P";
  if (v.theirSuits.includes(strain as Letter)) {
    // A cue-bid: forcing. Name a major, then notrump with a stopper, then the longest suit.
    const major = (["H", "S"] as const).filter((suit) => !v.theirSuits.includes(suit) && h[suit] >= 4).sort((a, b) => h[b] - h[a])[0];
    if (major) return v.cheapest(major, hcp >= 15 && levelOf(v.cheapest(major)) < 3 ? 1 : 0);
    if (stopped) return hcp >= 15 ? "3N" : v.cheapest("N");
    return v.cheapest(advanceSuit(h, unbidSuits(v))!);
  }
  if (strain === "N") {
    if (levelOf(advance) === 1) return hcp >= 19 ? "3N" : hcp >= 17 ? "2N" : own && hcp >= 16 ? v.cheapest(own) : "P";
    if (levelOf(advance) === 2) return hcp >= 14 ? "3N" : "P";
    return "P";
  }
  const suit = strain as Letter;
  let minimum = 1;
  while (rank(`${minimum}${suit}`) <= rank(floor)) minimum += 1;
  const jumped = levelOf(advance) > minimum;
  const fit = h[suit];
  const gameBid: Token = `${isMajor(suit) ? 4 : 5}${suit}`;
  // With a fit the doubler counts shortness as well as high cards.
  const worth = fit >= 4 ? Math.max(hcp, h.support(suit)) : hcp;
  if (jumped) {
    if (fit >= 3 && worth >= 15) return isMajor(suit) ? gameBid : stopped ? "3N" : gameBid;
    if (own && hcp >= 17) return v.cheapest(own);
    return "P";
  }
  if (own && hcp >= 17 && fit < 4) return hcp >= 22 && isMajor(own) ? `4${own}` : v.cheapest(own, hcp >= 21 && levelOf(v.cheapest(own)) <= 2 ? 1 : 0);
  if (fit >= 4 || (fit === 3 && hcp >= 17)) {
    if (worth >= 22) return gameBid;
    if (worth >= 19) return isMajor(suit) && levelOf(advance) >= 2 ? gameBid : v.cheapest(suit, 1);
    if (worth >= 16 && levelOf(advance) <= 2) return v.cheapest(suit);
  }
  if (hcp >= 18 && stopped && h.balanced) return v.cheapest("N", hcp >= 21 ? 1 : 0);
  return "P";
};

/** The advancer's next call after cue-bidding in reply to a takeout double and hearing the doubler's suit. */
export const afterAdvanceCue: Handler = (h, v) => {
  const length = v.tokens.length;
  if (v.opened || v.tokens[length - 1] !== "P") return undefined;
  const mine = nonPass(v.mine);
  const partners = nonPass(v.partners);
  if (mine.length !== 1 || partners.length !== 2 || partners[0] !== "X" || !v.theirSuits.includes(mine[0]![1] as Letter)) return undefined;
  const reply = partners[1]!;
  if (isGame(reply)) return "P";
  const strain = reply[1]!;
  if (strain === "N") return "3N";
  const suit = strain as Letter;
  if (h[suit] >= 4 || (h[suit] === 3 && !h.balanced)) return isMajor(suit) ? `4${suit}` : v.theirSuits.every((their) => h.stopper(their)) ? "3N" : `5${suit}`;
  if (v.theirSuits.every((their) => h.stopper(their))) return "3N";
  const own = LETTERS.filter((candidate) => candidate !== suit && !v.theirSuits.includes(candidate) && h[candidate] >= 5)[0];
  return own ? v.cheapest(own) : v.cheapest(suit);
};

/** Acting over an opponent's weak two or higher preempt: a takeout double, a natural overcall, or notrump. */
export const overPreempt: Handler = (h, v) => {
  const found = v.match(/^([234])([CDHS])(?: P (P|[2345]\2))?$/);
  if (!found || v.skill < 1 || v.text.startsWith("2C")) return undefined;
  const their = found[2] as Letter;
  const balancing = found[3] === "P";
  const level = levelOf(v.last!);
  const points = h.hcp + (balancing ? 3 : 0);
  if (level >= 5) return undefined;

  const shape = takeoutShape(h, [their]);
  const unbidMajor = (["H", "S"] as const).some((major) => major !== their && h[major] >= 4);
  if (h.stopper(their) && (h.balanced || h[their] >= 3) && !(shape && unbidMajor)) {
    if (level === 2 && points >= 15 && points <= 18 && h.balanced) return "2N";
    if (level <= 3 && points >= (level === 2 ? 19 : 16) && points <= 22) return "3N";
  }
  const suit = LETTERS.filter((candidate) => candidate !== their && h[candidate] >= 5 && h.goodSuit(candidate))
    .sort((a, b) => h[b] - h[a] || (isMajor(a) ? -1 : 1))[0];
  if (suit && points < 18) {
    const bid = v.cheapest(suit);
    const needed = levelOf(bid) === 2 ? 11 : levelOf(bid) === 3 ? 13 : 15;
    const otherMajorFour = isMajor(suit) ? false : (["H", "S"] as const).some((major) => major !== their && h[major] >= 4);
    if (points >= needed && (levelOf(bid) < 4 || h[suit] >= 6) && !(shape && otherMajorFour)) return bid;
  }
  if (shape && points >= 11 + level) return "X";
  if (points >= 19) return "X";
  return "P";
};

/** Acting over an opponent's 1NT opening: a penalty double with a strong hand, or a natural overcall in a long suit. */
export const overTheirNotrump: Handler = (h, v) => {
  if (!v.match(/^1N(?: P P)?$/) || v.skill < 1) return undefined;
  const { hcp } = h;
  const best = h.byLength[0]!;
  if (hcp >= 16 || (hcp === 15 && h[best] >= 5 && h.goodSuit(best))) return "X";
  if (h[best] >= 7 && hcp <= 10 && h.count(best, "AKQJT") >= 2) return `3${best}`;
  if ((h[best] >= 6 && hcp >= 8 && h.count(best, "AKQJT") >= 2) || (h[best] === 5 && h.goodSuit(best) && hcp >= 11 && !h.balanced)) return `2${best}`;
  return "P";
};

/** Advancing partner's natural overcall of, or penalty double of, an opponent's 1NT, and the overcaller's reply to a raise. */
export const advanceOverNotrump: Handler = (h, v) => {
  const found = v.match(/^1N (?:P P )?(X|2[CDHS]) (P|R|\S+)((?: \S+ P)*)$/);
  if (!found) return undefined;
  const action = found[1]!;
  const later = nonPass(found[3]!.trim().split(" "));
  if (later.length === 0) {
    if (found[2] !== "P") return found[2] === "R" && action === "X" && h.hcp < 5 && h[h.byLength[0]!] >= 5 ? `2${h.byLength[0]}` : "P";
    if (action === "X") return h.hcp < 5 && h[h.byLength[0]!] >= 5 ? `2${h.byLength[0]}` : "P";
    const suit = action[1] as Letter;
    if (h[suit] >= 3 && h.hcp >= 14) return isMajor(suit) ? `4${suit}` : "P";
    if (h[suit] >= 3 && h.hcp >= 11) return `3${suit}`;
    return "P";
  }
  if (later.length === 1 && rank(action) > 0 && later[0] === `3${action[1]}`) return h.hcp >= 13 && isMajor(action[1]) ? `4${action[1]}` : "P";
  return "P";
};

/** Advancing partner's simple suit overcall of a one-level opening. */
export const advanceOvercall: Handler = (h, v) => {
  const found = v.match(/^1([CDHS]) ([12])([CDHS]) (\S+)$/);
  if (!found || found[1] === found[3]) return undefined;
  const their = found[1] as Letter;
  const overcall = `${found[2]}${found[3]}`;
  const suit = found[3] as Letter;
  if (rank(overcall) > rank(`2${their}`) + 5 || (found[2] === "2" && rank(overcall) > rank(`2${their}`))) return undefined;
  const rho = found[4]!;
  const { hcp } = h;
  const fit = h[suit];
  const theirSuits = [their, ...(isSuit(rho[1]) && rank(rho) > 0 && rho[1] !== their ? [rho[1] as Letter] : [])];
  const stopped = theirSuits.every((candidate) => h.stopper(candidate));
  const raise = v.cheapest(suit);

  if (fit >= 3) {
    const points = h.support(suit);
    if (points >= 11 && hcp >= 9 && v.legal(v.cheapest(their)) && levelOf(v.cheapest(their)) <= 3) return v.cheapest(their);
    if (fit >= 4 && hcp <= 8 && levelOf(raise) <= 3) return levelOf(raise) === 2 ? `3${suit}` : raise;
    if (points >= 6 && levelOf(raise) <= (fit >= 4 ? 3 : 2)) return raise;
    return "P";
  }
  if (rho !== "P") return "P";
  const own = LETTERS.filter((candidate) => candidate !== suit && candidate !== their && h[candidate] >= 5 && h.goodSuit(candidate))
    .sort((a, b) => h[b] - h[a])[0];
  if (own && hcp >= 9) {
    const bid = v.cheapest(own);
    if (levelOf(bid) <= 2 || (hcp >= 11 && h[own] >= 6 && levelOf(bid) === 3)) return bid;
  }
  if (stopped) {
    if (hcp >= 15) return "3N";
    if (hcp >= 12) return v.cheapest("N", levelOf(v.cheapest("N")) === 1 ? 1 : 0);
    if (hcp >= 8 && levelOf(v.cheapest("N")) === 1) return "1N";
  }
  return "P";
};

/** The overcaller's rebid after partner's advance. */
export const overcallerRebid: Handler = (h, v) => {
  const found = v.match(/^1([CDHS]) ([12])([CDHS]) P (\S+) P$/);
  if (!found || found[1] === found[3]) return undefined;
  const their = found[1] as Letter;
  const suit = found[3] as Letter;
  const advance = found[4]!;
  const { hcp } = h;
  if (rank(advance) === 0 || isGame(advance)) return undefined;
  const strain = advance[1]!;
  const gameBid: Token = `${isMajor(suit) ? 4 : 5}${suit}`;
  const minimum = levelOf(advance) === Number(found[2]) + 1 || (levelOf(advance) === Number(found[2]) && rank(advance) > rank(`${found[2]}${suit}`));
  if (strain === their) {
    if (hcp >= 13) return isMajor(suit) ? gameBid : h.stopper(their) ? "3N" : v.cheapest(suit, hcp >= 16 ? 1 : 0);
    return v.cheapest(suit);
  }
  if (strain === suit) {
    if (!minimum) return hcp >= 17 && isMajor(suit) ? gameBid : "P";
    if (hcp >= 16) return isMajor(suit) ? gameBid : h.stopper(their) ? "3N" : hcp >= 19 ? gameBid : v.cheapest(suit);
    if (hcp >= 14 && levelOf(advance) === 2) return `3${suit}`;
    return "P";
  }
  if (strain === "N") {
    if (levelOf(advance) === 1) return hcp >= 16 ? "2N" : h[suit] >= 6 ? v.cheapest(suit) : "P";
    if (levelOf(advance) === 2) return hcp >= 13 ? "3N" : h[suit] >= 6 ? v.cheapest(suit) : "P";
    return "P";
  }
  const shown = strain as Letter;
  if (h[shown] >= 3) return hcp >= 14 ? v.cheapest(shown, isMajor(shown) && levelOf(v.cheapest(shown)) < 4 ? 1 : 0) : hcp >= 12 ? v.cheapest(shown) : "P";
  if (h[suit] >= 6 && h[shown] <= 1) return v.cheapest(suit);
  return "P";
};

/** Partner showed two suits with a cue-bid or a jump to 2NT: choose between them. */
export const advanceTwoSuiter: Handler = (h, v) => {
  const found = v.match(/^1([CDHS]) (2[CDHSN]) P$/);
  if (!found) return undefined;
  const their = found[1] as Letter;
  const call = found[2]!;
  const longer = (a: Letter, b: Letter): Letter => h[a] > h[b] ? a : h[b] > h[a] ? b : LETTERS.indexOf(a) < LETTERS.indexOf(b) ? a : b;
  if (call === "2N") {
    const [low, next] = LETTERS.filter((suit) => suit !== their) as [Letter, Letter, Letter];
    return `3${longer(low, next)}`;
  }
  if (call[1] !== their) return undefined;
  if (isMajor(their)) {
    const major: Letter = their === "H" ? "S" : "H";
    if (h[major] >= 3) return h[major] >= 4 && h.hcp >= 10 ? `4${major}` : v.cheapest(major);
    return "3C";
  }
  const major = h.S >= h.H ? "S" : "H";
  return h[major] >= 4 && h.hcp >= 10 ? `4${major}` : v.cheapest(major);
};

/** Reopening in the pass-out seat after an opponent's one-level opening, or after they raise it to two and stop. */
export const balance: Handler = (h, v) => {
  const found = v.match(/^1([CDHS]) P (?:P|2\1 P P)$/);
  if (!found || v.skill < 2) return undefined;
  const their = found[1] as Letter;
  const raised = v.text.includes(` 2${their}`);
  const { hcp } = h;
  if (nonPass(v.mine).length > 0) return undefined;
  const suit = LETTERS.filter((candidate) => candidate !== their && h[candidate] >= 5).sort((a, b) => h[b] - h[a] || (isMajor(a) ? -1 : 1))[0];
  if (!raised && h.balanced && h.stopper(their) && hcp >= 11 && hcp <= 14 && !(suit && isMajor(suit))) return "1N";
  if (suit && hcp >= 8 && hcp <= 15) {
    const bid = v.cheapest(suit);
    if (levelOf(bid) === 1 || (levelOf(bid) === 2 && (hcp >= 10 || h[suit] >= 6))) return bid;
  }
  if (takeoutShape(h, [their]) ? hcp >= 9 : hcp >= 15) return "X";
  return undefined;
};

/** Responder's call after partner's one-level suit opening and an opponent's takeout double or overcall. */
export const responderInCompetition: Handler = (h, v) => {
  const found = v.match(/^1([CDHS]) (X|[123][CDHSN])$/);
  if (!found) return undefined;
  const opened = found[1] as Letter;
  const action = found[2]!;
  const { hcp } = h;
  const fit = h[opened];
  const needed = isMajor(opened) ? 3 : opened === "D" ? 4 : 5;
  const short = LETTERS.some((suit) => h[suit] <= 1);

  if (action === "X") {
    if (fit >= needed + 1 && hcp >= 10) return "2N";
    if (fit >= needed + 1 && hcp <= 8 && short) return isMajor(opened) && fit >= 5 ? `4${opened}` : `3${opened}`;
    if (hcp >= 10) return "R";
    if (fit >= needed && hcp >= 5) return `2${opened}`;
    const oneLevel = LETTERS.filter((suit) => rank(`1${suit}`) > rank(`1${opened}`) && h[suit] >= 4).sort((a, b) => h[b] - h[a])[0];
    if (oneLevel && hcp >= 6) return `1${oneLevel}`;
    const long = LETTERS.filter((suit) => suit !== opened && h[suit] >= 6 && rank(`2${suit}`) < rank(`2${opened}`))[0];
    if (long && hcp >= 5) return `2${long}`;
    return hcp >= 6 ? "1N" : "P";
  }
  const their = action[1]!;
  if (their === "N" || their === opened) return undefined;
  const level = levelOf(action);
  const stopped = h.stopper(their);
  const cue = v.cheapest(their as Letter);
  const raise = v.cheapest(opened);
  if (fit >= needed) {
    const points = h.support(opened);
    if (points >= 11 && hcp >= 9 && levelOf(cue) <= 3) return cue;
    if (fit >= needed + 1 && hcp <= 7 && short && levelOf(raise) === 2) return `3${opened}`;
    if (points >= (levelOf(raise) >= 3 ? 8 : 6) && hcp >= 5 && levelOf(raise) <= 3) return raise;
  }
  const suits = LETTERS.filter((suit) => suit !== opened && suit !== their && h[suit] >= 4).sort((a, b) => h[b] - h[a] || (isMajor(a) ? -1 : 1));
  for (const suit of suits) {
    const bid = v.cheapest(suit);
    const bidLevel = levelOf(bid);
    if (bidLevel === 1 && hcp >= 6 && (h[suit] >= 5 || !isMajor(suit) || !suits.some((other) => other !== suit && isMajor(other) && h[other] === 4))) return bid;
    if (bidLevel === 2 && hcp >= 10 && h[suit] >= 5) return bid;
    if (bidLevel === 3 && hcp >= 12 && h[suit] >= 6) return bid;
  }
  const unbidMajors = (["H", "S"] as const).filter((suit) => suit !== opened && suit !== their);
  const doubleShape = unbidMajors.length > 0 ? unbidMajors.every((suit) => h[suit] >= 4) || (unbidMajors.some((suit) => h[suit] >= 4) && hcp >= 8)
    : LETTERS.filter((suit) => suit !== opened && suit !== their).every((suit) => h[suit] >= 4);
  if (doubleShape && rank(action) <= rank("2S") && hcp >= (level === 1 ? 6 : 8)) return "X";
  if (stopped) {
    if (hcp >= 13 && hcp <= 16) return "3N";
    if (hcp >= 11 && hcp <= 12 && v.legal("2N")) return "2N";
    if (hcp >= 8 && hcp <= 10 && level === 1) return "1N";
  }
  return "P";
};

/** Opener's calls once the opponents are in the auction and no forcing agreement applies. */
export const openerInCompetition: Handler = (h, v) => {
  const { hcp } = h;
  // Partner's 2NT over a takeout double shows a limit raise or better.
  const jordan = v.match(/^1([CDHS]) X 2N P$/);
  if (jordan) {
    const suit = jordan[1] as Letter;
    if (isMajor(suit)) return hcp >= 14 ? `4${suit}` : `3${suit}`;
    return hcp >= 15 && LETTERS.filter((other) => other !== suit).every((other) => h.stopper(other)) ? "3N" : `3${suit}`;
  }
  // Partner cue-bid the overcall to show a limit raise or better: with real extras, bid the game.
  const cueRaise = v.match(/^1([CDHS]) ([12])([CDHS]) ([23])\3 P$/);
  if (cueRaise && cueRaise[1] !== cueRaise[3] && hcp >= 16) {
    const suit = cueRaise[1] as Letter;
    if (isMajor(suit)) return `4${suit}`;
    return h.stopper(cueRaise[3]) ? "3N" : `5${suit}`;
  }
  // Both sides have raised: compete with extra length, bid game with extra strength.
  const raised = v.match(/^1([HS]) (?:X|[12][CDHS]) 2\1 ([23])([CDHS])$/);
  if (raised) {
    const suit = raised[1] as Letter;
    if (hcp >= 18) return `4${suit}`;
    if ((hcp >= 16 || h[suit] >= 6) && v.legal(`3${suit}`)) return `3${suit}`;
    return "P";
  }
  // Partner raised and the opponents are in: with 18 or more, bid the game.
  const single = v.match(/^1([CDHS]) (?:X|[12][CDHSN]) 2\1 (\S+)$/);
  if (single && hcp >= 18) {
    const suit = single[1] as Letter;
    if (isMajor(suit)) return `4${suit}`;
    return v.theirSuits.every((their) => h.stopper(their)) && v.legal("3N") ? "3N" : v.cheapest(suit);
  }
  // The overcall is passed back to opener: reopen with shortness in their suit, since partner may be waiting to defend.
  const reopen = v.match(/^1([CDHS]) ([12])([CDHS]) P P$/);
  if (reopen && v.skill >= 2 && reopen[1] !== reopen[3]) {
    const suit = reopen[1] as Letter;
    const their = reopen[3] as Letter;
    if (h[their] <= 2 && LETTERS.filter((other) => other !== their && other !== suit).every((other) => h[other] >= 3)) return "X";
    if (h[suit] >= 6 && v.legal(`2${suit}`)) return `2${suit}`;
    return undefined;
  }
  return undefined;
};

/** Responder's call after passing an overcall and hearing opener reopen with a double. */
export const afterReopeningDouble: Handler = (h, v) => {
  const found = v.match(/^1([CDHS]) ([12])([CDHS]) P P X P$/);
  if (!found) return undefined;
  const opened = found[1] as Letter;
  const their = found[3] as Letter;
  if (h[their] >= 4 && h.count(their, "AKQJT") >= 2 && h.hcp >= 7) return "P";
  const suit = LETTERS.filter((candidate) => candidate !== their && candidate !== opened && h[candidate] >= 4).sort((a, b) => h[b] - h[a] || (isMajor(a) ? -1 : 1))[0];
  if (suit) return v.cheapest(suit);
  if (h[opened] >= 2) return v.cheapest(opened);
  return v.cheapest(advanceSuit(h, LETTERS.filter((candidate) => candidate !== their))!);
};

/** Opener's rebid after responder's forcing new suit over an opponent's overcall. */
export const afterFreeBid: Handler = (h, v) => {
  const found = v.match(/^1([CDHS]) ([123][CDHS]) ([123])([CDHS]) P$/);
  if (!found || (v.partnerPassed && h.hcp < 15)) return undefined;
  const opened = found[1] as Letter;
  const their = found[2]![1] as Letter;
  const suit = found[4] as Letter;
  const level = Number(found[3]);
  if (suit === opened || suit === their || their === opened) return undefined;
  const { hcp } = h;
  const fit = h[suit];
  const gameBid: Token = `${isMajor(suit) ? 4 : 5}${suit}`;
  if (fit >= 4 || (fit === 3 && level >= 2)) {
    if (hcp >= 16 + (level === 1 ? 2 : 0) && isMajor(suit)) return gameBid;
    return v.cheapest(suit, hcp >= 16 && levelOf(v.cheapest(suit)) < (isMajor(suit) ? 3 : 4) ? 1 : 0);
  }
  if (h.stopper(their) && (h.balanced || h[opened] < 6)) {
    const cheap = v.cheapest("N");
    if (hcp >= 18 || (hcp >= 15 && level >= 2)) return "3N";
    return cheap;
  }
  const second = LETTERS.filter((candidate) => candidate !== opened && candidate !== suit && candidate !== their && h[candidate] >= 4)[0];
  if (h[opened] >= 6) return v.cheapest(opened, hcp >= 16 && levelOf(v.cheapest(opened)) === 2 ? 1 : 0);
  if (second && (rank(v.cheapest(second)) < rank(v.cheapest(opened)) || hcp >= 16)) return v.cheapest(second);
  if (h[opened] >= 5) return v.cheapest(opened);
  return fit >= 2 ? v.cheapest(suit) : v.cheapest("N");
};

/** Advancing partner's overcall of an opponent's preempt: raise to game with a fit and values. */
export const advancePreemptOvercall: Handler = (h, v) => {
  const found = v.match(/^([23])([CDHS]) ([234])([CDHSN]) P$/);
  if (!found || v.text.startsWith("2C")) return undefined;
  const their = found[2] as Letter;
  const strain = found[4]!;
  const level = Number(found[3]);
  const { hcp } = h;
  if (strain === their) return undefined;
  if (strain === "N") return level === 2 && hcp >= 9 ? "3N" : undefined;
  const suit = strain as Letter;
  const needed = level === 2 ? 13 : 11;
  if (isMajor(suit)) {
    if (level >= 4) return undefined;
    return (h[suit] >= 3 && h.support(suit) >= needed - 1) || (h[suit] === 2 && hcp >= needed) ? `4${suit}` : undefined;
  }
  if (h.stopper(their) && hcp >= needed - 1 && v.legal("3N")) return "3N";
  return h[suit] >= 3 && hcp >= needed + 2 ? `5${suit}` : undefined;
};

/**
 * Partner bid the opponents' suit below game and the next hand passed: that is a cue-bid, never a place to play. With
 * no clearer agreement, return to the partnership's suit, or bid game in it with extra values.
 */
export const neverPassCue: Handler = (h, v) => {
  const length = v.tokens.length;
  if (length < 3 || v.tokens[length - 1] !== "P") return undefined;
  const cue = v.tokens[length - 2]!;
  const strain = cue[1];
  if (rank(cue) === 0 || !isSuit(strain) || isGame(cue) || levelOf(cue) >= 4) return undefined;
  const firstBid = v.tokens.findIndex((token) => rank(token) > 0 && token[1] === strain);
  if (firstBid < 0 || firstBid % 2 === length % 2) return undefined;
  const mine = [...v.mine].reverse().find((token) => rank(token) > 0 && isSuit(token[1]) && !v.theirSuits.includes(token[1] as Letter));
  const suit = (mine?.[1] ?? advanceSuit(h, unbidSuits(v))) as Letter | undefined;
  if (!suit) return undefined;
  if (h.hcp >= 14 && isMajor(suit) && mine && v.legal(`4${suit}`)) return `4${suit}`;
  if (h.hcp >= 14 && !isMajor(suit) && v.theirSuits.every((their) => h.stopper(their)) && v.legal("3N")) return "3N";
  return v.cheapest(suit);
};
