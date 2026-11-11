import { act, applyBotEvent, dealHand } from "./hand.js";
import { clearSeat, leave, setBot, sit } from "./seats.js";
import type { Outcome, TableEvent, TableState } from "./state.js";

/** Applies one event. Presence events (connect, disconnect, tick, handToBot, resume) are not handled yet. */
export function reduce(state: TableState, event: TableEvent, random: () => number = Math.random): Outcome {
  if (event.type === "bot") return applyBotEvent(state, event.revision, event.action, event.at);
  if (event.type !== "message") return { state };
  const { player, message, at } = event;
  switch (message.type) {
    case "sit": return sit(state, player, state.names[player] ?? player, message.seat, at);
    case "leave": return leave(state, player);
    case "setBot": return setBot(state, player, message.seat, message.skill);
    case "clearSeat": return clearSeat(state, player, message.seat);
    case "deal": return dealHand(state, player, at, random);
    case "act": return act(state, player, message, at);
    default: return { state };
  }
}
