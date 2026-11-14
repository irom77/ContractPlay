import { applyAction, scoreContract, claimSeatFor, createGameState, remainingTricks, trickWinner, SEATS, SUITS, RANKS, isValidDeal, type Card, type Deal, type Seat, type Suit, type Vulnerability, type Bid, type GameAction, type GameState, type HandRecord, type TravellerRow, MAX_MULTIPLICITY } from "@contractplay/core";

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
  tables?: Readonly<Record<string, string>>;
  field?: readonly TravellerRow[];
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
    const rows: string[] = [];
    for (let offset = 0; offset < plays.length; offset += 4) {
      const columns = ["-", "-", "-", "-"];
      for (const action of plays.slice(offset, offset + 4)) {
        const column = (SEATS.indexOf(action.seat) - SEATS.indexOf(playSeat) + 4) % 4;
        columns[column] = serializeCard(action.card);
      }
      rows.push(columns.join(" "));
    }
    if (claim) {
      if (rows.length) rows[rows.length - 1] += " *";
      else rows.push("*");
    }
    sections.push(`[Play "${seatLetter[playSeat]}"]\n${rows.join("\n")}`);
  }
  return sections.join("\n");
}

type RawSection = { seat?: Seat; text: string; line: number };
type RawBoard = { tags: PbnTag[]; comments: string[]; diagnostics: PbnDiagnostic[]; auction?: RawSection; play?: RawSection; tables: Record<string, string> };

function newRawBoard(): RawBoard {
  return { tags: [], comments: [], diagnostics: [], tables: {} };
}

