import { SEATS, cardId, isValidDeal, type Card, type Deal, type Seat, type Suit } from "./cards.js";
import { emptyHistory, recordAction, type Bid, type GameAction, type GameHistory } from "./history.js";
import { trickWinner, validatePlay, type TrickCard } from "./rules.js";
import { scoreContract, type ContractScore } from "./scoring.js";
import type { PlayContext } from "./bots.js";
import type { Vulnerability } from "./types.js";

export type Contract = Readonly<{
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  strain: Suit | "notrump";
  declarer: Seat;
  doubled: 0 | 1 | 2;
}>;

export type RuleError = Readonly<{
  code: "wrong-phase" | "wrong-actor" | "invalid-bid" | "illegal-double" | "illegal-redouble" | "card-not-held" | "must-follow-suit" | "invalid-claim";
  message: string;
}>;

export type GameState = Readonly<{
  phase: "auction" | "play" | "passed-out" | "complete";
  dealer: Seat;
  vulnerability: Vulnerability;
  initialDeal: Deal;
  currentActor: Seat;
  auction: readonly Readonly<{ seat: Seat; bid: Bid }>[];
  contract?: Contract;
  hands: Deal;
  currentTrick: readonly TrickCard[];
  completedTricks: readonly (readonly TrickCard[])[];
  score?: ContractScore;
  claim?: Readonly<{ seat: Seat; tricks: number }>;
  trickLeader: Seat;
  history: GameHistory;
}>;

export type ApplyActionResult =
  | Readonly<{ ok: true; state: GameState }>
  | Readonly<{ ok: false; error: RuleError }>;

const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const strains = [...suitOrder, "notrump"] as const;
const seatIndex = (seat: Seat): number => SEATS.indexOf(seat);
const nextSeat = (seat: Seat): Seat => SEATS[(seatIndex(seat) + 1) % 4]!;
const partnership = (seat: Seat): 0 | 1 => (seatIndex(seat) % 2) as 0 | 1;

function error(code: RuleError["code"], message: string): ApplyActionResult {
  return { ok: false, error: { code, message } };
}

function parseContractBid(bid: Bid): { level: number; strain: Suit | "notrump" } | undefined {
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  if (!match) return undefined;
  const level = Number(match[1]);
  if (level < 1 || level > 7) return undefined;
  return { level, strain: match[2] as Suit | "notrump" };
}

function contractRank(contract: { level: number; strain: Suit | "notrump" }): number {
  return contract.level * 5 + strains.indexOf(contract.strain as (typeof strains)[number]);
}

export function createGameState(input: {
  deal: Deal;
  dealer: Seat;
  vulnerability: Vulnerability;
}): GameState {
  if (!isValidDeal(input.deal)) throw new Error("Cannot start a bridge game with an invalid deal");
  const hands = Object.fromEntries(SEATS.map((seat) => [seat, [...input.deal[seat]]])) as Record<Seat, Card[]>;
  const initialDeal = Object.fromEntries(SEATS.map((seat) => [seat, [...hands[seat]]])) as Record<Seat, Card[]>;
  return {
    phase: "auction",
    dealer: input.dealer,
    vulnerability: input.vulnerability,
    initialDeal,
    currentActor: input.dealer,
    auction: [],
    hands,
    currentTrick: [],
    completedTricks: [],
    trickLeader: input.dealer,
    history: emptyHistory()
  };
}

function finishAuction(state: GameState, auction: GameState["auction"]): GameState {
  const bidEntries = auction.flatMap((entry, index) => {
    const parsed = parseContractBid(entry.bid);
    return parsed ? [{ ...entry, index, ...parsed }] : [];
  });
  if (!bidEntries.length) {
    return { ...state, phase: "passed-out", auction, currentActor: state.dealer };
  }
  const finalBid = bidEntries[bidEntries.length - 1]!;
  const declarer = bidEntries.find((entry) =>
    partnership(entry.seat) === partnership(finalBid.seat) && entry.strain === finalBid.strain
  )!.seat;
  const finalContractCalls = auction.slice(finalBid.index + 1).filter((entry) => entry.bid !== "pass");
  const contract: Contract = {
    level: finalBid.level as Contract["level"],
    strain: finalBid.strain,
    declarer,
    doubled: finalContractCalls.reduce<0 | 1 | 2>((doubled, entry) =>
      entry.bid === "redouble" ? 2 : entry.bid === "double" ? 1 : doubled, 0)
  };
  const leader = nextSeat(declarer);
  return { ...state, phase: "play", auction, contract, currentActor: leader, trickLeader: leader };
}

