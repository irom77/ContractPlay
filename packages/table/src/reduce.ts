import { answerClaim, claim, withdrawClaim } from "./claim.js";
import { act, applyBotEvent, cancelHand, dealHand, takeBack } from "./hand.js";
import { autoPlay, connect, disconnect, handToBot, resume, tick } from "./presence.js";
import { clearSeat, leave, setBot, sit } from "./seats.js";
import type { Outcome, TableEvent, TableState } from "./state.js";

/**
 * Applies one event.
 * `random` shuffles the deck: production callers must supply a cryptographically secure source.
 */
export function reduce(state: TableState, event: TableEvent, random: () => number): Outcome {
  switch (event.type) {
    case "bot": return applyBotEvent(state, event.revision, event.action, event.at);
    case "connect": return connect(state, event.player, event.name, event.at);
    case "disconnect": return disconnect(state, event.player, event.at);
    case "tick": return tick(state, event.at);
    case "message": break;
  }
  const { player, message, at } = event;
  switch (message.type) {
    case "sit": return sit(state, player, state.names[player] ?? "Player", message.seat, at);
    case "leave": return leave(state, player);
    case "setBot": return setBot(state, player, message.seat, message.skill);
    case "clearSeat": return clearSeat(state, player, message.seat);
    case "deal": return dealHand(state, player, at, random);
    case "act": return act(state, player, message, at);
    case "handToBot": return handToBot(state, player, message.seat, at);
    case "resume": return resume(state, player);
    case "autoPlay": return autoPlay(state, player);
    case "takeBack": return takeBack(state, player, at);
    case "cancelHand": return cancelHand(state, player, at);
    case "claim": return claim(state, player, message.tricks, at);
    case "answerClaim": return answerClaim(state, player, message.accept, at);
    case "withdrawClaim": return withdrawClaim(state, player, at);
  }
}
