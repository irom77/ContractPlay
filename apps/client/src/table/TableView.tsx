import { useEffect, useRef, type CSSProperties } from "react";
import { cardId, SUITS, trickWinner, type Bid, type Card, type Seat, type TrickCard } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
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

const tablePositions = ["bottom", "left", "top", "right"] as const;

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
  /** During online play, keep every visible hand at its seat for the whole play. */
  fixedSeatHands?: boolean;
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
  seatLabel?(seat: Seat): React.ReactNode;       // extra per-seat content (online: player name, away, bot badge, seat controls)
  onBid?(bid: Bid): void; onPlay?(seat: Seat, card: Card): void;
  hintedBid?: Bid | undefined; hintedCards?: ReadonlySet<string> | undefined;
  explainCall?: { shown?: number | undefined; onToggle(index: number): void; text(index: number): string } | undefined;
  /** Running match score, shown under the trick count in the top-left status card. */
  matchScore?: { ns: number; ew: number } | undefined;
  tools?: React.ReactNode;               // menu + fullscreen (top-right)
  overlay?: React.ReactNode;             // score panel, review/history controls, hint controls, messages
};

const tableWatermark = <svg className="table-watermark" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
  <path d="M62 132c8-38 28-56 58-56s50 18 58 56" />
  <path d="M56 138h128M74 138v20m92-20v20M98 138v-34m44 34v-34M120 138V76" />
  <text x="120" y="50">♠</text><text x="212" y="132">♥</text><text x="120" y="214">♦</text><text x="28" y="132">♣</text>
</svg>;