function applyBid(state: GameState, action: Extract<GameAction, { type: "bid" }>): ApplyActionResult {
  if (state.phase !== "auction") return error("wrong-phase", "Bids are only allowed during the auction");
  if (action.seat !== state.currentActor) return error("wrong-actor", "It is not this player's turn");

  const auction = [...state.auction, { seat: action.seat, bid: action.bid }];
  const previousContractIndex = state.auction
    .map((entry) => parseContractBid(entry.bid) !== undefined)
    .lastIndexOf(true);
  const previousContract = previousContractIndex < 0 ? undefined : state.auction[previousContractIndex];
  const callsOnContract = previousContractIndex < 0 ? [] : state.auction.slice(previousContractIndex + 1);
  const lastNonPassCall = [...callsOnContract].reverse().find((entry) => entry.bid !== "pass");
  const proposed = parseContractBid(action.bid);

  if (action.bid === "double") {
    if (!previousContract || partnership(previousContract.seat) === partnership(action.seat) ||
      (lastNonPassCall?.bid === "double" || lastNonPassCall?.bid === "redouble")) {
      return error("illegal-double", "A double must be made over an opponent's undoubled contract");
    }
  } else if (action.bid === "redouble") {
    if (!previousContract || !lastNonPassCall || lastNonPassCall.bid !== "double" ||
      partnership(previousContract.seat) !== partnership(action.seat)) {
      return error("illegal-redouble", "A redouble must be made by the declaring side after an opponent's double");
    }
  } else if (action.bid !== "pass") {
    if (!proposed) return error("invalid-bid", "The contract bid is not valid");
    const previous = previousContract ? parseContractBid(previousContract.bid) : undefined;
    if (previous && contractRank(proposed) <= contractRank(previous)) {
      return error("invalid-bid", "A contract bid must be higher than the previous contract bid");
    }
  }

  const isPassedOut = !previousContract && action.bid === "pass" && auction.length === 4;
  const auctionEnded = !!previousContract && auction.length >= 3 && auction.slice(-3).every((entry) => entry.bid === "pass");
  const partial: GameState = { ...state, auction, currentActor: nextSeat(action.seat), history: recordAction(state.history, action) };
  if (isPassedOut || auctionEnded) {
    const finalState = finishAuction(partial, auction);
    return { ok: true, state: { ...finalState, history: partial.history } };
  }
  return { ok: true, state: partial };
}

function applyPlay(state: GameState, action: Extract<GameAction, { type: "play" }>): ApplyActionResult {
  if (state.phase !== "play" || !state.contract) return error("wrong-phase", "Cards can only be played after a contract is set");
  if (action.seat !== state.currentActor) return error("wrong-actor", "It is not this player's turn");
  const ledSuit = state.currentTrick[0]?.card.suit;
  const legality = validatePlay(state.hands[action.seat], action.card, ledSuit);
  if (!legality.legal) {
    return legality.reason === "must-follow-suit"
      ? error("must-follow-suit", "A player must follow suit when able")
      : error("card-not-held", "The player does not hold that card");
  }

  const hands = { ...state.hands, [action.seat]: state.hands[action.seat].filter((card) => cardId(card) !== cardId(action.card)) };
  const currentTrick = [...state.currentTrick, { seat: action.seat, card: action.card }];
  const history = recordAction(state.history, action);
  if (currentTrick.length < 4) {
    return { ok: true, state: { ...state, hands, currentTrick, currentActor: nextSeat(action.seat), history } };
  }

  const trump = state.contract.strain === "notrump" ? undefined : state.contract.strain;
  const winner = trickWinner(currentTrick, trump);
  const completedTricks = [...state.completedTricks, currentTrick];
  const complete = completedTricks.length === 13;
  const contractSide = partnership(state.contract.declarer);
  const declaringTricks = complete
    ? completedTricks.filter((trick) => partnership(trickWinner(trick, trump)) === contractSide).length
    : undefined;
  const score = declaringTricks === undefined
    ? undefined
    : scoreContract(state.contract, declaringTricks, state.vulnerability);
  return {
    ok: true,
    state: {
      ...state,
      phase: complete ? "complete" : "play",
      hands,
      currentTrick: [],
      completedTricks,
      ...(score ? { score } : {}),
      currentActor: winner,
      trickLeader: winner,
      history
    }
  };
}

