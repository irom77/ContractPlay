import { isMajor, isMinor, isSuit, levelOf, otherMajor, type Eval, type Handler, type Letter, type Token, type View } from "./auction.js";

/**
 * The notrump structure: Stayman, Jacoby transfers, the minor-suit relay, invitations and quantitative raises after a
 * natural notrump bid of known strength, and natural bidding when an opponent overcalls a 1NT opening.
 */

interface NotrumpBid {
  /** 1 after 1NT, 2 after 2NT. */
  readonly level: 1 | 2;
  /** The fewest and most points the notrump bidder has shown. */
  readonly min: number;
  readonly max: number;
  /** The opponents' suit when the notrump bid was an overcall. */
  readonly their?: Letter;
  /** The partnership's calls after the notrump bid, oldest first. */
  readonly seq: readonly Token[];
}

const shapes: readonly (readonly [RegExp, 1 | 2, number, number])[] = [
  [/^1N (?:P|X)((?: \S+ P)*)$/, 1, 15, 17],
  [/^2N P((?: \S+ P)*)$/, 2, 20, 21],
  [/^2C P 2D P 2N P((?: \S+ P)*)$/, 2, 22, 24],
  [/^1[CDHS] P P 1N P((?: \S+ P)*)$/, 1, 11, 14]
];

function notrumpBid(v: View): NotrumpBid | undefined {
  for (const [pattern, level, min, max] of shapes) {
    const found = v.match(pattern);
    if (!found) continue;
    const seq = found[1]!.trim().split(" ").filter((token) => token && token !== "P");
    // Every later call must be the partnership's own: the pattern allows only passes from the opponents.
    if (found[1]!.trim().split(" ").filter(Boolean).length !== seq.length * 2) return undefined;
    return { level, min, max, seq };
  }
  return undefined;
}

const gerberReply = (h: Eval): Token => ["4D", "4H", "4S", "4N", "4D"][h.aces]!;
const kingReply = (h: Eval): Token => ["5D", "5H", "5S", "5N", "5D"][h.kings]!;

function respond(h: Eval, v: View, nt: NotrumpBid): Token | undefined {
  const { level, min, max } = nt;
  const up = level + 1;
  const game = 25 - min;
  const invite = level === 1 ? game - 2 : game;
  const quant = 33 - max;
  const slam = 33 - min;
  const { hcp } = h;
  const majors = (["S", "H"] as const).filter((major) => major !== nt.their);
  const five = majors.filter((major) => h[major] >= 5).sort((a, b) => h[b] - h[a])[0];
  const transfer = (major: Letter): Token => `${up}${major === "H" ? "D" : "H"}`;
  const notrump = (): Token => hcp >= slam ? "6N" : hcp >= quant ? "4N" : hcp >= game ? "3N" : hcp >= invite ? "2N" : "P";
  const [first, reply] = nt.seq;

  if (nt.seq.length === 0) {
    // Expert bots ask for aces with Gerber on slam-going hands; leave those to their own rules.
    if (v.skill === 3 && hcp >= quant) return undefined;
    if (five) {
      const other = majors.find((major) => major !== five);
      if (h.S >= 5 && h.H >= 5 && majors.length === 2) return transfer("S");
      if (other && h[other] === 4 && hcp >= invite) return `${up}C`;
      if (h[five] >= 6 && hcp >= quant && level === 1) return `3${five}`;
      return transfer(five);
    }
    const flat = h.byLength.every((suit) => h[suit] >= 3);
    if (majors.some((major) => h[major] === 4) && hcp >= invite && !flat) return `${up}C`;
    const minor = (["D", "C"] as const).filter((suit) => h[suit] >= 6).sort((a, b) => h[b] - h[a])[0];
    if (minor && level === 1) {
      if (hcp < invite - 1) return "2S";
      if (hcp < game && h.count(minor, "AKQ") >= 2) return `3${minor}`;
    }
    return notrump();
  }

  if (nt.seq.length === 2) {
    if (first === `${up}C`) {
      if (isMajor(reply?.[1])) {
        const shown = reply![1] as Letter;
        if (h[shown] >= 4) return hcp >= slam ? `6${shown}` : hcp >= game ? `4${shown}` : `3${shown}`;
        return notrump();
      }
      if (five && hcp >= game) return `3${five}`;
      return notrump();
    }
    const shownMajor = first === `${up}D` ? "H" : first === `${up}H` ? "S" : undefined;
    if (shownMajor) {
      if (shownMajor === "S" && h.H >= 5 && h.S >= 5 && hcp >= game) return level === 1 ? "3H" : "4H";
      if (h[shownMajor] >= 6) return hcp >= slam ? `6${shownMajor}` : hcp >= game ? `4${shownMajor}` : hcp >= invite && level === 1 ? `3${shownMajor}` : "P";
      // Opener jumped to show a maximum with four trumps.
      if (reply === `${up + 1}${shownMajor}`) return hcp >= invite - 2 ? `4${shownMajor}` : "P";
      return notrump();
    }
    if (first === "2S" && level === 1 && reply === "3C") return h.D > h.C ? "3D" : "P";
    if (level === 1 && isMajor(first?.[1]) && first![0] === "3" && reply === `4${first![1]}`) return hcp >= slam ? `6${first![1]}` : "P";
    if (first === "4C") return undefined;
    return "P";
  }
  return undefined;
}

