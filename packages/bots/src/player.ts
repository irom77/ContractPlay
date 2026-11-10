import { SEATS, cardId, type Bid, type BotConfig, type BotPlayer, type Hand, type PlayContext, type PublicBid, type Seat, type Suit } from "@contractplay/core";

export interface ConventionSystem {
  readonly style: "SAYC" | "2/1";
  openingBid(hand: Hand): Bid;
}

const highCardPoints: Readonly<Record<string, number>> = { A: 4, K: 3, Q: 2, J: 1 };
const suits: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];

const strainOrder = ["clubs", "diamonds", "hearts", "spades", "notrump"] as const;

/** Orders contract bids; 0 for pass, double and redouble. */
function contractRank(bid: Bid): number {
  const match = /^([1-7])(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? Number(match[1]) * 5 + strainOrder.indexOf(match[2] as typeof strainOrder[number]) + 1 : 0;
}

function isLegalCall(bid: Bid, auction: readonly PublicBid[], seat: Seat): boolean {
  if (bid === "pass") return true;
  const lastContract = [...auction].reverse().find((call) => contractRank(call.bid) > 0);
  if (bid !== "double" && bid !== "redouble") return contractRank(bid) > (lastContract ? contractRank(lastContract.bid) : 0);
  if (!lastContract) return false;
  const lastNonPass = [...auction.slice(auction.indexOf(lastContract) + 1)].reverse().find((call) => call.bid !== "pass");
  const ourContract = SEATS.indexOf(lastContract.seat) % 2 === SEATS.indexOf(seat) % 2;
  return bid === "double" ? !lastNonPass && !ourContract : lastNonPass?.bid === "double" && ourContract;
}

/** The same strain at the lowest level that is still legal over the auction so far; pass if no level is left. */
function atLegalLevel(bid: Bid, auction: readonly PublicBid[]): Bid {
  const lastContract = [...auction].reverse().find((call) => contractRank(call.bid) > 0);
  const floor = lastContract ? contractRank(lastContract.bid) : 0;
  for (let level = Number(bid[0]); level <= 7; level++) {
    const raised = `${level}${bid.slice(1)}` as Bid;
    if (contractRank(raised) > floor) return raised;
  }
  return "pass";
}

/** Places the final contract after a king reply: the planned slam if it can still be bid, else pass it or settle in 6NT. */
function placeAfterKingReply(planned: Bid, reply: Bid, auction: readonly PublicBid[]): Bid {
  if (atLegalLevel(planned, auction) === planned) return planned;
  return reply === planned ? "pass" : atLegalLevel("6notrump", auction);
}

function points(hand: Hand): number {
  return hand.reduce((total, card) => total + (highCardPoints[card.rank] ?? 0), 0);
}

function quickTricks(hand: Hand, preemptSuit: Suit): number {
  return suits.reduce((total, suit) => {
    const cards = hand.filter((card) => card.suit === suit);
    const has = (rank: string) => cards.some((card) => card.rank === rank);
    const length = cards.length;
    if (has("A") && has("K") && has("Q")) return total + 3;
    if (has("A") && has("K")) return total + 2;
    if (has("A") && has("Q")) return total + 1.5;
    if (has("A")) return total + 1;
    if (has("K") && has("Q")) return total + 1;
    if (has("K") && (length >= 2 || suit === preemptSuit)) return total + 0.5;
    return total;
  }, 0);
}

function aceCount(hand: Hand): number {
  return hand.filter((card) => card.rank === "A").length;
}

function hasReasonablePreemptiveSuit(hand: Hand, suit: Suit, minimumLength: number): boolean {
  const suitCards = hand.filter((card) => card.suit === suit);
  return suitCards.length >= minimumLength && suitCards.filter((card) => ["A", "K", "Q", "J", "T"].includes(card.rank)).length >= 2;
}

function hasReasonableWeakTwoSuit(hand: Hand, suit: Suit): boolean {
  return hasReasonablePreemptiveSuit(hand, suit, 6);
}

function hasOutsideFourCardMajor(hand: Hand, suit: Suit): boolean {
  return (["hearts", "spades"] as const)
    .filter((major) => major !== suit)
    .some((major) => hand.filter((card) => card.suit === major).length >= 4);
}

function supportPoints(hand: Hand, trumpSuit: Suit): number {
  const shortSuitPoints = suits
    .filter((suit) => suit !== trumpSuit)
    .reduce((total, suit) => {
      const length = hand.filter((card) => card.suit === suit).length;
      return total + (length === 0 ? 5 : length === 1 ? 3 : length === 2 ? 1 : 0);
    }, 0);
  return points(hand) + shortSuitPoints;
}

function isBalanced(hand: Hand): boolean {
  const counts = suits.map((suit) => hand.filter((card) => card.suit === suit).length);
  return counts.every((count) => count >= 2) && counts.filter((count) => count === 2).length <= 1;
}

function hasStopper(hand: Hand, suit: Suit): boolean {
  const suitCards = hand.filter((card) => card.suit === suit);
  return suitCards.some((card) => card.rank === "A") ||
    (suitCards.length >= 2 && suitCards.some((card) => card.rank === "K")) ||
    (suitCards.length >= 3 && suitCards.some((card) => card.rank === "Q"));
}

function staymanMajor(hand: Hand, overcallSuit: Suit): Suit | undefined {
  const candidateMajors: readonly Suit[] = overcallSuit === "hearts"
    ? ["spades"]
    : overcallSuit === "spades" ? ["hearts"] : ["spades", "hearts"];
  return candidateMajors.find((suit) => hand.filter((card) => card.suit === suit).length >= 4);
}

function losingTricks(hand: Hand): number {
  return suits.reduce((losers, suit) => {
    const suitCards = hand.filter((card) => card.suit === suit)
      .sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
    const countedCards = suitCards.slice(0, 3);
    const missingTopHonors = ["A", "K", "Q"].slice(0, countedCards.length)
      .filter((honor) => !countedCards.some((card) => card.rank === honor)).length;
    return losers + missingTopHonors;
  }, 0);
}

function longestSuitLength(hand: Hand): number {
  return Math.max(...suits.map((suit) => hand.filter((card) => card.suit === suit).length));
}

function respondToTwoNotrump(hand: Hand): Bid {
  const hearts = hand.filter((card) => card.suit === "hearts").length;
  const spades = hand.filter((card) => card.suit === "spades").length;
  if (hearts >= 5 && spades < 4) return "3diamonds";
  if (spades >= 5 && hearts < 4) return "3hearts";
  if (hearts >= 4 || spades >= 4) return "3clubs";
  if (isBalanced(hand) && points(hand) >= 12) return "4notrump";
  if (isBalanced(hand) && points(hand) >= 5) return "3notrump";
  return "pass";
}

function passedBeforeOpening(auction: readonly PublicBid[], seat: Seat, opening: PublicBid): boolean {
  const openingIndex = auction.indexOf(opening);
  return openingIndex >= 0 && auction.slice(0, openingIndex).some((call) => call.seat === seat && call.bid === "pass");
}

function splinterSequence(
  opening: PublicBid | undefined,
  splinter: PublicBid | undefined
): { readonly major: Suit; readonly shortSuit: Suit } | undefined {
  const major = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
  if (!major || !splinter) return undefined;
  const shortSuit = splinter.bid.match(
    major === "hearts" ? /^3(clubs|diamonds|spades)$/ : /^4(clubs|diamonds|hearts)$/
  )?.[1] as Suit | undefined;
  return shortSuit ? { major, shortSuit } : undefined;
}

function twoOverOneAuction(auction: readonly PublicBid[], style: ConventionSystem["style"]) {
  if (style !== "2/1") return undefined;
  const contracts = auction.filter(({ bid }) => bid !== "pass");
  if (contracts.length < 2 || contracts.length > 5) return undefined;
  const opening = contracts[0]!;
  const response = contracts[1]!;
  if (passedBeforeOpening(auction, response.seat, opening)) return undefined;
  const openingSuit = opening.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
  const responseSuit = response.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
  const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
  const expectedResponder = SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]!;
  const higherMajorGameForce = openingSuit === "hearts" && responseSuit === "spades";
  if (
    !openingSuit || !responseSuit || response.seat !== expectedResponder ||
    (suitOrder.indexOf(responseSuit) >= suitOrder.indexOf(openingSuit) && !higherMajorGameForce)
  ) return undefined;
  const sideMajor = openingSuit === "hearts" ? "spades" : "hearts";
  const sideMinor = responseSuit === "clubs" && (openingSuit === "hearts" || openingSuit === "spades")
    ? "diamonds"
    : undefined;
  const lowerMinorRebid = responseSuit === "diamonds" ? "clubs" : undefined;
  if (contracts.length >= 3 && (
    contracts[2]!.seat !== opening.seat ||
    (contracts[2]!.bid !== `2${openingSuit}` && contracts[2]!.bid !== "2notrump" &&
      !(sideMajor !== responseSuit && contracts[2]!.bid === `2${sideMajor}`) &&
      contracts[2]!.bid !== `3${sideMajor}` &&
      (!sideMinor || contracts[2]!.bid !== `2${sideMinor}`) &&
      (!lowerMinorRebid || contracts[2]!.bid !== `3${lowerMinorRebid}`) &&
      (!((responseSuit === "clubs" || responseSuit === "diamonds") && contracts[2]!.bid === `3${responseSuit}`)))
  )) return undefined;
  if (contracts.length >= 4 && (
    contracts[3]!.seat !== expectedResponder ||
    (!(responseSuit === "clubs" && contracts[2]!.bid === `2${openingSuit}` && contracts[3]!.bid === `2${sideMajor}`) &&
      !(responseSuit === "clubs" && contracts[2]!.bid === "2diamonds" && contracts[3]!.bid === `2${sideMajor}`) &&
      contracts[3]!.bid !== `3${responseSuit}` && contracts[3]!.bid !== `3${openingSuit}` &&
      contracts[3]!.bid !== `3${sideMajor}` && contracts[3]!.bid !== "3notrump")
  )) return undefined;
  if (contracts.length >= 5 && contracts[4]!.seat !== opening.seat) return undefined;
  return { openingSeat: opening.seat, responderSeat: response.seat, openingSuit, responseSuit };
}

function saycJumpShiftAuction(auction: readonly PublicBid[], style: ConventionSystem["style"]) {
  if (style !== "SAYC") return undefined;
  const contracts = auction.filter(({ bid }) => bid !== "pass");
  if (contracts.length < 2) return undefined;
  const opening = contracts[0]!;
  const response = contracts[1]!;
  const openingSuit = opening.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
  const responseMatch = response.bid.match(/^([23])(clubs|diamonds|hearts|spades)$/);
  const responseLevel = responseMatch ? Number(responseMatch[1]) : undefined;
  const responseSuit = responseMatch?.[2] as Suit | undefined;
  const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
  const expectedResponder = SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]!;
  const expectedLevel = openingSuit && responseSuit && suitOrder.indexOf(responseSuit) > suitOrder.indexOf(openingSuit) ? 1 : 2;
  if (
    !openingSuit || !responseSuit || responseSuit === openingSuit || !responseLevel || response.seat !== expectedResponder ||
    responseLevel !== expectedLevel + 1 || passedBeforeOpening(auction, response.seat, opening) ||
    auction.some(({ seat, bid }) => bid !== "pass" && seat !== opening.seat && seat !== response.seat)
  ) return undefined;
  return { opening, response, openingSuit, responseSuit, responseLevel };
}

function saycMajorTwoLevelResponseAuction(auction: readonly PublicBid[], style: ConventionSystem["style"]) {
  if (style !== "SAYC") return undefined;
  const contracts = auction.filter(({ bid }) => bid !== "pass");
  if (contracts.length < 2) return undefined;
  const opening = contracts[0]!;
  const response = contracts[1]!;
  const openingSuit = opening.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
  const responseSuit = response.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
  const expectedResponder = SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]!;
  const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
  if (
    !openingSuit || !responseSuit || response.seat !== expectedResponder ||
    suitOrder.indexOf(responseSuit) >= suitOrder.indexOf(openingSuit) ||
    passedBeforeOpening(auction, response.seat, opening) ||
    auction.some(({ seat, bid }) => bid !== "pass" && seat !== opening.seat && seat !== response.seat)
  ) return undefined;
  return { opening, response, openingSuit, responseSuit };
}

function makeConvention(style: ConventionSystem["style"]): ConventionSystem {
  return {
    style,
    openingBid(hand) {
      const hcp = points(hand);
      if (hcp < 12) return "pass";
      if (isBalanced(hand) && hcp >= 20 && hcp <= 21) return "2notrump";
      if (hcp >= 22 || (longestSuitLength(hand) >= 6 && losingTricks(hand) <= 4)) return "2clubs";
      if (hcp >= 15 && hcp <= 17 && isBalanced(hand)) return "1notrump";
      const counts = new Map(suits.map((suit) => [suit, hand.filter((card) => card.suit === suit).length]));
      const majors: readonly Suit[] = ["spades", "hearts"];
      const minors: readonly Suit[] = ["diamonds", "clubs"];
      const eligibleMajors = majors.filter((suit) => counts.get(suit)! >= 5);
      const candidates = eligibleMajors.length > 0 ? eligibleMajors : minors;
      const preferred = [...candidates].sort((a, b) => counts.get(b)! - counts.get(a)! || candidates.indexOf(a) - candidates.indexOf(b))[0]!;
      return `1${preferred}` as Bid;
    }
  };
}

function legalCards(context: PlayContext) {
  const ledSuit = context.ledSuit ?? context.currentTrick[0]?.card.suit;
  const followSuit = ledSuit ? context.hand.filter((card) => card.suit === ledSuit) : [];
  return followSuit.length ? followSuit : context.hand;
}

const rankValue = (rank: string): number => "23456789TJQKA".indexOf(rank);

function beats(play: { card: Hand[number] }, current: { card: Hand[number] }, ledSuit: Suit, trump?: Suit): boolean {
  const playIsTrump = trump !== undefined && play.card.suit === trump;
  const currentIsTrump = trump !== undefined && current.card.suit === trump;
  if (playIsTrump !== currentIsTrump) return playIsTrump;
  if (play.card.suit === current.card.suit) return rankValue(play.card.rank) > rankValue(current.card.rank);
  return !playIsTrump && !currentIsTrump && play.card.suit === ledSuit && current.card.suit !== ledSuit;
}

function winningPlay(plays: PlayContext["currentTrick"], ledSuit: Suit, trump?: Suit) {
  return plays.reduce((current, play) => beats(play, current, ledSuit, trump) ? play : current);
}

function lowestCard(cards: Hand) {
  return [...cards].sort((a, b) => rankValue(a.rank) - rankValue(b.rank) || a.suit.localeCompare(b.suit))[0]!;
}

function topOfTouchingHonorSequence(cards: Hand) {
  const sequenceLeads = cards.filter((card) =>
    cards.some((other) => other.suit === card.suit && rankValue(card.rank) - rankValue(other.rank) === 1 && rankValue(card.rank) >= rankValue("J"))
  );
  return sequenceLeads.sort((a, b) => rankValue(b.rank) - rankValue(a.rank) || a.suit.localeCompare(b.suit))[0];
}

