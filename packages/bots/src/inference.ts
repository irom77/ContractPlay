import { LETTERS, isGame, isMajor, isSuit, levelOf, rank, type Eval, type Handler, type Letter, type Token, type View } from "./auction.js";

/**
 * What a player's calls have promised: a minimum point count and minimum suit lengths. The reading is deliberately
 * coarse — enough to know when the partnership holds the values for game or slam and where its fits are.
 */
export interface Shown {
  readonly min: number;
  readonly len: Readonly<Record<Letter, number>>;
  /** Whether any of the calls was a natural notrump bid. */
  readonly notrump: boolean;
}

export function shownBy(v: View, who: "partner" | "me"): Shown {
  const { tokens } = v;
  const turn = tokens.length;
  const seatIndex = (who === "me" ? turn : turn + 2) % 4;
  const len: Record<Letter, number> = { C: 0, D: 0, H: 0, S: 0 };
  let min = 0;
  let notrump = false;
  const raise = (value: number): void => { min = Math.max(min, value); };
  const atLeast = (suit: string | undefined, cards: number): void => { if (isSuit(suit)) len[suit] = Math.max(len[suit], cards); };
  const opening = tokens[0];
  const openedSuit = opening?.[1];
  const responderPassed = who === "partner" ? v.partnerPassed : v.iPassed;

  for (let index = seatIndex; index < turn; index += 4) {
    const token = tokens[index]!;
    if (token === "P") continue;
    const before = tokens.slice(0, index);
    const own = before.filter((_, at) => at % 4 === index % 4 && before[at] !== "P");
    const partners = before.filter((_, at) => at % 4 === (index + 2) % 4 && before[at] !== "P");
    const opponents = before.filter((_, at) => at % 2 !== index % 2 && before[at] !== "P");
    const floor = [...before].reverse().find((other) => rank(other) > 0);
    const theirSuits = LETTERS.filter((suit) => opponents.some((other) => rank(other) > 0 && other[1] === suit));
    const strain = rank(token) > 0 ? token[1]! : undefined;
    const level = rank(token) > 0 ? levelOf(token) : 0;
    let cheapest = 1;
    if (strain) while (rank(`${cheapest}${strain}`) <= rank(floor)) cheapest += 1;
    const jump = strain ? level - cheapest : 0;
    const openingSide = index % 2 === 0;
    if (strain === "N" && level <= 3) notrump = true;

    if (index === 0) {
      if (level === 1) { raise(strain === "N" ? 15 : 12); atLeast(strain, isMajor(strain) ? 5 : 3); }
      else if (token === "2C") raise(22);
      else if (token === "2N") raise(20);
      else if (token === "3N") raise(25);
      else { raise(5); atLeast(strain, level + 4); }
      continue;
    }

    if (own.length === 0 && openingSide) {
      // Responder's first call.
      const contested = opponents.length > 0;
      if (level === 0) {
        if (token === "R") raise(10);
        else if (token === "X" && isSuit(openedSuit)) {
          raise(levelOf(floor ?? "1C") === 1 ? 6 : levelOf(floor ?? "1C") === 2 ? 8 : 10);
          for (const major of ["H", "S"] as const) if (major !== openedSuit && !theirSuits.includes(major)) atLeast(major, 4);
        }
        continue;
      }
      if (opening === "1N" || opening === "2N") {
        const up = levelOf(opening) + 1;
        if (token === `${up}D`) atLeast("H", 5);
        else if (token === `${up}H`) atLeast("S", 5);
        else if (strain === "N") raise(opening === "1N" ? (level === 2 ? 8 : 10) : 4);
        else if (token === `${up}C`) raise(opening === "1N" ? 8 : 4);
        continue;
      }
      if (opening === "2C") { if (token !== "2D") { raise(8); atLeast(strain, 5); } continue; }
      if (!isSuit(openedSuit) || levelOf(opening!) !== 1) {
        if (token === "2N") raise(15);
        else if (strain !== openedSuit && isSuit(strain)) { raise(15); atLeast(strain, 5); }
        else atLeast(strain, 3);
        continue;
      }
      if (strain === openedSuit) {
        atLeast(strain, isMajor(strain) ? 3 : 4);
        if (jump === 0) raise(6);
        else if (jump === 1 && !contested) { raise(10); atLeast(strain, 4); }
        else { raise(4); atLeast(strain, 4); }
      } else if (isSuit(strain) && theirSuits.includes(strain)) { raise(10); atLeast(openedSuit, 3); }
      else if (strain === "N") raise(level === 1 ? (contested ? 8 : 6) : level === 2 ? (!contested && isMajor(openedSuit) ? 13 : 11) : 13);
      else if (jump >= 1) { if (contested) { raise(5); atLeast(strain, 6); } else { raise(17); atLeast(strain, 5); } }
      else if (level === 1) { raise(6); atLeast(strain, 4); }
      else if (level === 2) { raise(!contested && v.style === "2/1" && isMajor(openedSuit) && !responderPassed ? 12 : 10); atLeast(strain, strain === "H" || contested ? 5 : 4); }
      else { raise(11); atLeast(strain, 5); }
      continue;
    }

    if (own.length === 0 && partners.length === 0) {
      // The defending side's first action.
      const balancing = before.at(-1) === "P" && before.at(-2) === "P";
      const floorLevel = levelOf(floor ?? "1C");
      if (token === "X") {
        if (floor?.[1] === "N") raise(15);
        else { raise(Math.min(15, 11 + floorLevel) - (balancing ? 2 : 0)); for (const suit of LETTERS) if (!theirSuits.includes(suit)) atLeast(suit, 3); }
      } else if (strain === "N") {
        if (level === 2 && jump >= 1) { raise(6); for (const suit of LETTERS.filter((candidate) => !theirSuits.includes(candidate)).slice(0, 2)) atLeast(suit, 5); notrump = false; }
        else raise(level === 1 ? (balancing ? 11 : 15) : level === 2 ? 15 : 16);
      } else if (isSuit(strain) && theirSuits.includes(strain)) {
        raise(7);
        for (const major of ["H", "S"] as const) if (major !== strain) atLeast(major, 5);
      } else if (jump >= 1) { raise(5); atLeast(strain, 6); }
      else { raise(level === 1 ? 8 : level === 2 ? 10 : level === 3 ? 12 : 13); atLeast(strain, level >= 3 ? 6 : 5); }
      continue;
    }

    if (own.length === 0) {
      // Advancing partner's overcall or double.
      const action = partners[0]!;
      if (level === 0) continue;
      if (action === "X") {
        if (isSuit(strain) && theirSuits.includes(strain)) raise(12);
        else if (strain === "N") raise(level === 1 ? 6 : level === 2 ? 10 : 13);
        else { raise(jump >= 1 || isGame(token) ? 9 : 0); atLeast(strain, 4); }
      } else if (action[1] === "N") {
        if (strain === "N") raise(level === 2 ? 8 : 10);
        else if (token === "2D") atLeast("H", 5);
        else if (token === "2H") atLeast("S", 5);
      } else if (strain === action[1]) { raise(jump >= 1 ? 4 : 6); atLeast(strain, jump >= 1 ? 4 : 3); }
      else if (isSuit(strain) && theirSuits.includes(strain)) { raise(11); atLeast(action[1], 3); }
      else if (strain === "N") raise(level === 1 ? 8 : level === 2 ? 12 : 15);
      else { raise(9); atLeast(strain, 5); }
      continue;
    }

    // Later calls add to what the first one showed.
    if (level === 0) continue;
    const first = own[0]!;
    const partnerSuits = LETTERS.filter((suit) => partners.some((other) => rank(other) > 0 && other[1] === suit));
    if (index % 4 === 0 && isSuit(openedSuit) && levelOf(opening!) === 1) {
      const response = partners[0];
      const responseLevel = response && rank(response) > 0 ? levelOf(response) : 0;
      if (strain === "N") raise(jump >= 1 ? 18 : level === 1 ? 12 : responseLevel >= 2 ? 12 : 18);
      else if (strain === openedSuit) {
        atLeast(strain, 6);
        if (partnerSuits.includes(openedSuit)) raise(isGame(token) ? 18 : 16);
        else if (jump >= 1) raise(16);
      } else if (isSuit(strain) && partnerSuits.includes(strain)) {
        atLeast(strain, level >= 3 || isMajor(strain) ? 4 : 3);
        if (jump >= 1) raise(isGame(token) && jump >= 2 ? 19 : 16);
      } else if (isSuit(strain)) {
        atLeast(strain, 4);
        if (jump >= 1) raise(19);
        else if (level >= 2 && rank(`2${strain}`) > rank(`2${openedSuit}`) && responseLevel === 1) { raise(16); atLeast(openedSuit, 5); }
        else if (own.length === 1 && partnerSuits.includes(openedSuit)) raise(16);
      }
      continue;
    }
    if (first === "X" && !openingSide) {
      if (strain === "N") raise(level === 1 ? 18 : 19);
      else if (isSuit(strain) && partnerSuits.includes(strain)) { raise(jump >= 1 ? 19 : 16); atLeast(strain, 4); }
      else if (isSuit(strain) && !theirSuits.includes(strain)) { raise(17); atLeast(strain, 5); }
      else raise(19);
      continue;
    }
    if (isSuit(strain) && own.some((other) => other[1] === strain)) atLeast(strain, 6);
    else if (isSuit(strain) && !partnerSuits.includes(strain) && !theirSuits.includes(strain)) atLeast(strain, 4);
    if (openingSide && own.length >= 1 && (opening === "1N" || opening === "2N" || opening === "2C")) continue;
    if (isGame(token)) raise(openingSide ? 12 : 13);
    else if (strain === "N" && level === 2) raise(openingSide ? 11 : 12);
    else if (level === 3 && jump >= 1) raise(10);
    else if (level === 3 && isSuit(strain) && (partnerSuits.includes(strain) || own.some((other) => other[1] === strain))) raise(10);
  }
  return { min, len, notrump };
}

