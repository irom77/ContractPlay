import { RANKS, SEATS, SUITS } from "@contractplay/core";
import type { Deal, HandRecord } from "@contractplay/core";

export type DoubleDummyRequest = Readonly<Pick<HandRecord, "deal" | "dealer" | "vulnerability">>;
type WorkerReply = Readonly<{ id: number; score?: number; error?: string }>;

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, { resolve: (score: number) => void; reject: (error: Error) => void }>();

/** PBN deal string used by DDS: North, East, South, West, with S.H.D.C suits and descending ranks. */
export function serializeDdsDeal(deal: Deal): string {
  return SEATS.map((seat, index) => {
    const hands = SUITS.map((suit) =>
      [...deal[seat]].filter((card) => card.suit === suit)
        .sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank))
        .map((card) => card.rank)
        .join("")
    ).join(".");
    return index === 0 ? "N:" + hands : hands;
  }).join(" ");
}

function getWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL("./doubleDummy.worker.ts", import.meta.url), { type: "module" });
  instance.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const result = waiting.get(event.data.id);
    if (!result) return;
    waiting.delete(event.data.id);
    if (typeof event.data.score === "number" && Number.isFinite(event.data.score)) result.resolve(event.data.score);
    else result.reject(new Error(event.data.error ?? "The double-dummy solver returned no par score"));
  });
  const fail = () => {
    const error = new Error("The double-dummy solver worker failed");
    for (const result of waiting.values()) result.reject(error);
    waiting.clear();
    instance.terminate();
    if (worker === instance) worker = undefined;
  };
  instance.addEventListener("error", fail);
  instance.addEventListener("messageerror", fail);
  worker = instance;
  return instance;
}

/** Calculates duplicate par asynchronously in a Web Worker so DDS never blocks the table UI. */
export function calculateDoubleDummyPar(input: DoubleDummyRequest): Promise<number> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    try {
      getWorker().postMessage({
        id,
        cards: serializeDdsDeal(input.deal),
        dealer: input.dealer,
        vulnerability: input.vulnerability
      });
    } catch (cause) {
      waiting.delete(id);
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}