function fourthHighestFromLongestSuit(cards: Hand) {
  const longestSuit = suits
    .map((suit) => ({ suit, cards: cards.filter((card) => card.suit === suit) }))
    .sort((a, b) => b.cards.length - a.cards.length || suits.indexOf(a.suit) - suits.indexOf(b.suit))[0];
  if (!longestSuit || longestSuit.cards.length < 4) return undefined;
  return [...longestSuit.cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[3];
}

export class BeginnerBot implements BotPlayer {
  readonly config: BotConfig;
  readonly convention: ConventionSystem;

  constructor(config: BotConfig) {
    if (config.skill !== "beginner") throw new Error("Only beginner bot skill is currently implemented");
    this.config = config;
    this.convention = makeConvention(config.biddingStyle === "2/1" ? "2/1" : "SAYC");
  }

  async chooseBid(hand: Hand, auction: readonly PublicBid[], seat: Seat): Promise<Bid> {
    if (auction.length === 0 || auction.every(({ bid }) => bid === "pass")) {
      return this.convention.openingBid(hand);
    }

    const contractCalls = auction.filter(({ bid }) => bid !== "pass");
    const partner = SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!;
    const saycJumpShift = saycJumpShiftAuction(auction, this.convention.style);
    const saycMajorTwoLevelResponse = saycMajorTwoLevelResponseAuction(auction, this.convention.style);
    if (contractCalls.length === 4) {
      const [opening, response, openerRebid, responderRaise] = contractCalls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const minor = openerRebid?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      if (
        openingMajor && minor && opening?.seat === seat && response?.seat === partner && response.bid === "1notrump" &&
        openerRebid?.seat === seat && responderRaise?.seat === partner && responderRaise.bid === `3${minor}` &&
        hand.filter((card) => card.suit === minor).length >= 4 && points(hand) >= 16 &&
        suits.filter((suit) => suit !== minor).every((suit) => hasStopper(hand, suit)) &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid || bid === responderRaise.bid)
      ) return "3notrump";
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 2 && saycMajorTwoLevelResponse.opening.seat === seat &&
      isBalanced(hand) && points(hand) >= 18 && points(hand) <= 19
    ) return "2notrump";
    if (saycMajorTwoLevelResponse && contractCalls.length === 2 && saycMajorTwoLevelResponse.opening.seat === seat && points(hand) >= 19) {
      const responderSuitLength = hand.filter((card) => card.suit === saycMajorTwoLevelResponse.responseSuit).length;
      if (
        (saycMajorTwoLevelResponse.responseSuit === "hearts" || saycMajorTwoLevelResponse.responseSuit === "spades")
          ? responderSuitLength >= 3
          : responderSuitLength >= 4
      ) {
        return `3${saycMajorTwoLevelResponse.responseSuit}` as Bid;
      }
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const sideSuit = [...suitOrder].filter((suit) =>
        suit !== saycMajorTwoLevelResponse.openingSuit && suit !== saycMajorTwoLevelResponse.responseSuit &&
        hand.filter((card) => card.suit === suit).length >= 4
      ).sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
      if (sideSuit) return `3${sideSuit}` as Bid;
      if (hand.filter((card) => card.suit === saycMajorTwoLevelResponse.openingSuit).length >= 6) {
        return `3${saycMajorTwoLevelResponse.openingSuit}` as Bid;
      }
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 2 && saycMajorTwoLevelResponse.opening.seat === seat &&
      points(hand) >= 12 && points(hand) <= 18
    ) {
      const responseSuitLength = hand.filter((card) => card.suit === saycMajorTwoLevelResponse.responseSuit).length;
      const responseIsMajor = saycMajorTwoLevelResponse.responseSuit === "hearts" || saycMajorTwoLevelResponse.responseSuit === "spades";
      if (responseIsMajor && responseSuitLength >= 3) return `3${saycMajorTwoLevelResponse.responseSuit}` as Bid;
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const responseRank = suitOrder.indexOf(saycMajorTwoLevelResponse.responseSuit);
      const sideSuit = [...suitOrder]
        .filter((suit) => {
          if (suit === saycMajorTwoLevelResponse.openingSuit || suit === saycMajorTwoLevelResponse.responseSuit || hand.filter((card) => card.suit === suit).length < 4) return false;
          const isTwoLevelReverse = suitOrder.indexOf(suit) > responseRank &&
            suitOrder.indexOf(suit) > suitOrder.indexOf(saycMajorTwoLevelResponse.openingSuit);
          return !isTwoLevelReverse || points(hand) >= 16;
        })
        .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
      if (sideSuit) {
        const level = suitOrder.indexOf(sideSuit) > responseRank ? 2 : 3;
        return `${level}${sideSuit}` as Bid;
      }
      if (hand.filter((card) => card.suit === saycMajorTwoLevelResponse.openingSuit).length >= 5) {
        const level = suitOrder.indexOf(saycMajorTwoLevelResponse.openingSuit) > responseRank ? 2 : 3;
        return `${level}${saycMajorTwoLevelResponse.openingSuit}` as Bid;
      }
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 3 && saycMajorTwoLevelResponse.response.seat === seat &&
      contractCalls[2]?.bid === "2notrump"
    ) {
      return hand.filter((card) => card.suit === saycMajorTwoLevelResponse.openingSuit).length >= 3
        ? `4${saycMajorTwoLevelResponse.openingSuit}` as Bid
        : "3notrump";
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 3 && saycMajorTwoLevelResponse.response.seat === seat &&
      contractCalls[2]?.bid === `2${saycMajorTwoLevelResponse.openingSuit}`
    ) {
      const responderPoints = points(hand);
      const openingSupport = hand.filter((card) => card.suit === saycMajorTwoLevelResponse.openingSuit).length;
      if (openingSupport >= 3) {
        if (responderPoints >= 13) return `4${saycMajorTwoLevelResponse.openingSuit}` as Bid;
        if (responderPoints >= 10) return `3${saycMajorTwoLevelResponse.openingSuit}` as Bid;
      }
      if (hand.filter((card) => card.suit === saycMajorTwoLevelResponse.responseSuit).length >= 5 && responderPoints >= 10) {
        return `3${saycMajorTwoLevelResponse.responseSuit}` as Bid;
      }
      if (isBalanced(hand)) {
        if (responderPoints >= 13) return "3notrump";
        if (responderPoints >= 10) return "2notrump";
      }
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 3 && saycMajorTwoLevelResponse.response.seat === seat &&
      contractCalls[2]?.bid === `2${saycMajorTwoLevelResponse.openingSuit === "hearts" ? "spades" : "hearts"}`
    ) {
      const alternateMajor = saycMajorTwoLevelResponse.openingSuit === "hearts" ? "spades" : "hearts";
      if (
        alternateMajor === "hearts" && hand.filter((card) => card.suit === "hearts").length >= 3 &&
        points(hand) >= 10 && points(hand) <= 11
      ) return "3hearts";
      if (
        saycMajorTwoLevelResponse.openingSuit === "spades" && saycMajorTwoLevelResponse.responseSuit === "clubs" &&
        points(hand) >= 11 && points(hand) <= 12 &&
        hand.filter((card) => card.suit === "spades").length === 2
      ) return "2spades";
      if (
        saycMajorTwoLevelResponse.openingSuit === "spades" && saycMajorTwoLevelResponse.responseSuit === "clubs" &&
        points(hand) >= 10 && points(hand) <= 11 && hand.filter((card) => card.suit === "clubs").length >= 5 &&
        !(points(hand) === 11 && hand.filter((card) => card.suit === "spades").length === 2)
      ) return "3clubs";
      if (hand.filter((card) => card.suit === alternateMajor).length >= 4 && points(hand) >= 10) {
        return `3${alternateMajor}` as Bid;
      }
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 3 && saycMajorTwoLevelResponse.response.seat === seat &&
      saycMajorTwoLevelResponse.openingSuit === "spades" && saycMajorTwoLevelResponse.responseSuit === "clubs" &&
      contractCalls[2]?.bid === "2diamonds" && points(hand) >= 10 && points(hand) <= 12
    ) {
      const spades = hand.filter((card) => card.suit === "spades").length;
      const diamonds = hand.filter((card) => card.suit === "diamonds").length;
      const clubs = hand.filter((card) => card.suit === "clubs").length;
      if (points(hand) >= 11 && isBalanced(hand) && spades >= 3 && hasStopper(hand, "hearts")) return "2notrump";
      if (points(hand) >= 11 && clubs >= 6) return "3clubs";
      if (points(hand) >= 11 && diamonds >= 4) return "3diamonds";
      if (spades === 2) return "2spades";
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 3 && saycMajorTwoLevelResponse.response.seat === seat &&
      /^3(clubs|diamonds|hearts|spades)$/.test(contractCalls[2]?.bid ?? "")
    ) {
      const openerRebidSuit = contractCalls[2]!.bid.slice(1) as Suit;
      const support = hand.filter((card) => card.suit === openerRebidSuit).length;
      if ((openerRebidSuit === "hearts" || openerRebidSuit === "spades") && support >= 3) {
        return `4${openerRebidSuit}` as Bid;
      }
      if (saycMajorTwoLevelResponse.openingSuit === "hearts" && hand.filter((card) => card.suit === "hearts").length >= 3) return "4hearts";
      if (saycMajorTwoLevelResponse.openingSuit === "spades" && hand.filter((card) => card.suit === "spades").length >= 3) return "4spades";
      if ((openerRebidSuit === "clubs" || openerRebidSuit === "diamonds") && support >= 4) {
        return `5${openerRebidSuit}` as Bid;
      }
      if (isBalanced(hand)) return "3notrump";
      const longMajor = (["spades", "hearts"] as const).find((suit) => hand.filter((card) => card.suit === suit).length >= 5);
      if (longMajor) return `4${longMajor}` as Bid;
      const longMinor = (["diamonds", "clubs"] as const).find((suit) => hand.filter((card) => card.suit === suit).length >= 6);
      if (longMinor) return `5${longMinor}` as Bid;
      return "3notrump";
    }
    if (
      saycMajorTwoLevelResponse && contractCalls.length === 4 && saycMajorTwoLevelResponse.opening.seat === seat
    ) {
      const responderRebid = contractCalls[3]?.bid;
      const alternateMajor = saycMajorTwoLevelResponse.openingSuit === "hearts" ? "spades" : "hearts";
      if (contractCalls[2]?.bid === `2${alternateMajor}` && responderRebid === `3${alternateMajor}`) {
        return points(hand) >= 16 && hand.filter((card) => card.suit === alternateMajor).length >= 3
          ? `4${alternateMajor}` as Bid
          : "pass";
      }
      if (responderRebid === `3${saycMajorTwoLevelResponse.openingSuit}`) {
        const support = hand.filter((card) => card.suit === saycMajorTwoLevelResponse.openingSuit).length;
        return support >= 3 && points(hand) >= 16 ? `4${saycMajorTwoLevelResponse.openingSuit}` as Bid : "pass";
      }
      if (responderRebid === `3${saycMajorTwoLevelResponse.responseSuit}`) {
        return hand.filter((card) => card.suit === saycMajorTwoLevelResponse.responseSuit).length >= 3
          ? `4${saycMajorTwoLevelResponse.responseSuit}` as Bid
          : "3notrump";
      }
    }
    if (saycJumpShift && contractCalls.length === 2 && saycJumpShift.opening.seat === seat) {
      const support = hand.filter((card) => card.suit === saycJumpShift.responseSuit).length;
      if ((saycJumpShift.responseSuit === "hearts" || saycJumpShift.responseSuit === "spades") && support >= 3) {
        return `4${saycJumpShift.responseSuit}` as Bid;
      }
      if ((saycJumpShift.responseSuit === "clubs" || saycJumpShift.responseSuit === "diamonds") && support >= 5) {
        return `5${saycJumpShift.responseSuit}` as Bid;
      }
      if (isBalanced(hand) && points(hand) >= 18) return `${saycJumpShift.responseLevel}notrump` as Bid;
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const sideSuit = [...suitOrder]
        .filter((suit) => suit !== saycJumpShift.responseSuit && suit !== saycJumpShift.openingSuit && hand.filter((card) => card.suit === suit).length >= 4)
        .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
      if (sideSuit) {
        const level = saycJumpShift.responseLevel + (suitOrder.indexOf(sideSuit) < suitOrder.indexOf(saycJumpShift.responseSuit) ? 1 : 0);
        return `${level}${sideSuit}` as Bid;
      }
      const openingSuitLength = hand.filter((card) => card.suit === saycJumpShift.openingSuit).length;
      if (openingSuitLength >= 5) {
        const level = saycJumpShift.responseLevel + (suitOrder.indexOf(saycJumpShift.openingSuit) < suitOrder.indexOf(saycJumpShift.responseSuit) ? 1 : 0);
        return `${level}${saycJumpShift.openingSuit}` as Bid;
      }
      const openingSuitLevel = saycJumpShift.responseLevel + (suitOrder.indexOf(saycJumpShift.openingSuit) < suitOrder.indexOf(saycJumpShift.responseSuit) ? 1 : 0);
      return `${openingSuitLevel}${saycJumpShift.openingSuit}` as Bid;
    }
    if (saycJumpShift && contractCalls.length === 3 && saycJumpShift.response.seat === seat) {
      const openerRebid = contractCalls[2]?.bid;
      if (openerRebid === "3notrump" || openerRebid === "4hearts" || openerRebid === "4spades" || openerRebid === "5clubs" || openerRebid === "5diamonds") {
        return "pass";
      }
      if (openerRebid === "2notrump") return "3notrump";
      const shownMajor = openerRebid?.match(/^[23](hearts|spades)$/)?.[1] as Suit | undefined;
      if (shownMajor && hand.filter((card) => card.suit === shownMajor).length >= 3) return `4${shownMajor}` as Bid;
      if (saycJumpShift.openingSuit === "hearts" && hand.filter((card) => card.suit === "hearts").length >= 3) return "4hearts";
      if (saycJumpShift.openingSuit === "spades" && hand.filter((card) => card.suit === "spades").length >= 3) return "4spades";
      const longMajor = (["spades", "hearts"] as const).find((suit) => hand.filter((card) => card.suit === suit).length >= 5);
      if (longMajor) return `4${longMajor}` as Bid;
      const responseLength = hand.filter((card) => card.suit === saycJumpShift.responseSuit).length;
      if (responseLength >= 6) {
        return saycJumpShift.responseSuit === "hearts" || saycJumpShift.responseSuit === "spades"
          ? `4${saycJumpShift.responseSuit}` as Bid
          : `5${saycJumpShift.responseSuit}` as Bid;
      }
      const openerLevel = Number(openerRebid?.[0] ?? 0);
      if (isBalanced(hand) && openerLevel < 4) return "3notrump";
      const longMinor = (["diamonds", "clubs"] as const).find((suit) => hand.filter((card) => card.suit === suit).length >= 6);
      if (longMinor) return `5${longMinor}` as Bid;
      return openerLevel < 3 ? "3notrump" : "4notrump";
    }
    if (contractCalls.length === 3) {
      const [opening, response, rebid] = contractCalls;
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const bidSuit = (bid: Bid | undefined) => bid?.match(/^[1-7](clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const openingSuit = bidSuit(opening?.bid);
      const responseSuit = bidSuit(response?.bid);
      const rebidSuit = bidSuit(rebid?.bid);
      if (
        opening?.seat === partner && response?.seat === seat && rebid?.seat === partner &&
        response.bid.startsWith("1") && openingSuit && responseSuit && rebidSuit &&
        new Set([openingSuit, responseSuit, rebidSuit]).size === 3 && points(hand) >= 10 &&
        !passedBeforeOpening(auction, seat, opening)
      ) {
        const fourthSuit = suitOrder.find((suit) => ![openingSuit, responseSuit, rebidSuit].includes(suit))!;
        const lastCall = contractCalls.at(-1)!.bid;
        const lastLevel = Number(lastCall[0]);
        const lastSuit = bidSuit(lastCall)!;
        const level = suitOrder.indexOf(fourthSuit) > suitOrder.indexOf(lastSuit) ? lastLevel : lastLevel + 1;
        return `${level}${fourthSuit}` as Bid;
      }
    }
    if (contractCalls.length === 4) {
      const [opening, response, rebid, fourthSuitCall] = contractCalls;
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const bidSuit = (bid: Bid | undefined) => bid?.match(/^[1-7](clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const openingSuit = bidSuit(opening?.bid);
      const responseSuit = bidSuit(response?.bid);
      const rebidSuit = bidSuit(rebid?.bid);
      const fourthSuit = bidSuit(fourthSuitCall?.bid);
      if (
        opening?.seat === seat && response?.seat === partner && rebid?.seat === seat && fourthSuitCall?.seat === partner &&
        response.bid.startsWith("1") && openingSuit && responseSuit && rebidSuit && fourthSuit &&
        new Set([openingSuit, responseSuit, rebidSuit, fourthSuit]).size === 4
      ) {
        const lastLevel = Number(fourthSuitCall.bid[0]);
        const lastRank = suitOrder.indexOf(fourthSuit);
        const makeCall = (suit: Suit) => {
          const level = suitOrder.indexOf(suit) > lastRank ? lastLevel : lastLevel + 1;
          return `${level}${suit}` as Bid;
        };
        if (hand.filter((card) => card.suit === responseSuit).length >= 3) return makeCall(responseSuit);
        const fourthSuitCards = hand.filter((card) => card.suit === fourthSuit);
        const hasFourthSuitStopper = fourthSuitCards.some((card) => card.rank === "A") ||
          (fourthSuitCards.length >= 2 && fourthSuitCards.some((card) => card.rank === "K")) ||
          (fourthSuitCards.length >= 3 && fourthSuitCards.some((card) => card.rank === "Q"));
        if (isBalanced(hand) && hasFourthSuitStopper) {
          return `${lastLevel}notrump` as Bid;
        }
        return makeCall(openingSuit);
      }
    }
    if (contractCalls.length === 2) {
      const [opening, response] = contractCalls;
      if (
        opening?.seat === seat && response?.seat === partner && response.bid === "4notrump" &&
        ((opening.bid === "1notrump" && points(hand) >= 17) || (opening.bid === "2notrump" && points(hand) >= 21))
      ) return "6notrump";
      if (opening?.seat === seat && opening.bid === "1notrump" && response?.seat === partner) {
        const invitationalMinor = response.bid.match(/^3(clubs|diamonds)$/)?.[1] as Suit | undefined;
        if (invitationalMinor) {
          const cards = hand.filter((card) => card.suit === invitationalMinor);
          if (cards.length >= 2 && cards.some((card) => ["A", "K", "Q"].includes(card.rank))) return "3notrump";
          return "pass";
        }
        if (response.bid === "2spades") return "3clubs";
        if (response.bid === "2clubs") {
          if (hand.filter((card) => card.suit === "hearts").length >= 4) return "2hearts";
          if (hand.filter((card) => card.suit === "spades").length >= 4) return "2spades";
          return "2diamonds";
        }
        const transferSuit = response.bid === "2diamonds" ? "hearts" : response.bid === "2hearts" ? "spades" : undefined;
        if (transferSuit && points(hand) >= 17 && hand.filter((card) => card.suit === transferSuit).length >= 4) {
          return `3${transferSuit}` as Bid;
        }
        if (transferSuit) return `2${transferSuit}` as Bid;
      }
      const jacobyMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (opening?.seat === seat && response?.seat === partner && jacobyMajor && response.bid === "2notrump") {
        const shortSuit = suits
          .filter((suit) => suit !== jacobyMajor)
          .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
          .filter(({ length }) => length <= 1)
          .sort((a, b) => a.length - b.length || suits.indexOf(a.suit) - suits.indexOf(b.suit))[0]?.suit;
        if (shortSuit) return `3${shortSuit}` as Bid;
        return `4${jacobyMajor}` as Bid;
      }
      const positiveSuit = response?.bid.match(/^(2hearts|2spades|3clubs|3diamonds)$/)?.[0].slice(1) as Suit | undefined;
      if (opening?.seat === seat && opening.bid === "2clubs" && response?.seat === partner && response.bid === "2notrump") {
        return "3notrump";
      }
      if (opening?.seat === seat && opening.bid === "2clubs" && response?.seat === partner && positiveSuit) {
        const support = hand.filter((card) => card.suit === positiveSuit).length;
        if (support >= 3) return `${positiveSuit === "hearts" || positiveSuit === "spades" ? 4 : 5}${positiveSuit}` as Bid;
        if (isBalanced(hand)) return "3notrump";
        const sideSuit = (["spades", "hearts", "diamonds", "clubs"] as const)
          .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
          .filter(({ suit, length }) => suit !== positiveSuit && length >= 5)
          .sort((a, b) => b.length - a.length)[0]?.suit;
        if (sideSuit) return atLegalLevel(`2${sideSuit}` as Bid, auction);
        return "3notrump";
      }
      if (opening?.seat === seat && response?.seat === partner && opening.bid === "2clubs" && response.bid === "2diamonds") {
        const hcp = points(hand);
        if (isBalanced(hand) && hcp >= 22 && hcp <= 24) return "2notrump";
        if (isBalanced(hand) && hcp >= 25 && hcp <= 27) return "3notrump";
        if (isBalanced(hand) && hcp >= 28) return "4notrump";
        const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
        const rebidSuit = [...suitOrder]
          .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
          .sort((a, b) => b.length - a.length || suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit))[0]!.suit;
        return `${rebidSuit === "clubs" || rebidSuit === "diamonds" ? 3 : 2}${rebidSuit}` as Bid;
      }
      if (opening?.seat === seat && response?.seat === partner && opening.bid === "2notrump") {
        if (response.bid === "3clubs") {
          if (hand.filter((card) => card.suit === "hearts").length >= 4) return "3hearts";
          if (hand.filter((card) => card.suit === "spades").length >= 4) return "3spades";
          return "3diamonds";
        }
        if (response.bid === "3diamonds") return "3hearts";
        if (response.bid === "3hearts") return "3spades";
      }
    }
    if (contractCalls.length === 3) {
      const [opening, minorRelay, openerResponse] = contractCalls;
      if (
        opening?.seat === partner && opening.bid === "1notrump" && minorRelay?.seat === seat && minorRelay.bid === "2spades" &&
        openerResponse?.seat === partner && openerResponse.bid === "3clubs"
      ) {
        const clubs = hand.filter((card) => card.suit === "clubs").length;
        const diamonds = hand.filter((card) => card.suit === "diamonds").length;
        if (Math.max(clubs, diamonds) >= 6) return clubs > diamonds ? "pass" : "3diamonds";
      }
    }
    if (contractCalls.length === 4) {
      const [ntOpening, ntStayman, ntHeartReply, ntAlternateMajor] = contractCalls;
      if (
        ntOpening?.seat === seat && ntOpening.bid === "1notrump" && ntStayman?.bid === "2clubs" &&
        ntHeartReply?.bid === "2hearts" && ntAlternateMajor?.seat === partner && ntAlternateMajor.bid === "2spades"
      ) {
        return hand.filter((card) => card.suit === "spades").length >= 3 ? "3spades" : "2notrump";
      }
      const [staymanOpening, staymanCall, shownMajor, majorInvite] = contractCalls;
      const invitedMajor = shownMajor?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        staymanOpening?.seat === seat && staymanOpening.bid === "1notrump" && staymanCall?.bid === "2clubs" &&
        invitedMajor && majorInvite?.seat === partner && majorInvite.bid === `3${invitedMajor}`
      ) {
        return hand.filter((card) => card.suit === invitedMajor).length >= 4 && points(hand) >= 16
          ? `4${invitedMajor}` as Bid
          : "pass";
      }
      const [strongOpening, waiting, notrumpRebid, response] = contractCalls;
      if (
        strongOpening?.seat === seat && strongOpening.bid === "2clubs" && waiting?.bid === "2diamonds" &&
        notrumpRebid?.bid === "2notrump" && response?.seat === partner
      ) {
        if (response.bid === "3clubs") {
          if (hand.filter((card) => card.suit === "hearts").length >= 4) return "3hearts";
          if (hand.filter((card) => card.suit === "spades").length >= 4) return "3spades";
          return "3diamonds";
        }
        if (response.bid === "3diamonds") return "3hearts";
        if (response.bid === "3hearts") return "3spades";
      }
      const [opening, stayman, heartReply, alternateMajor] = contractCalls;
      if (
        opening?.seat === seat && opening.bid === "2notrump" && stayman?.bid === "3clubs" &&
        heartReply?.bid === "3hearts" && alternateMajor?.bid === "3spades" && alternateMajor.seat === partner
      ) {
        return hand.filter((card) => card.suit === "spades").length >= 4 ? "4spades" : "3notrump";
      }
    }
    const openingDouble = auction.length === 2 && auction[0]?.seat === partner &&
      /^1(clubs|diamonds|hearts|spades)$/.test(auction[0].bid) && auction[1]?.bid === "double";
    const expectedResponder = auction[0] ? SEATS[(SEATS.indexOf(auction[0].seat) + 2) % SEATS.length]! : undefined;
    if (openingDouble && expectedResponder === seat && points(hand) >= 10) {
      const openingSuit = auction[0]!.bid.slice(1) as Suit;
      const support = hand.filter((card) => card.suit === openingSuit).length;
      const supportThreshold = openingSuit === "hearts" || openingSuit === "spades" ? 4 : 5;
      if (support >= supportThreshold) return "2notrump";
      return "redouble";
    }
    if (contractCalls.length === 2) {
      const [opening, interference] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const overcall = interference?.bid.match(/^([12])(clubs|diamonds|hearts|spades)$/);
      const overcallLevel = overcall?.[1];
      const overcallSuit = overcall?.[2] as Suit | undefined;
      const expectedResponder = opening ? SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]! : undefined;
      if (
        auction.length === 3 && opening && openingSuit && opening.seat !== seat && opening.seat !== partner &&
        interference?.bid === "1notrump" && interference.seat === partner &&
        auction[2]?.seat === expectedResponder && auction[2]?.bid === "pass" &&
        seat === SEATS[(SEATS.indexOf(partner) + 2) % SEATS.length]! && points(hand) >= 8 &&
        (hand.filter((card) => card.suit === "hearts").length >= 4 || hand.filter((card) => card.suit === "spades").length >= 4)
      ) return "2clubs";
      if (
        auction.length === 3 && opening && openingSuit && opening.seat !== seat && opening.seat !== partner &&
        interference?.bid === "1notrump" && interference.seat === partner &&
        auction[2]?.seat === expectedResponder && auction[2]?.bid === "pass" &&
        seat === SEATS[(SEATS.indexOf(partner) + 2) % SEATS.length]! && points(hand) >= 6
      ) {
        const naturalSuit = ["hearts", "spades", "diamonds", "clubs"]
          .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
          .filter(({ suit, length }) => length >= (suit === "clubs" ? 6 : 5))
          .sort((a, b) => b.length - a.length || Number(b.suit === "hearts" || b.suit === "spades") - Number(a.suit === "hearts" || a.suit === "spades") || ["clubs", "diamonds", "hearts", "spades"].indexOf(b.suit) - ["clubs", "diamonds", "hearts", "spades"].indexOf(a.suit))[0];
        if (naturalSuit) return `${naturalSuit.suit === "clubs" ? 3 : 2}${naturalSuit.suit}` as Bid;
      }
      if (
        auction.length === 3 && opening && openingSuit && opening.seat !== seat && opening.seat !== partner &&
        interference?.bid === "1notrump" && interference.seat === partner &&
        auction[2]?.seat === expectedResponder && auction[2]?.bid === "pass" &&
        seat === SEATS[(SEATS.indexOf(partner) + 2) % SEATS.length]! && isBalanced(hand)
      ) {
        const responderPoints = points(hand);
        const hasFourCardMajor = hand.some((card) =>
          (card.suit === "hearts" || card.suit === "spades") && hand.filter((candidate) => candidate.suit === card.suit).length >= 4
        );
        if (!hasFourCardMajor && responderPoints >= 10) return "3notrump";
        if (!hasFourCardMajor && responderPoints >= 8) return "2notrump";
      }
      if (
        opening?.seat === partner && expectedResponder === seat && openingSuit &&
        (interference?.bid === "double" || overcallSuit) && interference?.seat !== seat
      ) {
        const balanced = isBalanced(hand);
        const responderPoints = points(hand);
        const overcallSuitCards = overcallSuit ? hand.filter((card) => card.suit === overcallSuit) : [];
        const hasStopper = overcallSuitCards.some((card) => card.rank === "A") ||
          (overcallSuitCards.length >= 2 && overcallSuitCards.some((card) => card.rank === "K")) ||
          (overcallSuitCards.length >= 3 && overcallSuitCards.some((card) => card.rank === "Q"));
        const majorSupport = hand.filter((card) => card.suit === openingSuit).length;
        const otherMajor = overcallSuit === "hearts" ? "spades" : overcallSuit === "spades" ? "hearts" : undefined;
        if (
          (openingSuit === "clubs" || openingSuit === "diamonds") && overcallLevel === "1" && overcallSuit &&
          majorSupport >= 3 && responderPoints >= 10
        ) return `2${overcallSuit}` as Bid;
        if (
          (openingSuit === "hearts" || openingSuit === "spades") && overcallLevel && overcallSuit &&
          majorSupport >= 3 && responderPoints >= 10
        ) return `${Number(overcallLevel) + 1}${overcallSuit}` as Bid;
        if (
          (openingSuit === "hearts" || openingSuit === "spades") && overcallLevel === "1" &&
          (overcallSuit === "clubs" || overcallSuit === "diamonds" || overcallSuit === "hearts" || overcallSuit === "spades") &&
          responderPoints >= 6
        ) {
          const oneLevelOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
          const availableSuit = oneLevelOrder
            .filter((suit) => suit !== openingSuit && oneLevelOrder.indexOf(suit) > oneLevelOrder.indexOf(overcallSuit))
            .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
            .filter(({ length }) => length >= 4)
            .sort((a, b) => b.length - a.length || oneLevelOrder.indexOf(b.suit) - oneLevelOrder.indexOf(a.suit))[0];
          if (availableSuit) return `1${availableSuit.suit}` as Bid;
        }
        if ((openingSuit === "hearts" || openingSuit === "spades") && overcallLevel === "1" && overcallSuit && responderPoints >= 10) {
          const newSuit = suits
            .filter((suit) => suit !== openingSuit && suit !== overcallSuit)
            .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
            .filter(({ length }) => length >= 5)
            .sort((a, b) => b.length - a.length || suits.indexOf(a.suit) - suits.indexOf(b.suit))[0];
          if (newSuit) return `2${newSuit.suit}` as Bid;
        }
        if (
          (openingSuit === "hearts" || openingSuit === "spades") && overcallLevel === "1" &&
          (overcallSuit === "hearts" || overcallSuit === "spades") && overcallSuit !== openingSuit && responderPoints >= 6 &&
          hand.filter((card) => card.suit === "diamonds").length >= 4
        ) return "double";
        if (
          (openingSuit === "clubs" || openingSuit === "diamonds") && responderPoints >= 6 &&
          (interference?.bid === "double" || (overcallLevel === "1" && overcallSuit))
        ) {
          const highestAvailableSuit = overcallSuit ?? openingSuit;
          const availableSuits = suits
            .filter((suit) => suits.indexOf(suit) < suits.indexOf(highestAvailableSuit))
            .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
            .filter(({ suit, length }) => length >= (overcallSuit === "hearts" && suit === "spades" ? 5 : 4))
            .sort((a, b) => b.length - a.length || suits.indexOf(a.suit) - suits.indexOf(b.suit));
          if (availableSuits[0]) return `1${availableSuits[0].suit}` as Bid;
        }
        if (
          (openingSuit === "clubs" || openingSuit === "diamonds") && overcallLevel === "1" && otherMajor && responderPoints >= 6 &&
          hand.filter((card) => card.suit === otherMajor).length >= 4
        ) return "double";
        if (
          (openingSuit === "hearts" || openingSuit === "spades") &&
          (interference?.bid === "double" || (overcallSuit && (overcallLevel === "1" || overcallLevel === "2"))) &&
          majorSupport >= 3 && responderPoints >= 6 && responderPoints <= 9
        ) {
          return `${overcallLevel === "2" ? 3 : 2}${openingSuit}` as Bid;
        }
        if ((openingSuit === "clubs" || openingSuit === "diamonds") && overcallLevel === "1" && overcallSuit && majorSupport >= 5 && responderPoints >= 6 && responderPoints <= 9) {
          return `2${openingSuit}` as Bid;
        }
        if (
          openingSuit === "spades" && overcallLevel === "2" && overcallSuit === "hearts" && responderPoints >= 6 &&
          hand.filter((card) => card.suit === "diamonds").length >= 4
        ) return "double";
        if (
          (openingSuit === "hearts" || openingSuit === "spades") && overcallLevel === "2" &&
          (overcallSuit === "clubs" || overcallSuit === "diamonds") && responderPoints >= 6 &&
          hand.filter((card) => card.suit === (openingSuit === "hearts" ? "spades" : "hearts")).length >= 4
        ) return "double";
        if (balanced && responderPoints >= 6 && responderPoints <= 9 && (interference?.bid === "double" || (overcallLevel === "1" && hasStopper))) return "1notrump";
        if (balanced && responderPoints >= 10 && responderPoints <= 12 && overcallLevel === "2" && hasStopper) return "2notrump";
        return "pass";
      }
    }
    if (contractCalls.length === 4) {
      const [inviteOpening, inviteResponse, inviteRebid, responderInvite] = contractCalls;
      const openingMajor = inviteOpening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        this.convention.style === "SAYC" && inviteOpening && inviteResponse && inviteRebid && responderInvite && openingMajor &&
        inviteOpening.seat === seat && inviteResponse.seat === partner && inviteResponse.bid.match(/^2(clubs|diamonds)$/) &&
        inviteRebid.seat === seat && inviteRebid.bid === `2${openingMajor}` &&
        responderInvite.seat === partner && responderInvite.bid === `3${openingMajor}` && points(hand) >= 16 &&
        auction.every(({ bid }) => bid === "pass" || bid === inviteOpening.bid || bid === inviteResponse.bid || bid === inviteRebid.bid || bid === responderInvite.bid)
      ) return `4${openingMajor}` as Bid;
      if (
        this.convention.style === "SAYC" && inviteOpening && inviteResponse && inviteRebid && responderInvite && openingMajor &&
        inviteOpening.seat === seat && inviteResponse.seat === partner && inviteResponse.bid.match(/^2(clubs|diamonds)$/) &&
        inviteRebid.seat === seat && inviteRebid.bid === `2${openingMajor}` &&
        responderInvite.seat === partner && responderInvite.bid === "2notrump" && points(hand) >= 16 &&
        auction.every(({ bid }) => bid === "pass" || bid === inviteOpening.bid || bid === inviteResponse.bid || bid === inviteRebid.bid || bid === responderInvite.bid)
      ) return "3notrump";
      const [competitiveOpening, interference, response, competitiveRebid] = contractCalls;
      if (
        competitiveOpening?.seat === partner && competitiveOpening.bid === "1hearts" && interference?.bid === "1diamonds" &&
        interference.seat !== seat && interference.seat !== partner && response?.seat === seat && response.bid === "1spades" &&
        competitiveRebid?.seat === partner && competitiveRebid.bid === "1notrump"
      ) {
        const responderPoints = points(hand);
        const spadeLength = hand.filter((card) => card.suit === "spades").length;
        if (spadeLength >= 5 && responderPoints >= 13) return "4spades";
        if (spadeLength >= 5 && responderPoints >= 10) return "3spades";
        if (isBalanced(hand) && responderPoints >= 13) return "3notrump";
        if (isBalanced(hand) && responderPoints >= 10) return "2notrump";
      }
      const [opening, stayman, denial, majorRebid] = contractCalls;
      const responderMajor = majorRebid?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === seat && opening.bid === "1notrump" && stayman?.seat === partner && stayman.bid === "2clubs" &&
        denial?.seat === seat && denial.bid === "2diamonds" && majorRebid?.seat === partner && responderMajor &&
        hand.filter((card) => card.suit === responderMajor).length >= 3
      ) return `3${responderMajor}` as Bid;
    }
    if (contractCalls.length === 5) {
      const [fitOpening, fitResponse, fitOpenerRebid, responderMajorBid, openerMajorRaise] = contractCalls;
      const fitOpeningMajor = fitOpening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const fitResponseSuit = fitResponse?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const fitShownSuit = fitOpenerRebid?.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const major = openerMajorRaise?.bid.match(/^3(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        this.convention.style === "SAYC" && major && fitOpeningMajor && fitResponseSuit && fitShownSuit &&
        major !== fitOpeningMajor && major !== fitResponseSuit && major !== fitShownSuit && fitShownSuit !== fitOpeningMajor && fitShownSuit !== fitResponseSuit &&
        fitOpening?.seat === partner && fitResponse?.seat === seat &&
        fitOpenerRebid?.seat === partner && responderMajorBid?.seat === seat && responderMajorBid.bid === `2${major}` &&
        openerMajorRaise?.seat === partner && !passedBeforeOpening(auction, seat, fitOpening) &&
        auction.every(({ bid }) => bid === "pass" || bid === fitOpening.bid || bid === fitResponse.bid || bid === fitOpenerRebid.bid || bid === responderMajorBid.bid || bid === openerMajorRaise.bid)
      ) return hand.filter((card) => card.suit === major).length >= 4 && points(hand) >= 12 ? `4${major}` as Bid : "pass";
      const [ntOpening, stayman, heartReply, alternateMajor, openerRaise] = contractCalls;
      if (
        ntOpening?.seat === partner && ntOpening.bid === "1notrump" && stayman?.bid === "2clubs" &&
        heartReply?.bid === "2hearts" && alternateMajor?.seat === seat && alternateMajor.bid === "2spades" &&
        openerRaise?.seat === partner && openerRaise.bid === "3spades"
      ) {
        return hand.filter((card) => card.suit === "spades").length >= 4 && points(hand) >= 10 ? "4spades" : "pass";
      }
      const [opening, waiting, notrumpRebid, response, reply] = contractCalls;
      if (
        opening?.seat === partner && opening.bid === "2clubs" && waiting?.bid === "2diamonds" &&
        notrumpRebid?.bid === "2notrump" && response?.seat === seat && reply?.seat === partner
      ) {
        if (response.bid === "3clubs") {
          if (reply.bid === "3diamonds") return "3notrump";
          if (reply.bid === "3hearts" && hand.filter((card) => card.suit === "hearts").length >= 4) return "4hearts";
          if (reply.bid === "3spades" && hand.filter((card) => card.suit === "spades").length >= 4) return "4spades";
          if (reply.bid === "3hearts" && hand.filter((card) => card.suit === "spades").length >= 4) return "3spades";
          if (reply.bid === "3hearts" || reply.bid === "3spades") return "3notrump";
        }
        if (response.bid === "3diamonds" && reply.bid === "3hearts") {
          return hand.filter((card) => card.suit === "hearts").length >= 5 && points(hand) >= 5 ? "4hearts" : "pass";
        }
        if (response.bid === "3hearts" && reply.bid === "3spades") {
          return hand.filter((card) => card.suit === "spades").length >= 5 && points(hand) >= 5 ? "4spades" : "pass";
        }
      }
    }
    if (contractCalls.length === 3) {
      const [opening, response, rebid] = contractCalls;
      if (
        opening?.seat === seat && opening.bid === "1hearts" && response?.bid === "1diamonds" &&
        response.seat !== seat && response.seat !== partner && rebid?.seat === partner && rebid.bid === "1spades"
      ) {
        const openerPoints = points(hand);
        if (hand.filter((card) => card.suit === "spades").length >= 4) {
          if (openerPoints >= 19) return "4spades";
          if (openerPoints >= 16) return "3spades";
          if (openerPoints >= 12) return "2spades";
        }
        const heartLength = hand.filter((card) => card.suit === "hearts").length;
        if (heartLength >= 6 && openerPoints >= 16 && openerPoints <= 18) return "3hearts";
        if (heartLength >= 6 && openerPoints >= 12 && openerPoints <= 15) return "2hearts";
        const diamondCards = hand.filter((card) => card.suit === "diamonds");
        const hasDiamondStopper = diamondCards.some((card) => card.rank === "A") ||
          (diamondCards.length >= 2 && diamondCards.some((card) => card.rank === "K")) ||
          (diamondCards.length >= 3 && diamondCards.some((card) => card.rank === "Q"));
        if (heartLength < 6 && isBalanced(hand) && openerPoints >= 18 && openerPoints <= 19 && hasDiamondStopper) {
          return "2notrump";
        }
        if (
          heartLength < 6 && isBalanced(hand) &&
          openerPoints >= 12 && openerPoints <= 14 && hasDiamondStopper
        ) return "1notrump";
      }
      const jumpRebidMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && jumpRebidMajor && response?.seat === seat && response.bid === "1notrump" &&
        rebid?.seat === partner && rebid.bid === `3${jumpRebidMajor}`
      ) {
        const acceptancePoints = this.convention.style === "SAYC" ? 8 : 10;
        return points(hand) >= acceptancePoints ? `4${jumpRebidMajor}` as Bid : "pass";
      }
      const responseMajor = response?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        auction.length === 5 && auction[1]?.bid === "pass" && auction[3]?.bid === "pass" &&
        opening?.seat === partner && response?.seat === seat && responseMajor && rebid?.seat === partner &&
        rebid.bid === `3${responseMajor}`
      ) return points(hand) >= 10 ? `4${responseMajor}` as Bid : "pass";
      if (
        opening?.seat === partner && opening.bid === "1hearts" && response?.seat === seat &&
        response.bid === "1notrump" && rebid?.seat === partner && rebid.bid === "2spades"
      ) {
        const spadeSupport = hand.filter((card) => card.suit === "spades").length;
        const heartSupport = hand.filter((card) => card.suit === "hearts").length;
        if (spadeSupport >= 3) return "3spades";
        if (heartSupport >= 3) return "3hearts";
        const spades = hand.filter((card) => card.suit === "spades");
        const hasSpadeStopper = spades.some((card) => card.rank === "A") ||
          (spades.length >= 2 && spades.some((card) => card.rank === "K")) ||
          (spades.length >= 3 && spades.some((card) => card.rank === "Q"));
        if (hasSpadeStopper && points(hand) >= 13) return "3notrump";
        if (hasSpadeStopper && points(hand) >= 6) return "2notrump";
        const minor = (["diamonds", "clubs"] as const)
          .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
          .filter(({ length }) => length >= 4)
          .sort((a, b) => b.length - a.length || (a.suit === "diamonds" ? -1 : 1))[0]?.suit;
        if (minor) return `3${minor}` as Bid;
        return "3hearts";
      }
      if (
        opening?.seat === partner && opening.bid === "1notrump" && response?.seat === seat && rebid?.seat === partner
      ) {
        const responderPoints = points(hand);
        if (response.bid === "2clubs") {
          if (rebid.bid === "2diamonds") {
            if (hand.filter((card) => card.suit === "hearts").length >= 5) return "2hearts";
            if (hand.filter((card) => card.suit === "spades").length >= 5) return "2spades";
            if (isBalanced(hand) && responderPoints >= 10) return "3notrump";
            if (isBalanced(hand) && responderPoints >= 8) return "2notrump";
            return "pass";
          }
          const shownMajor = rebid.bid === "2hearts" || rebid.bid === "2spades" ? rebid.bid.slice(1) as Suit : undefined;
          if (shownMajor) {
            const shownSupport = hand.filter((card) => card.suit === shownMajor).length;
            if (shownSupport >= 4) {
              if (responderPoints >= 10) return `4${shownMajor}` as Bid;
              if (responderPoints >= 8) return `3${shownMajor}` as Bid;
            }
            const otherMajor = shownMajor === "hearts" ? "spades" : "hearts";
            // Opener's 2 spades denies four hearts, so only the spade suit is still worth showing at the two level.
            if (otherMajor === "spades" && hand.filter((card) => card.suit === otherMajor).length >= 4) return `2${otherMajor}` as Bid;
            if (isBalanced(hand) && responderPoints >= 10) return "3notrump";
            if (isBalanced(hand) && responderPoints >= 8) return "2notrump";
            return "pass";
          }
        }
        const transferSuit = response.bid === "2diamonds" ? "hearts" : response.bid === "2hearts" ? "spades" : undefined;
        if (transferSuit && (rebid.bid === `2${transferSuit}` || rebid.bid === `3${transferSuit}`)) {
          const suitLength = hand.filter((card) => card.suit === transferSuit).length;
          if (rebid.bid === `3${transferSuit}`) return responderPoints >= 8 ? `4${transferSuit}` as Bid : "pass";
          if (suitLength >= 6 && responderPoints >= 10) return `4${transferSuit}` as Bid;
          if (suitLength >= 6 && responderPoints >= 8) return `3${transferSuit}` as Bid;
          if (suitLength === 5 && responderPoints >= 10) return "3notrump";
          if (responderPoints >= 8) return "2notrump";
          return "pass";
        }
      }
    }
    if (contractCalls.length === 3) {
      const [opening, response, rebid] = contractCalls;
      const jacobyMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const jacobyShortSuit = rebid?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && jacobyMajor && response?.seat === seat && response.bid === "2notrump" &&
        rebid?.seat === partner && jacobyShortSuit && jacobyShortSuit !== jacobyMajor
      ) return `4${jacobyMajor}` as Bid;
      if (
        opening?.seat === partner && opening.bid === "2clubs" && response?.seat === seat &&
        response.bid === "2diamonds" && rebid?.seat === partner
      ) {
        if (rebid.bid === "2notrump") return respondToTwoNotrump(hand);
        if (rebid.bid === "3notrump") return "pass";
        const rebidSuit = rebid.bid.match(/^[23](clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
        if (rebidSuit === "hearts" || rebidSuit === "spades") {
          if (hand.filter((card) => card.suit === rebidSuit).length >= 3) return `4${rebidSuit}` as Bid;
        }
        if (rebidSuit === "clubs" || rebidSuit === "diamonds") {
          if (hand.filter((card) => card.suit === rebidSuit).length >= 4) return `5${rebidSuit}` as Bid;
        }
        if (isBalanced(hand) && points(hand) >= 8) {
          const suitCards = rebidSuit ? hand.filter((card) => card.suit === rebidSuit) : [];
          const hasStopper = suitCards.some((card) => card.rank === "A") ||
            (suitCards.length >= 2 && suitCards.some((card) => card.rank === "K")) ||
            (suitCards.length >= 3 && suitCards.some((card) => card.rank === "Q"));
          if (hasStopper) return "3notrump";
        }
        return "pass";
      }
      if (
        opening?.seat === partner && opening.bid === "2notrump" && response?.seat === seat && rebid?.seat === partner
      ) {
        if (response.bid === "3clubs") {
          if (rebid.bid === "3diamonds") return "3notrump";
          if (rebid.bid === "3hearts" && hand.filter((card) => card.suit === "hearts").length >= 4) return "4hearts";
          if (rebid.bid === "3spades" && hand.filter((card) => card.suit === "spades").length >= 4) return "4spades";
          if (rebid.bid === "3hearts" && hand.filter((card) => card.suit === "spades").length >= 4) return "3spades";
          if (rebid.bid === "3hearts" || rebid.bid === "3spades") return "3notrump";
        }
        if (response.bid === "3diamonds" && rebid.bid === "3hearts") {
          return hand.filter((card) => card.suit === "hearts").length >= 5 && points(hand) >= 5 ? "4hearts" : "pass";
        }
        if (response.bid === "3hearts" && rebid.bid === "3spades") {
          return hand.filter((card) => card.suit === "spades").length >= 5 && points(hand) >= 5 ? "4spades" : "pass";
        }
      }
      const doubledOpeningSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        auction.length === 5 && opening && doubledOpeningSuit && response?.bid === "1notrump" &&
        response.seat === seat && rebid?.bid === "2clubs" && rebid.seat === partner &&
        opening.seat !== seat && opening.seat !== partner && auction[2]?.bid === "pass" &&
        auction[4]?.seat === opening.seat && auction[4].bid === "pass"
      ) {
        if (hand.filter((card) => card.suit === "hearts").length >= 4) return "2hearts";
        if (hand.filter((card) => card.suit === "spades").length >= 4) return "2spades";
        return "2diamonds";
      }
      if (
        opening?.seat === seat && response?.bid === "double" && response.seat !== seat &&
        rebid?.seat === partner && rebid.bid === "2notrump" && doubledOpeningSuit
      ) return `${points(hand) >= 15 ? 4 : 3}${doubledOpeningSuit}` as Bid;
      if (
        opening?.seat === partner && response?.seat === seat && rebid?.seat === partner &&
        /^1(clubs|diamonds|hearts|spades)$/.test(opening.bid) && response.bid === "1notrump" && rebid.bid === "2notrump"
      ) {
        const gameValues = opening.bid === "1clubs" || opening.bid === "1diamonds" ? 8 : 6;
        return points(hand) >= gameValues ? "3notrump" : "pass";
      }
      const minorOpening = opening?.bid === "1clubs" || opening?.bid === "1diamonds";
      const majorResponse = response?.bid === "1hearts" || response?.bid === "1spades";
      if (
        opening && response && rebid && opening.seat === partner && minorOpening && response.seat === seat && majorResponse &&
        rebid?.seat === partner && rebid.bid === "2notrump" && !passedBeforeOpening(auction, seat, opening) &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === rebid.bid)
      ) return isBalanced(hand) && points(hand) >= 8 ? "3notrump" : "pass";
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const repeatedMajor = rebid?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && opening.bid === "1spades" && response?.seat === seat &&
        response.bid === "1notrump" && rebid?.seat === partner && rebid.bid === "2hearts"
      ) {
        const responderPoints = points(hand);
        const heartSupport = hand.filter((card) => card.suit === "hearts").length;
        if (heartSupport >= 3 && responderPoints >= 13) return "4hearts";
        if (heartSupport >= 3 && responderPoints >= 10) return "3hearts";
        if (isBalanced(hand) && responderPoints >= 13) return "3notrump";
        if (isBalanced(hand) && responderPoints >= 10) return "2notrump";
      }
      if (
        opening?.seat === partner && response?.seat === seat && rebid?.seat === partner &&
        openingMajor && repeatedMajor === openingMajor && response.bid === "1notrump"
      ) {
        const responderPoints = points(hand);
        if (responderPoints >= 10 && responderPoints <= 12) {
          if (hand.filter((card) => card.suit === openingMajor).length >= 3) return `3${openingMajor}` as Bid;
          if (isBalanced(hand)) return "2notrump";
        }
      }
      const rebidSuit = rebid?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && response?.seat === seat && response.bid === "1notrump" &&
        rebid?.seat === partner && openingMajor && rebidSuit
      ) {
        const responderPoints = points(hand);
        const majorSupport = hand.filter((card) => card.suit === openingMajor).length;
        const minorSupport = hand.filter((card) => card.suit === rebidSuit).length;
        const unbidSuits = suits.filter((suit) => suit !== openingMajor && suit !== rebidSuit);
        const hasUnbidStoppers = unbidSuits.every((suit) => hasStopper(hand, suit));
        if (majorSupport >= 3 && responderPoints >= 13) return `4${openingMajor}` as Bid;
        if (majorSupport >= 3 && responderPoints >= 11 && responderPoints <= 12) return `3${openingMajor}` as Bid;
        if (isBalanced(hand) && hasUnbidStoppers && responderPoints >= 11 && responderPoints <= 12) return "2notrump";
        if (isBalanced(hand) && !hasUnbidStoppers && majorSupport === 2 && minorSupport < 4 && responderPoints >= 11 && responderPoints <= 12) {
          return atLegalLevel(`2${openingMajor}` as Bid, auction);
        }
        if (!isBalanced(hand) && minorSupport >= 5 && responderPoints >= 11 && responderPoints <= 12) {
          return `3${rebidSuit}` as Bid;
        }
        const alternateMajor = openingMajor === "spades" ? "hearts" : "spades";
        const directTwoLevelMinimum = this.convention.style === "2/1" ? 13 : 10;
        if (
          alternateMajor && responderPoints < directTwoLevelMinimum &&
          hand.filter((card) => card.suit === alternateMajor).length >= 5
        ) return `2${alternateMajor}` as Bid;
        if (majorSupport === 2 && minorSupport < 4 && responderPoints <= 9) {
          return atLegalLevel(`2${openingMajor}` as Bid, auction);
        }
      }
      const isOneLevelSuit = (bid: Bid | undefined) => bid !== undefined && /^1(clubs|diamonds|hearts|spades)$/.test(bid);
      if (
        opening?.seat === partner && response?.seat === seat && rebid?.seat === partner &&
        isOneLevelSuit(opening.bid) && isOneLevelSuit(response.bid) && rebid.bid === "1notrump"
      ) {
        const responderPoints = points(hand);
        const responderMajor = response.bid === "1hearts" || response.bid === "1spades" ? response.bid.slice(1) as Suit : undefined;
        if (responderMajor && responderPoints >= 10 && responderPoints <= 12 && hand.filter((card) => card.suit === responderMajor).length >= 5) {
          return `3${responderMajor}` as Bid;
        }
        if (isBalanced(hand)) {
          if (responderPoints >= 10 && responderPoints <= 12) return "2notrump";
          if (responderPoints >= 13) return "3notrump";
        }
        if (responderMajor && hand.filter((card) => card.suit === responderMajor).length >= 5 && responderPoints <= 9) {
          return `2${responderMajor}` as Bid;
        }
      }
    }
    if (contractCalls.length === 4) {
      const [followupOpening, followupResponse, followupOpenerRebid, responderSecondMajor] = contractCalls;
      const followupOpeningMajor = followupOpening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const rebidMinor = followupOpenerRebid?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const secondMajor = responderSecondMajor?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      const alternateMajor = followupOpeningMajor === "hearts" ? "spades" : "hearts";
      if (
        followupOpeningMajor && followupResponse?.bid === "1notrump" && rebidMinor && secondMajor === alternateMajor &&
        followupOpening?.seat === seat && followupResponse.seat === partner && followupOpenerRebid?.seat === seat && responderSecondMajor?.seat === partner &&
        !passedBeforeOpening(auction, partner, followupOpening) &&
        auction.every(({ bid }) => bid === "pass" || bid === followupOpening.bid || bid === followupResponse.bid || bid === followupOpenerRebid.bid || bid === responderSecondMajor.bid)
      ) {
        if (hand.filter((card) => card.suit === secondMajor).length >= 3 && points(hand) >= 16) {
          return `3${secondMajor}` as Bid;
        }
        return atLegalLevel(`2${followupOpeningMajor}` as Bid, auction);
      }
      const [fitOpening, fitResponse, fitOpenerRebid, responderMajorBid] = contractCalls;
      const fitOpeningMajor = fitOpening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const fitResponseSuit = fitResponse?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const fitShownSuit = fitOpenerRebid?.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responderMajor = responderMajorBid?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        this.convention.style === "SAYC" && fitOpeningMajor && fitResponseSuit && fitShownSuit && responderMajor &&
        responderMajor !== fitOpeningMajor && responderMajor !== fitShownSuit && responderMajor !== fitResponseSuit &&
        fitOpening?.seat === seat && fitResponse?.seat === partner && fitOpenerRebid?.seat === seat &&
        responderMajorBid?.seat === partner && responderMajorBid.bid === `2${responderMajor}` &&
        !passedBeforeOpening(auction, partner, fitOpening) &&
        auction.every(({ bid }) => bid === "pass" || bid === fitOpening.bid || bid === fitResponse.bid || bid === fitOpenerRebid.bid || bid === responderMajorBid.bid)
      ) {
        const support = hand.filter((card) => card.suit === responderMajor).length;
        if (support >= 3) return `${points(hand) >= 16 ? 4 : 3}${responderMajor}` as Bid;
        return `3${fitOpeningMajor}` as Bid;
      }
      const [opening, interference, limitRaise, openerRebid] = contractCalls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const shownMajor = openerRebid?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        auction.length === 7 && opening && openingSuit && interference?.bid === "1notrump" &&
        interference.seat === partner && limitRaise?.bid === "2clubs" && limitRaise.seat === seat &&
        openerRebid?.seat === partner && (shownMajor || openerRebid.bid === "2diamonds") &&
        opening.seat !== seat && opening.seat !== partner && auction[2]?.bid === "pass" &&
        auction[4]?.seat === opening.seat && auction[4].bid === "pass" && auction[6]?.bid === "pass"
      ) {
        const responderPoints = points(hand);
        if (shownMajor) {
          const support = hand.filter((card) => card.suit === shownMajor).length;
          if (support >= 3 && responderPoints >= 10) return `4${shownMajor}` as Bid;
          if (support >= 3 && responderPoints >= 8) return `3${shownMajor}` as Bid;
          if (
            shownMajor === "hearts" && support < 3 && responderPoints >= 8 &&
            hand.filter((card) => card.suit === "spades").length >= 4
          ) return "2spades";
          if (isBalanced(hand) && responderPoints >= 10) return "3notrump";
          if (isBalanced(hand) && responderPoints >= 8) return "2notrump";
        } else {
          if (isBalanced(hand) && responderPoints >= 10) return "3notrump";
          if (isBalanced(hand) && responderPoints >= 8) return "2notrump";
          const longMajor = ["hearts", "spades"].find((suit) => hand.filter((card) => card.suit === suit).length >= 5);
          if (longMajor) return `2${longMajor}` as Bid;
        }
      }
      if (
        opening?.seat === partner && interference?.bid === "double" && limitRaise?.seat === seat &&
        limitRaise.bid === "2notrump" && openerRebid?.seat === partner && openingMajor &&
        openerRebid.bid === `3${openingMajor}` && points(hand) >= 12
      ) return `4${openingMajor}` as Bid;
    }
    if (contractCalls.length === 5) {
      const [followupOpening, followupResponse, followupOpenerRebid, responderSecondMajor, openerInvite] = contractCalls;
      const followupOpeningMajor = followupOpening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const rebidMinor = followupOpenerRebid?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const secondMajor = responderSecondMajor?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        followupOpeningMajor && followupResponse?.bid === "1notrump" && rebidMinor && secondMajor &&
        openerInvite?.bid === `3${secondMajor}` &&
        followupOpening?.seat === partner && followupResponse.seat === seat &&
        followupOpenerRebid?.seat === partner && responderSecondMajor?.seat === seat && openerInvite.seat === partner &&
        secondMajor !== followupOpeningMajor && secondMajor !== rebidMinor &&
        !passedBeforeOpening(auction, seat, followupOpening)
      ) {
        const acceptanceThreshold = this.convention.style === "2/1" ? 10 : 8;
        return points(hand) >= acceptanceThreshold ? `4${secondMajor}` as Bid : "pass";
      }
      const [opening, interference, stayman, majorReply, alternateMajor] = contractCalls;
      if (
        auction.length === 9 && opening && opening.seat !== seat && opening.seat !== partner &&
        /^1(clubs|diamonds|hearts|spades)$/.test(opening.bid) &&
        interference?.bid === "1notrump" && interference.seat === seat &&
        stayman?.bid === "2clubs" && stayman.seat === SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]! &&
        majorReply?.bid === "2hearts" && majorReply.seat === seat &&
        alternateMajor?.bid === "2spades" && alternateMajor.seat === SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]! &&
        auction[2]?.bid === "pass" && auction[4]?.bid === "pass" && auction[6]?.bid === "pass" && auction[8]?.bid === "pass"
      ) {
        return hand.filter((card) => card.suit === "spades").length >= 3 ? "3spades" : "2notrump";
      }
    }
    if (contractCalls.length === 6) {
      const [opening, interference, stayman, majorReply, alternateMajor, overcallerRebid] = contractCalls;
      if (
        auction.length === 11 && opening && opening.seat !== seat && opening.seat !== partner &&
        /^1(clubs|diamonds|hearts|spades)$/.test(opening.bid) &&
        interference?.bid === "1notrump" && interference.seat === partner &&
        stayman?.bid === "2clubs" && stayman.seat === seat && majorReply?.bid === "2hearts" &&
        majorReply.seat === interference.seat && alternateMajor?.bid === "2spades" && alternateMajor.seat === seat &&
        overcallerRebid?.seat === interference.seat && auction[2]?.bid === "pass" && auction[4]?.bid === "pass" &&
        auction[6]?.bid === "pass" && auction[8]?.bid === "pass" && auction[10]?.bid === "pass"
      ) {
        const responderPoints = points(hand);
        if (overcallerRebid.bid === "3spades") return responderPoints >= 10 ? "4spades" : "pass";
        if (overcallerRebid.bid === "2notrump" && isBalanced(hand)) return responderPoints >= 10 ? "3notrump" : "pass";
      }
    }
    if (contractCalls.length === 3) {
      const [opening, response, openerRebid] = contractCalls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const responseSuit = response?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const shownSideSuit = openerRebid?.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        this.convention.style === "SAYC" && opening && response && openerRebid && openingMajor && responseSuit && shownSideSuit &&
        shownSideSuit !== openingMajor && shownSideSuit !== responseSuit &&
        opening?.seat === partner && response?.seat === seat && openerRebid.seat === partner &&
        !passedBeforeOpening(auction, seat, opening) &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid)
      ) {
        const responderPoints = points(hand);
        const alternateMajor = openingMajor === "hearts" ? "spades" : "hearts";
        if (
          alternateMajor !== shownSideSuit && alternateMajor !== responseSuit && responderPoints >= 10 &&
          hand.filter((card) => card.suit === alternateMajor).length >= 4
        ) return `2${alternateMajor}` as Bid;
        if (hand.filter((card) => card.suit === shownSideSuit).length >= 4 && responderPoints >= 10) {
          return `3${shownSideSuit}` as Bid;
        }
        const unbidSuits = suits.filter((suit) => suit !== openingMajor && suit !== responseSuit && suit !== shownSideSuit);
        const hasStoppers = unbidSuits.every((suit) => {
          const cards = hand.filter((card) => card.suit === suit);
          return cards.some((card) => card.rank === "A") ||
            (cards.some((card) => card.rank === "K") && cards.length >= 2) ||
            (cards.some((card) => card.rank === "Q") && cards.length >= 3);
        });
        if (isBalanced(hand) && responderPoints >= 13 && hasStoppers) return "3notrump";
        if (isBalanced(hand) && responderPoints >= 10 && responderPoints <= 12 && hasStoppers) return "2notrump";
        if (responderPoints >= 10 && hand.filter((card) => card.suit === openingMajor).length >= 2) return atLegalLevel(`2${openingMajor}` as Bid, auction);
      }
      if (
        this.convention.style === "SAYC" && opening && response && openerRebid && openingMajor && responseSuit &&
        opening.seat === partner && response.seat === seat && openerRebid.seat === partner &&
        openerRebid.bid === `2${openingMajor}` && responseSuit !== openingMajor &&
        !passedBeforeOpening(auction, seat, opening) &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid)
      ) {
        const responderPoints = points(hand);
        const support = hand.filter((card) => card.suit === openingMajor).length;
        if (support >= 3 && responderPoints >= 13) return `4${openingMajor}` as Bid;
        if (support >= 3 && responderPoints >= 10) return `3${openingMajor}` as Bid;
        const unbidSuits = suits.filter((suit) => suit !== openingMajor && suit !== responseSuit);
        const hasStoppers = unbidSuits.every((suit) => {
          const cards = hand.filter((card) => card.suit === suit);
          return cards.some((card) => card.rank === "A") ||
            (cards.some((card) => card.rank === "K") && cards.length >= 2) ||
            (cards.some((card) => card.rank === "Q") && cards.length >= 3);
        });
        if (isBalanced(hand) && responderPoints >= 10 && responderPoints <= 12 && hasStoppers) return "2notrump";
        if (hand.filter((card) => card.suit === responseSuit).length >= 5 && responderPoints >= 10) {
          return `3${responseSuit}` as Bid;
        }
      }
      if (
        this.convention.style === "SAYC" && opening?.bid === "1diamonds" && response?.bid === "2clubs" &&
        openerRebid?.bid === "2diamonds" && openerRebid.seat === partner && response.seat === seat &&
        hand.filter((card) => card.suit === "diamonds").length >= 4 && points(hand) >= 10
      ) return "3diamonds";
    }
    const twoOverOne = twoOverOneAuction(auction, this.convention.style);
    if (twoOverOne && contractCalls.length === 2 && twoOverOne.openingSeat === seat) {
      const sideMajor = twoOverOne.openingSuit === "hearts" ? "spades" : "hearts";
      if (
        twoOverOne.responseSuit === sideMajor && hand.filter((card) => card.suit === sideMajor).length >= 3
      ) return `3${sideMajor}` as Bid;
      if (isBalanced(hand) && points(hand) >= 18 && points(hand) <= 19) return "2notrump";
      if (points(hand) >= 12 && points(hand) <= 17 && hand.filter((card) => card.suit === sideMajor).length >= 4) {
        return `2${sideMajor}` as Bid;
      }
      if (
        (twoOverOne.responseSuit === "clubs" || twoOverOne.responseSuit === "diamonds") &&
        points(hand) >= 12 &&
        hand.filter((card) => card.suit === twoOverOne.responseSuit).length >= 4
      ) return `3${twoOverOne.responseSuit}` as Bid;
      if (
        twoOverOne.responseSuit === "clubs" && points(hand) >= 12 && points(hand) <= 17 &&
        hand.filter((card) => card.suit === "diamonds").length >= 4
      ) return "2diamonds";
      if (
        twoOverOne.responseSuit === "diamonds" && points(hand) >= 12 && points(hand) <= 17 &&
        hand.filter((card) => card.suit === "clubs").length >= 4
      ) return "3clubs";
      return atLegalLevel(`2${twoOverOne.openingSuit}` as Bid, auction);
    }
    if (twoOverOne && contractCalls.length === 3 && twoOverOne.responderSeat === seat) {
      const shownSideMajor = twoOverOne.openingSuit === "hearts" ? "spades" : "hearts";
      if (
        twoOverOne.responseSuit === shownSideMajor && contractCalls[2]?.bid === `3${shownSideMajor}` &&
        hand.filter((card) => card.suit === shownSideMajor).length >= 4
      ) return `4${shownSideMajor}` as Bid;
      if (
        contractCalls[2]?.bid === `2${shownSideMajor}` &&
        hand.filter((card) => card.suit === shownSideMajor).length >= 4
      ) return `4${shownSideMajor}` as Bid;
      if (contractCalls[2]?.bid === "2notrump") {
        if (hand.filter((card) => card.suit === twoOverOne.openingSuit).length >= 3) {
          return `4${twoOverOne.openingSuit}` as Bid;
        }
        if (
          twoOverOne.responseSuit !== shownSideMajor &&
          hand.filter((card) => card.suit === shownSideMajor).length >= 4
        ) return `3${shownSideMajor}` as Bid;
        return "3notrump";
      }
      const support = hand.filter((card) => card.suit === twoOverOne.openingSuit).length;
      if (support >= 3) {
        const openerRaisedResponderMinor =
          (twoOverOne.responseSuit === "clubs" || twoOverOne.responseSuit === "diamonds") &&
          contractCalls[2]?.bid === `3${twoOverOne.responseSuit}`;
        const level = openerRaisedResponderMinor && points(hand) >= 15 ? 3 : 4;
        return `${level}${twoOverOne.openingSuit}` as Bid;
      }
      if (
        (twoOverOne.responseSuit === "clubs" || twoOverOne.responseSuit === "diamonds") &&
        contractCalls[2]?.bid === `3${twoOverOne.responseSuit}` &&
        hand.filter((card) => card.suit === twoOverOne.responseSuit).length >= 4
      ) return `5${twoOverOne.responseSuit}` as Bid;
      if (
        contractCalls[2]?.bid === `2${twoOverOne.openingSuit}` &&
        twoOverOne.responseSuit === "clubs" &&
        hand.filter((card) => card.suit === shownSideMajor).length >= 4
      ) return atLegalLevel(`2${shownSideMajor}` as Bid, auction);
      const sideMajor = twoOverOne.openingSuit === "hearts" ? "spades" : "hearts";
      if (contractCalls[2]?.bid === "3clubs" && hand.filter((card) => card.suit === sideMajor).length >= 4) {
        return `3${sideMajor}` as Bid;
      }
      if (contractCalls[2]?.bid === "3clubs" && hand.filter((card) => card.suit === "diamonds").length >= 6) {
        return "3diamonds";
      }
      if (
        contractCalls[2]?.bid === "3clubs" &&
        hand.filter((card) => card.suit === "clubs").length >= 4
      ) return "5clubs";
      if (contractCalls[2]?.bid === "3clubs") return "3notrump";
      if (
        twoOverOne.responseSuit === "clubs" && contractCalls[2]?.bid === "2diamonds" &&
        hand.filter((card) => card.suit === "diamonds").length >= 4
      ) return "5diamonds";
      if (hand.filter((card) => card.suit === twoOverOne.responseSuit).length >= 6) return atLegalLevel(`3${twoOverOne.responseSuit}` as Bid, auction);
      if (hand.filter((card) => card.suit === sideMajor).length >= 4) {
        return contractCalls[2]?.bid === "2diamonds" && twoOverOne.responseSuit === "clubs"
          ? `2${sideMajor}` as Bid
          : `3${sideMajor}` as Bid;
      }
      return "3notrump";
    }
    if (twoOverOne && contractCalls.length === 4 && twoOverOne.openingSeat === seat) {
      const responderRebid = contractCalls[3]?.bid;
      const sideMajor = twoOverOne.openingSuit === "spades" ? "hearts" : "spades";
      if (
        responderRebid === `3${twoOverOne.openingSuit}` &&
        (twoOverOne.responseSuit === "clubs" || twoOverOne.responseSuit === "diamonds") &&
        contractCalls[2]?.bid === `3${twoOverOne.responseSuit}`
      ) return `4${twoOverOne.openingSuit}` as Bid;
      if (
        responderRebid === `2${sideMajor}` &&
        hand.filter((card) => card.suit === sideMajor).length >= 3
      ) return `3${sideMajor}` as Bid;
      if (responderRebid === `2${sideMajor}`) return "3notrump";
      if (
        responderRebid === `3${sideMajor}` &&
        hand.filter((card) => card.suit === sideMajor).length >= 3
      ) return `4${sideMajor}` as Bid;
      if (responderRebid === `3${sideMajor}`) return "3notrump";
      if (
        responderRebid === `3${twoOverOne.responseSuit}` &&
        hand.filter((card) => card.suit === twoOverOne.responseSuit).length >= 3
      ) return `4${twoOverOne.responseSuit}` as Bid;
      if (responderRebid === `3${twoOverOne.responseSuit}`) return "3notrump";
    }
    if (twoOverOne && contractCalls.length === 5 && twoOverOne.responderSeat === seat) {
      const openerSupport = contractCalls[4]?.bid;
      const sideMajor = twoOverOne.openingSuit === "spades" ? "hearts" : "spades";
      if (
        openerSupport === `3${sideMajor}` &&
        hand.filter((card) => card.suit === sideMajor).length >= 4
      ) return `4${sideMajor}` as Bid;
      if (
        openerSupport === `4${twoOverOne.responseSuit}` &&
        (twoOverOne.responseSuit === "clubs" || twoOverOne.responseSuit === "diamonds") &&
        hand.filter((card) => card.suit === twoOverOne.responseSuit).length >= 6
      ) return `5${twoOverOne.responseSuit}` as Bid;
    }
    if (contractCalls.length === 3) {
      const [opening, raise, invitation] = contractCalls;
      const major = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        major && opening?.seat === partner && raise?.seat === seat && raise.bid === `2${major}` &&
        invitation?.seat === partner && invitation.bid === `3${major}` &&
        auction.every(({ bid }) => bid === "pass" || [opening.bid, raise.bid, invitation.bid].includes(bid))
      ) return points(hand) >= 8 ? `4${major}` as Bid : "pass";
    }
    if (contractCalls.length === 2) {
      const [opening, response] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const openingMajor = openingSuit === "hearts" || openingSuit === "spades" ? openingSuit : undefined;
      const raisedMajor = response?.bid.match(/^([23])(hearts|spades)$/)?.[2] as Suit | undefined;
      if (
        openingMajor && opening?.seat === seat && response?.seat === partner && raisedMajor === openingMajor &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid)
      ) {
        const openerPoints = points(hand);
        if (response.bid === `2${openingMajor}`) {
          if (openerPoints >= 19) return `4${openingMajor}` as Bid;
          if (openerPoints >= 16) return `3${openingMajor}` as Bid;
        }
        if (this.convention.style === "SAYC" && response.bid === `3${openingMajor}` && openerPoints >= 13) {
          return `4${openingMajor}` as Bid;
        }
      }
      if (
        this.convention.style === "SAYC" && opening?.seat === seat && response?.seat === partner &&
        opening.bid === "1diamonds" && response.bid === "2clubs" &&
        hand.filter((card) => card.suit === "diamonds").length >= 5 && points(hand) >= 12 && points(hand) <= 18
      ) return "2diamonds";
      if (
        opening?.seat === seat && response?.seat === partner &&
        (openingSuit === "clubs" || openingSuit === "diamonds") && response.bid === "1notrump" &&
        isBalanced(hand) && points(hand) >= 18 && points(hand) <= 19
      ) return "2notrump";
      if (
        opening?.seat === seat && response?.seat === partner &&
        (openingSuit === "clubs" || openingSuit === "diamonds") && response.bid === "1notrump" &&
        hand.filter((card) => card.suit === openingSuit).length >= 6 && points(hand) >= 12 && points(hand) <= 17
      ) return `2${openingSuit}` as Bid;
      if (
        opening?.seat === seat && response?.seat === partner &&
        (openingSuit === "hearts" || openingSuit === "spades") && response.bid === "1notrump"
      ) {
        const openerPoints = points(hand);
        if (isBalanced(hand) && openerPoints >= 18 && openerPoints <= 19) return "2notrump";
        if (isBalanced(hand) && openerPoints >= 20 && openerPoints <= 21) return "3notrump";
        const maxMajorRebidPoints = this.convention.style === "SAYC" ? 18 : 17;
        const openingMajorLength = hand.filter((card) => card.suit === openingSuit).length;
        if (
          ((openerPoints >= 12 && openerPoints <= maxMajorRebidPoints) ||
            (openerPoints >= 19 && openingMajorLength >= 6)) &&
          openingMajorLength >= 5
        ) {
          const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
          const openingRank = suitOrder.indexOf(openingSuit);
          const secondSuit = suitOrder
            .filter((suit) => suitOrder.indexOf(suit) < openingRank && hand.filter((card) => card.suit === suit).length >= 4)
            .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
          if (secondSuit) return `2${secondSuit}` as Bid;
          const higherSecondSuit = suitOrder.find((suit) => suitOrder.indexOf(suit) > openingRank && hand.filter((card) => card.suit === suit).length >= 4);
          if (higherSecondSuit && openerPoints >= 16) return `2${higherSecondSuit}` as Bid;
          if (!higherSecondSuit && openerPoints >= 16 && openerPoints <= 18 && openingMajorLength >= 6) {
            return `3${openingSuit}` as Bid;
          }
          if (!higherSecondSuit && openerPoints >= 19 && openingMajorLength >= 6) {
            return `4${openingSuit}` as Bid;
          }
          if (openingMajorLength >= 6) return `2${openingSuit}` as Bid;
          if (!higherSecondSuit && this.convention.style === "SAYC" && openerPoints >= 12 && openerPoints <= 15) return `2${openingSuit}` as Bid;
        }
        if (this.convention.style === "2/1" && !passedBeforeOpening(auction, partner, opening!) && openerPoints >= 12 && openerPoints <= 17) {
          if (hand.filter((card) => card.suit === "clubs").length >= 3) return "2clubs";
          if (hand.filter((card) => card.suit === "diamonds").length >= 3) return "2diamonds";
          return `2${openingSuit}` as Bid;
        }
        return "pass";
      }
      const responseSuit = response?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const majorOpening = openingSuit === "hearts" || openingSuit === "spades" ? openingSuit : undefined;
      const twoLevelResponse = response?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      if (
        this.convention.style === "SAYC" && majorOpening && twoLevelResponse && opening?.seat === seat && response?.seat === partner &&
        !passedBeforeOpening(auction, partner, opening) && auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid)
      ) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const openingRank = suitOrder.indexOf(majorOpening);
        const secondSuit = suitOrder.find((suit) =>
          suit !== majorOpening && suit !== twoLevelResponse &&
          hand.filter((card) => card.suit === suit).length >= 4 &&
          (suitOrder.indexOf(suit) < openingRank || (points(hand) >= 16 && points(hand) <= 18))
        );
        if (secondSuit && points(hand) >= 13 && points(hand) <= 18) return `2${secondSuit}` as Bid;
        if (hand.filter((card) => card.suit === majorOpening).length >= 5 && points(hand) >= 12 && points(hand) <= 18) return `2${majorOpening}` as Bid;
      }
      if (opening?.seat !== seat || response?.seat !== partner || !openingSuit || !responseSuit || openingSuit === responseSuit) return "pass";
      const openerPoints = points(hand);
      const responderMajor = responseSuit === "hearts" || responseSuit === "spades" ? responseSuit : undefined;
      if (responderMajor && openerPoints >= 12 && openerPoints <= 15 && hand.filter((card) => card.suit === responderMajor).length >= 4) {
        return `2${responderMajor}` as Bid;
      }
      if (
        responderMajor && openerPoints >= 19 && !isBalanced(hand) &&
        hand.filter((card) => card.suit === responderMajor).length >= 4
      ) return `4${responderMajor}` as Bid;
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const openingRank = suitOrder.indexOf(openingSuit);
      const responseRank = suitOrder.indexOf(responseSuit);
      const secondSuit = suitOrder
        .filter((suit) =>
          suit !== responseSuit && suitOrder.indexOf(suit) > openingRank && hand.filter((card) => card.suit === suit).length >= 4 &&
          (suitOrder.indexOf(suit) > responseRank || openerPoints >= 16)
        )
        .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
      if (secondSuit) {
        const level = suitOrder.indexOf(secondSuit) < responseRank ? 2 : 1;
        return `${level}${secondSuit}` as Bid;
      }
      if (isBalanced(hand) && openerPoints >= 12 && openerPoints <= 14) return "1notrump";
      if (isBalanced(hand) && openerPoints >= 18 && openerPoints <= 19) return "2notrump";
      if (responderMajor && openerPoints >= 16 && openerPoints <= 18 && hand.filter((card) => card.suit === responderMajor).length >= 4) {
        return `3${responderMajor}` as Bid;
      }
      const lowerSecondSuit = suitOrder.find((suit) =>
        suit !== openingSuit && suit !== responseSuit && suitOrder.indexOf(suit) < openingRank &&
        hand.filter((card) => card.suit === suit).length >= 4
      );
      if (!isBalanced(hand) && lowerSecondSuit && openerPoints >= 12 && openerPoints <= 18) {
        return `2${lowerSecondSuit}` as Bid;
      }
      if (
        openingSuit === "diamonds" && responseSuit === "spades" && openerPoints >= 12 && openerPoints <= 17 &&
        hand.filter((card) => card.suit === "diamonds").length >= 5 && hand.filter((card) => card.suit === "clubs").length >= 4
      ) return "2clubs";
      if (hand.filter((card) => card.suit === openingSuit).length >= 6) return `2${openingSuit}` as Bid;
      return "pass";
    }
    if (contractCalls.length !== 1) return "pass";
    const opening = contractCalls[0]!;
    if (opening.seat !== partner) return "pass";

    if (opening.bid === "2clubs") {
      const responderPoints = points(hand);
      if (responderPoints >= 8) {
        const positiveSuit = (["hearts", "spades", "clubs", "diamonds"] as const)
          .find((suit) => hand.filter((card) => card.suit === suit).length >= 5);
        if (positiveSuit) return `${positiveSuit === "clubs" || positiveSuit === "diamonds" ? 3 : 2}${positiveSuit}` as Bid;
        if (isBalanced(hand)) return "2notrump";
      }
      return "2diamonds";
    }

    if (opening.bid === "2notrump") {
      return respondToTwoNotrump(hand);
    }

    const responderPoints = points(hand);
    const passedHand = passedBeforeOpening(auction, seat, opening);
    if (opening.bid === "1notrump") {
      const hearts = hand.filter((card) => card.suit === "hearts").length;
      const spades = hand.filter((card) => card.suit === "spades").length;
      const hasFourCardMajor = hearts === 4 || spades === 4 || (hearts >= 4 && spades >= 4);
      if (responderPoints >= 8 && hasFourCardMajor) return "2clubs";
      if (hearts >= 5 && spades < 4) return "2diamonds";
      if (spades >= 5 && hearts < 4) return "2hearts";
      const invitationalMinor = (["clubs", "diamonds"] as const)
        .map((suit) => ({
          suit,
          length: hand.filter((card) => card.suit === suit).length,
          topHonors: hand.filter((card) => card.suit === suit && ["A", "K", "Q"].includes(card.rank)).length
        }))
        .filter(({ length, topHonors }) => length >= 6 && topHonors >= 2)
        .sort((a, b) => b.length - a.length || b.topHonors - a.topHonors || (a.suit === "clubs" ? -1 : 1))[0];
      if (responderPoints >= 10 && responderPoints <= 15 && invitationalMinor) return `3${invitationalMinor.suit}` as Bid;
      const clubs = hand.filter((card) => card.suit === "clubs").length;
      const diamonds = hand.filter((card) => card.suit === "diamonds").length;
      if (responderPoints < 8 && !hasFourCardMajor && Math.max(clubs, diamonds) >= 6) return "2spades";
      if (!isBalanced(hand) || responderPoints < 8) return "pass";
      if (responderPoints >= 16) return "4notrump";
      return responderPoints < 10 ? "2notrump" : "3notrump";
    }

    const openingSuit = opening.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
    if (!openingSuit) return "pass";
    const openedMajor = openingSuit === "hearts" || openingSuit === "spades" ? openingSuit : undefined;
    if (
      openedMajor && responderPoints < 10 && hand.filter((card) => card.suit === openedMajor).length >= 5 &&
      suits.some((suit) => suit !== openedMajor && hand.filter((card) => card.suit === suit).length <= 1)
    ) return `4${openedMajor}` as Bid;
    if (
      openedMajor && !passedHand && responderPoints >= 13 && hand.filter((card) => card.suit === openedMajor).length >= 4
    ) return "2notrump";
    if (
      this.convention.style === "SAYC" && !passedHand && openedMajor &&
      responderPoints >= 16 && responderPoints <= 18 && isBalanced(hand) &&
      hand.filter((card) => card.suit === openedMajor).length === 2 &&
      hand.filter((card) => card.suit === (openedMajor === "hearts" ? "spades" : "hearts")).length < 4
    ) return "3notrump";
    if (
      this.convention.style === "2/1" && !passedHand && openingSuit === "hearts" &&
      responderPoints >= 13 && hand.filter((card) => card.suit === "spades").length >= 5
    ) return "2spades";
    if (
      this.convention.style === "SAYC" && openedMajor && responderPoints >= 13 &&
      hand.filter((card) => card.suit === openedMajor).length >= 3
    ) {
      return `4${openedMajor}` as Bid;
    }
    if (
      this.convention.style === "SAYC" && !passedHand && responderPoints >= 19 &&
      (!openedMajor || hand.filter((card) => card.suit === openedMajor).length < 3)
    ) {
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const openingRank = suitOrder.indexOf(openingSuit);
      const jumpShiftSuit = [...suitOrder]
        .filter((suit) => suit !== openingSuit && hand.filter((card) => card.suit === suit).length >= 5)
        .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
      if (jumpShiftSuit) {
        const jumpLevel = suitOrder.indexOf(jumpShiftSuit) > openingRank ? 2 : 3;
        return `${jumpLevel}${jumpShiftSuit}` as Bid;
      }
    }
    if (responderPoints >= 6) {
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const openingRank = suitOrder.indexOf(openingSuit);
      const suitLength = (suit: Suit) => hand.filter((card) => card.suit === suit).length;
      const newSuit = [...suitOrder]
        .filter((suit) => suitOrder.indexOf(suit) > openingRank && suitLength(suit) >= 4)
        .sort((a, b) => suitLength(b) - suitLength(a) || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
      if (newSuit) return `1${newSuit}` as Bid;
      const hasMajorSupport = (openingSuit === "hearts" || openingSuit === "spades") && suitLength(openingSuit) >= 3;
      const twoLevelMinimum = this.convention.style === "2/1" && openedMajor && !passedHand ? 13 : 10;
      const mayStartTwoOverOne = !hasMajorSupport || (this.convention.style === "2/1" && openedMajor && !passedHand);
      if (responderPoints >= twoLevelMinimum && mayStartTwoOverOne) {
        const twoLevelSuit = [...suitOrder]
          .filter((suit) => suit !== openingSuit && suitOrder.indexOf(suit) < openingRank && suitLength(suit) >= 4)
          .sort((a, b) => suitLength(b) - suitLength(a) || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
        if (twoLevelSuit) return `2${twoLevelSuit}` as Bid;
      }
    }

    if (contractCalls.length !== 1) return "pass";
    if (openingSuit === "clubs" || openingSuit === "diamonds") {
      const supportLength = hand.filter((card) => card.suit === openingSuit).length;
      if (supportLength >= 5 && responderPoints >= 6 && responderPoints <= 9) return `2${openingSuit}` as Bid;
      if (supportLength >= 5 && responderPoints >= 10 && responderPoints <= 12) return `3${openingSuit}` as Bid;
      if (supportLength < 5 && isBalanced(hand) && responderPoints >= 6 && responderPoints <= 9) return "1notrump";
      if (supportLength < 5 && isBalanced(hand) && responderPoints >= 10 && responderPoints <= 12) return "2notrump";
      if (isBalanced(hand) && responderPoints >= 13 && responderPoints <= 15) return "3notrump";
      return "pass";
    }
    if (!openedMajor) return "pass";
    const supportLength = hand.filter((card) => card.suit === openedMajor).length;
    if (this.convention.style === "2/1" && !passedHand && supportLength === 3 && responderPoints >= 10 && responderPoints <= 12) return "1notrump";
    if (this.convention.style === "2/1" && !passedHand && supportLength < 3 && responderPoints >= 6 && responderPoints <= 12) return "1notrump";
    if (supportLength < 3 && isBalanced(hand) && responderPoints >= 6 && responderPoints <= 9) return "1notrump";
    if (supportLength < 3 || responderPoints < 6) return "pass";
    if (responderPoints < 10) return `2${openedMajor}` as Bid;
    if (responderPoints < 13) return `3${openedMajor}` as Bid;
    return `4${openedMajor}` as Bid;
  }

  async chooseCard(context: PlayContext) {
    const choices = legalCards(context);
    return [...choices].sort((a, b) => cardId(a).localeCompare(cardId(b)))[0]!;
  }
}