/** The best major the partnership is known to hold eight cards in. */
export function majorFit(h: Eval, partner: Shown): Letter | undefined {
  return (["S", "H"] as const).filter((suit) => partner.len[suit] > 0 && h[suit] + partner.len[suit] >= 8)
    .sort((a, b) => h[b] + partner.len[b] - h[a] - partner.len[a])[0];
}

/** The trump suit an ace-asking 4NT refers to: one both partners have bid, else the last suit the other partner named. */
function agreedSuit(v: View, asker: readonly Token[], replier: readonly Token[]): Letter | undefined {
  const suits = (tokens: readonly Token[]): Letter[] => tokens.filter((token) => rank(token) > 0 && isSuit(token[1]) && !v.theirSuits.includes(token[1] as Letter)).map((token) => token[1] as Letter);
  const asked = suits(asker.slice(0, asker.lastIndexOf("4N")));
  const replied = suits(replier.filter((_, index) => index < replier.length));
  const both = [...asked].reverse().find((suit) => replied.includes(suit));
  return both ?? replied.at(-1) ?? asked.at(-1);
}

/** True when a 4NT bid asks for aces rather than inviting a notrump slam. */
function isBlackwood(bidderBefore: readonly Token[], partnerBefore: readonly Token[]): boolean {
  const lastOfPartner = [...partnerBefore].reverse().find((token) => rank(token) > 0);
  const anySuit = [...bidderBefore, ...partnerBefore].some((token) => rank(token) > 0 && isSuit(token[1]));
  return anySuit && lastOfPartner?.[1] !== "N";
}

