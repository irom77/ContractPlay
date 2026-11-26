import { serializeDdsDeal } from "./ddsDeal.js";
export { serializeDdsDeal } from "./ddsDeal.js";
import type { HandRecord } from "@contractplay/core";

export type DoubleDummyRequest = Readonly<Pick<HandRecord, "deal" | "dealer" | "vulnerability">>;
export type DoubleDummyBaseline = Readonly<{ source: "bridge-dds-1.4.0"; parNS: number; tricks: number[][] }>;
type WorkerReply = Readonly<{ id: number; baseline?: DoubleDummyBaseline; error?: string }>;

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, { resolve: (baseline: DoubleDummyBaseline) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL("./doubleDummy.worker.ts", import.meta.url), { type: "module" });
  instance.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const result = waiting.get(event.data.id);
    if (!result) return;
    waiting.delete(event.data.id);
    if (event.data.baseline) result.resolve(event.data.baseline);
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
export function calculateDoubleDummyBaseline(input: DoubleDummyRequest): Promise<DoubleDummyBaseline> {
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

export async function calculateDoubleDummyPar(input: DoubleDummyRequest): Promise<number> {
  return (await calculateDoubleDummyBaseline(input)).parNS;
}
