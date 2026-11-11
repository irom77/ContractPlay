import type { Bid, Hand, PublicBid, Seat, SkillLevel } from "@contractplay/core";
import { createView, evaluate, isLegalCall, isSuit, levelOf, rank, toBid, toToken, type Eval, type Handler, type Style, type Token, type View } from "./auction.js";
import {
  advanceDouble, advanceOverNotrump, advanceOvercall, advancePreemptOvercall, advanceTwoSuiter, afterFreeBid, neverPassCue, afterAdvanceCue, afterReopeningDouble, balance, doublerRebid,
  openerInCompetition, overPreempt, overTheirNotrump, overcallerRebid, responderInCompetition
} from "./competitive.js";
import { afterFourthSuit, constructiveAgreements, constructiveContinuations, fiveFiveAfterStayman, gameForce, lightOpening, opening, weakOppositeTwoNotrump } from "./constructive.js";
import { blackwood, knownValues } from "./inference.js";
import { afterNotrumpOvercall, gamblingRaise, notrumpStructure, overNotrumpOvercall } from "./notrump.js";
import { preemptResponse, strongTwoClubs, weakTwo } from "./twos.js";

/**
 * The partnership's system, read from the opening bid. The rule bots answer the positions they were written for; this
 * layer holds the agreements that apply at every level and supplies natural calls where the rules have none.
 */

/** Agreements that settle the call before the rules are consulted. */
const agreements: readonly Handler[] = [
  opening, weakOppositeTwoNotrump, constructiveAgreements, advanceDouble, doublerRebid, afterAdvanceCue, overPreempt, overTheirNotrump, advanceOverNotrump,
  overcallerRebid, openerInCompetition, afterReopeningDouble, balance, advancePreemptOvercall
];

/** Natural calls for positions the rules pass. */
const continuations: readonly Handler[] = [
  lightOpening, blackwood, notrumpStructure, gamblingRaise, overNotrumpOvercall, afterNotrumpOvercall, strongTwoClubs, weakTwo,
  preemptResponse, gameForce, constructiveContinuations, advanceOvercall, advanceTwoSuiter, responderInCompetition, afterFreeBid,
  advancePreemptOvercall, neverPassCue
];

export interface System {
  readonly h: Eval;
  readonly v: View;
  /** The call an agreement requires, before the rules are asked. */
  agreed(): Bid | undefined;
  /** A better call than the one the rules chose, where an agreement shows theirs to be wrong. */
  corrected(chosen: Bid): Bid | undefined;
  /** A natural call when the rules pass. */
  continued(): Bid | undefined;
  /** Game or a slam try when the calls so far show the values for it. */
  values(): Bid | undefined;
}

export function createSystem(hand: Hand, auction: readonly PublicBid[], seat: Seat, style: Style, skill: SkillLevel): System {
  const h = evaluate(hand);
  const v = createView(auction, seat, style, skill);
  const legal = (token: Token | undefined): Bid | undefined => token && isLegalCall(toBid(token), auction, seat) ? toBid(token) : undefined;
  const first = (handlers: readonly Handler[]): Bid | undefined => {
    for (const handler of handlers) {
      const bid = legal(handler(h, v));
      if (bid) return bid;
    }
    return undefined;
  };
  return {
    h, v,
    agreed: () => first(agreements),
    corrected(chosen) {
      const token = toToken(chosen);
      // With three cards in each minor the opening is 1C.
      if (v.tokens.length === 0 && token === "1D" && h.D === 3 && h.C === 3) return "1clubs";
      // Three of a minor over 1NT only invites; a hand with the values for game bids it.
      if (v.text === "1N P" && (token === "3C" || token === "3D") && h.hcp >= 12 && h.hcp <= 15) return "3notrump";
      // A bid of the opponents' suit at the four level or higher is no longer a cue-bid anyone can read: raise or pass.
      if (rank(token) > 0 && isSuit(token[1]) && v.theirSuits.includes(token[1]) && levelOf(token) >= 4) {
        const shown = [...v.partners].reverse().find((other) => rank(other) > 0 && isSuit(other[1]) && !v.theirSuits.includes(other[1]));
        const raise = shown && isSuit(shown[1]) ? v.cheapest(shown[1]) : undefined;
        return raise && shown && h.len(shown[1]) >= 3 && levelOf(raise) <= 4 ? legal(raise) ?? "pass" : "pass";
      }
      const below = rank(token) > 0 && levelOf(token) < (token[1] === "N" ? 3 : token[1] === "H" || token[1] === "S" ? 4 : 5);
      const fourth = below ? legal(afterFourthSuit(h, v)) : undefined;
      if (fourth) return fourth;
      const majors = below ? legal(fiveFiveAfterStayman(h, v)) : undefined;
      if (majors) return majors;
      // A hand too strong for a simple overcall doubles first and bids its suit next.
      if (v.match(/^1[CDHS]$/) && isSuit(token[1]) && token[1] !== v.tokens[0]![1] && levelOf(token) <= 2 && h.hcp >= 18 && rank(token) < rank(`2${v.tokens[0]![1]}`) + 5) return "double";
      const responder = responderInCompetition(h, v);
      if (responder && responder !== token && rank(responder) > 0) {
        const newSuit = v.tokens[0]![1] !== responder[1] && responder[1] !== "N" && levelOf(responder) >= 2;
        if ((token === "X" && newSuit) || responder === "2N" && v.tokens[1] === "X" || (responder[1] === v.tokens[0]![1] && levelOf(responder) === 3 && token === `2${responder[1]}`)) return legal(responder);
      }
      // Opposite a weak two, four-card support raises to game and a strong hand with its own suit names it.
      const weak = weakTwo(h, v);
      if (weak && rank(weak) > 0 && rank(token) > 0 && weak !== token) {
        const opened = v.tokens[0]![1];
        if ((weak === `4${opened}` && token === `3${opened}`) || (token === "2N" && weak[1] !== opened && weak[1] !== "N")) return legal(weak);
      }
      const advance = advanceOvercall(h, v);
      if (advance && rank(advance) > 0 && rank(token) > 0 && advance[1] === token[1] && levelOf(advance) > levelOf(token)) return legal(advance);
      return undefined;
    },
    continued: () => first(continuations),
    values: () => v.uncontested ? undefined : legal(knownValues(h, v))
  };
}