function hasBoardData(board: RawBoard): boolean {
  return board.tags.length > 0 || board.auction !== undefined || board.play !== undefined || Object.keys(board.tables).length > 0 || board.comments.length > 0;
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
    if (isAnnotation(rawToken)) continue;
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

/** A note reference (`=1=`) or a numeric annotation glyph (`$12`) in an Auction or Play section. */
const isAnnotation = (token: string) => /^=\d+=$/.test(token) || /^\$\d+$/.test(token);

/**
 * Reads a Play section as PBN 2.1 §3.11 lays it out: one trick per four tokens, each in its seat's column starting with
 * the `[Play]` seat, `-` for a card not played, and `*` ending the record. Each trick is played from its actual leader.
 * Returns undefined when the cards do not fit that layout, so a file written in play order can be read that way instead.
 */
function playByColumns(section: RawSection, start: GameState): { actions: GameAction[]; state: GameState; starred: boolean } | undefined {
  if (!section.seat) return undefined;
  const tokens: (Card | null)[] = [];
  let starred = false;
  for (const token of section.text.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ").split(/\s+/).filter(Boolean)) {
    if (isAnnotation(token)) continue;
    if (token === "*") {
      starred = true;
      break;
    }
    if (token === "-") {
      tokens.push(null);
      continue;
    }
    const card = parseCard(token);
    if (!card) return undefined;
    tokens.push(card);
  }
  const column = (seat: Seat) => (SEATS.indexOf(seat) - SEATS.indexOf(section.seat!) + 4) % 4;
  const actions: GameAction[] = [];
  let state = start;
  for (let trick = 0; trick * 4 < tokens.length && state.phase === "play"; trick += 1) {
    for (let turn = 0; turn < 4; turn += 1) {
      const seat = state.currentActor;
      const card = tokens[trick * 4 + column(seat)];
      if (!card) return { actions, state, starred };
      const result = applyAction(state, { type: "play", seat, card });
      if (!result.ok) return undefined;
      actions.push({ type: "play", seat, card });
      state = result.state;
    }
  }
  return { actions, state, starred };
}

const tokenizeRow = (row: string): string[] => Array.from(row.matchAll(/"([^"]*)"|(\S+)/g), (match) => match[1] ?? match[2]!);
const isUnknown = (token: string) => token === "?" || token === "-";

/** Reads a PBN ScoreTable into traveller rows; player names and pair numbers are ignored. */
export function parseScoreTable(header: string, rowsText: string, line: number): { rows: TravellerRow[]; diagnostics: PbnDiagnostic[] } {
  const columns = header.split(";").map((column) => column.trim().replace(/\\\d+[LR]?$/i, "").toLowerCase());
  const column = (name: string) => columns.indexOf(name.toLowerCase());
  const [nsColumn, ewColumn, contractColumn, declarerColumn, resultColumn, multiplicityColumn] =
    ["Score_NS", "Score_EW", "Contract", "Declarer", "Result", "Multiplicity"].map(column);
  const rows: TravellerRow[] = [];
  const diagnostics: PbnDiagnostic[] = [];
  const score = (token: string | undefined): number | undefined => {
    const match = token === undefined ? null : /^\^?([+-]?\d+)$/.exec(token);
    return match ? Number(match[1]) : undefined;
  };
  rowsText.split(/\r?\n/).forEach((rowText, index) => {
    if (!rowText.trim()) return;
    const rowLine = line + 1 + index;
    const tokens = tokenizeRow(rowText);
    if (tokens.length !== columns.length) {
      diagnostics.push({ severity: "warning", message: `ScoreTable row has ${tokens.length} values but ${columns.length} columns, skipped: ${rowText.trim()}`, line: rowLine });
      return;
    }
    const at = (index: number) => (index >= 0 ? tokens[index] : undefined);
    const ns = score(at(nsColumn!));
    const ew = score(at(ewColumn!));
    const nsScore = ns ?? (ew === undefined ? undefined : 0 - ew);
    const contract = at(contractColumn!);
    const declarer = letterSeat[at(declarerColumn!)?.toUpperCase() ?? ""];
    const tricks = Number(at(resultColumn!));
    let multiplicity = 1;
    const multiplicityToken = at(multiplicityColumn!);
    if (multiplicityToken !== undefined && !isUnknown(multiplicityToken)) {
      const value = Number(multiplicityToken);
      if (Number.isInteger(value) && value >= 1 && value <= MAX_MULTIPLICITY) multiplicity = value;
      else diagnostics.push({ severity: "warning", message: `Invalid Multiplicity, using 1: ${rowText.trim()}`, line: rowLine });
    }
    rows.push({
      ...(nsScore !== undefined ? { nsScore } : {}),
      ...(contract !== undefined && !isUnknown(contract) ? { contract } : {}),
      ...(declarer ? { declarer } : {}),
      ...(at(resultColumn!) !== undefined && Number.isInteger(tricks) && tricks >= 0 && tricks <= 13 ? { tricks } : {}),
      multiplicity,
      artificial: [at(nsColumn!), at(ewColumn!)].some((token) => token?.startsWith("^"))
    });
  });
  return { rows, diagnostics };
}

function materializeBoard(raw: RawBoard): PbnBoard {
  const tagValue = (name: string) => raw.tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.value;
  const tagLine = (name: string) => raw.tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.line ?? 1;
  const dealerCode = tagValue("Dealer")?.toUpperCase();
  const dealer = dealerCode ? letterSeat[dealerCode] : undefined;
  if (dealerCode && !dealer && !raw.diagnostics.some((entry) => entry.severity === "error" && entry.message === "Tag Dealer cannot inherit a value")) raw.diagnostics.push({ severity: "error", message: "Invalid Dealer tag", line: tagLine("Dealer") });
  if (!dealerCode) raw.diagnostics.push({ severity: "warning", message: "Missing Dealer tag", line: 1 });
  const vulnerableCode = tagValue("Vulnerable")?.toLowerCase();
  const vulnerability = vulnerableCode
    ? ({ none: "None", love: "None", "-": "None", ns: "NS", ew: "EW", both: "Both", all: "Both" } as const)[vulnerableCode]
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
  if (raw.play?.seat && playState?.phase === "play" && raw.play.seat !== playState.currentActor) {
    raw.diagnostics.push({ severity: "warning", message: "Play starting seat does not match the opening leader; original play is unavailable", line: raw.play.line });
  }
  const byColumns = raw.play && playState?.phase === "play" ? playByColumns(raw.play, playState) : undefined;
  if (byColumns) {
    actions.push(...byColumns.actions);
    playState = byColumns.state;
    stripComments(raw.play!.text, raw, raw.play!.line);
  }
  const resolvePlaySeat = !byColumns && playState?.phase === "play" ? (card: Card): Seat | undefined => {
    const seat = playState!.currentActor;
    const result = applyAction(playState!, { type: "play", seat, card });
    if (!result.ok) {
      raw.diagnostics.push({ severity: "warning", message: `Invalid play: ${result.error.message}; original play is unavailable`, line: raw.play?.line ?? 1 });
      playState = undefined;
      return undefined;
    }
    playState = result.state;
    return seat;
  } : undefined;
  const starred = byColumns ? byColumns.starred : parseSection(raw, raw.play, "play", actions, resolvePlaySeat);
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
  const scoreTable = Object.entries(raw.tables).find(([name]) => name.toLowerCase() === "scoretable");
  let field: TravellerRow[] | undefined;
  if (scoreTable) {
    const parsed = parseScoreTable(tagValue(scoreTable[0]) ?? "", scoreTable[1], tagLine(scoreTable[0]));
    field = parsed.rows;
    raw.diagnostics.push(...parsed.diagnostics);
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
    ...(Object.keys(raw.tables).length ? { tables: raw.tables } : {}),
    ...(field ? { field } : {}),
    diagnostics: raw.diagnostics
  };
}

const nonInheritableTags = ["dealer", "vulnerable", "deal", "declarer", "contract", "auction", "play"];

/** Resolves PBN 4.8 tag inheritance: `#` repeats the previous board's value, `##` sets a value for later boards too. */
function resolveInheritance(rawBoards: RawBoard[]): void {
  const sticky = new Map<string, PbnTag>();
  let previous = new Map<string, string>();
  for (const board of rawBoards) {
    const present = new Set(board.tags.map((tag) => tag.name.toLowerCase()));
    const resolved: PbnTag[] = [];
    for (const tag of board.tags) {
      const key = tag.name.toLowerCase();
      const line = tag.line ?? 1;
      if (!tag.value.startsWith("#")) {
        resolved.push(tag);
      } else if (nonInheritableTags.includes(key)) {
        board.diagnostics.push({ severity: "error", message: `Tag ${tag.name} cannot inherit a value`, line });
        resolved.push(tag);
      } else if (tag.value.startsWith("##")) {
        const value = tag.value.slice(2);
        sticky.set(key, { ...tag, value });
        resolved.push({ ...tag, value });
      } else if (tag.value === "#") {
        const value = previous.get(key);
        if (value === undefined) board.diagnostics.push({ severity: "warning", message: `Tag ${tag.name} has no previous value to inherit`, line });
        else resolved.push({ ...tag, value });
      } else {
        resolved.push(tag);
      }
    }
    for (const [key, tag] of sticky) {
      if (!present.has(key)) resolved.push({ name: tag.name, value: tag.value });
    }
    board.tags = resolved;
    previous = new Map(resolved.map((tag) => [tag.name.toLowerCase(), tag.value]));
  }
}

/** Parses PBN tag pairs, comments, deals, auctions, and card-play sections. */
export function parsePbn(input: string): PbnDocument {
  const rawBoards: RawBoard[] = [];
  let current = newRawBoard();
  let activeSection: "auction" | "play" | "table" | undefined;
  let activeTable = "";
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
        rawBoards.push(current);
        current = newRawBoard();
        activeSection = undefined;
      }
      if (name.toLowerCase() === "auction" || name.toLowerCase() === "play") {
        if (value.startsWith("#")) current.diagnostics.push({ severity: "error", message: `Tag ${name} cannot inherit a value`, line: lineNumber });
        const seat = letterSeat[value.trim().toUpperCase()];
        const section: RawSection = { ...(seat ? { seat } : {}), text: "", line: lineNumber + 1 };
        if (name.toLowerCase() === "auction") current.auction = section;
        else current.play = section;
        activeSection = name.toLowerCase() as "auction" | "play";
      } else if (/table$/i.test(name)) {
        current.tags.push({ name, value, line: lineNumber });
        current.tables[name] = "";
        activeSection = "table";
        activeTable = name;
      } else {
        current.tags.push({ name, value, line: lineNumber });
        activeSection = undefined;
      }
      continue;
    }
    if (activeSection === "table" && !tagMatch) {
      // Keep physical line positions for diagnostics, but brace comments are not table values.
      current.tables[activeTable] += `${line.replace(/\{[^}]*\}/g, "")}\n`;
      continue;
    }
    if (!line.trim()) continue;
    // PBN §2.4: a line starting with % is an escape line (such as "% PBN 2.1") and carries no game data.
    if (line.startsWith("%")) continue;
    if (activeSection) {
      const section = activeSection === "auction" ? current.auction : current.play;
      if (section) section.text += `${line}\n`;
    } else {
      const content = stripComments(line, current, lineNumber).trim();
      if (content) current.diagnostics.push({ severity: "warning", message: `Ignored content outside a PBN section: ${content}`, line: lineNumber });
    }
  }
  if (hasBoardData(current)) rawBoards.push(current);
  resolveInheritance(rawBoards);
  return { boards: rawBoards.map(materializeBoard) };
}

