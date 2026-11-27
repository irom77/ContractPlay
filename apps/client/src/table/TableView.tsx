import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cardId, SUITS, trickWinner, tricksWonBySide, type Bid, type Card, type Seat, type TrickCard } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
import { highCardPoints } from "@contractplay/bots";
import {
  biddingStrains,
  callChipClass,
  callLabel,
  cardFace,
  cardsHeld,
  cardLabel,
  compactCallLabel,
  contractText,
  isCallAvailable,
  isRedSuit,
  partnerOf,
  samePartnership,
  seatNames,
  seats,
  handSuitOrder,
  sortHand,
  suitGapShare,
  suitSymbols
} from "./labels.js";
import { DealAnimation } from "./DealAnimation.js";
import { defaultHandLayout, fanCardStyle, type HandLayout } from "./handLayout.js";

const tablePositions = ["bottom", "left", "top", "right"] as const;
const liveTurnPhase = (phase: PublicGame["phase"]) => phase === "auction" || phase === "play";
// The bidding box reads from the highest strain down in each row (NT, ♠, ♥, ♦, ♣), as on Trickster Cards.
const bidBoxStrains = [...biddingStrains].reverse();

export type TableViewProps = {
  game: PublicGame;                      // hidden hands are empty arrays
  bottomSeat: Seat;
  /** Seats whose cards the viewer may play now (own seat and/or dummy); empty when not their turn. */
  actingSeat?: Seat | undefined;
  displayedTrick: readonly TrickCard[];
  showCalls: boolean; onToggleCalls(): void;
  /** Whether the last completed trick is laid out on the table, and the last-trick button that toggles it. */
  lastTrickOpen: boolean; onToggleLastTrick(): void;
  /** Show the bottom seat's cards in the hand zone when the viewer is not acting. */
  showBottomHand: boolean;
  /** Online, keep every visible hand at its seat, grouped by suit, from the deal to the last card (the bidding included). */
  fixedSeatHands?: boolean;
  /** A seat without a player can still show its public card backs at the bottom (for read-only observers). */
  showBacksAtBottom?: boolean;
  /** A seat to show face-up at its place, such as the claimer's hand while a claim is pending; backs stay if its cards were not sent. */
  exposedSeat?: Seat | undefined;
  /** Seats whose cards the viewer may queue now, to play when that seat's turn comes. */
  queueSeats?: readonly Seat[] | undefined;
  /** The card queued to play, raised and outlined; clicking it again un-queues it. */
  queuedCard?: { seat: Seat; card: Card } | undefined;
  onQueue?(seat: Seat, card: Card): void;
  /** Keep playable cards disabled, for example while a completed trick is still on the table. */
  cardsDisabled?: boolean;
  /** Keep every call in the bid picker disabled, for example while a sent call awaits the service. */
  bidsDisabled?: boolean;
  statusText: string; ariaLabel: string;
  /** Where an imported board set stands, such as "Board 7 · 1 of 3", shown under the status in the top-right card. */
  boardLabel?: string | undefined;
  /** Seats played by a bot: their seat badge is drawn as a computer instead of a circle. */
  botSeats?: readonly Seat[] | undefined;
  seatLabel?(seat: Seat): React.ReactNode;       // extra per-seat content (online: player name, away, bot badge, seat controls)
  onBid?(bid: Bid): void; onPlay?(seat: Seat, card: Card): void;
  hintedBid?: Bid | undefined; hintedCards?: ReadonlySet<string> | undefined;
  explainCall?: { shown?: number | undefined; onToggle(index: number): void; text(index: number): string } | undefined;
  /**
   * When given, a tap in the bidding box first selects a call and shows `meaning(call)` under it; a second tap on the
   * call, or the confirm button, makes it. `initial` opens with a call already selected (a preview).
   */
  confirmCalls?: { meaning(bid: Bid): string; initial?: Bid | undefined } | undefined;
  /** Running match score, shown under the trick count in the top-right status card. */
  matchScore?: { ns: number; ew: number } | undefined;
  /** Once the hand is over: the whole deal, laid face-up at each seat with its high-card points. Nothing is playable. */
  revealedHands?: Readonly<Record<Seat, readonly Card[]>> | undefined;
  /** A new hand has just been dealt: a deck is shuffled and dealt in the middle, and the cards and calls appear once it is done. */
  dealing?: boolean | undefined;
  tools?: React.ReactNode;               // menu + fullscreen (top-left)
  toolsNote?: React.ReactNode;           // a short note under the tools, clear of the status card
  overlay?: React.ReactNode;             // score panel, review/history controls, hint controls, messages
  /** How held hands (the hand zone and the backs at hidden seats) are spread: an arcing fan or a flat line. */
  handLayout?: HandLayout;
};

