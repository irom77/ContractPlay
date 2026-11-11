import { useEffect, useRef } from "react";
import { cardId, SUITS, trickWinner, type Bid, type Card, type Seat, type TrickCard } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
import {
  biddingStrains,
  callChipClass,
  callLabel,
  cardFace,
  cardLabel,
  compactCallLabel,
  contractText,
  isCallAvailable,
  isRedSuit,
  partnerOf,
  samePartnership,
  seatNames,
  seats,
  sortHand,
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
  /** Keep playable cards disabled, for example while a completed trick is still on the table. */
  cardsDisabled?: boolean;
  /** Keep every call in the bid picker disabled, for example while a sent call awaits the service. */
  bidsDisabled?: boolean;
  statusText: string; ariaLabel: string;
  seatLabel?(seat: Seat): React.ReactNode;       // extra per-seat content (online: player name, away, bot badge, seat controls)
  onBid?(bid: Bid): void; onPlay?(seat: Seat, card: Card): void;
  hintedBid?: Bid | undefined; hintedCards?: ReadonlySet<string> | undefined;
  explainCall?: { shown?: number | undefined; onToggle(index: number): void; text(index: number): string } | undefined;
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
  game, bottomSeat, actingSeat, displayedTrick, showCalls, onToggleCalls, lastTrickOpen, onToggleLastTrick, showBottomHand,
  cardsDisabled = false, bidsDisabled = false, statusText, ariaLabel, seatLabel, onBid, onPlay, hintedBid, hintedCards, explainCall, tools, overlay
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
  const dummyVisible = !!contract && (game.currentTrick.length > 0 || game.completedTricks.length > 0 || phase === "complete");
  const completedNsTricks = contract
    ? game.completedTricks.filter((trick) => samePartnership(trickWinner(trick, trump), "north")).length
    : 0;
  const completedEwTricks = game.completedTricks.length - completedNsTricks;
  const positionOf = (seat: Seat) => tablePositions[(seats.indexOf(seat) - seats.indexOf(bottomSeat) + 4) % 4]!;
  const canAct = actingSeat !== undefined;
  // Dummy laid out across the table is played from there, so the bottom edge keeps showing declarer's own cards.
  const playFromDummy = canAct && phase === "play" && dummyVisible && actingSeat === dummySeat && positionOf(actingSeat) !== "bottom";
  const handIsInteractive = canAct && !playFromDummy;
  const handSeat: Seat | undefined = handIsInteractive ? actingSeat : showBottomHand || playFromDummy ? bottomSeat : undefined;
  const handCards = handSeat ? sortHand(game.hands[handSeat]) : [];
  const handIsDummy = dummyVisible && handSeat === dummySeat;
  const lastTrick = game.completedTricks.at(-1);
  const lastTrickWinner = lastTrick ? trickWinner(lastTrick, trump) : undefined;
  const shownExplanation = explainCall?.shown;
  const auctionList = game.auction.length ? <ol className="sr-only" ref={auctionListRef} aria-label="Auction calls">{game.auction.map(({ seat, bid }, index) => <li key={`${seat}-${index}`}><span>{seatNames[seat]}</span><strong>{callLabel(bid)}</strong></li>)}</ol> : null;
  const tableCard = (card: Card, className: string, label: string) => <span className={`${className} ${isRedSuit(card.suit) ? "red-card" : ""}`} key={cardId(card)} role="img" aria-label={label}>{cardFace(card)}</span>;

  return (
    <section className="table-panel" aria-label={ariaLabel}>
      <div className={`table-surface ${phase === "play" && showCalls ? "calls-shown" : ""}`}>
        {tableWatermark}
        <div className="table-status">
          {contract ? <button className="contract-badge" type="button" disabled={phase !== "play"} aria-expanded={showCalls} aria-label={`${showCalls ? "Hide" : "Show"} auction, ${game.auction.length} calls. Contract ${callLabel(`${contract.level}${contract.strain}` as Bid)} by ${seatNames[contract.declarer]}`} title={phase === "play" ? `${showCalls ? "Hide" : "Show"} the bidding` : undefined} onClick={onToggleCalls}>
            <strong>{contractText(contract)}</strong><span>{seatNames[contract.declarer][0]}</span>
          </button> : null}
          {contract ? <span className="trick-count" role="group" aria-label={`NS ${completedNsTricks} · EW ${completedEwTricks} tricks`} aria-live="polite">
            <span>NS<b>{completedNsTricks}</b></span><span>EW<b>{completedEwTricks}</b></span>
          </span> : null}
          <span className="status-pill" aria-live="polite">{statusText}</span>
        </div>

        <div className="table-tools">
          <div className="table-tools-row">{tools}</div>
          {lastTrick ? <button className="last-trick-button" type="button" disabled={game.currentTrick.length > 0} aria-pressed={lastTrickOpen} aria-label={lastTrickOpen ? "Hide last trick" : "Last trick"} title={game.currentTrick.length > 0 ? "Last trick" : lastTrickOpen ? "Hide last trick" : "Show last trick on the table"} onClick={onToggleLastTrick}>
            {lastTrick.map(({ seat, card }) => <span className={`table-card last-trick-card trick-pos-${positionOf(seat)} ${seat === lastTrickWinner ? "last-trick-winner" : ""} ${isRedSuit(card.suit) ? "red-card" : ""}`} key={seat} aria-hidden="true">{cardFace(card)}</span>)}
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
          const dummyCards = dummyVisible && dummySeat === seat && position !== "bottom" ? sortHand(game.hands[seat]) : [];
          return <div key={seat} className={`seat seat-${seat} pos-${position} ${isActor ? "active-seat" : ""} ${hasPlayed ? "played-seat" : ""} ${vulnerable ? "vulnerable-seat" : ""} ${isDealer ? "dealer-seat" : ""} ${dummyCards.length ? "has-dummy" : ""} ${dummyCards.length && playFromDummy ? "playable-dummy" : ""} ${explainedHere ? "explaining-seat" : ""}`}>
            <span className="seat-compass" role="img" aria-label={`${seatNames[seat]}${isDealer ? ", dealer" : ""}${vulnerable ? ", vulnerable" : ""}`} title={`${seatNames[seat]}${isDealer ? " · dealer" : ""}${vulnerable ? " · vulnerable" : ""}`}>{seat[0]!.toUpperCase()}{isDealer && phase === "auction" ? <span className="dealer-mark" aria-hidden="true">D</span> : null}</span>
            {seatLabel?.(seat)}
            {seatCalls.length ? <span className="seat-auction-calls" aria-label={`${seatNames[seat]} calls`}>{seatCalls.map(({ bid, index }) => explainCall
              ? <button type="button" className={`seat-auction-call ${callChipClass(bid)} ${shownExplanation === index ? "explained-call" : ""}`} key={index} aria-expanded={shownExplanation === index} aria-label={`Explain ${seatNames[seat]}'s ${callLabel(bid)}`} title="What does this call mean?" onClick={() => explainCall.onToggle(index)}>{compactCallLabel(bid)}</button>
              : <span className={`seat-auction-call ${callChipClass(bid)}`} key={index}>{compactCallLabel(bid)}</span>)}</span> : null}
            {explainedHere && explainCall ? <p className="call-meaning" role="status"><strong className={callChipClass(explainedHere.bid)}>{compactCallLabel(explainedHere.bid)}</strong> {explainCall.text(explainedHere.index)}</p> : null}
            {dummyCards.length ? <section className="dummy-table-hand" aria-label={`${seatNames[seat]}'s dummy hand`}>
              {SUITS.map((suit) => {
                const suitCards = dummyCards.filter((card) => card.suit === suit);
                return suitCards.length ? <div className="dummy-suit-row" key={suit}>{suitCards.map((card) => playFromDummy
                  ? <button className={`table-card dummy-card ${isRedSuit(card.suit) ? "red-card" : ""} ${hintedCards?.has(cardId(card)) ? "hinted-card" : ""}`} key={cardId(card)} aria-label={`Play ${cardLabel(card)}`} disabled={cardsDisabled} onClick={() => onPlay?.(seat, card)}>{cardFace(card)}</button>
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

      <div className="hand-zone">
        {handSeat && handCards.length ? <section className="hand-panel" aria-label={`${seatNames[handSeat]}'s ${handIsInteractive ? "hand" : "cards"}`}>
          <div className="cards-row">
            {handSeat !== bottomSeat || handIsDummy ? <span className="hand-tag"><span className="seat-compass" aria-hidden="true">{handSeat[0]!.toUpperCase()}</span>{handIsDummy ? <span>DUMMY</span> : <span className="sr-only">{seatNames[handSeat]}</span>}</span> : null}
            {handCards.map((card, index) => {
              const className = `playing-card ${isRedSuit(card.suit) ? "red-card" : ""} ${index > 0 && handCards[index - 1]!.suit !== card.suit ? "suit-gap" : ""}`;
              return handIsInteractive && phase === "play"
                ? <button className={`${className} ${hintedCards?.has(cardId(card)) ? "hinted-card" : ""}`} key={cardId(card)} aria-label={`Play ${cardLabel(card)}`} disabled={cardsDisabled} onClick={() => onPlay?.(handSeat, card)}>{cardFace(card)}</button>
                : tableCard(card, `${className} auction-card`, cardLabel(card));
            })}
          </div>
        </section> : null}
      </div>
    </section>
  );
}
