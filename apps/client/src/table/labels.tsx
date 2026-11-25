import { AGGRESSIONS, BOT_CHARACTERS, TRAIT_NAMES, botCharacter, type Aggression, type BotTraits, type TraitLevel, type Bid, type Card, type Contract, type Seat, type SkillLevel, type Suit } from "@contractplay/core";
import type { CustomBot, PublicGame } from "@contractplay/protocol";
import type { OwnCharacter } from "@contractplay/persistence";
import type { ReactElement } from "react";

export const seatNames: Record<Seat, string> = { north: "North", east: "East", south: "South", west: "West" };
export const aggressionNames: Record<Aggression, string> = { conservative: "Conservative", normal: "Normal", aggressive: "Aggressive" };
export const skillNames: Record<SkillLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };
/** A bot seat's name: its own character, named bot, or "Bot". */
export const botName = (info: { character?: string | undefined; custom?: { name: string } | undefined }): string =>
  info.custom?.name ?? botCharacter(info.character)?.name ?? "Bot";
/**
 * The choices for an online table's bot seat: a plain bot of each skill, playing at the table's aggressiveness, then the
 * named bots at their own. Values are skill levels and character ids, which never collide.
 */
export function onlineBotOptions(own: readonly OwnCharacter[], seated?: { value: string; name: string }) {
  return <>
    {seated ? <option value={seated.value} disabled>{seated.name}</option> : null}
    <optgroup label="Table bot">{(Object.keys(skillNames) as SkillLevel[]).map((skill) => <option key={skill} value={skill}>{skillNames[skill]}</option>)}</optgroup>
    <optgroup label="Named bots">{BOT_CHARACTERS.map((character) =>
      <option key={character.id} value={character.id}>{character.name} · {skillNames[character.skill]} · {aggressionNames[character.aggression]}</option>)}</optgroup>
    {own.length ? <optgroup label="Your characters">{own.filter((character) => !character.deleted).map((character) =>
      <option key={character.id} value={character.id}>{character.name} · {skillNames[character.skill]} · Your character</option>)}</optgroup> : null}
  </>;
}
/** The setBot message for a choice from the online bot picker. */
export function setBotFor(seat: Seat, choice: string, own: readonly OwnCharacter[] = []): { type: "setBot"; seat: Seat; skill: SkillLevel; character?: string; custom?: CustomBot } {
  const ownCharacter = own.find((character) => !character.deleted && character.id === choice);
  if (ownCharacter) return { type: "setBot", seat, skill: ownCharacter.skill,
    custom: { id: ownCharacter.id, name: ownCharacter.name, skill: ownCharacter.skill, traits: { ...ownCharacter.traits } } };
  const character = botCharacter(choice);
  return character ? { type: "setBot", seat, skill: character.skill, character: character.id } : { type: "setBot", seat, skill: choice as SkillLevel };
}
const asSkill = "Plays as its skill's system says.";
/** Each trait dial's name, and the word and one-line meaning for each setting, as the character editor shows them. */
export const traitWords: Record<keyof BotTraits, { label: string; levels: Record<TraitLevel, { word: string; meaning: string }> }> = {
  openings: { label: "Openings", levels: {
    cautious: { word: "Sound", meaning: "Needs 12 points to open one of a suit." },
    standard: { word: "By the book", meaning: asSkill },
    bold: { word: "Light", meaning: "Opens shapely hands on 10–11 points (the Rule of 20)." } } },
  competing: { label: "Competing", levels: {
    cautious: { word: "Sells out", meaning: "Needs more to overcall or double, and lets the opponents have partscores." },
    standard: { word: "By the book", meaning: asSkill },
    bold: { word: "Pushes", meaning: "Overcalls light on a good suit, and competes one more level with a fit." } } },
  preempts: { label: "Preempts", levels: {
    cautious: { word: "Sound", meaning: "Preempts only with two of the top three honours and 6+ points." },
    standard: { word: "By the book", meaning: asSkill },
    bold: { word: "Wild", meaning: "Preempts on a weak suit with one honour, from 4 points, in the first three seats." } } },
  doubles: { label: "Penalty doubles", levels: {
    cautious: { word: "Rarely", meaning: "Passes rather than double the opponents for penalty." },
    standard: { word: "By the book", meaning: asSkill },
    bold: { word: "Often", meaning: "Doubles the opponents' final contract when it holds a good defence." } } },
  leads: { label: "Leads", levels: {
    cautious: { word: "Passive", meaning: "Defends by leading from a sequence, or a suit without the ace or king." },
    standard: { word: "By the book", meaning: asSkill },
    bold: { word: "Attacking", meaning: "Defends by cashing the ace from ace-king against a suit contract." } } },
  secondHand: { label: "Second hand", levels: {
    cautious: { word: "Low", meaning: "Plays low second hand." },
    standard: { word: "By the book", meaning: asSkill },
    bold: { word: "High", meaning: "Wins the trick second hand when it can." } } }
};
/** A compact description of the dials that differ from the standard settings. */
export function traitSummary(traits: BotTraits): string {
  const changed = TRAIT_NAMES.flatMap((name) => traits[name] === "standard" ? [] : [`${name === "leads" ? "Opening leads" : traitWords[name].label}: ${traitWords[name].levels[traits[name]].word}`]);
  return changed.length ? changed.join(" · ") : "Standard on every dial";
}
/** The options for a bot aggressiveness select, Conservative to Aggressive. */
export const aggressionOptions = AGGRESSIONS.map((value) => <option key={value} value={value}>{aggressionNames[value]}</option>);
/** The review/result line for a claim, counting the claimer's tricks among the tricks that remained. */
export function claimText(claim: { seat: Seat; tricks: number }, declarer: Seat, remaining: number): string {
  const who = claim.seat === declarer ? `${seatNames[claim.seat]} (declarer)` : seatNames[claim.seat];
  return `Claimed by ${who}: ${claim.tricks} of the remaining ${remaining} tricks`;
}
/** A claim still waiting for its answers, named for the claimer ("You claim …") or for everyone else ("East claims …"). */
export function pendingClaimText(claim: { seat: Seat; tricks: number }, remaining: number, byViewer: boolean): string {
  return `${byViewer ? "You claim" : `${seatNames[claim.seat]} claims`} ${claim.tricks} of the remaining ${remaining} tricks`;
}
/** The notice after a claim is turned down. */
export function claimRejectedText(rejection: { tricks: number; by: Seat }): string {
  return `${seatNames[rejection.by]} rejected the claim of ${rejection.tricks} tricks`;
}
/** How many cards a seat still holds: 13 minus its plays, whether or not its hand is sent. */
export function cardsHeld(game: PublicGame, seat: Seat): number {
  const played = [...game.completedTricks.flat(), ...game.currentTrick].filter((play) => play.seat === seat).length;
  return 13 - played;
}
export const biddingStrains = ["clubs", "diamonds", "hearts", "spades", "notrump"] as const;
export const suitSymbols: Record<Suit, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const suitNames: Record<Suit, string> = { spades: "spades", hearts: "hearts", diamonds: "diamonds", clubs: "clubs" };
const ranks: Record<string, string> = { A: "ace", K: "king", Q: "queen", J: "jack", T: "ten" };
/** Pip centres as [x, y] percentages of the pip area; the lower half is drawn upside down like a printed card. */
const cardPipLayouts: Record<number, readonly (readonly [number, number])[]> = {
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[0, 0], [100, 0], [0, 100], [100, 100]],
  5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
  6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
  7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
  8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
  9: [[0, 0], [100, 0], [0, 33], [100, 33], [50, 50], [0, 67], [100, 67], [0, 100], [100, 100]],
  10: [[0, 0], [100, 0], [50, 17], [0, 33], [100, 33], [0, 67], [100, 67], [50, 83], [0, 100], [100, 100]]
};
export const seats: readonly Seat[] = ["north", "east", "south", "west"];
export const isRedSuit = (suit: string): boolean => suit === "hearts" || suit === "diamonds";
export const partnerOf = (seat: Seat): Seat => seats[(seats.indexOf(seat) + 2) % 4]!;
export const samePartnership = (a: Seat, b: Seat): boolean => seats.indexOf(a) % 2 === seats.indexOf(b) % 2;
const contractRank = (bid: Bid): number => {
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? Number(match[1]) * 5 + biddingStrains.indexOf(match[2] as typeof biddingStrains[number]) : 0;
};