/** Intermediate card play uses simple honor leads and wins the current trick cheaply. */
export class IntermediateBot implements BotPlayer {
  readonly config: BotConfig;
  private readonly biddingBot: BeginnerBot;

  constructor(config: BotConfig) {
    if (config.skill !== "intermediate") throw new Error("IntermediateBot requires intermediate skill");
    this.config = config;
    this.biddingBot = new BeginnerBot({ ...config, skill: "beginner" });
  }

  chooseBid(hand: Hand, auction: readonly PublicBid[], seat: Seat): Promise<Bid> {
    const partner = SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!;
    const contractCalls = auction.filter(({ bid }) => bid !== "pass");
    if (auction.every(({ bid }) => bid === "pass")) {
      const hcp = points(hand);
      if (hcp >= 5 && hcp <= 10) {
        const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
        const preemptiveSuit = suitOrder.find((suit) =>
          hasReasonablePreemptiveSuit(hand, suit, 7) && !hasOutsideFourCardMajor(hand, suit)
        );
        if (preemptiveSuit) return Promise.resolve(`3${preemptiveSuit}` as Bid);
      }
    }
    if (contractCalls.length === 1) {
      const [opening] = contractCalls;
      const openedSuit = opening?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening && openedSuit && opening.seat === partner &&
        auction.slice(auction.indexOf(opening) + 1).every(({ bid }) => bid === "pass")
      ) {
        const support = hand.filter((card) => card.suit === openedSuit).length;
        const openedMajor = openedSuit === "hearts" || openedSuit === "spades" ? openedSuit : undefined;
        if (openedMajor && support >= 4 && points(hand) >= 15) return Promise.resolve(`4${openedMajor}` as Bid);
        const sideSuits = suits.filter((suit) => suit !== openedSuit);
        const runningSuit = sideSuits.find((suit) => {
          const cards = hand.filter((card) => card.suit === suit);
          return cards.length >= 8 && ["A", "K", "Q", "J"].every((rank) => cards.some((card) => card.rank === rank));
        });
        if (runningSuit) {
          const stoppersNeeded = sideSuits.filter((suit) => suit !== runningSuit);
          const hasOutsideAce = stoppersNeeded.some((suit) => hand.some((card) => card.suit === suit && card.rank === "A"));
          const stoppers = stoppersNeeded.every((suit) => {
            const cards = hand.filter((card) => card.suit === suit);
            return cards.some((card) => card.rank === "A") || (cards.length >= 2 && cards.some((card) => card.rank === "K"));
          });
          if (hasOutsideAce && stoppers) return Promise.resolve("3notrump");
        }
        if (openedMajor && quickTricks(hand, openedMajor) >= 4.5) return Promise.resolve(`4${openedMajor}` as Bid);
        if (points(hand) >= 16) {
          const eligibleMajors = openedSuit === "clubs" || openedSuit === "diamonds"
            ? (["spades", "hearts"] as const)
            : openedSuit === "hearts" ? (["spades"] as const)
              : openedSuit === "spades" ? (["hearts"] as const) : ([] as const);
          const naturalMajor = eligibleMajors
            .filter((major) => hasReasonablePreemptiveSuit(hand, major, 6))
            .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length)[0];
          if (naturalMajor) return Promise.resolve(`${openedSuit === "spades" ? "4" : "3"}${naturalMajor}` as Bid);
          if (openedSuit === "spades" && hasReasonablePreemptiveSuit(hand, "hearts", 6)) return Promise.resolve("4hearts");
        }
        const fitLength = hand.filter((card) => card.suit === openedSuit).length;
        if (fitLength >= 3) return Promise.resolve(`${Math.min(7, fitLength + 1)}${openedSuit}` as Bid);
      }
    }
    if (contractCalls.length === 2) {
      const [opening, response] = contractCalls;
      const openedSuit = opening?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responseMajor = response?.bid.match(/^(?:3|4)(hearts|spades)$/)?.[1] as Suit | undefined;
      const allowedResponse = openedSuit === "clubs" || openedSuit === "diamonds"
        ? response?.bid === `3${responseMajor}`
        : openedSuit === "hearts" ? response?.bid === "3spades"
          : openedSuit === "spades" ? response?.bid === "4hearts" : false;
      if (
        opening?.seat === seat && openedSuit && allowedResponse && response?.seat === partner && responseMajor &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid)
      ) {
        const support = hand.filter((card) => card.suit === responseMajor).length;
        if (support >= 3) return Promise.resolve(`${openedSuit === "spades" ? "5" : "4"}${responseMajor}` as Bid);
        return Promise.resolve(`4${openedSuit}` as Bid);
      }
    }
    if (contractCalls.length === 3) {
      const [opening, response, openerRebid] = contractCalls;
      const openedSuit = opening?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responseMajor = response?.bid.match(/^(?:3|4)(hearts|spades)$/)?.[1] as Suit | undefined;
      const isMinorSequence = (openedSuit === "clubs" || openedSuit === "diamonds") && response?.bid === `3${responseMajor}`;
      const isHeartToSpadeSequence = openedSuit === "hearts" && response?.bid === "3spades";
      const isSpadeToHeartSequence = openedSuit === "spades" && response?.bid === "4hearts";
      const completion = `4${responseMajor}`;
      if (
        opening?.seat === partner && openedSuit && response?.seat === seat && responseMajor && (isMinorSequence || isHeartToSpadeSequence || isSpadeToHeartSequence) &&
        openerRebid?.seat === partner &&
        (openerRebid.bid === `4${openedSuit}` || openerRebid.bid === `4${responseMajor}` || (openedSuit === "spades" && openerRebid.bid === "5hearts")) &&
        auction.every(({ bid }) => bid === "pass" || [opening.bid, response.bid, openerRebid.bid].includes(bid))
      ) {
        if (isSpadeToHeartSequence) return Promise.resolve("pass");
        return Promise.resolve(openerRebid.bid === `4${responseMajor}` ? "pass" : completion as Bid);
      }
    }
    if (contractCalls.length === 4) {
      const [opening, response, openerRebid, placement] = contractCalls;
      const openedHearts = opening?.bid === "3hearts";
      if (
        opening?.seat === partner && openedHearts && response?.seat === seat && response.bid === "3spades" &&
        openerRebid?.seat === partner && openerRebid.bid === "4hearts" && placement?.seat === seat && placement.bid === "4spades" &&
        auction.every(({ bid }) => bid === "pass" || [opening.bid, response.bid, openerRebid.bid, placement.bid].includes(bid))
      ) return Promise.resolve("pass");
    }
    if (auction.length === 3 && contractCalls.length === 2 && auction[2]?.bid === "pass") {
      const [opening, unusualNotrump] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening && unusualNotrump && openingSuit && opening.seat !== seat && opening.seat !== partner &&
        unusualNotrump.seat === partner && unusualNotrump.bid === "2notrump"
      ) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        if (isBalanced(hand) && points(hand) >= 13) return Promise.resolve("3notrump");
        const shownSuits = suitOrder
          .filter((suit) => suit !== openingSuit)
          .slice(0, 2)
          .map((suit) => ({ suit, support: hand.filter((card) => card.suit === suit).length }));
        if (points(hand) >= 13 && shownSuits.some(({ support }) => support >= 3)) {
          return Promise.resolve(`3${openingSuit}` as Bid);
        }
        const preferredSuit = shownSuits
          .sort((a, b) => b.support - a.support || suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit))[0]?.suit;
        if (preferredSuit && points(hand) <= 9 && hand.filter((card) => card.suit === preferredSuit).length >= 5) {
          return Promise.resolve(`4${preferredSuit}` as Bid);
        }
        if (preferredSuit) return Promise.resolve(atLegalLevel(`3${preferredSuit}` as Bid, auction));
      }
    }
    if (auction.length === 5 && contractCalls.length === 3 && auction[2]?.bid === "pass" && auction[4]?.bid === "pass") {
      const [opening, unusualNotrump, cueBid] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening && unusualNotrump && cueBid && openingSuit && opening.seat !== seat && opening.seat !== partner &&
        unusualNotrump.seat === seat && unusualNotrump.bid === "2notrump" &&
        cueBid.seat === partner && cueBid.bid === `3${openingSuit}`
      ) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const preferredSuit = suitOrder
          .filter((suit) => suit !== openingSuit)
          .slice(0, 2)
          .map((suit) => ({ suit, length: hand.filter((card) => card.suit === suit).length }))
          .sort((a, b) => b.length - a.length || suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit))[0]?.suit;
        if (preferredSuit) {
          if (points(hand) >= 13) {
            const gameLevel = preferredSuit === "hearts" || preferredSuit === "spades" ? 4 : 5;
            return Promise.resolve(`${gameLevel}${preferredSuit}` as Bid);
          }
          return Promise.resolve(atLegalLevel(`3${preferredSuit}` as Bid, auction));
        }
      }
    }
    if (auction.length === 7 && contractCalls.length === 4 && auction[2]?.bid === "pass" && auction[4]?.bid === "pass" && auction[6]?.bid === "pass") {
      const [opening, unusualNotrump, cueBid, preference] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const preferredSuit = preference?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const shownSuits = openingSuit ? ["clubs", "diamonds", "hearts", "spades"].filter((suit) => suit !== openingSuit).slice(0, 2) : [];
      if (
        opening && unusualNotrump && cueBid && preference && openingSuit && preferredSuit &&
        opening.seat !== seat && opening.seat !== partner && unusualNotrump.seat === partner &&
        unusualNotrump.bid === "2notrump" && cueBid.seat === seat && cueBid.bid === `3${openingSuit}` &&
        preference.seat === partner && shownSuits.includes(preferredSuit) &&
        hand.filter((card) => card.suit === preferredSuit).length >= 3 && points(hand) >= 16
      ) {
        const gameLevel = preferredSuit === "hearts" || preferredSuit === "spades" ? 4 : 5;
        return Promise.resolve(`${gameLevel}${preferredSuit}` as Bid);
      }
    }
    if (contractCalls.length === 1 && auction.length === 1) {
      const opening = contractCalls[0]!;
      const openingSuit = opening.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (opening.seat !== seat && opening.seat !== partner && openingSuit) {
        const hcp = points(hand);
        if (openingSuit === "clubs" || openingSuit === "diamonds") {
          const hearts = hand.filter((card) => card.suit === "hearts").length;
          const spades = hand.filter((card) => card.suit === "spades").length;
          if (hcp >= 8 && hearts >= 5 && spades >= 5) return Promise.resolve(`2${openingSuit}` as Bid);
        } else {
          const otherMajor = openingSuit === "hearts" ? "spades" : "hearts";
          const minorLength = Math.max(hand.filter((card) => card.suit === "clubs").length, hand.filter((card) => card.suit === "diamonds").length);
          if (hcp >= 10 && hand.filter((card) => card.suit === otherMajor).length >= 5 && minorLength >= 5) {
            return Promise.resolve(`2${openingSuit}` as Bid);
          }
        }
      }
    }
    if (contractCalls.length === 3) {
      const [opening, cueBid, inquiry] = contractCalls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat !== seat && opening?.seat !== partner && openingMajor &&
        cueBid?.seat === seat && cueBid.bid === `2${openingMajor}` && inquiry?.seat === partner && inquiry.bid === "2notrump"
      ) {
        const minor = (["clubs", "diamonds"] as const)
          .filter((suit) => hand.filter((card) => card.suit === suit).length >= 5)
          .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || (a === "clubs" ? -1 : 1))[0];
        if (minor) return Promise.resolve(`3${minor}` as Bid);
      }
    }
    if (auction.every(({ bid }) => bid === "pass")) {
      const hcp = points(hand);
      if (hcp >= 5 && hcp <= 11) {
        const suitOrder: readonly Suit[] = ["spades", "hearts", "diamonds"];
        const weakTwoSuit = suitOrder
          .filter((suit) => hasReasonableWeakTwoSuit(hand, suit) && !hasOutsideFourCardMajor(hand, suit))
          .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(a) - suitOrder.indexOf(b))[0];
        if (weakTwoSuit) return Promise.resolve(`2${weakTwoSuit}` as Bid);
      }
    }
    if (contractCalls.length === 1) {
      const [opening] = contractCalls;
      const weakTwoSuit = opening?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (opening?.seat === partner && weakTwoSuit) {
        const hcp = points(hand);
        const support = hand.filter((card) => card.suit === weakTwoSuit).length;
        const uncontested = auction.slice(auction.indexOf(opening) + 1).every(({ bid }) => bid === "pass");
        if (support < 3 && isBalanced(hand) && hcp >= 16) return Promise.resolve("3notrump");
        if (hcp >= 15) return Promise.resolve("2notrump");
        if (support >= 5) return Promise.resolve(`4${weakTwoSuit}` as Bid);
        if (support >= 3) return Promise.resolve(`3${weakTwoSuit}` as Bid);
        if (uncontested && hcp >= 10 && hcp < 15) {
          const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
          const openingRank = suitOrder.indexOf(weakTwoSuit);
          const newSuit = suitOrder
            .filter((suit) => suit !== weakTwoSuit && hand.filter((card) => card.suit === suit).length >= 5)
            .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || suitOrder.indexOf(b) - suitOrder.indexOf(a))[0];
          if (newSuit) {
            const level = suitOrder.indexOf(newSuit) > openingRank ? 2 : 3;
            return Promise.resolve(`${level}${newSuit}` as Bid);
          }
        }
      }
    }
    if (contractCalls.length === 2) {
      const [opening, inquiry] = contractCalls;
      const weakTwoSuit = opening?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responseSuit = inquiry?.bid.match(/^[23](clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === seat && weakTwoSuit && responseSuit && responseSuit !== weakTwoSuit && inquiry?.seat === partner &&
        points(hand) >= 5 && points(hand) <= 11
      ) {
        const responseLength = hand.filter((card) => card.suit === responseSuit).length;
        const responseIsMajor = responseSuit === "hearts" || responseSuit === "spades";
        if (responseIsMajor && responseLength >= 3) return Promise.resolve(atLegalLevel(`3${responseSuit}` as Bid, auction));
        if (points(hand) <= 8) return Promise.resolve(atLegalLevel(`3${weakTwoSuit}` as Bid, auction));
        const feature = suits.find((suit) => {
          if (suit === weakTwoSuit || suit === responseSuit) return false;
          const cards = hand.filter((card) => card.suit === suit);
          return cards.some((card) => card.rank === "A") ||
            (cards.length >= 2 && cards.some((card) => card.rank === "K")) ||
            (cards.length >= 4 && cards.some((card) => card.rank === "Q"));
        });
        // A feature that can no longer be shown at the three level is not worth going higher for: repeat the suit instead.
        const featureBid = feature ? `3${feature}` as Bid : "3notrump";
        return Promise.resolve(isLegalCall(featureBid, auction, seat) ? featureBid : atLegalLevel(`3${weakTwoSuit}` as Bid, auction));
      }
      if (opening?.seat === seat && weakTwoSuit && inquiry?.bid === "2notrump" && inquiry.seat === partner) {
        const hcp = points(hand);
        if (hcp <= 8) return Promise.resolve(`3${weakTwoSuit}` as Bid);
        const feature = suits.find((suit) =>
          suit !== weakTwoSuit && hand.some((card) => card.suit === suit && (card.rank === "A" || card.rank === "K"))
        );
        return Promise.resolve(feature ? `3${feature}` as Bid : "3notrump");
      }
    }
    if (contractCalls.length === 3) {
      const [opening, response, openerRebid] = contractCalls;
      const weakTwoSuit = opening?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responseSuit = response?.bid.match(/^[23](clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && weakTwoSuit && response?.seat === seat && responseSuit && responseSuit !== weakTwoSuit &&
        openerRebid?.seat === partner && openerRebid.bid.startsWith("3")
      ) {
        const hcp = points(hand);
        const openerSuitIsMajor = weakTwoSuit === "hearts" || weakTwoSuit === "spades";
        if (openerRebid.bid === `3${weakTwoSuit}`) {
          if (hcp >= 13 && openerSuitIsMajor && hand.filter((card) => card.suit === weakTwoSuit).length >= 2) {
            return Promise.resolve(`4${weakTwoSuit}` as Bid);
          }
          if (hcp >= 13 && isBalanced(hand)) return Promise.resolve("3notrump");
          return Promise.resolve("pass");
        }
        if (openerRebid.bid === "3notrump") return Promise.resolve("pass");
        const shownSuit = openerRebid.bid.slice(1) as Suit;
        if (hcp >= 13 && (shownSuit === "hearts" || shownSuit === "spades") && hand.filter((card) => card.suit === shownSuit).length >= 3) {
          return Promise.resolve(`4${shownSuit}` as Bid);
        }
        if (hcp >= 13 && isBalanced(hand)) return Promise.resolve("3notrump");
        return Promise.resolve("pass");
      }
    }
    if (contractCalls.length === 3 && auction.length === 6) {
      const [opening, inquiry, openerRebid] = contractCalls;
      const weakTwoSuit = opening?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && weakTwoSuit && inquiry?.bid === "2notrump" && inquiry.seat === seat &&
        openerRebid?.seat === partner && openerRebid.bid.startsWith("3")
      ) {
        const hcp = points(hand);
        const support = hand.filter((card) => card.suit === weakTwoSuit).length;
        if (openerRebid.bid === `3${weakTwoSuit}`) {
          if (hcp >= 18 && support >= 3) return Promise.resolve(`4${weakTwoSuit}` as Bid);
          return Promise.resolve("pass");
        }
        if (openerRebid.bid === "3notrump") return Promise.resolve("pass");
        if (hcp >= 15 && support >= 3) return Promise.resolve(`4${weakTwoSuit}` as Bid);
        if (hcp >= 15 && isBalanced(hand)) return Promise.resolve("3notrump");
      }
    }
    if (auction.length <= 4 && contractCalls.length === 3) {
      const [opening, takeoutDouble, raise] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const raiseMatch = raise?.bid.match(/^([23])(clubs|diamonds|hearts|spades)$/);
      const raiseSuit = raiseMatch?.[2] as Suit | undefined;
      if (
        opening && takeoutDouble && raise && openingSuit && raiseMatch && raiseSuit === openingSuit &&
        opening.seat !== seat && opening.seat !== partner && takeoutDouble.seat === partner &&
        raise.seat === SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]! &&
        auction.slice(2, -1).every(({ bid }) => bid === "pass")
      ) {
        const raiseLevel = Number(raiseMatch[1]);
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const responses = suitOrder
          .filter((suit) => suit !== openingSuit)
          .map((suit) => ({
            suit,
            level: suitOrder.indexOf(suit) > suitOrder.indexOf(openingSuit) ? raiseLevel : raiseLevel + 1,
            length: hand.filter((card) => card.suit === suit).length,
            major: suit === "hearts" || suit === "spades"
          }))
          .filter(({ length }) => length >= 4)
          .sort((a, b) => Number(b.major) - Number(a.major) || a.level - b.level || b.length - a.length || suitOrder.indexOf(b.suit) - suitOrder.indexOf(a.suit));
        const bestResponse = responses[0];
        if (supportPoints(hand, bestResponse?.suit ?? openingSuit) >= 12) {
          return Promise.resolve(`${raiseLevel + 1}${openingSuit}` as Bid);
        }
        if (bestResponse) {
          const totalPoints = supportPoints(hand, bestResponse.suit);
          if (totalPoints >= 6 && totalPoints <= 8) return Promise.resolve(`${bestResponse.level}${bestResponse.suit}` as Bid);
          if (totalPoints >= 9 && totalPoints <= 11 && bestResponse.level < 4) {
            return Promise.resolve(`${bestResponse.level + 1}${bestResponse.suit}` as Bid);
          }
        }
        return Promise.resolve("pass");
      }
    }
    if (auction.length === 5 && contractCalls.length === 3) {
      const [opening, takeoutDouble, advance] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const cueMatch = advance?.bid.match(/^([23])(clubs|diamonds|hearts|spades)$/);
      const cueSuit = cueMatch?.[2] as Suit | undefined;
      if (
        opening && takeoutDouble && advance && openingSuit && cueMatch && cueSuit === openingSuit &&
        opening.seat !== seat && opening.seat !== partner && takeoutDouble.seat === seat && advance.seat === partner &&
        auction[2]?.bid === "pass" && auction[4]?.seat === opening.seat && auction[4].bid === "pass"
      ) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const cueLevel = Number(cueMatch[1]);
        const response = suitOrder
          .filter((suit) => suit !== openingSuit)
          .map((suit) => ({
            suit,
            level: suitOrder.indexOf(suit) > suitOrder.indexOf(openingSuit) ? cueLevel : cueLevel + 1,
            length: hand.filter((card) => card.suit === suit).length,
            major: suit === "hearts" || suit === "spades"
          }))
          .filter(({ length, major }) => length >= (major ? 4 : 3))
          .sort((a, b) => Number(b.major) - Number(a.major) || b.length - a.length || suitOrder.indexOf(b.suit) - suitOrder.indexOf(a.suit))[0];
        if (response) return Promise.resolve(`${response.level}${response.suit}` as Bid);
      }
    }
    if (auction.length === 5 && contractCalls.length === 3 && auction.every(({ bid }) => bid === "pass" || bid === "double" || /^([123])(clubs|diamonds|hearts|spades)$/.test(bid))) {
      const [opening, takeoutDouble, advance] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const advanceMatch = advance?.bid.match(/^([123])(hearts|spades)$/);
      const advanceSuit = advanceMatch?.[2] as Suit | undefined;
      if (
        opening && takeoutDouble && advance && openingSuit && advanceMatch && advanceSuit &&
        opening.seat !== seat && opening.seat !== partner && takeoutDouble.seat === seat && advance.seat === partner &&
        auction[2]?.bid === "pass" && auction[4]?.seat === opening.seat && auction[4].bid === "pass"
      ) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const minimumLevel = suitOrder.indexOf(advanceSuit) > suitOrder.indexOf(openingSuit) ? 1 : 2;
        const advanceLevel = Number(advanceMatch[1]);
        const totalPoints = supportPoints(hand, advanceSuit);
        const support = hand.filter((card) => card.suit === advanceSuit).length;
        if (support >= 4) {
          if (advanceLevel > minimumLevel) {
            if (totalPoints >= 15) return Promise.resolve(`4${advanceSuit}` as Bid);
          } else if (totalPoints >= 19) {
            return Promise.resolve(`${advanceLevel + 2}${advanceSuit}` as Bid);
          } else if (totalPoints >= 16) {
            return Promise.resolve(`${advanceLevel + 1}${advanceSuit}` as Bid);
          }
        }
      }
    }
    if (auction.length <= 5 && contractCalls.length === 3 && auction.every(({ bid }) => bid === "pass" || /^(1|2|3)(clubs|diamonds|hearts|spades)$/.test(bid))) {
      const [opening, overcall, raiseCue] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const overcallMatch = overcall?.bid.match(/^([12])(clubs|diamonds|hearts|spades)$/);
      const overcallSuit = overcallMatch?.[2] as Suit | undefined;
      const cueMatch = raiseCue?.bid.match(/^([23])(clubs|diamonds|hearts|spades)$/);
      const cueSuit = cueMatch?.[2] as Suit | undefined;
      const simpleRaiseMatch = raiseCue?.bid.match(/^([23])(clubs|diamonds|hearts|spades)$/);
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      if (
        opening && overcall && raiseCue && opening.seat !== seat && opening.seat !== partner &&
        overcall.seat === seat && raiseCue.seat === partner && openingSuit && overcallSuit && overcallMatch &&
        cueSuit === openingSuit && cueMatch
      ) {
        const openingRank = suitOrder.indexOf(openingSuit);
        const overcallRank = suitOrder.indexOf(overcallSuit);
        const overcallLevel = Number(overcallMatch[1]);
        const cueLevel = Number(cueMatch[1]);
        const expectedCueLevel = overcallLevel === 1 || openingRank > overcallRank ? 2 : 3;
        if (cueLevel === expectedCueLevel) {
          const hcp = points(hand);
          if (hcp >= 15) return Promise.resolve(`${overcallSuit === "hearts" || overcallSuit === "spades" ? 4 : 5}${overcallSuit}` as Bid);
          if (hcp >= 11) {
            const sideSuit = suitOrder
              .filter((suit) => suit !== openingSuit && suit !== overcallSuit)
              .map((suit) => ({
                suit,
                level: suitOrder.indexOf(suit) > suitOrder.indexOf(openingSuit) ? cueLevel : cueLevel + 1,
                length: hand.filter((card) => card.suit === suit).length
              }))
              .filter(({ length }) => length >= 3)
              .sort((a, b) => a.level - b.level || b.length - a.length || suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit))[0];
            if (sideSuit) return Promise.resolve(`${sideSuit.level}${sideSuit.suit}` as Bid);
          }
          const overcallRank = suitOrder.indexOf(overcallSuit);
          const repeatLevel = overcallRank > openingRank ? cueLevel : cueLevel + 1;
          return Promise.resolve(`${repeatLevel}${overcallSuit}` as Bid);
        }
      }
      if (
        opening && overcall && raiseCue && opening.seat !== seat && opening.seat !== partner &&
        overcall.seat === seat && raiseCue.seat === partner && overcallSuit && overcallMatch && simpleRaiseMatch &&
        simpleRaiseMatch[2] === overcallSuit && Number(simpleRaiseMatch[1]) === Number(overcallMatch[1]) + 1
      ) {
        const hcp = points(hand);
        if (hcp >= 15) return Promise.resolve(`${overcallSuit === "hearts" || overcallSuit === "spades" ? 4 : 5}${overcallSuit}` as Bid);
        if (Number(overcallMatch[1]) === 1 && hcp >= 11 && hcp <= 14) {
          return Promise.resolve(`3${overcallSuit}` as Bid);
        }
      }
    }
    const isBalancingDoubleResponse = auction.length === 5 && auction[1]?.bid === "pass" && auction[2]?.bid === "pass" &&
      auction[3]?.bid === "double" && auction[3].seat === partner && auction[4]?.bid === "pass";
    if (
      (auction.length <= 3 || isBalancingDoubleResponse) && contractCalls.length === 2 &&
      auction.every(({ bid }) => bid === "pass" || bid === "double" || /^1(clubs|diamonds|hearts|spades)$/.test(bid))
    ) {
      const [opening, takeoutDouble] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const isPartnerDouble = takeoutDouble?.bid === "double" && takeoutDouble.seat === partner;
      if (
        opening && openingSuit && opening.seat !== seat && opening.seat !== partner && isPartnerDouble
      ) {
        const hcp = points(hand);
        if (hcp >= 12) return Promise.resolve(`2${openingSuit}` as Bid);
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const openingRank = suitOrder.indexOf(openingSuit);
        const suitResponses = suitOrder
          .filter((suit) => suit !== openingSuit)
          .map((suit) => ({
            suit,
            level: suitOrder.indexOf(suit) > openingRank ? 1 : 2,
            length: hand.filter((card) => card.suit === suit).length,
            major: suit === "hearts" || suit === "spades"
          }))
          .filter(({ length, major }) => length >= (major ? 4 : 3))
          .sort((a, b) => Number(b.major) - Number(a.major) || a.level - b.level || b.length - a.length || suitOrder.indexOf(b.suit) - suitOrder.indexOf(a.suit));
        const majorResponse = suitResponses.find(({ major }) => major);
        if (majorResponse && hcp <= 8) return Promise.resolve(`${majorResponse.level}${majorResponse.suit}` as Bid);
        if (majorResponse && hcp >= 9 && hcp <= 11) return Promise.resolve(`${majorResponse.level + 1}${majorResponse.suit}` as Bid);
        const openingSuitCards = hand.filter((card) => card.suit === openingSuit);
        const hasStopper = openingSuitCards.some((card) => card.rank === "A") ||
          (openingSuitCards.length >= 2 && openingSuitCards.some((card) => card.rank === "K")) ||
          (openingSuitCards.length >= 3 && openingSuitCards.some((card) => card.rank === "Q"));
        if (isBalanced(hand) && hasStopper && hcp >= 7 && hcp <= 10) return Promise.resolve("1notrump");
        if (isBalanced(hand) && hasStopper && hcp >= 11 && hcp <= 12) return Promise.resolve("2notrump");
        const minorResponse = suitResponses.find(({ major }) => !major);
        if (minorResponse && hcp <= 8) return Promise.resolve(`${minorResponse.level}${minorResponse.suit}` as Bid);
        if (minorResponse && hcp <= 11) return Promise.resolve(`${minorResponse.level + 1}${minorResponse.suit}` as Bid);
        if (minorResponse) return Promise.resolve(`${minorResponse.level}${minorResponse.suit}` as Bid);
      }
    }
    if (auction.length <= 3 && contractCalls.length === 2 && auction.every(({ bid }) => bid === "pass" || /^[12](clubs|diamonds|hearts|spades)$/.test(bid))) {
      const [opening, overcall] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const overcallMatch = overcall?.bid.match(/^([12])(clubs|diamonds|hearts|spades)$/);
      const overcallSuit = overcallMatch?.[2] as Suit | undefined;
      const support = overcallSuit ? hand.filter((card) => card.suit === overcallSuit).length : 0;
      const hcp = points(hand);
      const raisePoints = overcallSuit ? supportPoints(hand, overcallSuit) : 0;
      const openingSuitCards = openingSuit ? hand.filter((card) => card.suit === openingSuit) : [];
      const hasOpeningSuitStopper = openingSuitCards.some((card) => card.rank === "A") ||
        (openingSuitCards.length >= 2 && openingSuitCards.some((card) => card.rank === "K")) ||
        (openingSuitCards.length >= 3 && openingSuitCards.some((card) => card.rank === "Q"));
      if (
        opening && overcall && opening.seat !== seat && opening.seat !== partner &&
        overcall.seat === partner && openingSuit && overcallSuit && overcallMatch && support >= 3 && raisePoints >= 11
      ) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const openingRank = suitOrder.indexOf(openingSuit);
        const overcallRank = suitOrder.indexOf(overcallSuit);
        const overcallLevel = Number(overcallMatch[1]);
        const cueLevel = overcallLevel === 1 || openingRank > overcallRank ? 2 : 3;
        return Promise.resolve(`${cueLevel}${openingSuit}` as Bid);
      }
      if (
        opening && overcall && opening.seat !== seat && opening.seat !== partner &&
        overcall.seat === partner && openingSuit && overcallSuit && support >= 3 && raisePoints >= 6 && raisePoints <= 10
      ) return Promise.resolve(`${Number(overcallMatch![1]) + 1}${overcallSuit}` as Bid);
      if (opening && overcall && opening.seat !== seat && opening.seat !== partner && overcall.seat === partner && overcallSuit && overcallMatch) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const overcallLevel = Number(overcallMatch[1]);
        const overcallRank = suitOrder.indexOf(overcallSuit);
        const newSuit = suitOrder
          .filter((suit) => suit !== overcallSuit)
          .map((suit) => ({
            suit,
            level: overcallLevel === 1 && suitOrder.indexOf(suit) > overcallRank ? 1 :
              overcallLevel === 2 && suitOrder.indexOf(suit) > overcallRank ? 2 : overcallLevel + 1,
            length: hand.filter((card) => card.suit === suit).length
          }))
          .filter(({ level, length }) => length >= 5 && hcp >= (level === 1 ? 6 : 11))
          .sort((a, b) => a.level - b.level || b.length - a.length || suitOrder.indexOf(b.suit) - suitOrder.indexOf(a.suit))[0];
        if (newSuit) return Promise.resolve(`${newSuit.level}${newSuit.suit}` as Bid);
      }
      if (
        opening && overcall && opening.seat !== seat && opening.seat !== partner &&
        overcall.seat === partner && overcallMatch?.[1] === "1" && openingSuit && overcallSuit &&
        support < 3 && isBalanced(hand) && hasOpeningSuitStopper && hcp >= 8 && hcp <= 11
      ) return Promise.resolve("1notrump");
    }
    if (
      auction.length === 3 && auction[1]?.bid === "pass" && auction[2]?.bid === "pass" &&
      auction[0]?.seat === SEATS[(SEATS.indexOf(seat) + 1) % SEATS.length]!
    ) {
      const openingSuit = auction[0]?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (openingSuit) {
        const length = (suit: Suit) => hand.filter((card) => card.suit === suit).length;
        const openingLength = length(openingSuit);
        const shortnessPoints = openingLength === 0 ? 5 : openingLength === 1 ? 3 : openingLength === 2 ? 1 : 0;
        const unbidSuitsSupported = openingSuit === "hearts"
          ? length("spades") >= 4 && length("diamonds") >= 3 && length("clubs") >= 3
          : openingSuit === "spades"
            ? length("hearts") >= 4 && length("diamonds") >= 3 && length("clubs") >= 3
            : length("hearts") >= 4 && length("spades") >= 4 && length(openingSuit === "clubs" ? "diamonds" : "clubs") >= 3;
        if (points(hand) + shortnessPoints >= 10 && openingLength <= 2 && unbidSuitsSupported) {
          return Promise.resolve("double");
        }
      }
    }
    if (auction.length === 1 && auction[0]?.seat !== SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!) {
      const openingSuit = auction[0]?.bid.match(/^1(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (openingSuit) {
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const openingRank = suitOrder.indexOf(openingSuit);
        const length = (suit: Suit) => hand.filter((card) => card.suit === suit).length;
        const hcp = points(hand);
        const openingSuitCards = hand.filter((card) => card.suit === openingSuit);
        const hasOpeningSuitStopper = openingSuitCards.some((card) => card.rank === "A") ||
          (openingSuitCards.length >= 2 && openingSuitCards.some((card) => card.rank === "K")) ||
          (openingSuitCards.length >= 3 && openingSuitCards.some((card) => card.rank === "Q"));
        const lowestTwoUnbid = suitOrder.filter((suit) => suit !== openingSuit).slice(0, 2);
        if (lowestTwoUnbid.every((suit) => length(suit) >= 5)) {
          return Promise.resolve("2notrump");
        }
        if (hcp >= 5 && hcp <= 11) {
          const jumpMajor = (["spades", "hearts"] as const)
            .filter((suit) => suit !== openingSuit && hasReasonableWeakTwoSuit(hand, suit))
            .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || Number(b === "spades") - Number(a === "spades"))[0];
          if (jumpMajor) return Promise.resolve(`2${jumpMajor}` as Bid);
          const jumpMinor = (["clubs", "diamonds"] as const)
            .filter((suit) => suit !== openingSuit && hasReasonablePreemptiveSuit(hand, suit, 7))
            .sort((a, b) => hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length || Number(b === "diamonds") - Number(a === "diamonds"))[0];
          if (jumpMinor) return Promise.resolve(`3${jumpMinor}` as Bid);
        }
        if (isBalanced(hand) && hcp >= 15 && hcp <= 18 && hasOpeningSuitStopper) return Promise.resolve("1notrump");
        const longest = (candidates: readonly Suit[]) => [...candidates]
          .map((suit) => ({ suit, length: length(suit) }))
          .filter(({ length: suitLength }) => suitLength >= 5)
          .sort((a, b) => b.length - a.length || suitOrder.indexOf(b.suit) - suitOrder.indexOf(a.suit))[0]?.suit;
        const oneLevelSuit = hcp >= 8
          ? longest(suitOrder.filter((suit) => suitOrder.indexOf(suit) > openingRank))
          : undefined;
        if (oneLevelSuit) return Promise.resolve(`1${oneLevelSuit}` as Bid);
        const twoLevelSuit = hcp >= 10
          ? longest(suitOrder.filter((suit) => suit !== openingSuit))
          : undefined;
        if (twoLevelSuit) return Promise.resolve(`2${twoLevelSuit}` as Bid);
        const openingLength = length(openingSuit);
        const shortnessPoints = openingLength === 0 ? 5 : openingLength === 1 ? 3 : openingLength === 2 ? 1 : 0;
        const unbidSuitsSupported = openingSuit === "hearts"
          ? length("spades") >= 4 && length("diamonds") >= 3 && length("clubs") >= 3
          : openingSuit === "spades"
            ? length("hearts") >= 4 && length("diamonds") >= 3 && length("clubs") >= 3
            : length("hearts") >= 4 && length("spades") >= 4 && length(openingSuit === "clubs" ? "diamonds" : "clubs") >= 3;
        if (hcp + shortnessPoints >= 13 && openingLength <= 2 && unbidSuitsSupported) {
          return Promise.resolve("double");
        }
      }
    }
    if (auction.length === 4 && contractCalls.length === 3) {
      const [opening, response, overcall] = contractCalls;
      const openingSuit = opening?.bid.match(/^1(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const responseSuit = response?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const overcallMatch = overcall?.bid.match(/^([12])(clubs|diamonds|hearts|spades)$/);
      if (
        opening && response && overcall && openingSuit && responseSuit && overcallMatch &&
        opening.seat === seat && response.seat === partner && overcall.seat !== seat && overcall.seat !== partner &&
        auction[1]?.bid === "pass" && auction[3]?.seat === overcall.seat
      ) {
        const support = hand.filter((card) => card.suit === responseSuit).length;
        if (support >= 4) return Promise.resolve(`${Number(overcallMatch[1]) + 1}${responseSuit}` as Bid);
        if (support === 3) return Promise.resolve("double");
      }
    }
    return this.biddingBot.chooseBid(hand, auction, seat);
  }

  async chooseCard(context: PlayContext) {
    const choices = legalCards(context);
    const partner = SEATS[(SEATS.indexOf(context.seat) + 2) % SEATS.length]!;
    if (context.currentTrick.length === 1) {
      const lead = context.currentTrick[0]?.card;
      const leadRank = lead ? rankValue(lead.rank) : -1;
      const honorRanks = new Set(["J", "Q", "K", "A"]);
      const cover = lead && context.currentTrick[0]?.seat !== partner && honorRanks.has(lead.rank)
        ? choices.filter((card) => card.suit === lead.suit && honorRanks.has(card.rank) && rankValue(card.rank) > leadRank)
        : [];
      return cover.length ? lowestCard(cover) : lowestCard(choices);
    }
    const ledSuit = context.ledSuit ?? context.currentTrick[0]?.card.suit;
    if (!ledSuit || context.currentTrick.length === 0) {
      return topOfTouchingHonorSequence(choices) ?? fourthHighestFromLongestSuit(choices) ?? lowestCard(choices);
    }

    const currentWinner = winningPlay(context.currentTrick, ledSuit, context.trump);
    if ((SEATS.indexOf(currentWinner.seat) % 2) === (SEATS.indexOf(partner) % 2)) return lowestCard(choices);

    const winningCards = choices.filter((card) => {
      const plays = [...context.currentTrick, { seat: context.seat, card }];
      return winningPlay(plays, ledSuit, context.trump).seat === context.seat;
    });
    return lowestCard(winningCards.length ? winningCards : choices);
  }
}

/** Advanced bidding follows Intermediate; third hand pressures a small lead with its top touching honor. */
export class AdvancedBot implements BotPlayer {
  readonly config: BotConfig;
  private readonly intermediateBot: IntermediateBot;

  constructor(config: BotConfig) {
    if (config.skill !== "advanced") throw new Error("AdvancedBot requires advanced skill");
    this.config = config;
    this.intermediateBot = new IntermediateBot({ ...config, skill: "intermediate" });
  }

  chooseBid(hand: Hand, auction: readonly PublicBid[], seat: Seat): Promise<Bid> {
    return this.intermediateBot.chooseBid(hand, auction, seat);
  }

  async chooseCard(context: PlayContext) {
    const ledSuit = context.ledSuit ?? context.currentTrick[0]?.card.suit;
    const partner = SEATS[(SEATS.indexOf(context.seat) + 2) % SEATS.length]!;
    if (ledSuit && context.currentTrick.length === 2) {
      const currentWinner = winningPlay(context.currentTrick, ledSuit, context.trump);
      if (currentWinner.seat === partner) {
        const sequence = topOfTouchingHonorSequence(legalCards(context).filter((card) => card.suit === ledSuit));
        if (sequence) return sequence;
      }
    }
    return this.intermediateBot.chooseCard(context);
  }
}

/** Expert adds Gerber ace-asking after a direct notrump opening to Advanced play. */
export class ExpertBot implements BotPlayer {
  readonly config: BotConfig;
  private readonly advancedBot: AdvancedBot;

  constructor(config: BotConfig) {
    if (config.skill !== "expert") throw new Error("ExpertBot requires expert skill");
    this.config = config;
    this.advancedBot = new AdvancedBot({ ...config, skill: "advanced" });
  }

  chooseBid(hand: Hand, auction: readonly PublicBid[], seat: Seat): Promise<Bid> {
    const calls = auction.filter(({ bid }) => bid !== "pass");
    const partner = SEATS[(SEATS.indexOf(seat) + 2) % SEATS.length]!;
    const isNotrumpOpening = (bid: Bid | undefined) => bid === "1notrump" || bid === "2notrump";
    const twoOverOneSideMajorFit = (): { readonly openingSeat: Seat; readonly responderSeat: Seat; readonly major: Suit } | undefined => {
      if (this.config.biddingStyle !== "2/1" || calls.length < 5) return undefined;
      const [opening, response, openerRebid, sideMajorResponse, openerRaise] = calls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (!opening || !openingMajor || !response || !openerRebid || !sideMajorResponse || !openerRaise) return undefined;
      const responderSeat = SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]!;
      const sideMajor = openingMajor === "hearts" ? "spades" : "hearts";
      if (
        !passedBeforeOpening(auction, responderSeat, opening) &&
        response.seat === responderSeat && response.bid === "2clubs" &&
        openerRebid.seat === opening.seat && openerRebid.bid === "2diamonds" &&
        sideMajorResponse.seat === responderSeat && sideMajorResponse.bid === `2${sideMajor}` &&
        openerRaise.seat === opening.seat && openerRaise.bid === `3${sideMajor}`
      ) return { openingSeat: opening.seat, responderSeat, major: sideMajor };
      return undefined;
    };
    const twoOverOneNaturalSideMajorGame = (): { readonly openingSeat: Seat; readonly responderSeat: Seat; readonly major: Suit } | undefined => {
      if (this.config.biddingStyle !== "2/1" || calls.length < 4) return undefined;
      const [opening, response, openerRebid, responderGame] = calls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const responseMinor = response?.bid.match(/^2(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const shownMajor = openerRebid?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      const responderSeat = opening ? SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]! : undefined;
      if (
        !opening || !openingMajor || !response || !responseMinor || !openerRebid || !shownMajor || !responderGame || !responderSeat ||
        shownMajor === openingMajor || shownMajor === responseMinor ||
        passedBeforeOpening(auction, responderSeat, opening) ||
        response.seat !== responderSeat || openerRebid.seat !== opening.seat ||
        responderGame.seat !== responderSeat || responderGame.bid !== `4${shownMajor}`
      ) return undefined;
      return { openingSeat: opening.seat, responderSeat, major: shownMajor };
    };
    const twoOverOneRaisedSuit = (): Suit | undefined => {
      if (this.config.biddingStyle !== "2/1" || calls.length < 3) return undefined;
      const [opening, response, openerRaise] = calls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const responseSuit = response?.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responderSeat = opening ? SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]! : undefined;
      if (
        !opening || !openingMajor || !response || !responseSuit || responseSuit === openingMajor || !openerRaise || !responderSeat ||
        passedBeforeOpening(auction, responderSeat, opening) ||
        response.seat !== responderSeat || openerRaise.seat !== opening.seat
      ) {
        return undefined;
      }
      if (openerRaise.bid === `3${openingMajor}`) return openingMajor;
      if (responseSuit !== openingMajor && openerRaise.bid === `3${responseSuit}`) return responseSuit;
      return undefined;
    };
    const weakThreeOpening = () => {
      const opening = calls[0];
      const suit = opening?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (!opening || !suit) return undefined;
      const responderSeat = SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]!;
      if (passedBeforeOpening(auction, responderSeat, opening)) return undefined;
      return { opening, suit, responderSeat };
    };
    const weakThreeMajorFitAuction = () => {
      const [opening, response, raise] = calls;
      const openingSuit = opening?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const major = response?.bid.match(/^3(hearts|spades)$/)?.[1] as Suit | undefined;
      const spadeOpeningToHeartResponse = opening?.bid === "3spades" && response?.bid === "4hearts";
      const heartOpeningToSpadeResponse = opening?.bid === "3hearts" && response?.bid === "3spades";
      const minorOpeningToMajorResponse = (opening?.bid === "3clubs" || opening?.bid === "3diamonds") && major;
      const agreedMajor = major ?? (spadeOpeningToHeartResponse ? "hearts" : undefined);
      if (!opening || !openingSuit || !response || !agreedMajor || !raise) return undefined;
      const responderSeat = SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]!;
      const expectedRaise = spadeOpeningToHeartResponse ? "5hearts" : `4${agreedMajor}`;
      if (
        response.seat !== responderSeat || raise.seat !== opening.seat ||
        !(minorOpeningToMajorResponse || heartOpeningToSpadeResponse || spadeOpeningToHeartResponse) ||
        raise.bid !== expectedRaise || passedBeforeOpening(auction, responderSeat, opening) ||
        auction.some(({ seat, bid }) => seat !== opening.seat && seat !== responderSeat && bid !== "pass")
      ) return undefined;
      return { opening, openingSuit, major: agreedMajor, responderSeat };
    };
    const blackwoodTrump = (): Suit | undefined => {
      const [opening, response, openerRebid] = calls;
      const major = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const expectedResponder = opening ? SEATS[(SEATS.indexOf(opening.seat) + 2) % SEATS.length]! : undefined;
      if (!opening || !major || !response || !openerRebid || response.seat !== expectedResponder || openerRebid.seat !== opening.seat) return undefined;
      const saycJumpShift = this.config.biddingStyle === "SAYC" ? saycJumpShiftAuction(auction, "SAYC") : undefined;
      if (
        saycJumpShift && (saycJumpShift.responseSuit === "hearts" || saycJumpShift.responseSuit === "spades") &&
        openerRebid.bid === `4${saycJumpShift.responseSuit}`
      ) return saycJumpShift.responseSuit;
      if (response.bid === "2notrump" && /^3(clubs|diamonds|hearts|spades)$/.test(openerRebid.bid) && openerRebid.bid !== `3${major}`) return major;
      const raisedSuit = twoOverOneRaisedSuit();
      if (raisedSuit) return raisedSuit;
      const sideMajorFit = twoOverOneSideMajorFit();
      if (sideMajorFit) return sideMajorFit.major;
      const acceptedSplinter = splinterSequence(opening, response);
      if (acceptedSplinter && openerRebid.bid === `4${acceptedSplinter.major}`) return acceptedSplinter.major;
      return undefined;
    };

    const sideMajorBlackwoodFit = twoOverOneSideMajorFit();
    const naturalSideMajorGame = twoOverOneNaturalSideMajorGame();
    const agreedBlackwoodMajor = blackwoodTrump();
    const saycJumpShift = this.config.biddingStyle === "SAYC" ? saycJumpShiftAuction(auction, "SAYC") : undefined;
    const saycJumpShiftBlackwoodMajor = saycJumpShift &&
      (saycJumpShift.responseSuit === "hearts" || saycJumpShift.responseSuit === "spades") &&
      calls[2]?.bid === `4${saycJumpShift.responseSuit}`
      ? saycJumpShift.responseSuit
      : undefined;
    const weakThree = weakThreeOpening();
    const weakThreeMajorFit = weakThreeMajorFitAuction();
    const contractBidRank = (bid: Bid): number => {
      const match = bid.match(/^([1-7])(clubs|diamonds|hearts|spades|notrump)$/);
      if (!match) return -1;
      return Number(match[1]) * 5 + ["clubs", "diamonds", "hearts", "spades", "notrump"].indexOf(match[2]!);
    };
    if (
      calls.length === 3 && weakThreeMajorFit?.responderSeat === seat && points(hand) >= 19 &&
      hand.filter((card) => card.suit === weakThreeMajorFit.major).length >= 6 &&
      weakThreeMajorFit.opening.bid !== "3spades"
    ) return Promise.resolve("4notrump");

    if (calls.length === 3 && weakThreeMajorFit?.responderSeat === seat) {
      const majorLength = hand.filter((card) => card.suit === weakThreeMajorFit.major).length;
      const canAskBlackwood = weakThreeMajorFit.opening.bid !== "3spades" && points(hand) >= 19 && majorLength >= 6;
      if (points(hand) >= 18 && majorLength >= 6 && !canAskBlackwood) return Promise.resolve("5notrump");
    }

    if (
      calls.length === 4 && weakThreeMajorFit?.opening.seat === seat &&
      calls[3]?.seat === partner && calls[3].bid === "5notrump"
    ) {
      const topTrumpHonors = hand.filter((card) => card.suit === weakThreeMajorFit.major && ["A", "K", "Q"].includes(card.rank)).length;
      return Promise.resolve(`${topTrumpHonors >= 2 ? 7 : 6}${weakThreeMajorFit.major}` as Bid);
    }

    if (
      calls.length === 4 && weakThreeMajorFit?.opening.seat === seat && calls[3]?.seat === partner &&
      calls[3].bid === "4notrump"
    ) {
      const aces = aceCount(hand);
      if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
      if (aces === 1) return Promise.resolve("5diamonds");
      if (aces === 2) return Promise.resolve("5hearts");
      return Promise.resolve("5spades");
    }

    if (
      calls.length === 5 && weakThreeMajorFit?.responderSeat === seat && calls[3]?.seat === seat &&
      calls[3].bid === "4notrump" && calls[4]?.seat === partner &&
      ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[4].bid)
    ) {
      const partnerAces = calls[4].bid === "5clubs" ? 0 : calls[4].bid === "5diamonds" ? 1 : calls[4].bid === "5hearts" ? 2 : 3;
      const combinedAces = aceCount(hand) + partnerAces;
      if (combinedAces === 4) {
        const ownKings = hand.filter((card) => card.rank === "K").length;
        if (ownKings === 0) return Promise.resolve(`6${weakThreeMajorFit.major}` as Bid);
        if (ownKings === 4) return Promise.resolve(`7${weakThreeMajorFit.major}` as Bid);
        return Promise.resolve("5notrump");
      }
      return Promise.resolve(`${combinedAces >= 3 ? 6 : 5}${weakThreeMajorFit.major}` as Bid);
    }

    if (
      calls.length === 6 && weakThreeMajorFit?.opening.seat === seat && calls[3]?.seat === partner &&
      calls[3].bid === "4notrump" && calls[4]?.seat === seat &&
      ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[4].bid) && calls[5]?.seat === partner &&
      calls[5].bid === "5notrump"
    ) {
      const kings = hand.filter((card) => card.rank === "K").length;
      if (kings === 0 || kings === 4) return Promise.resolve("6clubs");
      if (kings === 1) return Promise.resolve("6diamonds");
      if (kings === 2) return Promise.resolve("6hearts");
      return Promise.resolve("6spades");
    }

    if (
      calls.length === 7 && weakThreeMajorFit?.responderSeat === seat && calls[3]?.seat === seat &&
      calls[3].bid === "4notrump" && calls[4]?.seat === partner &&
      ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[4].bid) &&
      calls[5]?.seat === seat && calls[5].bid === "5notrump" && calls[6]?.seat === partner &&
      ["6clubs", "6diamonds", "6hearts", "6spades"].includes(calls[6].bid)
    ) {
      const partnerAces = calls[4].bid === "5clubs" ? 0 : calls[4].bid === "5diamonds" ? 1 : calls[4].bid === "5hearts" ? 2 : 3;
      const partnerKings = calls[6].bid === "6clubs" ? 0 : calls[6].bid === "6diamonds" ? 1 : calls[6].bid === "6hearts" ? 2 : 3;
      const allAcesKnown = aceCount(hand) + partnerAces === 4;
      const allKingsKnown = hand.filter((card) => card.rank === "K").length + partnerKings === 4;
      if (allAcesKnown && allKingsKnown) return Promise.resolve(`7${weakThreeMajorFit.major}` as Bid);
      if (contractBidRank(calls[6].bid) >= contractBidRank(`6${weakThreeMajorFit.major}`)) return Promise.resolve("pass");
      return Promise.resolve(`6${weakThreeMajorFit.major}` as Bid);
    }

    if (
      calls.length === 8 && weakThreeMajorFit?.opening.seat === seat && calls[7]?.seat === partner &&
      calls[3]?.seat === partner && calls[3].bid === "4notrump" && calls[4]?.seat === seat &&
      ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[4].bid) &&
      calls[5]?.seat === partner && calls[5].bid === "5notrump" && calls[6]?.seat === seat &&
      ["6clubs", "6diamonds", "6hearts", "6spades"].includes(calls[6].bid) &&
      (calls[7].bid === `6${weakThreeMajorFit.major}` || calls[7].bid === `7${weakThreeMajorFit.major}`)
    ) return Promise.resolve("pass");

    if (
      calls.length === 1 && weakThree?.opening.seat === partner && auction.every(({ bid }) => bid === "pass" || bid === weakThree.opening.bid) &&
      points(hand) >= 19 && hand.filter((card) => card.suit === weakThree.suit).length >= ((weakThree.suit === "hearts" || weakThree.suit === "spades") ? 3 : 5)
    ) return Promise.resolve("4notrump");

    if (
      calls.length === 2 && weakThree?.opening.seat === seat && calls[1]?.seat === partner && calls[1].bid === "4notrump" &&
      auction.every(({ bid }) => bid === "pass" || bid === weakThree.opening.bid || bid === "4notrump")
    ) {
      const aces = aceCount(hand);
      if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
      if (aces === 1) return Promise.resolve("5diamonds");
      if (aces === 2) return Promise.resolve("5hearts");
      return Promise.resolve("5spades");
    }

    if (
      calls.length === 3 && weakThree?.opening.seat === partner && calls[1]?.seat === seat && calls[1].bid === "4notrump" &&
      calls[2]?.seat === partner && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[2].bid) &&
      auction.every(({ bid }) => bid === "pass" || [weakThree.opening.bid, "4notrump", calls[2]!.bid].includes(bid))
    ) {
      const partnerAces = calls[2].bid === "5clubs" ? 0 : calls[2].bid === "5diamonds" ? 1 : calls[2].bid === "5hearts" ? 2 : 3;
      const combinedAces = aceCount(hand) + partnerAces;
      if (combinedAces === 4) {
        const ownKings = hand.filter((card) => card.rank === "K").length;
        if (ownKings === 0) return Promise.resolve(`6${weakThree.suit}` as Bid);
        if (ownKings === 4) return Promise.resolve(`7${weakThree.suit}` as Bid);
        return Promise.resolve("5notrump");
      }
      return Promise.resolve(`${combinedAces >= 3 ? 6 : 5}${weakThree.suit}` as Bid);
    }

    if (
      calls.length === 4 && weakThree?.opening.seat === seat && calls[1]?.seat === partner && calls[1].bid === "4notrump" &&
      calls[2]?.seat === seat && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[2].bid) &&
      calls[3]?.seat === partner && calls[3].bid === "5notrump" &&
      auction.every(({ bid }) => bid === "pass" || [weakThree.opening.bid, "4notrump", calls[2]!.bid, "5notrump"].includes(bid))
    ) {
      const kings = hand.filter((card) => card.rank === "K").length;
      if (kings === 0 || kings === 4) return Promise.resolve("6clubs");
      if (kings === 1) return Promise.resolve("6diamonds");
      if (kings === 2) return Promise.resolve("6hearts");
      return Promise.resolve("6spades");
    }

    if (
      calls.length === 5 && weakThree?.opening.seat === partner && calls[1]?.seat === seat && calls[1].bid === "4notrump" &&
      calls[2]?.seat === partner && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[2].bid) &&
      calls[3]?.seat === seat && calls[3].bid === "5notrump" && calls[4]?.seat === partner &&
      ["6clubs", "6diamonds", "6hearts", "6spades"].includes(calls[4].bid) &&
      auction.every(({ bid }) => bid === "pass" || [weakThree.opening.bid, "4notrump", calls[2]!.bid, "5notrump", calls[4]!.bid].includes(bid))
    ) {
      const partnerKings = calls[4].bid === "6clubs" ? 0 : calls[4].bid === "6diamonds" ? 1 : calls[4].bid === "6hearts" ? 2 : 3;
      const partnerAces = calls[2].bid === "5clubs" ? 0 : calls[2].bid === "5diamonds" ? 1 : calls[2].bid === "5hearts" ? 2 : 3;
      const allAcesKnown = aceCount(hand) + partnerAces === 4;
      const allKingsKnown = hand.filter((card) => card.rank === "K").length + partnerKings === 4;
      if (allAcesKnown && allKingsKnown) return Promise.resolve(`7${weakThree.suit}` as Bid);
      if (contractBidRank(calls[4].bid) >= contractBidRank(`6${weakThree.suit}`)) return Promise.resolve("pass");
      return Promise.resolve(`6${weakThree.suit}` as Bid);
    }

    if (
      calls.length === 4 && weakThree?.opening.seat === seat && calls[1]?.seat === partner && calls[1].bid === "4notrump" &&
      calls[2]?.seat === seat && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[2].bid) &&
      calls[3]?.seat === partner && (calls[3].bid === `5${weakThree.suit}` || calls[3].bid === `6${weakThree.suit}`)
    ) return Promise.resolve("pass");

    if (
      calls.length === 3 && this.config.biddingStyle === "SAYC" &&
      saycJumpShiftBlackwoodMajor &&
      calls[0]?.seat === partner && calls[1]?.seat === seat && calls[2]?.seat === partner &&
      calls[2].bid === `4${saycJumpShiftBlackwoodMajor}` && points(hand) >= 18
    ) {
      const topTrumpHonors = hand.filter((card) => card.suit === saycJumpShiftBlackwoodMajor && ["A", "K", "Q"].includes(card.rank)).length;
      return Promise.resolve(topTrumpHonors >= 2 ? "5notrump" : "4notrump");
    }

    if (
      calls.length === 4 && saycJumpShiftBlackwoodMajor && calls[0]?.seat === seat && calls[1]?.seat === partner &&
      calls[2]?.seat === seat && calls[2].bid === `4${saycJumpShiftBlackwoodMajor}` &&
      calls[3]?.seat === partner && calls[3].bid === "5notrump"
    ) {
      const topTrumpHonors = hand.filter((card) => card.suit === saycJumpShiftBlackwoodMajor && ["A", "K", "Q"].includes(card.rank)).length;
      return Promise.resolve(`${topTrumpHonors >= 2 ? 7 : 6}${saycJumpShiftBlackwoodMajor}` as Bid);
    }

    if (
      calls.length === 4 && saycJumpShiftBlackwoodMajor && agreedBlackwoodMajor && calls[3]?.seat === partner && calls[3].bid === "4notrump"
    ) {
      const aces = aceCount(hand);
      if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
      if (aces === 1) return Promise.resolve("5diamonds");
      if (aces === 2) return Promise.resolve("5hearts");
      return Promise.resolve("5spades");
    }

    if (
      calls.length === 5 && saycJumpShiftBlackwoodMajor && agreedBlackwoodMajor && calls[3]?.seat === seat && calls[3].bid === "4notrump" &&
      calls[4]?.seat === partner && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[4].bid)
    ) {
      const ownAces = aceCount(hand);
      const partnerAces = calls[4].bid === "5clubs" ? undefined : calls[4].bid === "5diamonds" ? 1 : calls[4].bid === "5hearts" ? 2 : 3;
      const allAcesKnown = partnerAces === undefined ? ownAces === 4 : ownAces + partnerAces === 4;
      if (allAcesKnown) return Promise.resolve("5notrump");
      if (partnerAces === undefined ? ownAces >= 3 : ownAces + partnerAces >= 3) {
        return Promise.resolve(`6${agreedBlackwoodMajor}` as Bid);
      }
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      return Promise.resolve(suitOrder.indexOf(agreedBlackwoodMajor) > suitOrder.indexOf(calls[4].bid.slice(1) as Suit)
        ? `5${agreedBlackwoodMajor}` as Bid
        : "pass");
    }

    if (
      calls.length === 5 && agreedBlackwoodMajor && calls[3]?.seat === seat && calls[3].bid === "4notrump" &&
      calls[4]?.seat === partner && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[4].bid)
    ) {
      const ownAces = aceCount(hand);
      const partnerAces = calls[4].bid === "5clubs" ? undefined : calls[4].bid === "5diamonds" ? 1 : calls[4].bid === "5hearts" ? 2 : 3;
      const allAcesKnown = partnerAces === undefined ? ownAces === 4 : ownAces + partnerAces === 4;
      if (allAcesKnown) return Promise.resolve("5notrump");
    }

    if (
      calls.length === 6 && agreedBlackwoodMajor && calls[3]?.seat === partner && calls[3].bid === "4notrump" &&
      calls[4]?.seat === seat && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[4].bid) &&
      calls[5]?.seat === partner && calls[5].bid === "5notrump"
    ) {
      const kings = hand.filter((card) => card.rank === "K").length;
      if (kings === 0 || kings === 4) return Promise.resolve("6clubs");
      if (kings === 1) return Promise.resolve("6diamonds");
      if (kings === 2) return Promise.resolve("6hearts");
      return Promise.resolve("6spades");
    }

    if (
      calls.length === 7 && agreedBlackwoodMajor && calls[3]?.bid === "4notrump" &&
      calls[4]?.seat === partner && calls[5]?.seat === seat && calls[5].bid === "5notrump" && calls[6]?.seat === partner
    ) {
      const ownKings = hand.filter((card) => card.rank === "K").length;
      const partnerKings = calls[6].bid === "6clubs" ? (ownKings === 4 ? 4 : undefined)
        : calls[6].bid === "6diamonds" ? 1
          : calls[6].bid === "6hearts" ? 2
            : calls[6].bid === "6spades" ? 3
              : calls[6].bid === "6notrump" ? 4 : undefined;
      const allKingsKnown = partnerKings === 4 || (partnerKings !== undefined && ownKings + partnerKings === 4);
      return Promise.resolve(placeAfterKingReply(`${allKingsKnown ? 7 : 6}${agreedBlackwoodMajor}` as Bid, calls[6].bid, auction));
    }

    if (calls.length === 1 && calls[0]?.seat === partner && (calls[0].bid === "1notrump" || calls[0].bid === "2notrump")) {
      const hearts = hand.filter((card) => card.suit === "hearts").length;
      const spades = hand.filter((card) => card.suit === "spades").length;
      const hcp = points(hand);
      const gameOnlyRange = calls[0].bid === "1notrump" ? hcp >= 8 && hcp <= 9 : hcp <= 9;
      if (gameOnlyRange) {
        if (spades >= 6) return Promise.resolve("4hearts");
        if (hearts >= 6) return Promise.resolve("4diamonds");
      }
    }

    if (calls.length === 2) {
      const [opening, transfer] = calls;
      if (opening && isNotrumpOpening(opening.bid) && opening.seat === seat && transfer?.seat === partner) {
        if (transfer.bid === "4diamonds") return Promise.resolve("4hearts");
        if (transfer.bid === "4hearts") return Promise.resolve("4spades");
      }
    }

    if (calls.length === 3) {
      const [opening, transfer, acceptance] = calls;
      if (
        opening && isNotrumpOpening(opening.bid) && opening.seat === partner && transfer?.seat === seat && acceptance?.seat === partner &&
        ((transfer.bid === "4diamonds" && acceptance.bid === "4hearts") ||
          (transfer.bid === "4hearts" && acceptance.bid === "4spades"))
      ) return Promise.resolve("pass");
    }

    if (calls.length === 1 && calls[0]?.seat === partner && calls[0].bid === "2notrump") {
      const hearts = hand.filter((card) => card.suit === "hearts").length;
      const spades = hand.filter((card) => card.suit === "spades").length;
      const noFourCardMajor = hearts < 4 && spades < 4;
      const keepQuantitativeOrGerber = noFourCardMajor && isBalanced(hand) && points(hand) >= 12;
      if (Math.max(hearts, spades) < 5 && Math.max(hearts, spades) >= 3 && !keepQuantitativeOrGerber) {
        return Promise.resolve("3clubs");
      }
    }

    if (calls.length === 2) {
      const [opening, puppet] = calls;
      if (opening?.seat === seat && opening.bid === "2notrump" && puppet?.seat === partner && puppet.bid === "3clubs") {
        const hearts = hand.filter((card) => card.suit === "hearts").length;
        const spades = hand.filter((card) => card.suit === "spades").length;
        if (hearts >= 5) return Promise.resolve("3hearts");
        if (spades >= 5) return Promise.resolve("3spades");
        if (hearts >= 4 || spades >= 4) return Promise.resolve("3diamonds");
        return Promise.resolve("3notrump");
      }
    }

    if (calls.length === 3) {
      const [opening, puppet, response] = calls;
      if (opening?.seat === partner && opening.bid === "2notrump" && puppet?.seat === seat && puppet.bid === "3clubs" && response?.seat === partner) {
        if (response.bid === "3notrump") {
          const hearts = hand.filter((card) => card.suit === "hearts").length;
          const spades = hand.filter((card) => card.suit === "spades").length;
          if (spades >= 6 && hearts >= 4) return Promise.resolve("4hearts");
          if (hearts >= 6 && spades >= 4) return Promise.resolve("4diamonds");
        }
        if (response.bid === "3hearts" || response.bid === "3spades") {
          const shownMajor = response.bid.slice(1) as Suit;
          return Promise.resolve(hand.filter((card) => card.suit === shownMajor).length >= 3 ? `4${shownMajor}` as Bid : "3notrump");
        }
        if (response.bid === "3diamonds") {
          const hearts = hand.filter((card) => card.suit === "hearts").length;
          const spades = hand.filter((card) => card.suit === "spades").length;
          if (hearts >= 4 && spades >= 4) return Promise.resolve("4diamonds");
          if (hearts >= 4) return Promise.resolve("3spades");
          if (spades >= 4) return Promise.resolve("3hearts");
          return Promise.resolve("3notrump");
        }
      }
    }

    if (calls.length === 4) {
      const [opening, puppet, fourMajorReply, responderMajor] = calls;
      if (
        opening?.seat === seat && opening.bid === "2notrump" && puppet?.seat === partner && puppet.bid === "3clubs" &&
        fourMajorReply?.seat === seat && fourMajorReply.bid === "3notrump" && responderMajor?.seat === partner
      ) {
        if (responderMajor.bid === "4diamonds") return Promise.resolve("4hearts");
        if (responderMajor.bid === "4hearts") return Promise.resolve("4spades");
      }
      if (
        opening?.seat === seat && opening.bid === "2notrump" && puppet?.seat === partner && puppet.bid === "3clubs" &&
        fourMajorReply?.seat === seat && fourMajorReply.bid === "3diamonds" && responderMajor?.seat === partner
      ) {
        if (responderMajor.bid === "4diamonds") {
          const hearts = hand.filter((card) => card.suit === "hearts").length;
          const spades = hand.filter((card) => card.suit === "spades").length;
          if (spades >= 4 && spades >= hearts) return Promise.resolve("4spades");
          if (hearts >= 4) return Promise.resolve("4hearts");
          if (spades >= 4) return Promise.resolve("4spades");
        }
        const shownMajor = responderMajor.bid === "3spades" ? "hearts" : responderMajor.bid === "3hearts" ? "spades" : undefined;
        if (shownMajor) return Promise.resolve(hand.filter((card) => card.suit === shownMajor).length >= 4 ? `4${shownMajor}` as Bid : "3notrump");
      }
    }

    if (calls.length === 5) {
      const [opening, puppet, denial, transfer, acceptance] = calls;
      if (
        opening?.seat === partner && opening.bid === "2notrump" && puppet?.seat === seat && puppet.bid === "3clubs" &&
        denial?.seat === partner && denial.bid === "3notrump" && transfer?.seat === seat && acceptance?.seat === partner &&
        ((transfer.bid === "4diamonds" && acceptance.bid === "4hearts") ||
          (transfer.bid === "4hearts" && acceptance.bid === "4spades"))
      ) return Promise.resolve("pass");
    }

    if (calls.length === 3) {
      const [opening, stayman, denial] = calls;
      const spades = hand.filter((card) => card.suit === "spades").length;
      const hearts = hand.filter((card) => card.suit === "hearts").length;
      if (
        opening?.bid === "1notrump" && opening.seat === partner &&
        stayman?.bid === "2clubs" && stayman.seat === seat &&
        denial?.bid === "2diamonds" && denial.seat === partner && points(hand) >= 10 &&
        ((spades >= 5 && hearts === 4) || (hearts >= 5 && spades === 4)) &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === stayman.bid || bid === denial.bid)
      ) return Promise.resolve(spades === 4 ? "3spades" : "3hearts");
    }

    if (calls.length === 4) {
      const [opening, stayman, denial, smolen] = calls;
      const longerMajor = smolen?.bid === "3hearts" ? "spades" : smolen?.bid === "3spades" ? "hearts" : undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === seat &&
        stayman?.bid === "2clubs" && stayman.seat === partner &&
        denial?.bid === "2diamonds" && denial.seat === seat && longerMajor &&
        smolen?.seat === partner && auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === stayman.bid || bid === denial.bid || bid === smolen.bid)
      ) {
        return Promise.resolve(hand.filter((card) => card.suit === longerMajor).length >= 3 ? `4${longerMajor}` as Bid : "3notrump");
      }
    }

    if (calls.length === 5) {
      const [opening, stayman, denial, smolen, openerReply] = calls;
      const longerMajor = smolen?.bid === "3hearts" ? "spades" : smolen?.bid === "3spades" ? "hearts" : undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === partner &&
        stayman?.bid === "2clubs" && stayman.seat === seat &&
        denial?.bid === "2diamonds" && denial.seat === partner && longerMajor &&
        smolen?.seat === seat && openerReply?.seat === partner &&
        (openerReply.bid === "3notrump" || openerReply.bid === `4${longerMajor}`) &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === stayman.bid || bid === denial.bid || bid === smolen.bid || bid === openerReply.bid)
      ) return Promise.resolve(openerReply.bid === "3notrump" && hand.filter((card) => card.suit === longerMajor).length >= 6 ? `4${longerMajor}` as Bid : "pass");
    }

    if (calls.length === 3) {
      const [opening, response, openerRebid] = calls;
      const openingMinor = opening?.bid.match(/^1(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const responderMajor = response?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const forcingAsk = this.config.biddingStyle === "2/1" && openingMinor === "clubs" ? "2diamonds" : "2clubs";
      if (
        openingMinor && opening?.seat === partner && responderMajor && response?.seat === seat &&
        openerRebid?.bid === "1notrump" && openerRebid.seat === partner && points(hand) >= 10 &&
        (
          hand.filter((card) => card.suit === responderMajor).length >= 5 ||
          hand.filter((card) => card.suit === (responderMajor === "hearts" ? "spades" : "hearts")).length >= 4
        ) && auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid)
      ) return Promise.resolve(forcingAsk);
    }

    if (calls.length === 4) {
      const [opening, response, openerRebid, checkback] = calls;
      const openingMinor = opening?.bid.match(/^1(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const responderMajor = response?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const forcingAsk = this.config.biddingStyle === "2/1" && openingMinor === "clubs" ? "2diamonds" : "2clubs";
      const denialBid = this.config.biddingStyle === "2/1" ? "2notrump" : "2diamonds";
      if (
        openingMinor && opening?.seat === seat && responderMajor && response?.seat === partner &&
        openerRebid?.bid === "1notrump" && openerRebid.seat === seat && checkback?.bid === forcingAsk &&
        checkback.seat === partner && auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid || bid === checkback.bid)
      ) {
        if (hand.filter((card) => card.suit === responderMajor).length >= 3) return Promise.resolve(atLegalLevel(`2${responderMajor}` as Bid, auction));
        const otherMajor = responderMajor === "hearts" ? "spades" : "hearts";
        if (hand.filter((card) => card.suit === otherMajor).length >= 4) return Promise.resolve(`2${otherMajor}` as Bid);
        return Promise.resolve(denialBid);
      }
    }

    if (calls.length === 5) {
      const [opening, response, openerRebid, checkback, majorReply] = calls;
      const openingMinor = opening?.bid.match(/^1(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const responderMajor = response?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const major = majorReply?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      const forcingAsk = this.config.biddingStyle === "2/1" && openingMinor === "clubs" ? "2diamonds" : "2clubs";
      const denialBid = this.config.biddingStyle === "2/1" ? "2notrump" : "2diamonds";
      if (
        openingMinor && opening?.seat === partner && responderMajor && response?.seat === seat &&
        openerRebid?.bid === "1notrump" && openerRebid.seat === partner && checkback?.bid === forcingAsk &&
        checkback.seat === seat && majorReply?.bid === denialBid && majorReply.seat === partner &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid || bid === checkback.bid || bid === majorReply.bid)
      ) {
        const responderPoints = points(hand);
        const hasStoppers = suits.every((suit) => hasStopper(hand, suit));
        if (isBalanced(hand) && hasStoppers && responderPoints >= 13) return Promise.resolve("3notrump");
        // In 2/1 the denial is itself 2NT, so an invitational hand has nothing to add and passes it.
        if (isBalanced(hand) && hasStoppers && responderPoints >= 10 && responderPoints <= 12) return Promise.resolve(isLegalCall("2notrump", auction, seat) ? "2notrump" : "pass");
        if (hand.filter((card) => card.suit === responderMajor).length >= 5) return Promise.resolve(atLegalLevel(`2${responderMajor}` as Bid, auction));
      }
      if (
        openingMinor && opening?.seat === partner && responderMajor && response?.seat === seat &&
        openerRebid?.bid === "1notrump" && openerRebid.seat === partner && checkback?.bid === forcingAsk &&
        checkback.seat === seat && major && majorReply?.seat === partner &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid || bid === checkback.bid || bid === majorReply.bid)
      ) {
        const fitLength = hand.filter((card) => card.suit === major).length;
        const requiredFitLength = major === responderMajor ? 5 : 4;
        if (fitLength >= requiredFitLength) return Promise.resolve(points(hand) >= 13 ? `4${major}` as Bid : `3${major}` as Bid);
        if (isBalanced(hand) && points(hand) >= 13 && suits.every((suit) => hasStopper(hand, suit))) {
          return Promise.resolve("3notrump");
        }
        if (isBalanced(hand) && points(hand) >= 10 && points(hand) <= 12 && suits.every((suit) => hasStopper(hand, suit))) {
          return Promise.resolve("2notrump");
        }
        if (hand.filter((card) => card.suit === responderMajor).length >= 5) {
          return Promise.resolve(atLegalLevel(`2${responderMajor}` as Bid, auction));
        }
      }
    }

    if (calls.length === 6) {
      const [opening, response, openerRebid, checkback, majorReply, responderInvite] = calls;
      const openingMinor = opening?.bid.match(/^1(clubs|diamonds)$/)?.[1] as Suit | undefined;
      const major = majorReply?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      const forcingAsk = this.config.biddingStyle === "2/1" && openingMinor === "clubs" ? "2diamonds" : "2clubs";
      if (
        openingMinor && opening?.seat === seat && response?.bid.match(/^1(hearts|spades)$/) && response.seat === partner &&
        openerRebid?.bid === "1notrump" && openerRebid.seat === seat && checkback?.bid === forcingAsk &&
        checkback.seat === partner && major && majorReply?.seat === seat && responderInvite?.bid === `3${major}` &&
        responderInvite.seat === partner && hand.filter((card) => card.suit === major).length >= 3 &&
        auction.every(({ bid }) => bid === "pass" || bid === opening.bid || bid === response.bid || bid === openerRebid.bid || bid === checkback.bid || bid === majorReply.bid || bid === responderInvite.bid)
      ) return Promise.resolve(points(hand) >= 14 ? `4${major}` as Bid : "pass");
    }

    if (calls.length === 2) {
      const [opening, overcall] = calls;
      if (
        opening?.bid === "1notrump" && opening.seat === partner &&
        overcall && overcall.seat !== seat && overcall.seat !== partner
      ) {
        const overcallSuit = overcall.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const overcallIndex = overcallSuit ? suitOrder.indexOf(overcallSuit) : -1;
        const weakLowerSuit = overcallIndex >= 0 ? suitOrder
          .slice(0, overcallIndex)
          .filter((suit) => hand.filter((card) => card.suit === suit).length >= 5)
          .sort((a, b) =>
            hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length ||
            suitOrder.indexOf(b) - suitOrder.indexOf(a)
          )[0] : undefined;
        const invitationalSuit = overcallIndex >= 0 ? suitOrder
          .slice(overcallIndex + 1)
          .filter((suit) => hand.filter((card) => card.suit === suit).length >= 5)
          .sort((a, b) =>
            hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length ||
            suitOrder.indexOf(b) - suitOrder.indexOf(a)
          )[0] : undefined;
        const hcp = points(hand);
        const gameForcingSuit = overcallSuit && hcp >= 10 ? suitOrder
          .filter((suit) => suit !== overcallSuit && hand.filter((card) => card.suit === suit).length >= 5)
          .sort((a, b) =>
            hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length ||
            suitOrder.indexOf(b) - suitOrder.indexOf(a)
          )[0] : undefined;
        if (gameForcingSuit) return Promise.resolve(`3${gameForcingSuit}` as Bid);
        const staymanSuit = overcallSuit ? staymanMajor(hand, overcallSuit) : undefined;
        if (overcallSuit && staymanSuit && hcp >= 10 && !hasStopper(hand, overcallSuit)) {
          return Promise.resolve(`3${overcallSuit}` as Bid);
        }
        if (
          (weakLowerSuit && hcp <= 7) ||
          (invitationalSuit && hcp >= 8 && hcp <= 9) ||
          (overcallSuit && staymanSuit && hcp >= 10 && hasStopper(hand, overcallSuit)) ||
          (overcallSuit && isBalanced(hand) && hcp >= 10 && hasStopper(hand, overcallSuit))
        ) return Promise.resolve("2notrump");
        if (overcallSuit && isBalanced(hand) && hcp >= 10 && !hasStopper(hand, overcallSuit)) {
          return Promise.resolve("3notrump");
        }
      }
    }

    if (calls.length === 3) {
      const [opening, overcall, response] = calls;
      const overcallSuit = overcall?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === seat && overcallSuit &&
        overcall?.seat !== seat && overcall?.seat !== partner && response?.bid === `3${overcallSuit}` &&
        response.seat === partner && auction.length === 3
      ) {
        const major = staymanMajor(hand, overcallSuit);
        return Promise.resolve(major ? `3${major}` as Bid : "3notrump");
      }
    }

    if (calls.length === 4) {
      const [opening, overcall, relay, clubRelay] = calls;
      const overcallSuit = overcall?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === partner && overcallSuit &&
        overcall?.seat !== seat && overcall?.seat !== partner && relay?.bid === "2notrump" && relay.seat === seat &&
        clubRelay?.bid === "3clubs" && clubRelay.seat === partner && auction.length === 6 &&
        auction[3]?.bid === "pass" && auction[5]?.bid === "pass" && points(hand) >= 10 &&
        staymanMajor(hand, overcallSuit) && hasStopper(hand, overcallSuit)
      ) return Promise.resolve(`3${overcallSuit}` as Bid);
    }

    if (calls.length === 4) {
      const [opening, overcall, cueBid, shownMajor] = calls;
      const overcallSuit = overcall?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const shownMajorSuit = shownMajor?.bid.match(/^3(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === partner && overcallSuit &&
        overcall?.seat !== seat && overcall?.seat !== partner && cueBid?.bid === `3${overcallSuit}` &&
        cueBid.seat === seat && shownMajorSuit && shownMajor?.seat === partner && auction.length === 6 &&
        auction[3]?.bid === "pass" && auction[5]?.bid === "pass"
      ) {
        if (hand.filter((card) => card.suit === shownMajorSuit).length >= 4) {
          return Promise.resolve(`4${shownMajorSuit}` as Bid);
        }
        return Promise.resolve("3notrump");
      }
    }

    if (calls.length === 3) {
      const [opening, overcall, response] = calls;
      const responseSuit = response?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const overcallSuit = overcall?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === seat && overcallSuit &&
        overcall?.seat !== seat && overcall?.seat !== partner && response?.seat === partner && responseSuit &&
        responseSuit !== overcallSuit && auction.length === 3
      ) {
        if (hand.filter((card) => card.suit === responseSuit).length >= 3) return Promise.resolve(`4${responseSuit}` as Bid);
        return Promise.resolve("3notrump");
      }
    }

    if (calls.length === 3) {
      const [opening, overcall, relay] = calls;
      if (
        opening?.bid === "1notrump" && opening.seat === seat &&
        overcall?.bid.match(/^2(diamonds|hearts|spades)$/) && overcall.seat !== seat && overcall.seat !== partner &&
        relay?.bid === "2notrump" && relay.seat === partner && auction.length === 4 && auction[3]?.bid === "pass"
      ) return Promise.resolve("3clubs");
    }

    if (calls.length === 4) {
      const [opening, overcall, relay, clubRelay] = calls;
      const overcallSuit = overcall?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      const overcallIndex = overcallSuit ? suitOrder.indexOf(overcallSuit) : -1;
      const weakLowerSuit = overcallIndex >= 0 ? suitOrder
        .slice(0, overcallIndex)
        .filter((suit) => hand.filter((card) => card.suit === suit).length >= 5)
        .sort((a, b) =>
          hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length ||
          suitOrder.indexOf(b) - suitOrder.indexOf(a)
        )[0] : undefined;
      const invitationalSuit = overcallIndex >= 0 ? suitOrder
        .slice(overcallIndex + 1)
        .filter((suit) => hand.filter((card) => card.suit === suit).length >= 5)
        .sort((a, b) =>
          hand.filter((card) => card.suit === b).length - hand.filter((card) => card.suit === a).length ||
          suitOrder.indexOf(b) - suitOrder.indexOf(a)
        )[0] : undefined;
      const hcp = points(hand);
      if (
        opening?.bid === "1notrump" && opening.seat === partner && overcallSuit &&
        overcall?.seat !== seat && overcall?.seat !== partner && relay?.bid === "2notrump" && relay.seat === seat &&
        clubRelay?.bid === "3clubs" && clubRelay.seat === partner && auction.length === 6 &&
        auction[3]?.bid === "pass" && auction[5]?.bid === "pass"
      ) {
        if (hcp <= 7 && weakLowerSuit) return Promise.resolve(weakLowerSuit === "clubs" ? "pass" : `3${weakLowerSuit}` as Bid);
        if (hcp >= 8 && hcp <= 9 && invitationalSuit) return Promise.resolve(`3${invitationalSuit}` as Bid);
        if (hcp >= 10 && staymanMajor(hand, overcallSuit) && hasStopper(hand, overcallSuit)) {
          return Promise.resolve(`3${overcallSuit}` as Bid);
        }
        if (hcp >= 10 && isBalanced(hand) && hasStopper(hand, overcallSuit)) return Promise.resolve("3notrump");
      }
    }

    if (calls.length === 5) {
      const [opening, overcall, relay, clubRelay, cueBid] = calls;
      const overcallSuit = overcall?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === seat && overcallSuit &&
        overcall?.seat !== seat && overcall?.seat !== partner && relay?.bid === "2notrump" && relay.seat === partner &&
        clubRelay?.bid === "3clubs" && clubRelay.seat === seat && cueBid?.bid === `3${overcallSuit}` &&
        cueBid.seat === partner && auction.length === 8 && auction[3]?.bid === "pass" &&
        auction[5]?.bid === "pass" && auction[7]?.bid === "pass"
      ) {
        const major = staymanMajor(hand, overcallSuit);
        return Promise.resolve(major ? `3${major}` as Bid : "3notrump");
      }
    }

    if (calls.length === 6) {
      const [opening, overcall, relay, clubRelay, cueBid, shownMajor] = calls;
      const overcallSuit = overcall?.bid.match(/^2(diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const shownMajorSuit = shownMajor?.bid.match(/^3(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.bid === "1notrump" && opening.seat === partner && overcallSuit &&
        overcall?.seat !== seat && overcall?.seat !== partner && relay?.bid === "2notrump" && relay.seat === seat &&
        clubRelay?.bid === "3clubs" && clubRelay.seat === partner && cueBid?.bid === `3${overcallSuit}` &&
        cueBid.seat === seat && shownMajorSuit && shownMajor?.seat === partner && auction.length === 10 &&
        auction[3]?.bid === "pass" && auction[5]?.bid === "pass" && auction[7]?.bid === "pass" && auction[9]?.bid === "pass"
      ) {
        if (hand.filter((card) => card.suit === shownMajorSuit).length >= 4) {
          return Promise.resolve(`4${shownMajorSuit}` as Bid);
        }
        return Promise.resolve("3notrump");
      }
    }

    const possibleMajorOpening = calls[0];
    const possibleMajor = possibleMajorOpening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
    const possibleMajorOpeningIndex = possibleMajorOpening ? auction.indexOf(possibleMajorOpening) : -1;
    const passedResponder = possibleMajorOpeningIndex >= 0 &&
      auction.slice(0, possibleMajorOpeningIndex).some((call) => call.seat === seat && call.bid === "pass");
    const thirdOrFourthSeatOpening = possibleMajorOpeningIndex >= 0 &&
      auction.slice(0, possibleMajorOpeningIndex).filter((call) => call.bid === "pass").length >= 2;

    if (
      calls.length === 1 && possibleMajorOpening && possibleMajor && possibleMajorOpening.seat === partner &&
      passedResponder && thirdOrFourthSeatOpening && auction.slice(possibleMajorOpeningIndex + 1).every((call) => call.bid === "pass")
    ) {
      const support = hand.filter((card) => card.suit === possibleMajor).length;
      const raisePoints = supportPoints(hand, possibleMajor);
      if (support >= 3 && raisePoints >= 10 && raisePoints <= 12) return Promise.resolve("2clubs");
    }

    if (calls.length === 2 && possibleMajorOpening && possibleMajor && possibleMajorOpening.seat === seat) {
      const [opening, druryResponse] = calls;
      if (
        opening && druryResponse && thirdOrFourthSeatOpening && druryResponse.seat === partner &&
        druryResponse.bid === "2clubs" && passedBeforeOpening(auction, partner, opening) &&
        auction.slice(auction.indexOf(druryResponse) + 1).every((call) => call.bid === "pass")
      ) {
        const hcp = points(hand);
        if (hcp <= 12) return Promise.resolve(`2${possibleMajor}` as Bid);
        if (hcp <= 15) return Promise.resolve("2diamonds");
        return Promise.resolve(`4${possibleMajor}` as Bid);
      }
    }

    if (calls.length === 3 && possibleMajorOpening && possibleMajor && possibleMajorOpening.seat === partner) {
      const [opening, druryResponse, soundOpening] = calls;
      if (
        opening && druryResponse && soundOpening && druryResponse.seat === seat && druryResponse.bid === "2clubs" &&
        soundOpening.seat === partner && soundOpening.bid === "2diamonds" &&
        passedBeforeOpening(auction, seat, opening) && auction.slice(auction.indexOf(soundOpening) + 1).every((call) => call.bid === "pass")
      ) {
        const supportPointsInMajor = supportPoints(hand, possibleMajor);
        if (supportPointsInMajor >= 12) return Promise.resolve(`4${possibleMajor}` as Bid);
        if (supportPointsInMajor >= 10) return Promise.resolve(`3${possibleMajor}` as Bid);
      }
    }

    if (calls.length === 4 && possibleMajorOpening && possibleMajor && possibleMajorOpening.seat === seat) {
      const [opening, druryResponse, soundOpening, limitRaise] = calls;
      if (
        opening && druryResponse && soundOpening && limitRaise && druryResponse.seat === partner &&
        druryResponse.bid === "2clubs" && soundOpening.seat === seat && soundOpening.bid === "2diamonds" &&
        limitRaise.seat === partner && limitRaise.bid === `3${possibleMajor}` &&
        points(hand) >= 15
      ) return Promise.resolve(`4${possibleMajor}` as Bid);
    }

    if (calls.length === 3) {
      const [opening, jacobyRaise, openerGame] = calls;
      const major = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const topTrumpHonors = major ? hand.filter((card) => card.suit === major && ["A", "K", "Q"].includes(card.rank)).length : 0;
      if (
        opening?.seat === partner && major && jacobyRaise?.seat === seat && jacobyRaise.bid === "2notrump" &&
        openerGame?.seat === partner && openerGame.bid === `4${major}` && points(hand) >= 18 && topTrumpHonors >= 2
      ) return Promise.resolve("5notrump");
    }

    if (calls.length === 4 && this.config.biddingStyle === "2/1") {
      const [opening, response, openerRaise, responderGame] = calls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const responseSuit = response?.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responseMajor = response?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      const agreedMajor = openerRaise?.bid === `3${openingMajor}`
        ? openingMajor
        : responseMajor && openerRaise?.bid === `3${responseMajor}` ? responseMajor : undefined;
      const topTrumpHonors = agreedMajor
        ? hand.filter((card) => card.suit === agreedMajor && ["A", "K", "Q"].includes(card.rank)).length
        : 0;
      if (
        opening?.seat === seat && openingMajor && response?.seat === partner && responseSuit && responseSuit !== openingMajor &&
        openerRaise?.seat === seat && agreedMajor && responderGame?.seat === partner &&
        responderGame.bid === `4${agreedMajor}` && points(hand) >= 18 && topTrumpHonors >= 2
      ) return Promise.resolve("5notrump");
    }

    if (calls.length === 4) {
      const [opening, jacobyRaise, openerGame, grandSlamAsk] = calls;
      const major = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === seat && major && jacobyRaise?.seat === partner && jacobyRaise.bid === "2notrump" &&
        openerGame?.seat === seat && openerGame.bid === `4${major}` && grandSlamAsk?.seat === partner && grandSlamAsk.bid === "5notrump"
      ) {
        const topTrumpHonors = hand.filter((card) => card.suit === major && ["A", "K", "Q"].includes(card.rank)).length;
        return Promise.resolve(`${topTrumpHonors >= 2 ? 7 : 6}${major}` as Bid);
      }
    }

    if (calls.length === 4) {
      const [opening, splinterCall, openerGame, grandSlamAsk] = calls;
      const splinter = splinterSequence(opening, splinterCall);
      const major = splinter?.major;
      if (
        opening?.seat === seat && major && splinterCall?.seat === partner && splinter &&
        openerGame?.seat === seat && openerGame.bid === `4${major}` && grandSlamAsk?.seat === partner && grandSlamAsk.bid === "5notrump"
      ) {
        const topTrumpHonors = hand.filter((card) => card.suit === major && ["A", "K", "Q"].includes(card.rank)).length;
        return Promise.resolve(`${topTrumpHonors >= 2 ? 7 : 6}${major}` as Bid);
      }
    }

    if (calls.length === 5 && this.config.biddingStyle === "2/1") {
      const [opening, response, openerRaise, responderGame, grandSlamAsk] = calls;
      const openingMajor = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const responseSuit = response?.bid.match(/^2(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      const responseMajor = response?.bid.match(/^2(hearts|spades)$/)?.[1] as Suit | undefined;
      const agreedMajor = openerRaise?.bid === `3${openingMajor}`
        ? openingMajor
        : responseMajor && openerRaise?.bid === `3${responseMajor}` ? responseMajor : undefined;
      if (
        opening?.seat === partner && openingMajor && response?.seat === seat && responseSuit && responseSuit !== openingMajor &&
        openerRaise?.seat === partner && agreedMajor && responderGame?.seat === seat &&
        responderGame.bid === `4${agreedMajor}` && grandSlamAsk?.seat === partner && grandSlamAsk.bid === "5notrump"
      ) {
        const topTrumpHonors = hand.filter((card) => card.suit === agreedMajor && ["A", "K", "Q"].includes(card.rank)).length;
        return Promise.resolve(`${topTrumpHonors >= 2 ? 7 : 6}${agreedMajor}` as Bid);
      }
    }

    if (
      calls.length === 3 && this.config.biddingStyle === "2/1" &&
      calls[0]?.seat === partner && calls[1]?.seat === seat && calls[2]?.seat === partner &&
      twoOverOneRaisedSuit() && points(hand) >= 18
    ) {
      return Promise.resolve("4notrump");
    }

    if (calls.length === 5 && sideMajorBlackwoodFit?.responderSeat === seat && points(hand) >= 18) {
      return Promise.resolve("4notrump");
    }

    if (calls.length === 4 && naturalSideMajorGame?.responderSeat === seat && points(hand) >= 18) {
      return Promise.resolve("4notrump");
    }

    if (calls.length === 5 && naturalSideMajorGame?.openingSeat === seat && calls[4]?.bid === "4notrump") {
      const aces = aceCount(hand);
      if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
      if (aces === 1) return Promise.resolve("5diamonds");
      if (aces === 2) return Promise.resolve("5hearts");
      return Promise.resolve("5spades");
    }

    if (calls.length === 6 && naturalSideMajorGame?.responderSeat === seat && calls[4]?.bid === "4notrump") {
      const aceAnswer = calls[5]?.bid;
      const ownAces = aceCount(hand);
      const partnerAces = aceAnswer === "5clubs" ? undefined : aceAnswer === "5diamonds" ? 1 : aceAnswer === "5hearts" ? 2 : aceAnswer === "5spades" ? 3 : undefined;
      const allAcesKnown = partnerAces === undefined ? ownAces === 4 : ownAces + partnerAces === 4;
      if (allAcesKnown) return Promise.resolve("5notrump");
      const enoughAces = partnerAces === undefined ? ownAces >= 3 : ownAces + partnerAces >= 3;
      if (enoughAces) return Promise.resolve(`6${naturalSideMajorGame.major}` as Bid);
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      return Promise.resolve(suitOrder.indexOf(naturalSideMajorGame.major) > suitOrder.indexOf((aceAnswer?.slice(1) ?? "spades") as Suit)
        ? `5${naturalSideMajorGame.major}` as Bid
        : "pass");
    }

    if (calls.length === 7 && naturalSideMajorGame?.openingSeat === seat && calls[6]?.bid === "5notrump") {
      const kings = hand.filter((card) => card.rank === "K").length;
      if (kings === 0 || kings === 4) return Promise.resolve("6clubs");
      if (kings === 1) return Promise.resolve("6diamonds");
      if (kings === 2) return Promise.resolve("6hearts");
      return Promise.resolve("6spades");
    }

    if (calls.length === 8 && naturalSideMajorGame?.responderSeat === seat && calls[6]?.bid === "5notrump") {
      const ownKings = hand.filter((card) => card.rank === "K").length;
      const kingAnswer = calls[7]?.bid;
      const partnerKings = kingAnswer === "6clubs" ? (ownKings === 4 ? 4 : undefined)
        : kingAnswer === "6diamonds" ? 1
          : kingAnswer === "6hearts" ? 2
            : kingAnswer === "6spades" ? 3 : undefined;
      const allKingsKnown = partnerKings === 4 || (partnerKings !== undefined && ownKings + partnerKings === 4);
      return Promise.resolve(placeAfterKingReply(`${allKingsKnown ? 7 : 6}${naturalSideMajorGame.major}` as Bid, kingAnswer ?? "pass", auction));
    }

    if (calls.length === 4 && this.config.biddingStyle === "2/1") {
      const [opening, response, openerRaise, aceAsk] = calls;
      const agreedSuit = twoOverOneRaisedSuit();
      if (
        opening?.seat === seat && response?.seat === partner && agreedSuit &&
        openerRaise?.seat === seat &&
        aceAsk?.seat === partner && aceAsk.bid === "4notrump"
      ) {
        const aces = aceCount(hand);
        if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
        if (aces === 1) return Promise.resolve("5diamonds");
        if (aces === 2) return Promise.resolve("5hearts");
        return Promise.resolve("5spades");
      }
    }

    if (
      calls.length === 6 && sideMajorBlackwoodFit?.openingSeat === seat &&
      calls[5]?.seat === sideMajorBlackwoodFit.responderSeat && calls[5].bid === "4notrump"
    ) {
      const aces = aceCount(hand);
      if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
      if (aces === 1) return Promise.resolve("5diamonds");
      if (aces === 2) return Promise.resolve("5hearts");
      return Promise.resolve("5spades");
    }

    if (calls.length === 5 && this.config.biddingStyle === "2/1") {
      const [opening, response, openerRaise, aceAsk, aceAnswer] = calls;
      const agreedSuit = twoOverOneRaisedSuit();
      if (
        opening?.seat === partner && response?.seat === seat && agreedSuit &&
        openerRaise?.seat === partner &&
        aceAsk?.seat === seat && aceAsk.bid === "4notrump" &&
        aceAnswer?.seat === partner && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(aceAnswer.bid)
      ) {
        const ownAces = aceCount(hand);
        const partnerAces = aceAnswer.bid === "5clubs" ? undefined : aceAnswer.bid === "5diamonds" ? 1 : aceAnswer.bid === "5hearts" ? 2 : 3;
        const enoughAces = partnerAces === undefined ? ownAces >= 3 : ownAces + partnerAces >= 3;
        if (enoughAces) return Promise.resolve(`6${agreedSuit}` as Bid);
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const answerSuit = aceAnswer.bid.slice(1) as Suit;
        return Promise.resolve(suitOrder.indexOf(agreedSuit) > suitOrder.indexOf(answerSuit) ? `5${agreedSuit}` as Bid : "pass");
      }
    }

    if (
      calls.length === 7 && sideMajorBlackwoodFit && sideMajorBlackwoodFit.responderSeat === seat &&
      calls[5]?.seat === seat && calls[5].bid === "4notrump" && calls[6]?.seat === sideMajorBlackwoodFit.openingSeat &&
      ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[6].bid)
    ) {
      const ownAces = aceCount(hand);
      const partnerAces = calls[6].bid === "5clubs" ? undefined : calls[6].bid === "5diamonds" ? 1 : calls[6].bid === "5hearts" ? 2 : 3;
      const allAcesKnown = partnerAces === undefined ? ownAces === 4 : ownAces + partnerAces === 4;
      if (allAcesKnown) return Promise.resolve("5notrump");
      const enoughAces = partnerAces === undefined ? ownAces >= 3 : ownAces + partnerAces >= 3;
      if (enoughAces) return Promise.resolve(`6${sideMajorBlackwoodFit.major}` as Bid);
      const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      return Promise.resolve(suitOrder.indexOf(sideMajorBlackwoodFit.major) > suitOrder.indexOf(calls[6].bid.slice(1) as Suit)
        ? `5${sideMajorBlackwoodFit.major}` as Bid
        : "pass");
    }

    if (
      calls.length === 8 && sideMajorBlackwoodFit && sideMajorBlackwoodFit.openingSeat === seat &&
      calls[5]?.seat === sideMajorBlackwoodFit.responderSeat && calls[5].bid === "4notrump" &&
      ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[6]?.bid ?? "") &&
      calls[7]?.seat === sideMajorBlackwoodFit.responderSeat && calls[7].bid === "5notrump"
    ) {
      const kings = hand.filter((card) => card.rank === "K").length;
      if (kings === 0 || kings === 4) return Promise.resolve("6clubs");
      if (kings === 1) return Promise.resolve("6diamonds");
      if (kings === 2) return Promise.resolve("6hearts");
      return Promise.resolve("6spades");
    }

    if (
      calls.length === 9 && sideMajorBlackwoodFit && sideMajorBlackwoodFit.responderSeat === seat &&
      calls[5]?.seat === seat && calls[5].bid === "4notrump" &&
      ["5clubs", "5diamonds", "5hearts", "5spades"].includes(calls[6]?.bid ?? "") &&
      calls[7]?.seat === seat && calls[7].bid === "5notrump" &&
      calls[8]?.seat === sideMajorBlackwoodFit.openingSeat &&
      ["6clubs", "6diamonds", "6hearts", "6spades", "6notrump"].includes(calls[8].bid)
    ) {
      const ownKings = hand.filter((card) => card.rank === "K").length;
      const partnerKings = calls[8].bid === "6clubs" ? (ownKings === 4 ? 4 : undefined)
        : calls[8].bid === "6diamonds" ? 1
          : calls[8].bid === "6hearts" ? 2
            : calls[8].bid === "6spades" ? 3
              : calls[8].bid === "6notrump" ? 4 : undefined;
      const allKingsKnown = partnerKings === 4 || (partnerKings !== undefined && ownKings + partnerKings === 4);
      return Promise.resolve(placeAfterKingReply(`${allKingsKnown ? 7 : 6}${sideMajorBlackwoodFit.major}` as Bid, calls[8].bid, auction));
    }

    if (calls.length === 3) {
      const [opening, splinterCall, game] = calls;
      const splinter = splinterSequence(opening, splinterCall);
      const major = splinter?.major;
      const topTrumpHonors = major
        ? hand.filter((card) => card.suit === major && ["A", "K", "Q"].includes(card.rank)).length
        : 0;
      if (
        opening?.seat === partner && major && splinterCall?.seat === seat && splinter &&
        game?.seat === partner && game.bid === `4${major}` && points(hand) >= 18 && topTrumpHonors >= 2
      ) return Promise.resolve("5notrump");
    }

    if (calls.length === 3) {
      const [opening, splinterCall, game] = calls;
      const splinter = splinterSequence(opening, splinterCall);
      const major = splinter?.major;
      if (
        opening?.seat === partner && major && splinterCall?.seat === seat && splinter &&
        game?.seat === partner && game.bid === `4${major}` && points(hand) >= 18
      ) return Promise.resolve("4notrump");
    }

    if (calls.length === 4) {
      const [opening, splinterCall, game, aceAsk] = calls;
      const splinter = splinterSequence(opening, splinterCall);
      const major = splinter?.major;
      if (
        opening?.seat === seat && major && splinterCall?.seat === partner && splinter &&
        game?.seat === seat && game.bid === `4${major}` && aceAsk?.seat === partner && aceAsk.bid === "4notrump"
      ) {
        const aces = aceCount(hand);
        if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
        if (aces === 1) return Promise.resolve("5diamonds");
        if (aces === 2) return Promise.resolve("5hearts");
        return Promise.resolve("5spades");
      }
    }

    if (calls.length === 5) {
      const [opening, splinterCall, game, aceAsk, aceAnswer] = calls;
      const splinter = splinterSequence(opening, splinterCall);
      const major = splinter?.major;
      if (
        opening?.seat === partner && major && splinterCall?.seat === seat && splinter &&
        game?.seat === partner && game.bid === `4${major}` && aceAsk?.seat === seat && aceAsk.bid === "4notrump" &&
        aceAnswer?.seat === partner && ["5clubs", "5diamonds", "5hearts", "5spades"].includes(aceAnswer.bid)
      ) {
        const ownAces = aceCount(hand);
        const partnerAces = aceAnswer.bid === "5clubs" ? undefined : aceAnswer.bid === "5diamonds" ? 1 : aceAnswer.bid === "5hearts" ? 2 : 3;
        const enoughAces = partnerAces === undefined ? ownAces >= 3 : ownAces + partnerAces >= 3;
        if (enoughAces) return Promise.resolve(`6${major}` as Bid);
        const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
        const responseSuit = aceAnswer.bid.slice(1) as Suit;
        return Promise.resolve(suitOrder.indexOf(major) > suitOrder.indexOf(responseSuit) ? `5${major}` as Bid : "pass");
      }
    }

    if (calls.length === 2) {
      const [opening, splinterCall] = calls;
      const splinter = splinterSequence(opening, splinterCall);
      const major = splinter?.major;
      if (
        opening?.seat === seat && major && splinterCall?.seat === partner && splinter
      ) return Promise.resolve(`4${major}` as Bid);
    }

    if (calls.length === 3) {
      const [opening, jacobyRaise, openerShortness] = calls;
      const major = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      const shownShortness = openerShortness?.bid.match(/^3(clubs|diamonds|hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && major && jacobyRaise?.seat === seat && jacobyRaise.bid === "2notrump" &&
        openerShortness?.seat === partner && shownShortness && shownShortness !== major && points(hand) >= 18
      ) return Promise.resolve("4notrump");
    }

    if (calls.length === 4) {
      const [opening, jacobyRaise, openerShortness, aceAsk] = calls;
      if (
        opening?.seat === seat && /^1(hearts|spades)$/.test(opening.bid) && jacobyRaise?.seat === partner &&
        jacobyRaise.bid === "2notrump" && openerShortness?.seat === seat &&
        /^3(clubs|diamonds|hearts|spades)$/.test(openerShortness.bid) && aceAsk?.seat === partner && aceAsk.bid === "4notrump"
      ) {
        const aces = aceCount(hand);
        if (aces === 0 || aces === 4) return Promise.resolve("5clubs");
        if (aces === 1) return Promise.resolve("5diamonds");
        if (aces === 2) return Promise.resolve("5hearts");
        return Promise.resolve("5spades");
      }
    }

    if (calls.length === 5) {
      const [opening, jacobyRaise, openerShortness, aceAsk, aceAnswer] = calls;
      const major = opening?.bid.match(/^1(hearts|spades)$/)?.[1] as Suit | undefined;
      if (
        opening?.seat === partner && major && jacobyRaise?.seat === seat && jacobyRaise.bid === "2notrump" &&
        openerShortness?.seat === partner && /^3(clubs|diamonds|hearts|spades)$/.test(openerShortness.bid) &&
        aceAsk?.seat === seat && aceAsk.bid === "4notrump" && aceAnswer?.seat === partner
      ) {
        if (!["5clubs", "5diamonds", "5hearts", "5spades"].includes(aceAnswer.bid)) return this.advancedBot.chooseBid(hand, auction, seat);
        const ownAces = aceCount(hand);
        if (aceAnswer.bid === "5clubs") return Promise.resolve(ownAces >= 3 ? `6${major}` as Bid : `5${major}` as Bid);
        const partnerAces = aceAnswer.bid === "5diamonds" ? 1 : aceAnswer.bid === "5hearts" ? 2 : 3;
        return Promise.resolve(ownAces + partnerAces >= 3 ? `6${major}` as Bid : `5${major}` as Bid);
      }
    }

    if (calls.length === 1 && calls[0]?.seat === partner && /^1(hearts|spades)$/.test(calls[0].bid) &&
      !passedBeforeOpening(auction, seat, calls[0]!)) {
      const openingMajor = calls[0]!.bid.slice(1) as Suit;
      const shortSuits = suits.filter((suit) => suit !== openingMajor && hand.filter((card) => card.suit === suit).length <= 1);
      const support = hand.filter((card) => card.suit === openingMajor).length;
      if (support >= 4 && shortSuits.length === 1 && supportPoints(hand, openingMajor) >= 13) {
        const splinterSuit = shortSuits[0]!;
        const level = openingMajor === "hearts" ? 3 : 4;
        return Promise.resolve(`${level}${splinterSuit}` as Bid);
      }
    }

    if (calls.length === 1 && calls[0]?.seat === partner && isNotrumpOpening(calls[0].bid)) {
      const hearts = hand.filter((card) => card.suit === "hearts").length;
      const spades = hand.filter((card) => card.suit === "spades").length;
      const threshold = calls[0].bid === "1notrump" ? 19 : 16;
      if (isBalanced(hand) && hearts < 4 && spades < 4 && points(hand) >= threshold) {
        return Promise.resolve("4clubs");
      }
    }

    if (calls.length === 2) {
      const [opening, ask] = calls;
      if (
        opening?.seat === seat && isNotrumpOpening(opening.bid) && ask?.seat === partner &&
        ask.bid === "4clubs"
      ) {
        const aces = aceCount(hand);
        if (aces === 0 || aces === 4) return Promise.resolve("4diamonds");
        if (aces === 1) return Promise.resolve("4hearts");
        if (aces === 2) return Promise.resolve("4spades");
        return Promise.resolve("4notrump");
      }
    }

    if (calls.length === 3) {
      const [opening, ask, answer] = calls;
      if (
        opening?.seat === partner && isNotrumpOpening(opening.bid) && ask?.seat === seat &&
        ask.bid === "4clubs" && answer?.seat === partner &&
        ["4diamonds", "4hearts", "4spades", "4notrump"].includes(answer.bid)
      ) {
        const ownAces = aceCount(hand);
        if (answer.bid === "4diamonds") return Promise.resolve(ownAces >= 3 ? "6notrump" : "4notrump");
        const partnerAces = answer.bid === "4hearts" ? 1 : answer.bid === "4spades" ? 2 : 3;
        return Promise.resolve(ownAces + partnerAces >= 3 ? "6notrump" : "4notrump");
      }
    }

    return this.advancedBot.chooseBid(hand, auction, seat);
  }

  chooseCard(context: PlayContext): Promise<Hand[number]> {
    if (context.currentTrick.length === 0 && context.trump) {
      const lead = topOfTouchingHonorSequence(context.hand) ??
        fourthHighestFromLongestSuit(context.hand) ?? lowestCard(context.hand);
      const ace = context.hand.find((card) => card.suit === lead.suit && card.rank === "A");
      if (ace) return Promise.resolve(ace);
    }
    return this.advancedBot.chooseCard(context);
  }
}

/** The bidding and play rules for a skill level, exactly as written. */
export function createRuleBot(config: BotConfig): BotPlayer {
  if (config.skill === "beginner") return new BeginnerBot(config);
  if (config.skill === "intermediate") return new IntermediateBot(config);
  if (config.skill === "advanced") return new AdvancedBot(config);
  if (config.skill === "expert") return new ExpertBot(config);
  throw new Error(`Bot skill ${config.skill} is not implemented yet`);
}

/**
 * A bot for the table. Should a rule ever choose a call the auction no longer allows, the bot passes instead, so a
 * table never waits on a call that cannot be made.
 */
export function createBot(config: BotConfig): BotPlayer {
  const bot = createRuleBot(config);
  return {
    config: bot.config,
    async chooseBid(hand, auction, seat) {
      const bid = await bot.chooseBid(hand, auction, seat);
      return isLegalCall(bid, auction, seat) ? bid : "pass";
    },
    chooseCard: (context) => bot.chooseCard(context)
  };
}