function rebid(h: Eval, v: View, nt: NotrumpBid): Token | undefined {
  const { level, min } = nt;
  const up = level + 1;
  const accept = h.hcp >= min + 1;
  const [first, mine, second] = nt.seq;
  const transferred = first === `${up}D` ? "H" : first === `${up}H` ? "S" : undefined;

  if (nt.seq.length === 1) {
    if (first === `${up}C`) return h.H >= 4 && nt.their !== "H" ? `${up}H` : h.S >= 4 && nt.their !== "S" ? `${up}S` : `${up}D`;
    if (transferred) return `${up}${transferred}`;
    if (first === "4C") return gerberReply(h);
    if (first === "4N") return accept ? "6N" : "P";
    if (first === "5N") return "6N";
    if (level === 1) {
      if (first === "2S") return "3C";
      if (first === "2N") return accept ? "3N" : "P";
      if (first === "3C" || first === "3D") {
        const suit = first[1] as Letter;
        return h.count(suit, "AKQ") >= 1 ? "3N" : "P";
      }
      if (first === "3H" || first === "3S") return `4${first[1]}`;
    }
    if (level === 2 && first === "3S") return "3N";
    return "P";
  }

  if (nt.seq.length === 3) {
    if (first === "4C") return second === "5C" ? kingReply(h) : "P";
    if (first === `${up}C`) {
      const shown = isMajor(mine?.[1]) ? mine![1] as Letter : undefined;
      const hiddenSpades = shown === "H" && h.S >= 4;
      if (second === "2N") return hiddenSpades ? (accept ? "4S" : "3S") : accept ? "3N" : "P";
      if (second === "3N") return hiddenSpades ? "4S" : "P";
      if (second === "4N") return accept ? "6N" : "P";
      if (shown && second === `3${shown}`) return accept ? `4${shown}` : "P";
      if (!shown && isMajor(second?.[1]) && levelOf(second!) <= 3) {
        const suit = second![1] as Letter;
        if (levelOf(second!) === 3) return h[suit] >= 3 ? `4${suit}` : "3N";
        return h[suit] >= 3 ? (accept ? `4${suit}` : "P") : accept ? "3N" : "2N";
      }
      return "P";
    }
    if (transferred) {
      const fit = h[transferred] >= 3;
      if (second === "2N") return accept ? (fit ? `4${transferred}` : "3N") : fit ? `3${transferred}` : "P";
      if (second === "3N") return fit ? `4${transferred}` : "P";
      if (second === `3${transferred}`) return accept ? `4${transferred}` : "P";
      if (second === "4N") return accept ? (fit ? `6${transferred}` : "6N") : fit ? `5${transferred}` : "P";
      if (transferred === "S" && second === "3H") return h.H >= 3 && h.H > h.S ? "4H" : "4S";
      if (transferred === "S" && second === "4H") return h.S > h.H ? "4S" : "P";
      if (isMinor(second?.[1]) && levelOf(second!) === 3) return fit ? `4${transferred}` : "3N";
      return "P";
    }
    return "P";
  }
  return "P";
}

