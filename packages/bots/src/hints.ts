import { SEATS, cardId, type Bid, type Card, type Hand, type PlayContext, type PublicBid, type Seat, type SkillLevel, type Suit } from "@contractplay/core";
import { createBot } from "./player.js";

/**
 * Hints for a human player: what a call means, which call or card the Expert bot would choose, and why.
 *
 * Bid meanings are read from the public auction alone, following standard SAYC / 2-over-1 agreements. They cover the
 * common situations; anything else falls back to a plain natural description rather than a guess at a convention.
 */

export type HintStyle = "SAYC" | "2/1";
export type BidHint = Readonly<{ bid: Bid; reason: string }>;
export type PlayHint = Readonly<{ card: Card; reason: string }>;

type Strain = Suit | "notrump";
type Contract = Readonly<{ level: number; strain: Strain }>;
type Placed = Contract & Readonly<{ seat: Seat; index: number }>;
type AuctionView = Readonly<{
  prior: readonly PublicBid[];
  me: Seat;
  partner: Seat;
  bids: readonly Placed[];
  ours: readonly Placed[];
  theirs: readonly Placed[];
  style: HintStyle;
  /** Whether the bidder uses the Expert bot's extra conventions: splinters, Reverse Drury and Lebensohl. */
  expert: boolean;
}>;

const strainOrder: readonly Strain[] = ["clubs", "diamonds", "hearts", "spades", "notrump"];
const honorPoints: Readonly<Record<string, number>> = { A: 4, K: 3, Q: 2, J: 1 };
const rankValue = (rank: string): number => "23456789TJQKA".indexOf(rank);
const partnerOf = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!;
const isMajor = (strain: Strain): boolean => strain === "hearts" || strain === "spades";
const isSuit = (strain: Strain): strain is Suit => strain !== "notrump";
const order = (contract: Contract): number => contract.level * 5 + strainOrder.indexOf(contract.strain);
const isGame = ({ level, strain }: Contract): boolean => level >= (strain === "notrump" ? 3 : isMajor(strain) ? 4 : 5);
const label = ({ level, strain }: Contract): string => `${level}${strain === "notrump" ? "NT" : { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[strain]}`;