const tableWatermark = <svg className="table-watermark" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
  <path d="M62 132c8-38 28-56 58-56s50 18 58 56" />
  <path d="M56 138h128M74 138v20m92-20v20M98 138v-34m44 34v-34M120 138V76" />
  <text x="120" y="50">♠</text><text x="212" y="132">♥</text><text x="120" y="214">♦</text><text x="28" y="132">♣</text>
</svg>;


/** The narrowest result panel worth fitting between the side seats rather than laying over them, in pixels. */
const MIN_PANEL_WIDTH = 320;
/** The bridge table: status, seats with their calls and dummy, the trick, the bid picker, and the hand zone. */
export function TableView({
  game, bottomSeat, actingSeat, displayedTrick, showCalls, onToggleCalls, lastTrickOpen, onToggleLastTrick, showBottomHand, fixedSeatHands = false, showBacksAtBottom = false, exposedSeat,
  queueSeats, queuedCard, onQueue, cardsDisabled = false, bidsDisabled = false, statusText, ariaLabel, boardLabel, botSeats, seatLabel, onBid, onPlay, hintedBid, hintedCards, explainCall, confirmCalls, matchScore, revealedHands, dealing = false, tools, toolsNote, overlay, handLayout = defaultHandLayout
}: TableViewProps): React.JSX.Element {
  const auctionListRef = useRef<HTMLOListElement>(null);
  const bidPickerRef = useRef<HTMLDivElement>(null);
  const phase = game.phase;
  const auctionLength = game.auction.length;
  // The call picked in the bidding box but not yet made, and the auction length it was picked at: once the auction
  // moves on, the pick no longer applies.
  const [picked, setPicked] = useState<{ bid: Bid; at: number } | undefined>(() => confirmCalls?.initial ? { bid: confirmCalls.initial, at: auctionLength } : undefined);
  const pickedNow = picked && picked.at === auctionLength ? picked.bid : undefined;

  useEffect(() => {
    if (!pickedNow) return;
    const clear = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !bidPickerRef.current?.contains(event.target as Node)) setPicked(undefined);
    };
    document.addEventListener("click", clear);
    document.addEventListener("keydown", clear);
    return () => { document.removeEventListener("click", clear); document.removeEventListener("keydown", clear); };
  }, [pickedNow]);

  useEffect(() => {
    const list = auctionListRef.current;
    if (phase === "auction" && list) list.scrollTop = list.scrollHeight;
  }, [phase, auctionLength]);

  const contract = game.contract;
  const trump = contract && contract.strain !== "notrump" ? contract.strain : undefined;
  const liveTurn = phase === "auction" || phase === "play";
  const shownActor = game.currentActor;
  const dummySeat = contract ? partnerOf(contract.declarer) : undefined;
  const dummyPosition = dummySeat ? tablePositions[(seats.indexOf(dummySeat) - seats.indexOf(bottomSeat) + 4) % 4]! : undefined;
  const dummyVisible = !!contract && (game.currentTrick.length > 0 || game.completedTricks.length > 0 || phase === "complete");
  const revealed = revealedHands && (phase === "complete" || phase === "passed-out") ? revealedHands : undefined;
  const surfaceRef = useRef<HTMLDivElement>(null);
  // With every hand face-up, the result panel must stay clear of all four seats: their names, tags, high-card points
  // and calls as well as their cards. The CSS estimates the room from the card sizes; this measures what is there.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!revealed || !surface) return;
    const measure = () => {
      const bounds = surface.getBoundingClientRect();
      const seat = (position: string) => surface.querySelector(`.pos-${position}`)?.getBoundingClientRect();
      const [top, right, bottom, left] = [seat("top"), seat("right"), seat("bottom"), seat("left")];
      const rooms = { top: top ? top.bottom - bounds.top : 0, right: right ? bounds.right - right.left : 0,
        bottom: bottom ? bounds.bottom - bottom.top : 0, left: left ? left.right - bounds.left : 0 };
      // A phone held upright has no usable room between the side hands; there the panel spans the table over them.
      if (bounds.width - rooms.left - rooms.right < MIN_PANEL_WIDTH) rooms.left = rooms.right = 0;
      for (const [side, room] of Object.entries(rooms)) surface.style.setProperty(`--measured-${side}-room`, `${Math.ceil(Math.max(0, room))}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(surface);
    for (const seat of surface.querySelectorAll(".seat")) observer?.observe(seat);
    return () => {
      observer?.disconnect();
      for (const side of ["top", "right", "bottom", "left"]) surface.style.removeProperty(`--measured-${side}-room`);
    };
  });
  const fixedPlayHands = fixedSeatHands && liveTurnPhase(phase);
  // A dummy at a side seat is a column as wide as its longest suit; the bottom hand is laid out beside it.
  const sideDummy = fixedPlayHands && dummyVisible && dummySeat && (dummyPosition === "left" || dummyPosition === "right") ? dummyPosition : undefined;
  // A hand spread along the top shares its height with the corners, so it fits between the tools and the status card.
  const handOnTop = fixedPlayHands && game.hands[seats[(seats.indexOf(bottomSeat) + 2) % 4]!].length > 0;
  const sideDummySpan = sideDummy && dummySeat ? Math.max(1, ...SUITS.map((suit) => game.hands[dummySeat].filter((card) => card.suit === suit).length)) : undefined;
  const { ns: completedNsTricks, ew: completedEwTricks } = tricksWonBySide(game);
  const positionOf = (seat: Seat) => tablePositions[(seats.indexOf(seat) - seats.indexOf(bottomSeat) + 4) % 4]!;
  const canAct = actingSeat !== undefined;
  const selectedCall = confirmCalls && canAct && onBid && phase === "auction" && !bidsDisabled && pickedNow && isCallAvailable(game, pickedNow) ? pickedNow : undefined;
  // Without confirmCalls a tap makes the call; with it, a tap picks a call and a second tap on it makes it.
  const chooseCall = (bid: Bid) => {
    if (!onBid) return;
    if (!confirmCalls || selectedCall === bid) { setPicked(undefined); onBid(bid); return; }
    setPicked({ bid, at: auctionLength });
  };
  // Dummy laid out across the table is played from there, so the bottom edge keeps showing declarer's own cards.
  const playFromDummy = canAct && phase === "play" && dummyVisible && actingSeat === dummySeat && positionOf(actingSeat) !== "bottom";
  const handIsInteractive = canAct && !playFromDummy;
  const handSeat: Seat | undefined = fixedPlayHands || revealed ? undefined : handIsInteractive ? actingSeat : showBottomHand || playFromDummy ? bottomSeat : undefined;
  const handCards = handSeat ? sortHand(game.hands[handSeat]) : [];
  const handIsDummy = dummyVisible && handSeat === dummySeat;
  const lastTrick = game.completedTricks.at(-1);
  const lastTrickWinner = lastTrick ? trickWinner(lastTrick, trump) : undefined;
  const shownExplanation = explainCall?.shown;
  const auctionList = game.auction.length ? <ol className="sr-only" ref={auctionListRef} aria-label="Auction calls">{game.auction.map(({ seat, bid }, index) => <li key={`${seat}-${index}`}><span>{seatNames[seat]}</span><strong>{callLabel(bid)}</strong></li>)}</ol> : null;
  const isQueued = (seat: Seat, card: Card) => queuedCard?.seat === seat && cardId(queuedCard.card) === cardId(card);
  const canQueue = (seat: Seat) => phase === "play" && !!onQueue && !!queueSeats?.includes(seat);
  const queueButton = (seat: Seat, card: Card, className: string, style?: CSSProperties) => {
    const queued = isQueued(seat, card);
    return <button type="button" className={`${className} ${queued ? "queued-card" : ""}`} key={cardId(card)} style={style} aria-label={`${queued ? "Unqueue" : "Queue"} ${cardLabel(card)}`} title={queued ? "Queued: plays when your turn comes. Click to cancel" : "Queue this card to play when your turn comes"} onClick={() => onQueue?.(seat, card)}>{cardFace(card)}</button>;
  };
  const tableCard = (card: Card, className: string, label: string, style?: CSSProperties) => <span className={`${className} ${isRedSuit(card.suit) ? "red-card" : ""}`} key={cardId(card)} style={style} role="img" aria-label={label}>{cardFace(card)}</span>;

  return (
    <section className={`table-panel hand-layout-${handLayout}${dealing ? " dealing" : ""}`} aria-label={ariaLabel}>
      <div ref={surfaceRef} className={`table-surface ${revealed ? "hands-revealed" : ""} ${phase === "play" && showCalls ? "calls-shown" : ""} ${sideDummy ? `dummy-on-${sideDummy}` : ""} ${handOnTop ? "hand-on-top" : ""}`} style={sideDummySpan ? { "--dummy-span": sideDummySpan } as CSSProperties : undefined}>
        {tableWatermark}
        <div className={`table-status${contract ? " has-contract" : ""}`}>
          {contract ? <button style={{ gridRow: `1 / span ${1 + (contract ? 1 : 0) + (matchScore ? 1 : 0)}` }} className="contract-badge" type="button" disabled={phase !== "play"} aria-expanded={showCalls} aria-label={`${showCalls ? "Hide" : "Show"} auction, ${game.auction.length} calls. Contract ${callLabel(`${contract.level}${contract.strain}` as Bid)} by ${seatNames[contract.declarer]}`} title={phase === "play" ? `${showCalls ? "Hide" : "Show"} the bidding` : undefined} onClick={onToggleCalls}>
            <strong>{contractText(contract)}</strong><span>{seatNames[contract.declarer][0]}</span>
          </button> : null}
          {contract || matchScore ? <>
            <span className="hud-side hud-ns" aria-hidden="true">NS</span><span className="hud-side hud-ew" aria-hidden="true">EW</span>
          </> : null}
          {contract ? <span className="hud-row trick-count" role="group" aria-label={`NS ${completedNsTricks} · EW ${completedEwTricks} tricks`} aria-live="polite" title="Tricks won this hand">
            <b className="hud-ns">{completedNsTricks}</b><b className="hud-ew">{completedEwTricks}</b>
          </span> : null}
          {matchScore ? <span className="hud-row match-score" role="group" aria-label={`Score NS ${matchScore.ns} · EW ${matchScore.ew}`} title="Running score at this table">
            <span className="hud-ns">{matchScore.ns}</span><span className="hud-ew">{matchScore.ew}</span>
          </span> : null}
          <span className="status-pill" aria-live="polite">{statusText}</span>
          {boardLabel ? <span className="board-label">{boardLabel}</span> : null}
        </div>

        <div className="table-tools">
          <div className="table-tools-row">{tools}</div>
          {toolsNote}
        </div>

        {seats.map((seat) => {
          const position = positionOf(seat);
          const hasPlayed = phase === "play" && game.currentTrick.some((play) => play.seat === seat);
          const isActor = shownActor === seat && liveTurn;
          // A finished deal keeps each seat's calls beside its face-up hand, so the bidding can be reviewed with the cards and score.
          const seatCalls = showCalls || revealed ? game.auction.map((entry, index) => ({ ...entry, index })).filter((entry) => entry.seat === seat) : [];
          const explainedHere = seatCalls.find(({ index }) => index === shownExplanation);
          const vulnerable = game.vulnerability === "Both" || (game.vulnerability === "NS" && samePartnership(seat, "north")) || (game.vulnerability === "EW" && samePartnership(seat, "east"));
          const isDealer = game.dealer === seat;
          const seatCards = revealed ? sortHand([...revealed[seat]]) : fixedPlayHands
            ? sortHand(game.hands[seat])
            : dummyVisible && dummySeat === seat && position !== "bottom" ? sortHand(game.hands[seat]) : exposedSeat === seat && position !== "bottom" ? sortHand(game.hands[seat]) : [];
          const seatHasCards = seatCards.length > 0;
          const held = cardsHeld(game, seat);
          // Hands the viewer cannot see are backs; the bottom position never shows backs, as the hand zone is the viewer's own.
          const showBacks = phase === "play" && !seatHasCards && held > 0 && (showBacksAtBottom || position !== "bottom");
          // Dummy is told by its seat badge alone: a square with a gold ring instead of a circle, and no text tag.
          const isDummy = dummyVisible && seat === dummySeat;
          const isBot = botSeats?.includes(seat) ?? false;
          const points = revealed ? highCardPoints([...revealed[seat]]) : undefined;
          // A seat's calls read newest first: its latest call is the leftmost in the row.
          const callChips = seatCalls.length ? <span className="seat-auction-calls" role="group" aria-label={`${seatNames[seat]} calls`}>{[...seatCalls].reverse().map(({ bid, index }) => explainCall
            ? <button type="button" className={`seat-auction-call ${callChipClass(bid)} ${shownExplanation === index ? "explained-call" : ""}`} key={index} aria-expanded={shownExplanation === index} aria-label={`Explain ${seatNames[seat]}'s ${callLabel(bid)}`} title="What does this call mean?" onClick={() => explainCall.onToggle(index)}>{compactCallLabel(bid)}</button>
            : <span className={`seat-auction-call ${callChipClass(bid)}`} key={index}>{compactCallLabel(bid)}</span>)}</span> : null;
          // Beside a face-up hand at a side seat, the calls get their own row under the name, as wide as the hand.
          const callsInHead = !(revealed && (position === "left" || position === "right"));
          // A hand still held (not dummy, not the face-up hands of a finished deal) along the top or bottom edge is fanned
          // like the hand zone; dummy and the side seats keep their suit rows, laid out as dummy is on a real table.
          const fanned = handLayout === "fan" && fixedPlayHands && !revealed && !isDummy && (position === "top" || position === "bottom");
          const fanOrder = fanned ? handSuitOrder(seatCards).flatMap((suit) => seatCards.filter((card) => card.suit === suit)) : [];
          const fanStyle = (card: Card) => fanned ? fanCardStyle(handLayout, fanOrder.indexOf(card), fanOrder.length) : undefined;
          const seatCanPlay = fixedPlayHands ? canAct && phase === "play" && shownActor === seat : playFromDummy && seat === dummySeat;
          return <div key={seat} className={`seat seat-${seat} pos-${position} ${isActor ? "active-seat" : ""} ${hasPlayed ? "played-seat" : ""} ${vulnerable ? "vulnerable-seat" : ""} ${isDealer ? "dealer-seat" : ""} ${seatHasCards && !revealed ? "has-dummy" : ""} ${revealed ? "has-revealed-hand" : ""} ${showBacks ? "has-backs" : ""} ${seatHasCards && fixedPlayHands ? "has-fixed-hand" : ""} ${seatHasCards && seatCanPlay ? "playable-dummy" : ""} ${explainedHere ? "explaining-seat" : ""}`}>
            {/* The head row: one line beside a hand spread along the top or bottom, invisible (display: contents) elsewhere. */}
            <div className="seat-head">
            <span className={`seat-compass ${isDummy ? "dummy-compass" : ""} ${isBot ? "bot-compass" : ""}`} role="img" aria-label={`${seatNames[seat]}${isBot ? ", bot" : ""}${isDummy ? ", dummy" : ""}${isDealer ? ", dealer" : ""}${vulnerable ? ", vulnerable" : ""}${showBacks ? `, ${held} cards` : ""}`} title={`${seatNames[seat]}${isBot ? " · bot" : ""}${isDummy ? " · dummy" : ""}${isDealer ? " · dealer" : ""}${vulnerable ? " · vulnerable" : ""}`}>{seat[0]!.toUpperCase()}{isDealer && phase === "auction" ? <span className="dealer-mark" aria-hidden="true">D</span> : null}</span>
            {seatLabel?.(seat)}
            {points !== undefined ? <span className="hcp-badge" title="High-card points: A 4, K 3, Q 2, J 1">{points} HCP</span> : null}
            {callsInHead ? callChips : null}
            </div>
            {callsInHead ? null : callChips}
            {explainedHere && explainCall ? <p className="call-meaning" role="status"><strong className={callChipClass(explainedHere.bid)}>{compactCallLabel(explainedHere.bid)}</strong> {explainCall.text(explainedHere.index)}</p> : null}
            {showBacks ? <div className="hidden-hand" aria-hidden="true">{Array.from({ length: held }, (_, index) => <span className="card-back" key={index} style={fanCardStyle(handLayout, index, held)} />)}</div> : null}
            {seatHasCards ? <section className={`dummy-table-hand ${fixedPlayHands ? "fixed-seat-hand" : ""} ${fanned ? "fanned-hand" : ""}`} aria-label={`${seatNames[seat]}'s ${seat === dummySeat && !revealed ? "dummy " : ""}hand`}>
              {handSuitOrder(seatCards).map((suit) => {
                const suitCards = seatCards.filter((card) => card.suit === suit);
                return suitCards.length ? <div className="dummy-suit-row" key={suit}>{suitCards.map((card) => seatCanPlay
                  ? <button className={`table-card dummy-card ${isRedSuit(card.suit) ? "red-card" : ""} ${hintedCards?.has(cardId(card)) ? "hinted-card" : ""} ${isQueued(seat, card) ? "queued-card" : ""}`} key={cardId(card)} style={fanStyle(card)} aria-label={`Play ${cardLabel(card)}`} disabled={cardsDisabled} onClick={() => onPlay?.(seat, card)}>{cardFace(card)}</button>
                  : canQueue(seat) ? queueButton(seat, card, `table-card dummy-card ${isRedSuit(card.suit) ? "red-card" : ""}`, fanStyle(card))
                  : tableCard(card, "table-card dummy-card", cardLabel(card), fanStyle(card)))}</div> : null;
              })}
            </section> : null}
          </div>;
        })}

        <div className="trick-area" role="region" aria-label="Current trick">
          {displayedTrick.map(({ seat, card }) => tableCard(card, `trick-card trick-card-position-${seat} trick-pos-${positionOf(seat)}`, `${seatNames[seat]} played ${cardLabel(card)}`))}
        </div>

        {/* The last trick lies beside the card of the seat that won it, as a won trick is gathered in front of its winner; once
            every hand is face-up at the end of the deal there is no trick to look back on. */}
        {lastTrick && lastTrickWinner && !revealed ? <div className={`last-trick-spot last-trick-at-${positionOf(lastTrickWinner)}`}><button className="last-trick-button" type="button" disabled={game.currentTrick.length > 0} aria-pressed={lastTrickOpen} aria-label={lastTrickOpen ? "Hide last trick" : "Last trick"} title={game.currentTrick.length > 0 ? "The last trick can be shown once this trick is complete" : lastTrickOpen ? "Hide last trick" : "Show the last trick on the table"} onClick={onToggleLastTrick}>
          <span className="last-trick-label" aria-hidden="true">Last trick</span>
          {lastTrick.filter(({ seat }) => seat === lastTrickWinner).map(({ seat, card }) => <span className={`last-trick-chip ${isRedSuit(card.suit) ? "red-card" : ""}`} key={seat} aria-hidden="true">{card.rank === "T" ? "10" : card.rank}{suitSymbols[card.suit]}</span>)}
        </button></div> : null}

        <section className={phase === "auction" ? "auction-panel centered-auction" : "sr-only"} aria-label="Auction">
          {auctionList}
          {canAct && onBid && phase === "auction" ? <div ref={bidPickerRef} className="bid-picker" aria-label="Choose a bid">
            <div className="bid-grid" role="group" aria-label="Contract bids by level and strain">
              {[1, 2, 3, 4, 5, 6, 7].map((level) => bidBoxStrains.map((strain) => {
                const bid = `${level}${strain}` as Bid;
                return <button key={bid} type="button" className={`bid-cell ${isRedSuit(strain) ? "bid-red" : ""} ${hintedBid === bid ? "hinted-bid" : ""} ${selectedCall === bid ? "selected-bid" : ""}`} aria-label={`${level} ${strain}`} aria-pressed={confirmCalls ? selectedCall === bid : undefined} title={hintedBid === bid ? "Suggested bid" : undefined} disabled={bidsDisabled || !isCallAvailable(game, bid)} onClick={() => chooseCall(bid)}>{level}<span>{strain === "notrump" ? "NT" : suitSymbols[strain]}</span></button>;
              }))}
            </div>
            <div className="bid-special-calls" role="group" aria-label="Pass, double, or redouble">
              {(["double", "redouble", "pass"] as const).map((bid) => <button key={bid} type="button" className={`bid-special bid-special-${bid} ${hintedBid === bid ? "hinted-bid" : ""} ${selectedCall === bid ? "selected-bid" : ""}`} aria-pressed={confirmCalls ? selectedCall === bid : undefined} title={hintedBid === bid ? "Suggested call" : undefined} disabled={bidsDisabled || !isCallAvailable(game, bid)} onClick={() => chooseCall(bid)}>{bid === "double" ? "X" : bid === "redouble" ? "XX" : "Pass"}</button>)}
            </div>
            {confirmCalls ? <div className="call-preview">
              {selectedCall ? <>
                <p role="status"><strong className={callChipClass(selectedCall)}>{compactCallLabel(selectedCall)}</strong> {confirmCalls.meaning(selectedCall)}</p>
                <button className="primary-button" type="button" aria-label={`Confirm ${/^[1-7]/.test(selectedCall) ? compactCallLabel(selectedCall) : callLabel(selectedCall)}`} onClick={() => chooseCall(selectedCall)}>{/^[1-7]/.test(selectedCall) ? `Bid ${compactCallLabel(selectedCall)}` : callLabel(selectedCall)}</button>
              </> : <p className="quiet-copy">Tap a call to see what it means.</p>}
            </div> : null}
          </div> : null}
        </section>

        {dealing ? <DealAnimation /> : null}
        {overlay}
      </div>

      {fixedPlayHands || revealed ? null : <div className="hand-zone">
        {handSeat && handCards.length ? <section className="hand-panel" aria-label={`${seatNames[handSeat]}'s ${handIsInteractive ? "hand" : "cards"}`}>
          <div className="cards-row" style={{ "--gap-share": suitGapShare(handCards) } as CSSProperties}>
            {handSeat !== bottomSeat || handIsDummy ? <span className="hand-tag" title={`${seatNames[handSeat]}${handIsDummy ? " · dummy" : ""}`}><span className={`seat-compass ${handIsDummy ? "dummy-compass" : ""}`} aria-hidden="true">{handSeat[0]!.toUpperCase()}</span><span className="sr-only">{seatNames[handSeat]}{handIsDummy ? ", dummy" : ""}</span></span> : null}
            {handCards.map((card, index) => {
              const className = `playing-card ${isRedSuit(card.suit) ? "red-card" : ""} ${index > 0 && handCards[index - 1]!.suit !== card.suit ? "suit-gap" : ""}`;
              const fan = fanCardStyle(handLayout, index, handCards.length);
              return handIsInteractive && phase === "play"
                ? <button className={`${className} ${hintedCards?.has(cardId(card)) ? "hinted-card" : ""} ${isQueued(handSeat, card) ? "queued-card" : ""}`} key={cardId(card)} style={fan} aria-label={`Play ${cardLabel(card)}`} disabled={cardsDisabled} onClick={() => onPlay?.(handSeat, card)}>{cardFace(card)}</button>
                : canQueue(handSeat) ? queueButton(handSeat, card, className, fan)
                : tableCard(card, `${className} auction-card`, cardLabel(card), fan);
            })}
          </div>
        </section> : null}
      </div>}
    </section>
  );
}
