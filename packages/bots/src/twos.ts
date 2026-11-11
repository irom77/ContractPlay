import { LETTERS, isMajor, levelOf, type Eval, type Handler, type Letter, type Token } from "./auction.js";

/** The strong 2C opening, weak two bids and higher preempts: responses and the opener's rebids. */

/** Responder's and opener's calls after a strong, artificial 2C. */
export const strongTwoClubs: Handler = (h, v) => {
  const found = v.match(/^2C P((?: \S+ P)*)$/);
  if (!found) return undefined;
  const seq = found[1]!.trim().split(" ").filter((token) => token && token !== "P");
  if (found[1]!.trim().split(" ").filter(Boolean).length !== seq.length * 2) return undefined;
  const [response, rebid, second, third] = seq;
  const { hcp } = h;
  const best = h.byLength[0]!;

  if (seq.length === 0) {
    if (hcp < 8) return "2D";
    const suit = h.byLength.find((candidate) => h[candidate] >= 5 && h.count(candidate, "AKQ") >= 2);
    if (suit) return isMajor(suit) ? `2${suit}` : `3${suit}`;
    return h.balanced ? "2N" : "2D";
  }

  if (seq.length === 1) {
    if (response === "2D") {
      if (h.balanced) return hcp >= 25 ? "3N" : "2N";
      return isMajor(best) ? `2${best}` : `3${best}`;
    }
    // A positive response sets up a game force: support, a suit of one's own, or notrump.
    const shown = response![1];
    if (shown === "N") return h.balanced ? (hcp >= 25 ? "6N" : "3N") : v.cheapest(best);
    if (h.len(shown) >= 3) return hcp >= 23 ? "4N" : v.cheapest(shown as Letter);
    return h[best] >= 5 ? v.cheapest(best) : v.cheapest("N");
  }

  if (seq.length === 2 && response === "2D") {
    // 2NT and 3NT rebids are handled as notrump bids; here opener has shown a suit, which is forcing.
    const suit = rebid![1] as Letter;
    if (rebid![1] === "N") return undefined;
    const own = h.byLength.find((candidate) => candidate !== suit && h[candidate] >= 5 && v.legal(v.cheapest(candidate)) && levelOf(v.cheapest(candidate)) <= 3);
    if (h[suit] >= 3) return isMajor(suit) ? (hcp >= 4 ? `3${suit}` : `4${suit}`) : hcp >= 6 ? "3N" : `4${suit}`;
    if (own && hcp >= 4) return v.cheapest(own);
    return v.cheapest("N");
  }

  if (seq.length === 3 && response === "2D") {
    const suit = rebid![1];
    if (suit === "N" || !second) return undefined;
    const mine = suit as Letter;
    if (second === "3N" || levelOf(second) >= 4) return "P";
    if (second[1] === mine) return levelOf(second) >= 4 ? "P" : isMajor(mine) ? `4${mine}` : "3N";
    if (second[1] === "N") {
      const other = LETTERS.filter((candidate) => candidate !== mine && h[candidate] >= 4).sort((a, b) => h[b] - h[a])[0];
      if (h[mine] >= 6) return v.cheapest(mine);
      if (other && levelOf(v.cheapest(other)) <= 3) return v.cheapest(other);
      return levelOf(second) >= 3 ? "P" : "3N";
    }
    const theirs = second[1] as Letter;
    if (h[theirs] >= 3 && isMajor(theirs)) return `4${theirs}`;
    return h[mine] >= 6 ? v.cheapest(mine) : v.legal("3N") ? "3N" : v.cheapest(mine);
  }

  if (seq.length === 4 && response === "2D" && rebid![1] !== "N") {
    // Responder's last duty: 2C – 2D – 2M – 2NT – 3M may be passed with nothing; any other call still looks for game.
    const mine = rebid![1] as Letter;
    if (!third || v.last === undefined) return undefined;
    if (levelOf(third) >= 4 || third === "3N") return "P";
    if (third[1] === mine) return hcp >= 3 || h[mine] >= 3 ? (isMajor(mine) ? `4${mine}` : "3N") : "P";
    const shown = third[1] as Letter;
    if (isMajor(shown) && h[shown] >= 4) return `4${shown}`;
    if (isMajor(mine) && h[mine] >= 2) return v.cheapest(mine);
    return v.legal("3N") ? "3N" : v.cheapest(mine);
  }
  // Later rounds: the 2C opening is forcing to game, apart from the one sequence handled above.
  if (seq.length >= 2 && v.last && v.lastIsOurs && levelOf(v.last) < (v.last[1] === "N" ? 3 : isMajor(v.last[1]) ? 4 : 5)) {
    const strain = v.last[1]!;
    if (isMajor(strain) && h.len(strain) >= 3) return `4${strain}`;
    const major = (["S", "H"] as const).find((suit) => h[suit] >= 6);
    if (major) return `4${major}`;
    return v.legal("3N") ? "3N" : strain === "N" ? undefined : v.cheapest(strain as Letter);
  }
  return undefined;
};

