import type { SavedHand } from "@contractplay/persistence";

export const isOnlineHand = (hand: SavedHand): boolean => hand.id.startsWith("online-");
export const newestHands = (hands: readonly SavedHand[]): SavedHand[] => [...hands].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || b.id.localeCompare(a.id));

/** Solo, guest online, and each account's online cache have independent 25-hand limits. */
export function retainHandHistory(hands: readonly SavedHand[]): SavedHand[] {
  const counts = new Map<string, number>();
  return newestHands(hands).filter(hand => {
    const group = isOnlineHand(hand) ? `online:${hand.onlineHistory?.ownerPlayerId ?? ""}` : "solo";
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return count < 25;
  });
}