/** Serializes parsed board records, retaining unknown tags and raw section text. */
export function serializePbn(document: PbnDocument): string {
  return document.boards.map((board) => {
    const hasRawDeal = board.tags.some((tag) => tag.name.toLowerCase() === "deal");
    if (board.auctionText === undefined && board.playText === undefined && board.tables === undefined && board.dealer && board.vulnerability && (!hasRawDeal || board.deal)) {
      return exportPbn({
        dealer: board.dealer,
        vulnerability: board.vulnerability,
        actions: board.actions,
        ...(board.deal ? { deal: board.deal } : {}),
        tags: board.tags,
        comments: board.comments
      });
    }

    const lines = board.tags.map(({ name, value }) => {
      const table = board.tables?.[name];
      // Table headers keep their `\<width>[LR]` column suffixes as written, so only quotes are escaped.
      const rows = table?.split(/\r?\n/).filter((row) => row.trim()).join("\n");
      return table === undefined ? `[${name} "${escapeTag(value)}"]` : `[${name} "${value.replaceAll('"', '\\"')}"]\n${rows}`;
    });
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
    return lines.join("\n");
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

/** PBN 2.1 OptimumScore, normalized to North-South score units. */
function doubleDummyPar(value: string | undefined): number | undefined {
  if (!value) return undefined;
  // Some PBN 2.1 exporters list optimum contracts before the signed NS score.
  const trailingScore = /;\s*([+-]?\d+)\s*$/.exec(value);
  if (trailingScore) return Number(trailingScore[1]);
  const scores = [...value.matchAll(/\b(NS|EW)\s+([+-]?\d+)\b/gi)];
  if (!scores.length) return undefined;
  const nsScore = scores.find((match) => match[1]!.toUpperCase() === "NS");
  const ewScore = scores.find((match) => match[1]!.toUpperCase() === "EW");
  return nsScore ? Number(nsScore[2]) : ewScore ? -Number(ewScore[2]) : undefined;
}

/** Maps a parsed board to a hand record for comparing results with the field, or undefined when it has no usable deal. */
export function pbnBoardToRecord(board: PbnBoard): HandRecord | undefined {
  if (!board.deal || !board.dealer || board.diagnostics.some((entry) => entry.severity === "error")) return undefined;
  const tag = (name: string) => board.tags.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;
  const [boardNumber, event, scoring] = [tag("Board"), tag("Event"), tag("Scoring")];
  const par = doubleDummyPar(tag("OptimumScore"));
  const unavailableOriginal = board.diagnostics.some((entry) => entry.message.startsWith("Invalid play:") || entry.message.startsWith("Play starting seat does not match"));
  return {
    ...(boardNumber !== undefined ? { board: boardNumber } : {}),
    ...(event !== undefined ? { event } : {}),
    ...(scoring !== undefined ? { scoring } : {}),
    ...(par !== undefined ? { doubleDummyPar: par } : {}),
    dealer: board.dealer,
    vulnerability: board.vulnerability ?? "None",
    deal: board.deal,
    ...(board.actions.length && !unavailableOriginal ? { original: board.actions } : {}),
    field: board.field ?? []
  };
}

/**
 * The result one table recorded for its board in the `Contract`, `Declarer`, `Result`, and `Score` tags, as a traveller
 * row. Files such as RealBridge's "full" export list each table's play of a board as its own game with these tags
 * instead of a `ScoreTable`. Undefined when the table has no contract (an unplayed board) or its score cannot be found.
 */
export function tableResult(board: PbnBoard): TravellerRow | undefined {
  const tag = (name: string) => board.tags.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value.trim();
  const contractText = tag("Contract")?.toUpperCase();
  if (!contractText || isUnknown(contractText)) return undefined;
  if (contractText === "PASS" || contractText === "AP") return { nsScore: 0, contract: "Pass", multiplicity: 1, artificial: false };
  const match = /^([1-7])(C|D|H|S|NT|N)(X{0,2})$/.exec(contractText);
  const declarer = letterSeat[tag("Declarer")?.toUpperCase() ?? ""];
  const tricks = Number(tag("Result"));
  if (!match || !declarer || !Number.isInteger(tricks) || tricks < 0 || tricks > 13) return undefined;
  const strain = ({ C: "clubs", D: "diamonds", H: "hearts", S: "spades", NT: "notrump", N: "notrump" } as const)[match[2] as "C" | "D" | "H" | "S" | "NT" | "N"];
  const doubled = match[3]!.length as 0 | 1 | 2;
  const scoreMatch = /^(NS|EW)\s+([+-]?\d+)$/i.exec(tag("Score") ?? "");
  const nsScore = scoreMatch
    ? (scoreMatch[1]!.toUpperCase() === "NS" ? 1 : -1) * Number(scoreMatch[2])
    : scoreContract({ level: Number(match[1]) as 1 | 2 | 3 | 4 | 5 | 6 | 7, strain, declarer, doubled }, tricks, board.vulnerability ?? "None").score;
  return { nsScore, contract: `${match[1]}${match[2] === "N" ? "NT" : match[2]}${match[3]}`, declarer, tricks, multiplicity: 1, artificial: false };
}