/** Responses to partner's weak two bid, and the opener's replies to them. */
export const weakTwo: Handler = (h, v) => {
  const found = v.match(/^2([DHS]) P((?: \S+ P)*)$/);
  if (!found) return undefined;
  const suit = found[1] as Letter;
  const seq = found[2]!.trim().split(" ").filter((token) => token && token !== "P");
  if (found[2]!.trim().split(" ").filter(Boolean).length !== seq.length * 2) return undefined;
  const [response, reply] = seq;
  const { hcp } = h;
  const fit = h[suit];
  const major = isMajor(suit);

  if (seq.length === 0) {
    const own = (["S", "H"] as const).find((candidate) => candidate !== suit && h[candidate] >= 5 && h.goodSuit(candidate));
    if (own && hcp >= 16 && fit < 3) return v.cheapest(own);
    if (hcp >= 17 && fit >= 2 && major) return "4" + suit;
    if (hcp >= 15) return fit >= 2 || h.balanced ? "2N" : own ? v.cheapest(own) : "P";
    if (fit >= 4) return major ? `4${suit}` : hcp >= 6 ? `3${suit}` : "P";
    if (fit === 3 && hcp >= 6) return `3${suit}`;
    return "P";
  }

  if (seq.length === 1) {
    if (response === "2N") {
      if (hcp < 9) return `3${suit}`;
      const feature = LETTERS.find((candidate) => candidate !== suit && h.count(candidate, "AK") >= 1 && v.legal(`3${candidate}`));
      return feature ? `3${feature}` : h.count(suit, "AKQ") === 3 ? "3N" : `3${suit}`;
    }
    const shown = response![1];
    if (shown === suit || response === "3N" || levelOf(response!) >= 4) return "P";
    if (shown === "N") return "P";
    // A new suit is forcing for one round: raise with support, otherwise rebid the long suit.
    const support = h.len(shown);
    if (support >= 3 || (support === 2 && h.count(shown as Letter, "AKQ") >= 1 && hcp >= 8)) return v.cheapest(shown as Letter, isMajor(shown) && levelOf(v.cheapest(shown as Letter)) === 3 ? 1 : 0);
    return v.cheapest(suit);
  }

  if (seq.length === 2 && response === "2N") {
    if (!reply) return undefined;
    if (reply === `3${suit}`) return hcp >= 18 && major ? `4${suit}` : "P";
    if (reply === "3N") return "P";
    if (major) return `4${suit}`;
    return LETTERS.filter((candidate) => candidate !== suit).every((candidate) => h.stopper(candidate) || reply[1] === candidate) ? "3N" : v.cheapest(suit);
  }
  return undefined;
};

/** Responses to partner's three- or four-level preempt. */
export const preemptResponse: Handler = (h, v) => {
  const found = v.match(/^([34])([CDHS]) P((?: \S+ P)*)$/);
  if (!found) return undefined;
  const level = Number(found[1]);
  const suit = found[2] as Letter;
  const seq = found[3]!.trim().split(" ").filter((token) => token && token !== "P");
  if (found[3]!.trim().split(" ").filter(Boolean).length !== seq.length * 2) return undefined;
  const { hcp } = h;
  const fit = h[suit];
  const tricks = h.aces + h.kings * 0.5;

  if (seq.length === 0) {
    if (level === 4) return isMajor(suit) || hcp < 16 || h.aces < 2 ? "P" : `5${suit}`;
    if (isMajor(suit)) {
      if ((fit >= 2 && hcp >= 15) || (fit >= 3 && (hcp >= 13 || tricks >= 3)) || fit >= 4) return `4${suit}`;
      return "P";
    }
    const stopped = LETTERS.filter((candidate) => candidate !== suit).every((candidate) => h.stopper(candidate));
    if (hcp >= 15 && stopped && fit >= 2) return "3N";
    if (fit >= 3 && hcp >= 16) return `5${suit}`;
    if (fit >= 4 && hcp <= 9) return `4${suit}`;
    return "P";
  }

  if (seq.length === 1) {
    // A new suit below game is forcing: raise with support, otherwise return to the long suit.
    const response: Token = seq[0]!;
    const shown = response[1];
    if (shown === suit || shown === "N" || levelOf(response) >= 4 + (isMajor(shown) ? 0 : 1)) return "P";
    if (h.len(shown) >= 2 && isMajor(shown)) return `4${shown}`;
    return v.cheapest(suit);
  }
  return undefined;
};

/** A hand's longest suit when it is long and strong enough to open at the four level. */
export function fourLevelSuit(h: Eval): Letter | undefined {
  const suit = h.byLength[0]!;
  return h[suit] >= 8 && h.hcp <= 10 && h.count(suit, "AKQJT") >= 2 ? suit : undefined;
}