/** Tricks not yet completed, counting the one in progress. */
export function remainingTricks(state: GameState): number {
  return 13 - state.completedTricks.length;
}

/** The seat a claim made on this turn is recorded under: declarer when declarer or dummy is to act, else the actor. */
export function claimSeatFor(state: GameState): Seat | undefined {
  if (state.phase !== "play" || !state.contract) return undefined;
  const declarer = state.contract.declarer;
  const dummy = SEATS[(seatIndex(declarer) + 2) % 4]!;
  return state.currentActor === declarer || state.currentActor === dummy ? declarer : state.currentActor;
}

function applyClaim(state: GameState, action: Extract<GameAction, { type: "claim" }>): ApplyActionResult {
  if (state.phase !== "play" || !state.contract) return error("wrong-phase", "Tricks can only be claimed during the play");
  const remaining = remainingTricks(state);
  if (action.seat !== claimSeatFor(state)) return error("invalid-claim", "This player cannot claim on this turn");
  if (!Number.isInteger(action.tricks) || action.tricks < 0 || action.tricks > remaining) {
    return error("invalid-claim", "A claim must be a whole number of the remaining tricks");
  }
  const trump = state.contract.strain === "notrump" ? undefined : state.contract.strain;
  const contractSide = partnership(state.contract.declarer);
  const wonSoFar = state.completedTricks.filter((trick) => partnership(trickWinner(trick, trump)) === contractSide).length;
  const claimed = partnership(action.seat) === contractSide ? action.tricks : remaining - action.tricks;
  const claim = { seat: action.seat, tricks: action.tricks };
  return {
    ok: true,
    state: {
      ...state,
      phase: "complete",
      claim,
      score: scoreContract(state.contract, wonSoFar + claimed, state.vulnerability),
      history: recordAction(state.history, action)
    }
  };
}

export function applyAction(state: GameState, action: GameAction): ApplyActionResult {
  if (action.type === "bid") return applyBid(state, action);
  return action.type === "play" ? applyPlay(state, action) : applyClaim(state, action);
}

function rebuild(state: GameState, count: number): GameState {
  let rebuilt = createGameState({ deal: state.initialDeal, dealer: state.dealer, vulnerability: state.vulnerability });
  for (const action of state.history.actions.slice(0, count)) {
    const result = applyAction(rebuilt, action);
    if (!result.ok) throw new Error(`Cannot reconstruct game history: ${result.error.message}`);
    rebuilt = result.state;
  }
  return { ...rebuilt, history: { actions: state.history.actions, cursor: count } };
}

export function undoAction(state: GameState): GameState {
  return rebuild(state, Math.max(0, state.history.cursor - 1));
}

/** The game as it stood after its first `count` recorded actions, keeping the later ones as redoable history. */
export function rewindTo(state: GameState, count: number): GameState {
  return rebuild(state, Math.min(Math.max(0, count), state.history.cursor));
}

export function redoAction(state: GameState): GameState {
  return rebuild(state, Math.min(state.history.actions.length, state.history.cursor + 1));
}

export function replayActions(state: GameState): readonly GameAction[] {
  return state.history.actions;
}

/**
 * What the player to act can see when choosing a card: their own hand, the trick so far, the cards already played, and
 * — once the opening lead is on the table — dummy. When dummy is to play, the hand is dummy's and declarer's is the
 * visible one, because declarer chooses dummy's cards.
 */
export function playContextFor(state: GameState, seat: Seat = state.currentActor): PlayContext {
  const contract = state.contract;
  const dummy = contract ? SEATS[(seatIndex(contract.declarer) + 2) % 4]! : undefined;
  const dummyShown = state.completedTricks.length > 0 || state.currentTrick.length > 0;
  const visibleSeat = !contract || !dummy || !dummyShown ? undefined : seat === dummy ? contract.declarer : dummy;
  return {
    seat,
    hand: state.hands[seat],
    currentTrick: state.currentTrick,
    ...(state.currentTrick[0] ? { ledSuit: state.currentTrick[0].card.suit } : {}),
    ...(contract && contract.strain !== "notrump" ? { trump: contract.strain } : {}),
    ...(contract ? { declarer: contract.declarer } : {}),
    ...(visibleSeat ? { visibleHand: state.hands[visibleSeat] } : {}),
    played: state.completedTricks.flatMap((trick) => trick.map((play) => play.card))
  };
}
