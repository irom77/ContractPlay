import { RANKS, SEATS, SUITS } from "@contractplay/core";
import type { Card, Deal, Seat } from "@contractplay/core";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A card with a known suit and rank, copied so no extra fields survive; undefined for anything else. */
export function parseCard(value: unknown): Card | undefined {
  if (!isRecord(value) || !SUITS.includes(value.suit as Card["suit"]) || !RANKS.includes(value.rank as Card["rank"])) return undefined;
  return { suit: value.suit as Card["suit"], rank: value.rank as Card["rank"] };
}

/** Sanitizes an uploaded deal: exactly thirteen distinct cards in each hand, all 52 cards unique. */
export function parseDeal(value: unknown): Deal | undefined {
  if (!isRecord(value)) return undefined;
  const seen = new Set<string>();
  const hands = {} as Record<Seat, Card[]>;
  for (const seat of SEATS) {
    const hand = value[seat];
    if (!Array.isArray(hand) || hand.length !== 13) return undefined;
    const cards: Card[] = [];
    for (const raw of hand) {
      const card = parseCard(raw);
      if (!card) return undefined;
      const key = `${card.suit}:${card.rank}`;
      if (seen.has(key)) return undefined;
      seen.add(key);
      cards.push(card);
    }
    hands[seat] = cards;
  }
  return seen.size === 52 ? hands as Deal : undefined;
}

/** The request body as text, or undefined once it is over `limit` bytes; never buffers more than `limit` bytes plus one chunk. */
export async function readLimited(request: Request, limit: number): Promise<string | undefined> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && !(Number(declared) <= limit)) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
