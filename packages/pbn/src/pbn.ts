import { applyAction, claimSeatFor, createGameState, remainingTricks, trickWinner, SEATS, SUITS, RANKS, isValidDeal, type Card, type Deal, type Seat, type Suit, type Vulnerability, type Bid, type GameAction } from "@contractplay/core";

export type PbnTag = Readonly<{ name: string; value: string; line?: number }>;
export type PbnDiagnostic = Readonly<{ severity: "error" | "warning"; message: string; line: number }>;
export type PbnHand = Readonly<{
  dealer: Seat;
  vulnerability: Vulnerability;
  actions: readonly GameAction[];
  deal?: Deal;
  tags?: readonly PbnTag[];
  comments?: readonly string[];
}>;
export type PbnBoard = Readonly<{
  tags: readonly PbnTag[];
  comments: readonly string[];
  actions: readonly GameAction[];
  dealer?: Seat;
  vulnerability?: Vulnerability;
  deal?: Deal;
  auctionStartSeat?: Seat;
  auctionText?: string;
  playStartSeat?: Seat;
  playText?: string;
  diagnostics: readonly PbnDiagnostic[];
}>;
export type PbnDocument = Readonly<{ boards: readonly PbnBoard[] }>;

const seatLetter: Record<Seat, string> = { north: "N", east: "E", south: "S", west: "W" };
const letterSeat: Record<string, Seat> = { N: "north", E: "east", S: "south", W: "west" };
const suitLetter: Record<Suit, string> = { spades: "S", hearts: "H", diamonds: "D", clubs: "C" };
const letterSuit: Record<string, Suit> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const rankOrder = "23456789TJQKA";
const nextSeat = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 1) % 4]!;