/** Calls in a notrump auction the opponents have stayed out of, apart from a double of the 1NT opening. */
export const notrumpStructure: Handler = (h, v) => {
  const nt = notrumpBid(v);
  if (!nt) return undefined;
  return nt.seq.length % 2 === 0 ? respond(h, v, nt) : rebid(h, v, nt);
};

/** Partner opened 3NT, or rebid it after 2C: pass unless slam is likely. */
export const gamblingRaise: Handler = (h, v) => {
  if (!v.match(/^(?:3N P|2C P 2D P 3N P)$/)) return undefined;
  return h.hcp >= 8 ? "6N" : "P";
};

/** Responder's call after an opponent overcalls partner's 1NT opening in a suit: natural, with a cue-bid as Stayman. */
export const overNotrumpOvercall: Handler = (h, v) => {
  const found = v.match(/^1N ([23])([CDHS])$/);
  if (!found) return undefined;
  const level = Number(found[1]);
  const their = found[2] as Letter;
  const { hcp } = h;
  const majors = (["S", "H"] as const).filter((major) => major !== their);
  const five = majors.filter((major) => h[major] >= 5).sort((a, b) => h[b] - h[a])[0];
  if (h[their] >= 4 && h.count(their, "AKQJT") >= 2 && hcp >= 6) return "X";
  if (level === 3) {
    if (hcp < 9) return "P";
    if (five) return v.legal(`3${five}`) ? `3${five}` : h[five] >= 6 ? `4${five}` : "3N";
    return h.stopper(their) || hcp >= 11 ? "3N" : "X";
  }
  if (hcp >= 10) {
    if (five) return `3${five}`;
    // Expert bots show or deny a stopper through Lebensohl; leave the rest of their game-going hands to those rules.
    if (v.skill === 3) return undefined;
    if (majors.some((major) => h[major] === 4)) return `3${their}`;
    return "3N";
  }
  if (five && v.legal(`2${five}`)) return `2${five}`;
  if (v.skill === 3) return undefined;
  if (hcp >= 8) return five && hcp >= 9 ? `3${five}` : h.stopper(their) ? "2N" : "P";
  const long = (["S", "H", "D", "C"] as const).find((suit) => suit !== their && h[suit] >= 6 && v.legal(`2${suit}`));
  return long ? `2${long}` : "P";
};

/** Opener's call after partner acted over an overcall of 1NT. Expert partnerships use Lebensohl instead. */
export const afterNotrumpOvercall: Handler = (h, v) => {
  const found = v.match(/^1N ([23])([CDHS]) (\S+) P((?: \S+ P)*)$/);
  if (!found) return undefined;
  const their = found[2] as Letter;
  const action = found[3]!;
  // Expert partnerships use Lebensohl, where only a direct three-level suit keeps its natural meaning.
  if (v.skill === 3 && !(found[4] === "" && /^3[CDHS]$/.test(action) && action[1] !== their)) return undefined;
  const later = found[4]!.trim().split(" ").filter((token) => token && token !== "P");
  const accept = h.hcp >= 16;
  if (later.length === 0) {
    if (action === "P") return undefined;
    if (action === "X" || action === "3N") return "P";
    if (action === "2N") return accept ? "3N" : "P";
    const suit = action[1];
    if (!isSuit(suit)) return "P";
    if (suit === their) {
      const major = (["H", "S"] as const).find((candidate) => candidate !== their && h[candidate] >= 4);
      return major ? v.cheapest(major) : "3N";
    }
    if (levelOf(action) === 2) return "P";
    if (isMajor(suit)) return levelOf(action) >= 4 ? "P" : h[suit] >= 3 ? `4${suit}` : "3N";
    return "3N";
  }
  // Responder's turn after a cue-bid and opener's reply, then opener's last word.
  if (later.length === 1 && action[1] === their) {
    const shown = later[0]![1];
    if (isMajor(shown) && later[0] !== "3N") return h[shown] >= 4 ? (v.legal(`4${shown}`) && levelOf(later[0]!) < 4 ? `4${shown}` : "P") : "3N";
    return "P";
  }
  if (later.length === 2 && action[1] === their && later[1] === "3N" && isMajor(later[0]![1])) {
    const second = otherMajor(later[0]![1] as Letter);
    return second !== their && h[second] >= 4 ? `4${second}` : "P";
  }
  return "P";
};