/** Answers to Blackwood, the asker's placement afterwards, and the king ask. */
export const blackwood: Handler = (h, v) => {
  const length = v.tokens.length;
  if (v.tokens[length - 1] !== "P" || length < 4) return undefined;
  const partnerCall = v.tokens[length - 2]!;
  const mine = v.mine.filter((token) => token !== "P");
  const partners = v.partners.filter((token) => token !== "P");

  if (partnerCall === "4N" && isBlackwood(partners.slice(0, -1), mine)) return ["5C", "5D", "5H", "5S", "5C"][h.aces];
  if (partnerCall === "5N" && partners.at(-2) === "4N" && /^5[CDHS]$/.test(mine.at(-1) ?? "") && isBlackwood(partners.slice(0, -2), mine.slice(0, -1))) {
    return ["6C", "6D", "6H", "6S", "6C"][h.kings];
  }
  const asked = mine.lastIndexOf("4N");
  if (asked < 0 || !isBlackwood(mine.slice(0, asked), partners.slice(0, partners.length - (mine.length - asked)))) return undefined;
  const trump = agreedSuit(v, mine, partners.slice(0, partners.length - (mine.length - asked)));
  if (!trump) return undefined;
  const place = (level: number): Token => v.legal(`${level}${trump}`) ? `${level}${trump}` : partnerCall === `${level}${trump}` ? "P" : v.legal(`${level}N`) ? `${level}N` : "P";
  if (mine.length - asked === 1 && /^5[CDHS]$/.test(partnerCall)) {
    const reply = "CDHS".indexOf(partnerCall[1]!);
    const aces = h.aces + (reply === 0 && h.aces === 0 ? 4 : reply);
    if (aces <= 2) return place(5) === "P" || levelOf(place(5)) === 5 ? place(5) : "P";
    if (aces === 3) return place(6);
    return h.hcp + shownBy(v, "partner").min >= 35 && v.legal("5N") ? "5N" : place(6);
  }
  if (mine.length - asked === 2 && mine.at(-1) === "5N" && /^6[CDHS]$/.test(partnerCall)) {
    const reply = "CDHS".indexOf(partnerCall[1]!);
    const kings = h.kings + (reply === 0 && h.kings === 0 ? 4 : reply);
    return kings === 4 ? place(7) : place(6);
  }
  return undefined;
};