/** The bridge table: status, seats with their calls and dummy, the trick, the bid picker, and the hand zone. */
export function TableView({
  game, bottomSeat, actingSeat, displayedTrick, showCalls, onToggleCalls, lastTrickOpen, onToggleLastTrick, showBottomHand, fixedSeatHands = false, exposedSeat,
  queueSeats, queuedCard, onQueue, cardsDisabled = false, bidsDisabled = false, statusText, ariaLabel, seatLabel, onBid, onPlay, hintedBid, hintedCards, explainCall, matchScore, tools, overlay
}: TableViewProps): React.JSX.Element {
  const auctionListRef = useRef<HTMLOListElement>(null);
  const phase = game.phase;
  const auctionLength = game.auction.length;

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
  const fixedPlayHands = fixedSeatHands && phase === "play" && dummyVisible;
  // A dummy at a side seat is a column as wide as its longest suit; the bottom hand is laid out beside it.
  const sideDummy = fixedPlayHands && dummySeat && (dummyPosition === "left" || dummyPosition === "right") ? dummyPosition : undefined;
  // A hand spread along the top shares its height with the status corner, so it starts to the right of it.
  const handOnTop = fixedPlayHands && game.hands[seats[(seats.indexOf(bottomSeat) + 2) % 4]!].length > 0;
  const sideDummySpan = sideDummy && dummySeat ? Math.max(1, ...SUITS.map((suit) => game.hands[dummySeat].filter((card) => card.suit === suit).length)) : undefined;
  const completedNsTricks = contract
    ? game.completedTricks.filter((trick) => samePartnership(trickWinner(trick, trump), "north")).length
    : 0;
  const completedEwTricks = game.completedTricks.length - completedNsTricks;
  const positionOf = (seat: Seat) => tablePositions[(seats.indexOf(seat) - seats.indexOf(bottomSeat) + 4) % 4]!;
  const canAct = actingSeat !== undefined;
  // Dummy laid out across the table is played from there, so the bottom edge keeps showing declarer's own cards.
  const playFromDummy = canAct && phase === "play" && dummyVisible && actingSeat === dummySeat && positionOf(actingSeat) !== "bottom";
  const handIsInteractive = canAct && !playFromDummy;
  const handSeat: Seat | undefined = fixedPlayHands ? undefined : handIsInteractive ? actingSeat : showBottomHand || playFromDummy ? bottomSeat : undefined;
  const handCards = handSeat ? sortHand(game.hands[handSeat]) : [];
  const handIsDummy = dummyVisible && handSeat === dummySeat;
  const lastTrick = game.completedTricks.at(-1);
  const lastTrickWinner = lastTrick ? trickWinner(lastTrick, trump) : undefined;
  const shownExplanation = explainCall?.shown;
  const auctionList = game.auction.length ? <ol className="sr-only" ref={auctionListRef} aria-label="Auction calls">{game.auction.map(({ seat, bid }, index) => <li key={`${seat}-${index}`}><span>{seatNames[seat]}</span><strong>{callLabel(bid)}</strong></li>)}</ol> : null;
  const isQueued = (seat: Seat, card: Card) => queuedCard?.seat === seat && cardId(queuedCard.card) === cardId(card);
  const canQueue = (seat: Seat) => phase === "play" && !!onQueue && !!queueSeats?.includes(seat);
  const queueButton = (seat: Seat, card: Card, className: string) => {
    const queued = isQueued(seat, card);
    return <button type="button" className={`${className} ${queued ? "queued-card" : ""}`} key={cardId(card)} aria-label={`${queued ? "Unqueue" : "Queue"} ${cardLabel(card)}`} title={queued ? "Queued: plays when your turn comes. Click to cancel" : "Queue this card to play when your turn comes"} onClick={() => onQueue?.(seat, card)}>{cardFace(card)}</button>;
  };
  const tableCard = (card: Card, className: string, label: string) => <span className={`${className} ${isRedSuit(card.suit) ? "red-card" : ""}`} key={cardId(card)} role="img" aria-label={label}>{cardFace(card)}</span>;

  return (
    <section className="table-panel" aria-label={ariaLabel}>
      <div className={`table-surface ${phase === "play" && showCalls ? "calls-shown" : ""} ${sideDummy ? `dummy-on-${sideDummy}` : ""} ${handOnTop ? "hand-on-top" : ""}`} style={sideDummySpan ? { "--dummy-span": sideDummySpan } as CSSProperties : undefined}>
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
        </div>

        <div className="table-tools">
          <div className="table-tools-row">{tools}</div>
          {lastTrick && lastTrickWinner ? <button className="last-trick-button" type="button" disabled={game.currentTrick.length > 0} aria-pressed={lastTrickOpen} aria-label={lastTrickOpen ? "Hide last trick" : "Last trick"} title={game.currentTrick.length > 0 ? "The last trick can be shown once this trick is complete" : lastTrickOpen ? "Hide last trick" : "Show the last trick on the table"} onClick={onToggleLastTrick}>
            <span className="last-trick-label" aria-hidden="true">Last trick</span>
            {lastTrick.filter(({ seat }) => seat === lastTrickWinner).map(({ seat, card }) => <span className={`last-trick-chip ${isRedSuit(card.suit) ? "red-card" : ""}`} key={seat} aria-hidden="true">{card.rank === "T" ? "10" : card.rank}{suitSymbols[card.suit]}</span>)}
          </button> : null}
        </div>

        {seats.map((seat) => {
          const position = positionOf(seat);
          const hasPlayed = phase === "play" && game.currentTrick.some((play) => play.seat === seat);
          const isActor = shownActor === seat && liveTurn;
          const seatCalls = showCalls ? game.auction.map((entry, index) => ({ ...entry, index })).filter((entry) => entry.seat === seat) : [];
          const explainedHere = seatCalls.find(({ index }) => index === shownExplanation);
          const vulnerable = game.vulnerability === "Both" || (game.vulnerability === "NS" && samePartnership(seat, "north")) || (game.vulnerability === "EW" && samePartnership(seat, "east"));
          const isDealer = game.dealer === seat;
          const seatCards = fixedPlayHands
            ? sortHand(game.hands[seat])
            : dummyVisible && dummySeat === seat && position !== "bottom" ? sortHand(game.hands[seat]) : exposedSeat === seat && position !== "bottom" ? sortHand(game.hands[seat]) : [];
          const seatHasCards = seatCards.length > 0;
          const held = cardsHeld(game, seat);
          // Hands the viewer cannot see are backs; the bottom position never shows backs, as the hand zone is the viewer's own.
          const showBacks = liveTurn && !seatHasCards && held > 0 && position !== "bottom";
          // Dummy is told by its seat badge alone: a square with a gold ring instead of a circle, and no text tag.
          const isDummy = dummyVisible && seat === dummySeat;
          const seatCanPlay = fixedPlayHands ? canAct && shownActor === seat : playFromDummy && seat === dummySeat;
          return <div key={seat} className={`seat seat-${seat} pos-${position} ${isActor ? "active-seat" : ""} ${hasPlayed ? "played-seat" : ""} ${vulnerable ? "vulnerable-seat" : ""} ${isDealer ? "dealer-seat" : ""} ${seatHasCards ? "has-dummy" : ""} ${showBacks ? "has-backs" : ""} ${seatHasCards && fixedPlayHands ? "has-fixed-hand" : ""} ${seatHasCards && seatCanPlay ? "playable-dummy" : ""} ${explainedHere ? "explaining-seat" : ""}`}>
            {/* The head row: one line beside a hand spread along the top or bottom, invisible (display: contents) elsewhere. */}
            <div className="seat-head">
            <span className={`seat-compass ${isDummy ? "dummy-compass" : ""}`} role="img" aria-label={`${seatNames[seat]}${isDummy ? ", dummy" : ""}${isDealer ? ", dealer" : ""}${vulnerable ? ", vulnerable" : ""}${showBacks ? `, ${held} cards` : ""}`} title={`${seatNames[seat]}${isDummy ? " · dummy" : ""}${isDealer ? " · dealer" : ""}${vulnerable ? " · vulnerable" : ""}`}>{seat[0]!.toUpperCase()}{isDealer && phase === "auction" ? <span className="dealer-mark" aria-hidden="true">D</span> : null}</span>
            {seatLabel?.(seat)}
            {seatCalls.length ? <span className="seat-auction-calls" aria-label={`${seatNames[seat]} calls`}>{seatCalls.map(({ bid, index }) => explainCall
              ? <button type="button" className={`seat-auction-call ${callChipClass(bid)} ${shownExplanation === index ? "explained-call" : ""}`} key={index} aria-expanded={shownExplanation === index} aria-label={`Explain ${seatNames[seat]}'s ${callLabel(bid)}`} title="What does this call mean?" onClick={() => explainCall.onToggle(index)}>{compactCallLabel(bid)}</button>
              : <span className={`seat-auction-call ${callChipClass(bid)}`} key={index}>{compactCallLabel(bid)}</span>)}</span> : null}
            </div>
            {explainedHere && explainCall ? <p className="call-meaning" role="status"><strong className={callChipClass(explainedHere.bid)}>{compactCallLabel(explainedHere.bid)}</strong> {explainCall.text(explainedHere.index)}</p> : null}
            {showBacks ? <div className="hidden-hand" aria-hidden="true">{Array.from({ length: held }, (_, index) => <span className="card-back" key={index} />)}</div> : null}
            {seatHasCards ? <section className={`dummy-table-hand ${fixedPlayHands ? "fixed-seat-hand" : ""}`} aria-label={`${seatNames[seat]}'s ${seat === dummySeat ? "dummy " : ""}hand`}>
              {handSuitOrder(seatCards).map((suit) => {
                const suitCards = seatCards.filter((card) => card.suit === suit);
                return suitCards.length ? <div className="dummy-suit-row" key={suit}>{suitCards.map((card) => seatCanPlay
                  ? <button className={`table-card dummy-card ${isRedSuit(card.suit) ? "red-card" : ""} ${hintedCards?.has(cardId(card)) ? "hinted-card" : ""} ${isQueued(seat, card) ? "queued-card" : ""}`} key={cardId(card)} aria-label={`Play ${cardLabel(card)}`} disabled={cardsDisabled} onClick={() => onPlay?.(seat, card)}>{cardFace(card)}</button>
                  : canQueue(seat) ? queueButton(seat, card, `table-card dummy-card ${isRedSuit(card.suit) ? "red-card" : ""}`)
                  : tableCard(card, "table-card dummy-card", cardLabel(card)))}</div> : null;
              })}
            </section> : null}
          </div>;
        })}

        <div className="trick-area" role="region" aria-label="Current trick">
          {displayedTrick.map(({ seat, card }) => tableCard(card, `trick-card trick-card-position-${seat} trick-pos-${positionOf(seat)}`, `${seatNames[seat]} played ${cardLabel(card)}`))}
        </div>

        <section className={phase === "auction" ? "auction-panel centered-auction" : "sr-only"} aria-label="Auction">
          {auctionList}
          {canAct && onBid && phase === "auction" ? <div className="bid-picker" aria-label="Choose a bid">
            <div className="bid-grid" role="group" aria-label="Contract bids by level and strain">
              {[1, 2, 3, 4, 5, 6, 7].map((level) => biddingStrains.map((strain) => {
                const bid = `${level}${strain}` as Bid;
                return <button key={bid} type="button" className={`bid-cell ${isRedSuit(strain) ? "bid-red" : ""} ${hintedBid === bid ? "hinted-bid" : ""}`} aria-label={`${level} ${strain}`} title={hintedBid === bid ? "Suggested bid" : undefined} disabled={bidsDisabled || !isCallAvailable(game, bid)} onClick={() => onBid(bid)}>{level}<span>{strain === "notrump" ? "NT" : suitSymbols[strain]}</span></button>;
              }))}
            </div>
            <div className="bid-special-calls" role="group" aria-label="Pass, double, or redouble">
              {(["double", "redouble", "pass"] as const).map((bid) => <button key={bid} type="button" className={`bid-special bid-special-${bid} ${hintedBid === bid ? "hinted-bid" : ""}`} title={hintedBid === bid ? "Suggested call" : undefined} disabled={bidsDisabled || !isCallAvailable(game, bid)} onClick={() => onBid(bid)}>{bid === "double" ? "X" : bid === "redouble" ? "XX" : "Pass"}</button>)}
            </div>
          </div> : null}
        </section>

        {overlay}
      </div>

      {fixedPlayHands ? null : <div className="hand-zone">
        {handSeat && handCards.length ? <section className="hand-panel" aria-label={`${seatNames[handSeat]}'s ${handIsInteractive ? "hand" : "cards"}`}>
          <div className="cards-row" style={{ "--gap-share": suitGapShare(handCards) } as CSSProperties}>
            {handSeat !== bottomSeat || handIsDummy ? <span className="hand-tag" title={`${seatNames[handSeat]}${handIsDummy ? " · dummy" : ""}`}><span className={`seat-compass ${handIsDummy ? "dummy-compass" : ""}`} aria-hidden="true">{handSeat[0]!.toUpperCase()}</span><span className="sr-only">{seatNames[handSeat]}{handIsDummy ? ", dummy" : ""}</span></span> : null}
            {handCards.map((card, index) => {
              const className = `playing-card ${isRedSuit(card.suit) ? "red-card" : ""} ${index > 0 && handCards[index - 1]!.suit !== card.suit ? "suit-gap" : ""}`;
              return handIsInteractive && phase === "play"
                ? <button className={`${className} ${hintedCards?.has(cardId(card)) ? "hinted-card" : ""} ${isQueued(handSeat, card) ? "queued-card" : ""}`} key={cardId(card)} aria-label={`Play ${cardLabel(card)}`} disabled={cardsDisabled} onClick={() => onPlay?.(handSeat, card)}>{cardFace(card)}</button>
                : canQueue(handSeat) ? queueButton(handSeat, card, className)
                : tableCard(card, `${className} auction-card`, cardLabel(card));
            })}
          </div>
        </section> : null}
      </div>}
    </section>
  );
}