function escapeTag(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function dealHand(cards: Deal[Seat]): string {
  return SUITS.map((suit) => cards
    .filter((card) => card.suit === suit)
    .sort((a, b) => rankOrder.indexOf(b.rank) - rankOrder.indexOf(a.rank))
    .map((card) => card.rank)
    .join("") || "-").join(".");
}

function serializeBid(bid: Bid): string {
  if (bid === "pass") return "Pass";
  if (bid === "double") return "X";
  if (bid === "redouble") return "XX";
  return bid.replace("notrump", "NT").replace("clubs", "C").replace("diamonds", "D")
    .replace("hearts", "H").replace("spades", "S");
}

function serializeCard(card: Card): string {
  return `${suitLetter[card.suit]}${card.rank}`;
}

/** The state after replaying the hand's actions on its deal, or undefined when it cannot be replayed. */
function replay(hand: PbnHand, deal: Deal, upTo: (action: GameAction) => boolean = () => true) {
  let state = createGameState({ deal, dealer: hand.dealer, vulnerability: hand.vulnerability });
  for (const action of hand.actions) {
    if (!upTo(action)) break;
    const result = applyAction(state, action);
    if (!result.ok) return undefined;
    state = result.state;
  }
  return state;
}

function openingLeader(hand: PbnHand): Seat | undefined {
  if (!hand.deal) return undefined;
  const state = replay(hand, hand.deal, (action) => action.type === "bid");
  return state?.phase === "play" ? state.currentActor : undefined;
}

/** Serializes one board as standard PBN tags, followed by Auction and Play sections. */
export function exportPbn(hand: PbnHand): string {
  const claim = hand.actions.find((action): action is Extract<GameAction, { type: "claim" }> => action.type === "claim");
  const claimed = claim && hand.deal ? replay(hand, hand.deal) : undefined;
  const tags = [...(hand.tags ?? []).filter((tag) => !["dealer", "vulnerable", "deal", ...(claimed?.score ? ["result"] : [])].includes(tag.name.toLowerCase()))];
  tags.push({ name: "Dealer", value: seatLetter[hand.dealer] });
  tags.push({ name: "Vulnerable", value: hand.vulnerability === "Both" ? "All" : hand.vulnerability });
  if (hand.deal) {
    if (!isValidDeal(hand.deal)) throw new Error("Cannot export an invalid bridge deal");
    const start = SEATS.indexOf(hand.dealer);
    const clockwise = [...SEATS.slice(start), ...SEATS.slice(0, start)];
    tags.push({ name: "Deal", value: `${seatLetter[hand.dealer]}:${clockwise.map((seat) => dealHand(hand.deal![seat])).join(" ")}` });
  }

  if (claimed?.score) tags.push({ name: "Result", value: String(claimed.score.tricksTaken) });

  const sections = tags.map(({ name, value }) => `[${name} "${escapeTag(value)}"]`);
  if (hand.comments?.length) sections.push(...hand.comments.map((comment) => `{${comment}}`));
  const bids = hand.actions.filter((action): action is Extract<GameAction, { type: "bid" }> => action.type === "bid");
  const plays = hand.actions.filter((action): action is Extract<GameAction, { type: "play" }> => action.type === "play");
  if (bids.length) {
    sections.push(`[Auction "${seatLetter[bids[0]!.seat]}"]\n${bids.map((action) => serializeBid(action.bid)).join(" ")}`);
  }
  // A claim is written as the play section's `*`; the Result tag carries the tricks it settles.
  const playTokens = [...plays.map((action) => serializeCard(action.card)), ...(claim ? ["*"] : [])];
  const playSeat = plays[0]?.seat ?? (claim ? openingLeader(hand) : undefined);
  if (playTokens.length && playSeat) {
    sections.push(`[Play "${seatLetter[playSeat]}"]\n${playTokens.join(" ")}`);
  }
  return sections.join("\n\n");
}

type RawSection = { seat?: Seat; text: string; line: number };
type RawBoard = { tags: PbnTag[]; comments: string[]; diagnostics: PbnDiagnostic[]; auction?: RawSection; play?: RawSection };

function newRawBoard(): RawBoard {
  return { tags: [], comments: [], diagnostics: [] };
}

function hasBoardData(board: RawBoard): boolean {
  return board.tags.length > 0 || board.auction !== undefined || board.play !== undefined || board.comments.length > 0;
}

function stripComments(line: string, board: RawBoard, lineNumber: number): string {
  let result = "";
  let inComment = false;
  let comment = "";
  for (const char of line) {
    if (char === "{" && !inComment) {
      inComment = true;
      comment = "";
    } else if (char === "}" && inComment) {
      board.comments.push(comment.trim());
      inComment = false;
    } else if (inComment) {
      comment += char;
    } else if (char === ';') {
      break;
    } else {
      result += char;
    }
  }
  if (inComment) board.diagnostics.push({ severity: "warning", message: "Unclosed PBN comment", line: lineNumber });
  return result;
}

function parseDeal(value: string): Deal | undefined {
  const match = /^([NESW]):(.+)$/i.exec(value.trim());
  if (!match) return undefined;
  const start = letterSeat[match[1]!.toUpperCase()];
  const encodedHands = match[2]!.trim().split(/\s+/);
  if (!start || encodedHands.length !== 4) return undefined;
  const hands: Record<Seat, Card[]> = { north: [], east: [], south: [], west: [] };
  let seat = start;
  for (const encodedHand of encodedHands) {
    const suitParts = encodedHand.split(".");
    if (suitParts.length !== 4) return undefined;
    for (let suitIndex = 0; suitIndex < 4; suitIndex++) {
      const suit = SUITS[suitIndex]!;
      const ranks = suitParts[suitIndex]!;
      if (ranks !== "-" && (!/^[2-9TJQKA]*$/i.test(ranks) || new Set(ranks.toUpperCase()).size !== ranks.length)) return undefined;
      for (const rank of ranks === "-" ? "" : ranks.toUpperCase()) {
        if (!RANKS.includes(rank as (typeof RANKS)[number])) return undefined;
        hands[seat].push({ suit, rank: rank as Card["rank"] });
      }
    }
    seat = nextSeat(seat);
  }
  return isValidDeal(hands) ? hands : undefined;
}

function parseBid(token: string): Bid | undefined {
  const normalized = token.replace(/[!?]+$/g, "").toUpperCase();
  if (["P", "PASS", "-"].includes(normalized)) return "pass";
  if (["X", "DBL", "DOUBLE"].includes(normalized)) return "double";
  if (["XX", "RDBL", "REDOUBLE"].includes(normalized)) return "redouble";
  const match = /^([1-7])(C|D|H|S|NT|N)$/.exec(normalized);
  if (!match) return undefined;
  const strains: Record<string, string> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades", NT: "notrump", N: "notrump" };
  return `${match[1]}${strains[match[2]!]}` as Bid;
}

function parseCard(token: string): Card | undefined {
  const normalized = token.replace(/[!?]+$/g, "").toUpperCase();
  const match = /^([SHDC])(10|[2-9TJQKA])$/.exec(normalized) ?? /^([2-9TJQKA])(10|[SHDC])$/.exec(normalized);
  if (!match) return undefined;
  const suitCode = match[1]!.length === 1 && letterSuit[match[1]!] ? match[1]! : match[2]!;
  const rankCode = suitCode === match[1] ? match[2]! : match[1]!;
  const rank = rankCode === "10" ? "T" : rankCode;
  if (!RANKS.includes(rank as (typeof RANKS)[number])) return undefined;
  return { suit: letterSuit[suitCode]!, rank: rank as Card["rank"] };
}

function parseSection(board: RawBoard, section: RawSection | undefined, type: "bid" | "play", actions: GameAction[], resolvePlaySeat?: (card: Card) => Seat | undefined): boolean {
  if (!section) return false;
  if (!section.seat) {
    board.diagnostics.push({ severity: "error", message: `Invalid ${type === "bid" ? "Auction" : "Play"} starting seat`, line: section.line });
    return false;
  }
  let seat = section.seat;
  let consecutivePasses = 0;
  let contractStarted = false;
  let stopped = false;
  let starred = false;
  const content = stripComments(section.text, board, section.line);
  for (const rawToken of content.split(/\s+/).filter(Boolean)) {
    if (stopped) break;
    if (type === "bid") {
      const token = rawToken.toUpperCase();
      if (token === "AP") {
        const target = contractStarted ? 3 : 4;
        while (consecutivePasses < target) {
          actions.push({ type: "bid", seat, bid: "pass" });
          seat = nextSeat(seat);
          consecutivePasses++;
        }
        stopped = true;
        continue;
      }
      const bid = parseBid(rawToken);
      if (!bid) {
        board.diagnostics.push({ severity: "warning", message: `Unrecognized auction call: ${rawToken}`, line: section.line });
        continue;
      }
      actions.push({ type: "bid", seat, bid });
      if (bid === "pass") consecutivePasses++;
      else {
        consecutivePasses = 0;
        if (bid !== "double" && bid !== "redouble") contractStarted = true;
      }
      seat = nextSeat(seat);
      if ((!contractStarted && consecutivePasses === 4) || (contractStarted && consecutivePasses === 3)) stopped = true;
    } else {
      if (rawToken === "*") {
        starred = true;
        stopped = true;
        continue;
      }
      const card = parseCard(rawToken);
      if (!card) {
        board.diagnostics.push({ severity: "warning", message: `Unrecognized played card: ${rawToken}`, line: section.line });
        continue;
      }
      const playSeat = resolvePlaySeat ? resolvePlaySeat(card) : seat;
      if (!playSeat) {
        stopped = true;
        continue;
      }
      actions.push({ type: "play", seat: playSeat, card });
      seat = nextSeat(playSeat);
    }
  }
  return starred;
}

function materializeBoard(raw: RawBoard): PbnBoard {
  const tagValue = (name: string) => raw.tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.value;
  const tagLine = (name: string) => raw.tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.line ?? 1;
  const dealerCode = tagValue("Dealer")?.toUpperCase();
  const dealer = dealerCode ? letterSeat[dealerCode] : undefined;
  if (dealerCode && !dealer) raw.diagnostics.push({ severity: "error", message: "Invalid Dealer tag", line: tagLine("Dealer") });
  if (!dealerCode) raw.diagnostics.push({ severity: "warning", message: "Missing Dealer tag", line: 1 });
  const vulnerableCode = tagValue("Vulnerable")?.toLowerCase();
  const vulnerability = vulnerableCode
    ? ({ none: "None", love: "None", ns: "NS", ew: "EW", both: "Both", all: "Both" } as const)[vulnerableCode]
    : undefined;
  if (vulnerableCode && !vulnerability) raw.diagnostics.push({ severity: "error", message: "Invalid Vulnerable tag", line: tagLine("Vulnerable") });
  if (!vulnerableCode) raw.diagnostics.push({ severity: "warning", message: "Missing Vulnerable tag", line: 1 });
  const dealValue = tagValue("Deal");
  const deal = dealValue ? parseDeal(dealValue) : undefined;
  if (dealValue && !deal) raw.diagnostics.push({ severity: "error", message: "Invalid or incomplete Deal tag", line: tagLine("Deal") });
  const actions: GameAction[] = [];
  parseSection(raw, raw.auction, "bid", actions);
  let playState = deal && dealer ? createGameState({ deal, dealer, vulnerability: vulnerability ?? "None" }) : undefined;
  if (playState) {
    for (const action of actions) {
      if (action.type !== "bid") continue;
      const result = applyAction(playState, action);
      if (!result.ok) {
        playState = undefined;
        break;
      }
      playState = result.state;
    }
  }
  const resolvePlaySeat = playState?.phase === "play" ? (card: Card): Seat | undefined => {
    const seat = playState!.currentActor;
    const result = applyAction(playState!, { type: "play", seat, card });
    if (!result.ok) {
      raw.diagnostics.push({ severity: "error", message: `Invalid play: ${result.error.message}`, line: raw.play?.line ?? 1 });
      playState = undefined;
      return undefined;
    }
    playState = result.state;
    return seat;
  } : undefined;
  if (raw.play?.seat && playState?.phase === "play" && raw.play.seat !== playState.currentActor) {
    raw.diagnostics.push({ severity: "error", message: "Play starting seat does not match the opening leader", line: raw.play.line });
  }
  const starred = parseSection(raw, raw.play, "play", actions, resolvePlaySeat);
  // A `*` that ends the play early with a Result is a claim of the tricks that settle that result.
  const result = Number(tagValue("Result"));
  if (starred && playState?.phase === "play" && tagValue("Result") !== undefined && Number.isInteger(result)) {
    const claimSeat = claimSeatFor(playState);
    const contract = playState.contract!;
    const declaringSide = SEATS.indexOf(contract.declarer) % 2;
    const trump = contract.strain === "notrump" ? undefined : contract.strain;
    const won = playState.completedTricks.filter((trick) => SEATS.indexOf(trickWinner(trick, trump)) % 2 === declaringSide).length;
    const more = result - won;
    const remaining = remainingTricks(playState);
    const claim: GameAction | undefined = claimSeat && more >= 0 && more <= remaining
      ? { type: "claim", seat: claimSeat, tricks: SEATS.indexOf(claimSeat) % 2 === declaringSide ? more : remaining - more }
      : undefined;
    if (claim && applyAction(playState, claim).ok) actions.push(claim);
    else raw.diagnostics.push({ severity: "warning", message: "Play ends with * but the Result tag does not match a claim", line: raw.play?.line ?? 1 });
  }
  return {
    tags: raw.tags,
    comments: raw.comments,
    actions,
    ...(dealer ? { dealer } : {}),
    ...(vulnerability ? { vulnerability } : {}),
    ...(deal ? { deal } : {}),
    ...(raw.auction?.seat ? { auctionStartSeat: raw.auction.seat } : {}),
    ...(raw.auction ? { auctionText: raw.auction.text } : {}),
    ...(raw.play?.seat ? { playStartSeat: raw.play.seat } : {}),
    ...(raw.play ? { playText: raw.play.text } : {}),
    diagnostics: raw.diagnostics
  };
}

/** Parses PBN tag pairs, comments, deals, auctions, and card-play sections. */
export function parsePbn(input: string): PbnDocument {
  const boards: PbnBoard[] = [];
  let current = newRawBoard();
  let activeSection: "auction" | "play" | undefined;
  let lineNumber = 0;
  for (const line of input.split(/\r?\n/)) {
    lineNumber++;
    const tagMatch = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\]\s*$/.exec(line);
    if (tagMatch) {
      const name = tagMatch[1]!;
      const value = tagMatch[2]!.replace(/\\([\\"])/g, "$1");
      const boundary = ["board", "event", "dealer"].includes(name.toLowerCase());
      const repeated = current.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (hasBoardData(current) && boundary && repeated) {
        boards.push(materializeBoard(current));
        current = newRawBoard();
        activeSection = undefined;
      }
      if (name.toLowerCase() === "auction" || name.toLowerCase() === "play") {
        const seat = letterSeat[value.trim().toUpperCase()];
        const section: RawSection = { ...(seat ? { seat } : {}), text: "", line: lineNumber + 1 };
        if (name.toLowerCase() === "auction") current.auction = section;
        else current.play = section;
        activeSection = name.toLowerCase() as "auction" | "play";
      } else {
        current.tags.push({ name, value, line: lineNumber });
        activeSection = undefined;
      }
      continue;
    }
    if (!line.trim()) continue;
    if (activeSection) {
      const section = activeSection === "auction" ? current.auction : current.play;
      if (section) section.text += `${line}\n`;
    } else {
      const content = stripComments(line, current, lineNumber).trim();
      if (content) current.diagnostics.push({ severity: "warning", message: `Ignored content outside a PBN section: ${content}`, line: lineNumber });
    }
  }
  if (hasBoardData(current)) boards.push(materializeBoard(current));
  return { boards };
}

/** Serializes parsed board records, retaining unknown tags and raw section text. */
export function serializePbn(document: PbnDocument): string {
  return document.boards.map((board) => {
    const hasRawDeal = board.tags.some((tag) => tag.name.toLowerCase() === "deal");
    if (board.auctionText === undefined && board.playText === undefined && board.dealer && board.vulnerability && (!hasRawDeal || board.deal)) {
      return exportPbn({
        dealer: board.dealer,
        vulnerability: board.vulnerability,
        actions: board.actions,
        ...(board.deal ? { deal: board.deal } : {}),
        tags: board.tags,
        comments: board.comments
      });
    }

    const lines = board.tags.map(({ name, value }) => `[${name} "${escapeTag(value)}"]`);
    const rawSections = [board.auctionText, board.playText].filter((text): text is string => text !== undefined);
    for (const comment of board.comments) {
      if (!rawSections.some((section) => section.includes(`{${comment}}`))) lines.push(`{${comment}}`);
    }
    if (board.auctionText !== undefined && board.auctionStartSeat) {
      lines.push(`[Auction "${seatLetter[board.auctionStartSeat]}"]\n${board.auctionText.trim()}`);
    }
    if (board.playText !== undefined && board.playStartSeat) {
      lines.push(`[Play "${seatLetter[board.playStartSeat]}"]\n${board.playText.trim()}`);
    }
    return lines.join("\n\n");
  }).join("\n\n");
}

/** Converts a parsed board to the metadata and actions shape used by the core exporter. */
export function pbnBoardToHand(board: PbnBoard): PbnHand {
  if (!board.dealer) throw new Error("PBN board is missing a valid Dealer tag");
  if (!board.vulnerability) throw new Error("PBN board is missing a valid Vulnerable tag");
  return {
    dealer: board.dealer,
    vulnerability: board.vulnerability,
    actions: board.actions,
    tags: board.tags,
    comments: board.comments,
    ...(board.deal ? { deal: board.deal } : {})
  };
}

/** Retained for callers that only need the two required board metadata tags. */
export function parsePbnMetadata(pbn: string): Pick<PbnHand, "dealer" | "vulnerability"> {
  const board = parsePbn(pbn).boards[0];
  if (!board?.dealer) throw new Error("PBN is missing a valid [Dealer] tag");
  if (!board.vulnerability) throw new Error("PBN is missing a valid [Vulnerable] tag");
  return { dealer: board.dealer, vulnerability: board.vulnerability };
}