function parse(bid: Bid): Contract | undefined {
  const match = /^([1-7])(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? { level: Number(match[1]), strain: match[2] as Strain } : undefined;
}

/** Lowest level at which `strain` can legally be bid over `last`. */
function cheapestLevel(strain: Strain, last: Contract | undefined): number {
  if (!last) return 1;
  return strainOrder.indexOf(strain) > strainOrder.indexOf(last.strain) ? last.level : last.level + 1;
}

export function highCardPoints(hand: Hand): number {
  return hand.reduce((total, card) => total + (honorPoints[card.rank] ?? 0), 0);
}

/**
 * The meaning of the call at `index` in `auction`, judged from the calls made before it. `skill` is the level of the
 * player who made the call: only Expert uses splinters, Reverse Drury and Lebensohl.
 */
export function explainBid(auction: readonly PublicBid[], index: number, style: HintStyle = "SAYC", skill: SkillLevel = "expert"): string {
  const entry = auction[index];
  if (!entry) return "";
  const prior = auction.slice(0, index);
  const me = entry.seat;
  const partner = partnerOf(me);
  const bids = prior.flatMap((call, position) => {
    const contract = parse(call.bid);
    return contract ? [{ ...contract, seat: call.seat, index: position }] : [];
  });
  const ours = bids.filter(({ seat }) => seat === me || seat === partner);
  const theirs = bids.filter(({ seat }) => seat !== me && seat !== partner);
  const view: AuctionView = { prior, me, partner, bids, ours, theirs, style, expert: skill === "expert" };

  if (entry.bid === "pass") return explainPass(view);
  if (entry.bid === "double") return explainDouble(view);
  if (entry.bid === "redouble") return explainRedouble(view);
  const call = parse(entry.bid);
  if (!call) return "";
  if (!bids.length) return explainOpening(call);
  if (!ours.length) return explainOvercall(view, call);
  const conventional = explainConvention(view, call);
  if (conventional) return conventional;
  if (ours.length === 1 && ours[0]!.seat === partner) {
    return theirs.some(({ index: position }) => position < ours[0]!.index) ? explainAdvance(view, call) : explainResponse(view, call);
  }
  return explainLaterBid(view, call);
}

function lastCallBy(view: AuctionView, seat: Seat): Bid | undefined {
  return [...view.prior].reverse().find((call) => call.seat === seat)?.bid;
}

function explainOpening({ level, strain }: Contract): string {
  if (level === 1 && strain === "notrump") return "Opening 1NT: 15–17 points and a balanced hand.";
  if (level === 1) return isMajor(strain)
    ? `Opening bid: 12–21 points with at least five ${strain}.`
    : `Opening bid: 12–21 points with at least three ${strain} and no five-card major.`;
  if (level === 2 && strain === "clubs") return "Strong and artificial: 22+ points, or a hand that can nearly make game alone. It says nothing about clubs, and partner must respond.";
  if (level === 2 && strain === "notrump") return "Opening 2NT: 20–21 points and a balanced hand.";
  if (level === 2) return `Weak two: a good six-card ${strain.slice(0, -1)} suit and about 5–10 points.`;
  if (level === 3 && strain === "notrump") return "Opening 3NT: 25–27 points and a balanced hand.";
  if (level === 3) return `Preempt: a seven-card ${strain.slice(0, -1)} suit and less than opening strength. It uses up the opponents' bidding room.`;
  if (level === 4 && isSuit(strain)) return `Preempt: an eight-card ${strain.slice(0, -1)} suit and less than opening strength.`;
  return "A high-level opening, bid to play there.";
}

function explainPass(view: AuctionView): string {
  const { bids, ours, theirs, prior, partner } = view;
  const last = bids.at(-1);
  if (!last) return "Not enough to open: fewer than 12 points and no long suit worth a preempt.";
  if (!ours.length) {
    const partnerDoubled = lastCallBy(view, partner) === "double" && prior.at(-1)?.bid === "pass";
    return partnerDoubled
      ? `Leaves partner's double in: good ${last.strain === "notrump" ? "defence" : last.strain} and a wish to defend ${label(last)}.`
      : "No overcall or takeout double to make with this hand.";
  }
  const myCalls = prior.filter(({ seat }) => seat === view.me);
  if (ours.length === 1 && ours[0]!.seat === partner && !theirs.length && myCalls.every(({ bid }) => bid === "pass") && prior.at(-1)?.bid === "pass") {
    const opening = ours[0]!;
    if (opening.level === 1 && isSuit(opening.strain)) return "Fewer than 6 points: too weak to respond to the opening bid.";
    if (opening.strain === "notrump") return "No interest in game opposite the notrump opening, and no long major to show.";
    return `No interest in going past ${label(opening)}.`;
  }
  return last.seat === view.me || last.seat === partner
    ? `Nothing more to say: content to play in ${label(last)}.`
    : `Nothing more to say: leaves the opponents in ${label(last)}.`;
}

function explainDouble(view: AuctionView): string {
  const { bids, ours, theirs, prior, me, partner } = view;
  const target = bids.at(-1);
  if (!target) return "Double.";
  const penalty = `Penalty double: expects to defeat ${label(target)}.`;
  if (target.strain === "notrump") return penalty;
  const myEarlierBids = ours.filter(({ seat }) => seat === me);
  if (!ours.length && order(target) <= order({ level: 4, strain: "hearts" })) {
    const theirSuits = [...new Set(theirs.map(({ strain }) => strain).filter(isSuit))];
    const balancing = prior.length >= 3 && prior.slice(-2).every(({ bid }) => bid === "pass") && prior.at(-3)?.seat !== partner;
    return `Takeout double: about opening strength, short in ${theirSuits.join(" and ")}, with support for the unbid suits. It asks partner to bid.${balancing ? " In the pass-out seat it can be a little lighter." : ""}`;
  }
  const overcall = theirs.length === 1 ? theirs[0]! : undefined;
  if (ours.length === 1 && ours[0]!.seat === partner && ours[0]!.level === 1 && isSuit(ours[0]!.strain) && overcall && overcall.index > ours[0]!.index && overcall.level <= 2) {
    const unbidMajors = (["hearts", "spades"] as const).filter((suit) => suit !== ours[0]!.strain && suit !== overcall.strain);
    return `Negative double: 6+ points with ${unbidMajors.length === 2 ? "both majors" : unbidMajors.length === 1 ? `four ${unbidMajors[0]}` : "the unbid suits"}. It is for takeout, not penalties.`;
  }
  const response = ours[1];
  if (ours.length === 2 && myEarlierBids.length === 1 && ours[0]!.seat === me && response && isMajor(response.strain) && response.level === 1 && overcall && overcall.index > response.index && overcall.level <= 2) {
    return `Support double: exactly three-card support for partner's ${response.strain}.`;
  }
  return penalty;
}

function explainRedouble(view: AuctionView): string {
  const { ours, theirs, partner } = view;
  if (ours.length === 1 && ours[0]!.seat === partner && ours[0]!.level === 1 && !theirs.length) {
    return "Redouble: 10+ points. It tells partner the hand belongs to your side.";
  }
  return "Redouble: confident the doubled contract will make.";
}

function explainOvercall(view: AuctionView, call: Contract): string {
  const { theirs, partner, prior } = view;
  const opening = theirs[0]!;
  const last = theirs.at(-1)!;
  const theirSuits = new Set(theirs.map(({ strain }) => strain));
  const jump = call.level - cheapestLevel(call.strain, last);
  const suit = isSuit(call.strain) ? call.strain : undefined;

  if (lastCallBy(view, partner) === "double" && prior.filter(({ seat }) => seat === view.me).every(({ bid }) => bid === "pass")) {
    if (isGame(call)) return "Bids game opposite partner's takeout double: to play.";
    if (theirSuits.has(call.strain)) return "Cue bid of their suit: 12+ points, forcing. It asks the doubler to describe their hand.";
    if (!suit) return call.level === 1
      ? "Answers the takeout double: 6–10 points, balanced, with a stopper in their suit."
      : "Answers the takeout double: 11–12 points, balanced, with a stopper in their suit. Invites game.";
    return jump > 0
      ? `Jump reply to the takeout double: 9–11 points with four or more ${suit}. Invites game.`
      : `Answers the takeout double: the best unbid suit, with 0–8 points. Partner asked for a bid, so this promises nothing.`;
  }
  if (!suit) {
    if (call.level === 1) return "1NT overcall: 15–18 points, balanced, with a stopper in their suit.";
    if (call.level === 2 && opening.level === 1 && theirs.length === 1 && jump > 0) return "Unusual 2NT: at least five cards in each of the two lowest unbid suits.";
    return isGame(call) ? "Bid to play, with their suit well stopped." : "Natural: a strong balanced hand with their suit stopped.";
  }
  if (theirSuits.has(suit)) {
    if (theirs.length === 1 && opening.level === 1 && jump === 0) return isMajor(suit)
      ? `Michaels cue bid: at least five ${suit === "hearts" ? "spades" : "hearts"} and five cards in a minor.`
      : "Michaels cue bid: at least five cards in each major.";
    return "Cue bid of their suit: a strong hand, forcing. It is not an offer to play there.";
  }
  if (isGame(call)) return `Bids game in ${suit}: a long suit, to play.`;
  if (jump > 0) return `Weak jump overcall: a ${call.level >= 3 ? "seven" : "six"}-card ${suit.slice(0, -1)} suit and less than opening strength.`;
  return call.level === 1
    ? `Overcall: five or more ${suit} and about 8–16 points.`
    : `Overcall: a good suit of five or more ${suit} and about 10–16 points.`;
}

const aceAnswers = ["No aces (or all four).", "One ace.", "Two aces.", "Three aces."];
const kingAnswers = ["No kings (or all four).", "One king.", "Two kings.", "Three kings."];

/** Whether the 4NT at `asked` was Blackwood rather than a quantitative raise of notrump. */
function isBlackwood(view: AuctionView, asked: Placed): boolean {
  const before = view.ours.filter(({ index }) => index < asked.index);
  const partnersLast = before.filter(({ seat }) => seat !== asked.seat).at(-1);
  return asked.level === 4 && asked.strain === "notrump" && before.some(({ strain }) => strain !== "notrump") && partnersLast?.strain !== "notrump";
}

function explainConvention(view: AuctionView, call: Contract): string | undefined {
  const { ours, theirs, me, partner, prior } = view;
  const first = ours[0]!;
  const rhoPassed = prior.at(-1)?.bid === "pass";
  const partnersLast = ours.filter(({ seat }) => seat === partner).at(-1);

  // Stayman, transfers and Gerber over an opening or overcalled 1NT / 2NT that the opponents have left alone.
  if (first.strain === "notrump" && first.level <= 2 && theirs.every(({ index }) => index < first.index) && prior.slice(first.index + 1).every(({ bid, seat }) => seat === me || seat === partner || bid === "pass")) {
    const base = first.level + 1;
    const at = (level: number, strain: Strain) => call.level === level && call.strain === strain;
    const opener = first.level === 1 ? "1NT" : "2NT";
    if (ours.length === 1 && first.seat === partner) {
      if (at(base, "clubs")) return `Stayman: asks the ${opener} bidder for a four-card major. It says nothing about clubs.`;
      if (at(base, "diamonds")) return `Jacoby transfer: five or more hearts. Partner is asked to bid ${base}♥.`;
      if (at(base, "hearts")) return `Jacoby transfer: five or more spades. Partner is asked to bid ${base}♠.`;
      if (at(4, "clubs")) return "Gerber: asks how many aces partner holds.";
      if (at(4, "notrump")) return "Quantitative 4NT: invites 6NT. Partner passes with a minimum and bids 6NT with a maximum.";
      if (first.level === 1) {
        if (at(2, "spades")) return "Shows a weak hand with a long minor: asks partner to bid 3♣.";
        if (at(2, "notrump")) return "Invites game: 8–9 points, balanced. Partner passes with a minimum or bids 3NT with a maximum.";
        if (at(3, "notrump")) return "Bids game: 10–15 points with no interest in a major-suit fit. To play.";
        if (at(4, "diamonds")) return "Texas transfer: six or more hearts and enough for game. Partner is asked to bid 4♥.";
        if (at(4, "hearts")) return "Texas transfer: six or more spades and enough for game. Partner is asked to bid 4♠.";
        if (call.level === 3 && isSuit(call.strain)) return isMajor(call.strain)
          ? `A six-card ${call.strain.slice(0, -1)} suit with slam interest. Forcing.`
          : `A six-card ${call.strain.slice(0, -1)} suit and an invitation to game.`;
      } else if (at(3, "notrump")) return "Bids game: enough points opposite 20–21, with no interest in a major-suit fit. To play.";
    }
    if (ours.length === 2 && first.seat === me && ours[1]!.seat === partner) {
      const asked = ours[1]!;
      const was = (level: number, strain: Strain) => asked.level === level && asked.strain === strain;
      if (was(base, "clubs")) {
        if (at(base, "diamonds")) return "Answers Stayman: no four-card major.";
        if (at(base, "hearts")) return "Answers Stayman: four hearts (and possibly four spades as well).";
        if (at(base, "spades")) return "Answers Stayman: four spades, but not four hearts.";
      }
      for (const [from, to] of [["diamonds", "hearts"], ["hearts", "spades"]] as const) {
        if (was(base, from) || (first.level === 1 && was(4, from))) {
          if (at(asked.level, to)) return `Completes the transfer to ${to}, as partner asked. It shows nothing extra.`;
          if (asked.level === base && at(base + 1, to)) return `Jumps in the transfer suit: four-card ${to.slice(0, -1)} support and a maximum.`;
        }
      }
      if (first.level === 1 && was(2, "notrump") && at(3, "notrump")) return "Accepts the invitation: a maximum 1NT opening.";
      if (was(4, "clubs")) {
        const answer = ["diamonds", "hearts", "spades", "notrump"].indexOf(call.strain);
        if (call.level === 4 && answer >= 0) return `Answers Gerber: ${aceAnswers[answer]!.toLowerCase()}`;
      }
    }
  }

  if (call.level === 4 && call.strain === "notrump") {
    if (partnersLast?.strain === "notrump") return "Quantitative 4NT: invites a notrump slam. Partner passes with a minimum.";
    if (ours.some(({ strain }) => strain !== "notrump")) return "Blackwood: asks how many aces partner holds.";
  }
  if (partnersLast && rhoPassed && partnersLast.index === prior.length - 2) {
    const answer = ["clubs", "diamonds", "hearts", "spades"].indexOf(call.strain);
    if (isBlackwood(view, partnersLast) && call.level === 5 && answer >= 0) return `Answers Blackwood: ${aceAnswers[answer]!.toLowerCase()}`;
    const myAsk = ours.filter(({ seat }) => seat === me).at(-1);
    if (partnersLast.level === 5 && partnersLast.strain === "notrump" && call.level === 6 && answer >= 0) {
      const partnersAsk = ours.filter(({ seat, index }) => seat === partner && index < partnersLast.index).at(-1);
      if (partnersAsk && isBlackwood(view, partnersAsk) && myAsk) return `Answers the king ask: ${kingAnswers[answer]!.toLowerCase()}`;
    }
  }
  if (call.level === 5 && call.strain === "notrump") {
    const myAsk = ours.filter(({ seat }) => seat === me).at(-1);
    if (myAsk && isBlackwood(view, myAsk)) return "Asks for kings: the partnership holds all four aces and is looking at a grand slam.";
  }
  return undefined;
}

function explainResponse(view: AuctionView, call: Contract): string {
  const { ours, theirs, prior, me, style } = view;
  const opening = ours[0]!;
  const contested = theirs.length > 0 || prior.slice(opening.index + 1).some(({ bid }) => bid === "double");
  const passedHand = prior.slice(0, opening.index).some(({ seat }) => seat === me);
  const twoOverOne = style === "2/1" && !contested && !passedHand;
  const jump = call.level - cheapestLevel(call.strain, theirs.at(-1) ?? opening);
  const suit = isSuit(call.strain) ? call.strain : undefined;
  const openedSuit = isSuit(opening.strain) ? opening.strain : undefined;

  if (opening.level === 2 && opening.strain === "clubs") {
    if (call.level === 2 && call.strain === "diamonds") return "Waiting bid: artificial, saying nothing about diamonds. It lets the strong hand describe itself.";
    return suit ? `Positive response: 8+ points with a good suit of five or more ${suit}.` : "Positive response: 8+ points and a balanced hand.";
  }
  if (opening.level >= 2 && openedSuit) {
    const weakTwo = opening.level === 2;
    if (suit === openedSuit) return isGame(call) ? "Raises the preempt to game: to play, either to make or to shut the opponents out." : "Raises the preempt: makes life harder for the opponents. It is not an invitation.";
    if (weakTwo && call.level === 2 && !suit) return "Asks the weak-two bidder for a feature (an ace or king in a side suit). Forcing, with interest in game.";
    if (!suit) return "Bid to play in notrump opposite the preempt.";
    return `New suit over the preempt: five or more ${suit}. Forcing.`;
  }
  if (opening.strain === "notrump" && opening.level === 1 && theirs.length === 1 && theirs[0]!.level === 2) {
    const overcalled = theirs[0]!.strain;
    if (suit && suit === overcalled) return "Cue bid of their suit: forcing to game, and asks the 1NT opener for a four-card major.";
    if (!suit && call.level === 2) return view.expert
      ? "Lebensohl 2NT: artificial. It asks the 1NT opener to bid 3♣ so that responder can then describe their hand."
      : "2NT: about 8–9 points with their suit stopped. Invites game.";
    if (!suit) return "3NT: to play.";
    return call.level === 2
      ? `Natural: five or more ${suit}, wanting to play there. Not forcing.`
      : isGame(call) ? `Bids game in ${suit}: to play.` : `Five or more ${suit} with game values. Forcing.`;
  }
  if (!openedSuit || opening.level !== 1) return explainLaterBid(view, call);

  if (suit && theirs.some(({ strain }) => strain === suit)) return `Cue bid of their suit: a good raise of partner's ${openedSuit}, with 10+ points and support. Not an offer to play in ${suit}.`;
  if (view.expert && !contested && passedHand && isMajor(openedSuit) && opening.index >= 2 && call.level === 2 && suit === "clubs") {
    return `Reverse Drury: a passed hand with about 10–12 points and ${openedSuit.slice(0, -1)} support. Artificial; it asks whether the opening was full strength.`;
  }
  if (suit === openedSuit) {
    const support = isMajor(suit) ? "three" : "four";
    if (isGame(call)) return isMajor(suit) ? `Raises to game in ${suit}: a fit and enough to play there.` : `Bids game in ${suit}: to play.`;
    if (jump === 0) return `${contested ? "Raise" : "Single raise"}: 6–10 points with at least ${support}-card ${suit.slice(0, -1)} support.`;
    return contested
      ? `Jump raise in competition: four or more ${suit} and a weak hand, to crowd the bidding.`
      : `Limit raise: 10–12 points with four-card ${suit.slice(0, -1)} support. Invites game.`;
  }
  if (!suit) {
    if (call.level === 1) return twoOverOne && isMajor(openedSuit)
      ? "Forcing 1NT: 6–12 points, no suit to show at the one level. Opener must bid again."
      : `1NT response: 6–10 points${contested ? " with a stopper in their suit" : ", no suit to show at the one level"}. Not forcing.`;
    if (call.level === 2) return contested
      ? "2NT: 10–12 points, balanced, with a stopper in their suit. Invites game."
      : isMajor(openedSuit)
        ? `Jacoby 2NT: four-card ${openedSuit.slice(0, -1)} support and 13+ points. Forcing to game; asks opener to show a short suit.`
        : "2NT response: balanced with no four-card major and about 11–12 points (13–15 in older styles).";
    return "3NT: balanced with game values and no major-suit fit. To play.";
  }
  const splinter = openedSuit === "hearts" ? call.level === 3 && suit !== "hearts" : openedSuit === "spades" && call.level === 4 && suit !== "spades";
  if (view.expert && !contested && splinter) return `Splinter: a game-forcing raise of ${openedSuit} with four-card support and a singleton or void in ${suit}.`;
  if (jump >= 1) return contested
    ? `Jump in a new suit: a long, good ${suit.slice(0, -1)} suit.`
    : twoOverOne
      ? `Jump shift: 13+ points with five or more ${suit}. Forcing to game.`
      : `Jump shift: a very strong hand (about 19+ points) with five or more ${suit}. Forcing to game, with slam interest.`;
  if (call.level === 1) return `New suit: ${suit === "spades" && theirs.at(-1)?.strain === "hearts" ? "five" : "four"} or more ${suit} and 6+ points. Forcing for one round.`;
  if (contested) return `New suit at the ${call.level === 2 ? "two" : "three"} level: five or more ${suit} and 10+ points. Forcing.`;
  if (twoOverOne && isMajor(openedSuit)) return `Two-over-one: 13+ points with four or more ${suit}. Forcing to game.`;
  return `New suit at the two level: 10+ points with four or more ${suit}. Forcing for one round.`;
}

function explainAdvance(view: AuctionView, call: Contract): string {
  const { ours, theirs } = view;
  const overcall = ours[0]!;
  const opening = theirs[0]!;
  const theirSuits = new Set(theirs.map(({ strain }) => strain));
  const jump = call.level - cheapestLevel(call.strain, theirs.at(-1)!.index > overcall.index ? theirs.at(-1)! : overcall);
  const suit = isSuit(call.strain) ? call.strain : undefined;
  const twoSuited = overcall.strain === opening.strain ? "Michaels cue bid" : overcall.strain === "notrump" && overcall.level === 2 && opening.level === 1 ? "Unusual 2NT" : undefined;

  if (twoSuited) {
    if (suit && theirSuits.has(suit)) return `Cue bid after partner's ${twoSuited}: a strong hand with interest in game.`;
    if (!suit) return call.level === 2 ? "Asks partner which minor they hold alongside the major." : "Bid to play in notrump.";
    return isGame(call) ? `Bids game in one of the suits partner showed: to play.` : `Chooses ${suit} from the two suits partner showed with the ${twoSuited}. It may be a very weak hand.`;
  }
  if (suit && theirSuits.has(suit)) return `Cue bid of their suit: a good raise of partner's ${overcall.strain === "notrump" ? "overcall" : overcall.strain}, with 10+ points.`;
  if (suit && suit === overcall.strain) {
    if (isGame(call)) return `Raises partner's overcall to game in ${suit}: to play.`;
    return jump > 0
      ? `Jump raise of partner's overcall: four or more ${suit} and a weak hand, to crowd the bidding.`
      : `Raises partner's overcall: at least three-card ${suit.slice(0, -1)} support and about 6–10 points.`;
  }
  if (!suit) return isGame(call)
    ? "3NT: to play, with their suit well stopped."
    : `Notrump opposite partner's overcall: ${call.level === 1 ? "8–11" : "12–13"} points with a stopper in their suit.`;
  return isGame(call) ? `Bids game in ${suit}: to play.` : `New suit opposite partner's overcall: a good suit of five or more ${suit}. Not forcing.`;
}

function explainLaterBid(view: AuctionView, call: Contract): string {
  const { ours, theirs, me, partner, prior } = view;
  const mine = ours.filter(({ seat }) => seat === me);
  const partners = ours.filter(({ seat }) => seat === partner);
  const theirSuits = new Set(theirs.map(({ strain }) => strain));
  const ourSuits = new Set(ours.map(({ strain }) => strain).filter(isSuit));
  const jump = call.level - cheapestLevel(call.strain, view.bids.at(-1));
  const suit = isSuit(call.strain) ? call.strain : undefined;
  const openedOneOfASuit = ours[0]!.seat === me && ours[0]!.level === 1 && isSuit(ours[0]!.strain) && !view.bids.some(({ index }) => index < ours[0]!.index);
  const openersRebid = openedOneOfASuit && mine.length === 1 && partners.length === 1;
  const uncontested = !theirs.length && prior.every(({ bid }) => bid !== "double");

  if (call.level >= 6) return `${call.level === 6 ? "Small slam" : "Grand slam"} in ${suit ?? "notrump"}: to play.`;
  const myOpening = ours[0]!.seat === me && !view.bids.some(({ index }) => index < ours[0]!.index) ? ours[0]! : undefined;
  const reply = partners.length === 1 && mine.length === 1 ? partners[0]! : undefined;
  if (myOpening && mine.length === 1 && myOpening.level === 2 && myOpening.strain === "clubs" && !isGame(call)) {
    return suit ? `The strong hand's real suit: five or more ${suit}. Forcing.` : "22–24 points and a balanced hand.";
  }
  if (myOpening && reply && uncontested && myOpening.level === 2 && isSuit(myOpening.strain) && myOpening.strain !== "clubs" && reply.level === 2 && reply.strain === "notrump" && call.level === 3) {
    if (suit === myOpening.strain) return "A minimum weak two, with no extra feature to show.";
    return suit ? `A maximum weak two with a feature (an ace or king) in ${suit}.` : "A maximum weak two with no feature in a side suit.";
  }
  if (view.expert && myOpening && reply && uncontested && myOpening.level === 1 && isMajor(myOpening.strain) && reply.level === 2 && reply.strain === "clubs" && call.level === 2 &&
    myOpening.index >= 2 && prior.slice(0, myOpening.index).some(({ seat }) => seat === partner)) {
    if (suit === "diamonds") return "Answers Drury: a sound, full-strength opening. Artificial, saying nothing about diamonds.";
    if (suit === myOpening.strain) return "Answers Drury: a minimum or light opening, wanting to stop here.";
  }
  if (view.expert && reply && ours[0]!.seat === me && ours[0]!.level === 1 && ours[0]!.strain === "notrump" && reply.level === 2 && reply.strain === "notrump" && theirs.length && call.level === 3 && suit === "clubs") {
    return "Completes the Lebensohl relay, as partner asked. It says nothing about clubs.";
  }
  if (!suit) {
    if (openersRebid && uncontested && call.level === 1) return "1NT rebid: 12–14 points and a balanced hand, too weak to have opened 1NT.";
    if (openersRebid && uncontested && call.level === 2) return jump > 0
      ? "Jump to 2NT: 18–19 points and a balanced hand, too strong to have opened 1NT."
      : "2NT rebid: a balanced hand with stoppers in the unbid suits.";
    if (call.level === 3) return "3NT: to play. Shows the unbid suits are stopped and no better fit has been found.";
    if (call.level >= 4) return "Bid to play in notrump.";
    return `${label(call)}: a balanced hand with stoppers in the unbid suits${call.level === 2 ? ". Invites game" : ""}.`;
  }
  if (theirSuits.has(suit) && !ourSuits.has(suit)) return "Cue bid of their suit: forcing. It shows strength or asks partner for a stopper, and is not an offer to play there.";
  if (partners.some(({ strain }) => strain === suit)) {
    if (isGame(call)) return `Game in partner's ${suit}: to play.`;
    return jump > 0
      ? `Jump raise of partner's ${suit}: a fit with extra values. Invites game.`
      : `Raises partner's ${suit}: a fit${mine.some(({ strain }) => strain === suit) ? "" : `, usually four-card support`}.`;
  }
  if (mine.some(({ strain }) => strain === suit)) {
    if (isGame(call)) return `Game in ${suit}: a long, self-sufficient suit. To play.`;
    return jump > 0
      ? `Jump rebid of ${suit}: six or more cards and extra values. Invites game.`
      : `Rebids ${suit}: nothing new to show, often with extra length in the suit.`;
  }
  if (isGame(call)) return `Bids game in ${suit}: to play.`;
  if (uncontested && ourSuits.size === 3) return "Fourth suit: artificial and forcing. It asks partner to say more about their hand and need not show the suit.";
  const opened = ours[0]!;
  if (openersRebid && uncontested && call.level === 2 && jump === 0 && partners[0]!.level === 1 && strainOrder.indexOf(suit) > strainOrder.indexOf(opened.strain)) {
    return `Reverse: 17+ points with four or more ${suit} and longer ${opened.strain}. Forcing.`;
  }
  return jump > 0
    ? `Jump in a new suit: four or more ${suit} and a strong hand. Forcing.`
    : `New suit: four or more ${suit}.`;
}

function legalCards(context: PlayContext): readonly Card[] {
  const ledSuit = context.ledSuit ?? context.currentTrick[0]?.card.suit;
  const following = ledSuit ? context.hand.filter((card) => card.suit === ledSuit) : [];
  return following.length ? following : context.hand;
}

function beats(card: Card, current: Card, ledSuit: Suit, trump?: Suit): boolean {
  if ((card.suit === trump) !== (current.suit === trump)) return card.suit === trump;
  if (card.suit === current.suit) return rankValue(card.rank) > rankValue(current.rank);
  return card.suit === ledSuit && current.suit !== ledSuit;
}

function trickLeader(context: PlayContext, ledSuit: Suit) {
  return context.currentTrick.reduce((best, play) => beats(play.card, best.card, ledSuit, context.trump) ? play : best);
}

const lowestOf = (cards: readonly Card[]): Card => [...cards].sort((a, b) => rankValue(a.rank) - rankValue(b.rank) || a.suit.localeCompare(b.suit))[0]!;

/** Why `card` is a sensible play in this position, in one line. */
export function explainPlay(context: PlayContext, card: Card): string {
  const legal = legalCards(context);
  const ledSuit = context.ledSuit ?? context.currentTrick[0]?.card.suit;
  const suitCards = context.hand.filter((other) => other.suit === card.suit);
  const holds = (rank: number) => suitCards.some((other) => rankValue(other.rank) === rank);
  const value = rankValue(card.rank);
  const isHonor = value >= rankValue("J");

  if (!ledSuit || !context.currentTrick.length) {
    if (context.hand.length === 1) return "Your last card.";
    if (isHonor && holds(value - 1)) return "Lead the top of touching honours: it sets up the cards below it.";
    if (card.rank === "A" && context.trump && card.suit !== context.trump) return "Lead the ace: against a suit contract, don't lead a low card away from an ace.";
    const fourth = [...suitCards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[3];
    if (fourth && cardId(fourth) === cardId(card)) return "Lead the fourth-highest card of your longest suit.";
    return "Lead a low card and keep your high cards for later.";
  }
  if (legal.length === 1) return card.suit === ledSuit ? `Your only ${ledSuit.slice(0, -1)}: you must follow suit.` : "Your last card.";

  const leader = trickLeader(context, ledSuit);
  const partnerWinning = leader.seat === partnerOf(context.seat);
  const wins = beats(card, leader.card, ledSuit, context.trump);
  const lowest = cardId(lowestOf(legal)) === cardId(card);
  if (card.suit !== ledSuit) {
    if (card.suit === context.trump) return wins && !partnerWinning ? `You have no ${ledSuit}: ruff to win the trick.` : `You have no ${ledSuit}, and only trumps left to play.`;
    return partnerWinning ? `You have no ${ledSuit} and partner is winning: throw a low card you don't need.` : `You have no ${ledSuit} and can't win the trick: throw a low card you don't need.`;
  }
  if (partnerWinning) return lowest ? "Partner is already winning the trick, so play low." : "Partner is winning: play the top of your touching honours to show what you hold.";
  if (wins) {
    const lead = context.currentTrick[0]!.card;
    if (context.currentTrick.length === 1 && rankValue(lead.rank) >= rankValue("J")) return "Cover an honour with an honour.";
    return context.currentTrick.length === 3 ? "Last to play: win the trick with the cheapest card that does it." : "Win the trick with the cheapest card that beats what has been played.";
  }
  if (context.currentTrick.length === 1) return "Second hand plays low: keep your high cards over the next player's.";
  return "You can't win this trick, so play your lowest card.";
}

/** The call the Expert bot would make with this hand, and what that call means. */
export async function suggestBid(hand: Hand, auction: readonly PublicBid[], seat: Seat, style: HintStyle = "SAYC"): Promise<BidHint> {
  const bid = await createBot({ skill: "expert", biddingStyle: style }).chooseBid(hand, auction, seat);
  return { bid, reason: explainBid([...auction, { seat, bid }], auction.length, style, "expert") };
}

/** The card the Expert bot would play, and why. It follows standard technique; it does not see the other hands. */
export async function suggestPlay(context: PlayContext): Promise<PlayHint> {
  const ledSuit = context.ledSuit ?? context.currentTrick[0]?.card.suit;
  let card = await createBot({ skill: "expert", biddingStyle: "SAYC" }).chooseCard(context);
  if (ledSuit && context.currentTrick.length && card.suit !== ledSuit && card.suit === context.trump) {
    // Out of the suit led: don't spend a trump that isn't needed to win the trick.
    const leader = trickLeader(context, ledSuit);
    const needed = leader.seat !== partnerOf(context.seat) && beats(card, leader.card, ledSuit, context.trump);
    const sideCards = context.hand.filter((other) => other.suit !== context.trump);
    if (!needed && sideCards.length) card = lowestOf(sideCards);
  }
  return { card, reason: explainPlay(context, card) };
}