export function isCallAvailable(game: PublicGame, bid: Bid): boolean {
  if (bid === "pass") return true;
  const previousContract = [...game.auction].reverse().find(({ bid: call }) => call !== "pass" && call !== "double" && call !== "redouble");
  const callsSinceContract = previousContract ? game.auction.slice(game.auction.indexOf(previousContract) + 1) : [];
  const lastNonPass = [...callsSinceContract].reverse().find(({ bid: call }) => call !== "pass");
  if (bid === "double") return !!previousContract && !["double", "redouble"].includes(lastNonPass?.bid ?? "") && !samePartnership(previousContract.seat, game.currentActor);
  if (bid === "redouble") return !!previousContract && lastNonPass?.bid === "double" && samePartnership(previousContract.seat, game.currentActor);
  return !previousContract || contractRank(bid) > contractRank(previousContract.bid);
}

export function callLabel(bid: Bid): string {
  if (bid === "pass") return "Pass";
  if (bid === "double") return "Double";
  if (bid === "redouble") return "Redouble";
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? `${match[1]} ${match[2]}` : bid;
}

export function compactCallLabel(bid: Bid): string {
  if (bid === "double") return "X";
  if (bid === "redouble") return "XX";
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  if (!match) return callLabel(bid);
  const strain = match[2] as typeof biddingStrains[number];
  return `${match[1]}${strain === "notrump" ? "NT" : suitSymbols[strain]}`;
}

export function cardLabel(card: Card): string {
  return `${ranks[card.rank] ?? card.rank} of ${suitNames[card.suit]}`;
}