/**
 * Game, or an ace ask on the way to slam, when the calls so far show the partnership holds the values and the player's
 * pass would otherwise leave the contract short of it. This is the check for auctions the opponents have joined.
 */
export const knownValues: Handler = (h, v) => {
  const partner = shownBy(v, "partner");
  if (partner.min === 0 || !v.last) return undefined;
  const fit = majorFit(h, partner);
  const strength = (fit ? Math.max(h.hcp, h.support(fit) - 1) : h.hcp) + partner.min;
  if (strength < 25) return undefined;
  // Our own game is already bid, or the opponents have bid past where ours would be.
  if (v.lastIsOurs && isGame(v.last)) {
    if (fit && strength >= 33 && h.hcp >= 16 && v.legal("4N") && v.last[1] === fit) return "4N";
    return undefined;
  }
  const stopped = v.theirSuits.every((suit) => h.stopper(suit));
  if (fit) {
    if (strength >= 33 && h.hcp >= 16 && v.legal("4N") && LETTERS.every((suit) => h[suit] <= 1 || h.count(suit, "AK") >= 1 || suit === fit)) return "4N";
    if (v.legal(`4${fit}`)) return `4${fit}`;
  }
  if (!fit && v.legal("3N") && (stopped || partner.notrump)) return "3N";
  const minor = (["D", "C"] as const).find((suit) => partner.len[suit] > 0 && h[suit] + partner.len[suit] >= 9);
  if (minor && strength >= 28 && v.legal(`5${minor}`)) return `5${minor}`;
  if (minor && v.legal(v.cheapest(minor)) && levelOf(v.cheapest(minor)) <= 4) return v.cheapest(minor);
  if (!v.lastIsOurs && v.legal("X") && levelOf(v.last) >= 3 && h.len(v.last[1]) >= 2) return "X";
  if (v.legal("3N") && v.theirSuits.length === 0) return "3N";
  // No fit and no stopper yet: cue-bid the opponents' suit once to ask partner to describe the hand further.
  const their = v.theirSuits.at(-1);
  const cued = v.mine.some((token) => rank(token) > 0 && v.theirSuits.includes(token[1] as Letter));
  if (their && !cued && v.lastIsOurs && levelOf(v.cheapest(their)) <= 3) return v.cheapest(their);
  return undefined;
};