export function cardFace(card: Card) {
  const suit = <SuitGlyph suit={card.suit} />;
  const rank = card.rank === "T" ? "10" : card.rank;
  const pips = cardPipLayouts[card.rank === "T" ? 10 : Number(card.rank)];
  const corner = (side: "top" | "bottom") => <span className={`card-corner card-corner-${side}`} aria-hidden="true"><span className={rank === "10" ? "card-rank-ten" : undefined}>{rank}</span><span>{suit}</span></span>;
  return <>
    {corner("top")}
    {pips ? <span className="card-pips" aria-hidden="true">{pips.map(([x, y], index) => <span className={`card-pip ${y > 50 ? "card-pip-flipped" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} key={index}>{suit}</span>)}</span>
      : card.rank === "A" ? <span className="card-center-suit" aria-hidden="true">{suit}</span>
        : <span className="card-portrait" aria-hidden="true"><span>{card.rank}</span><span>{suit}</span></span>}
    {corner("bottom")}
  </>;
}

/** The contract as level, coloured strain symbol, and doubling marks, as shown on the badge and the score panel. */
export function contractText(contract: Contract) {
  return <>{contract.level}<span className={isRedSuit(contract.strain) ? "red-card" : ""}>{contract.strain === "notrump" ? "NT" : suitSymbols[contract.strain]}</span>{"X".repeat(contract.doubled)}</>;
}

export function callChipClass(bid: Bid): string {
  if (bid === "pass" || bid === "double" || bid === "redouble") return `call-${bid}`;
  return isRedSuit(bid.slice(1)) ? "auction-call-red" : "";
}

/** Preferred left-to-right suit order for a hand: spades first, colours alternating. */
const preferredSuitOrder: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];
const permutations = <T,>(items: readonly T[]): T[][] =>
  items.length <= 1 ? [[...items]] : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]));

/**
 * The order a hand's suits are laid out in, so that two suits of the same colour never sit side by side whenever the
 * suits held allow it (♠♥♣♦; with clubs void ♥♠♦; with hearts void ♠♦♣). Among the orders that alternate, the one
 * closest to ♠♥♣♦ wins; a hand of only one colour keeps that order.
 */
export function handSuitOrder(cards: readonly Card[]): Suit[] {
  const held = preferredSuitOrder.filter((suit) => cards.some((card) => card.suit === suit));
  const sameColourTouches = (order: readonly Suit[]) => order.slice(1).filter((suit, index) => isRedSuit(suit) === isRedSuit(order[index]!)).length;
  // Distance from the preferred order: how many pairs of suits are flipped.
  const inversions = (order: readonly Suit[]) => order.reduce((count, suit, index) => count + order.slice(index + 1).filter((later) => held.indexOf(later) < held.indexOf(suit)).length, 0);
  return permutations(held).reduce((best, order) => {
    const difference = sameColourTouches(order) - sameColourTouches(best) || inversions(order) - inversions(best);
    return difference < 0 ? order : best;
  }, held);
}

export function sortHand(cards: readonly Card[]): Card[] {
  const order = handSuitOrder(cards);
  return [...cards].sort((a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || "23456789TJQKA".indexOf(b.rank) - "23456789TJQKA".indexOf(a.rank));
}

/**
 * Suit-group spacing for a spread hand of `count` cards: the extra room at each suit boundary is taken back from the
 * steps inside the suits, so the hand is exactly as wide as an evenly stepped one. Returns the share of one boundary
 * gap each in-suit step gives up.
 */
export function suitGapShare(cards: readonly Card[]): number {
  const boundaries = cards.slice(1).filter((card, index) => card.suit !== cards[index]!.suit).length;
  const inSuitSteps = cards.length - 1 - boundaries;
  return inSuitSteps > 0 ? boundaries / inSuitSteps : 0;
}

/**
 * Suit shapes drawn to be told apart at a glance rather than taken from whatever symbol font the system has: the spade
 * comes to a sharp point and the club is three separate round lobes; the heart is broad and round-shouldered and the
 * diamond is slim and pointed at both ends.
 */
const suitShapes: Record<Suit, ReactElement> = {
  spades: <path d="M50 3C61 22 95 38 95 62C95 76 85 85 73 85C64 85 57 81 53 74C54 84 58 92 67 97H33C42 92 46 84 47 74C43 81 36 85 27 85C15 85 5 76 5 62C5 38 39 22 50 3Z" />,
  hearts: <path d="M50 95C21 70 3 53 3 31C3 15 15 4 29 4C39 4 46 10 50 20C54 10 61 4 71 4C85 4 97 15 97 31C97 53 79 70 50 95Z" />,
  diamonds: <path d="M50 2Q66 28 86 50Q66 72 50 98Q34 72 14 50Q34 28 50 2Z" />,
  clubs: <>
    <circle cx="50" cy="25" r="21" /><circle cx="25" cy="59" r="21" /><circle cx="75" cy="59" r="21" /><circle cx="50" cy="52" r="11" />
    <path d="M47 55C47 76 42 88 32 97H68C58 88 53 76 53 55Z" />
  </>
};

export function SuitGlyph({ suit }: { suit: Suit }) {
  return <svg className={`suit-glyph suit-glyph-${suit}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">{suitShapes[suit]}</svg>;
}
