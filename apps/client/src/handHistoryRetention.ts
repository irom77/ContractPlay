import type { SavedHand } from "@contractplay/persistence";

export const isOnlineHand = (hand: SavedHand): boolean => hand.id.startsWith("online-");
export const newestHands = (hands: readonly SavedHand[]): SavedHand[] => [...hands].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || b.id.localeCompare(a.id));

/**
 * Device solo hands, guest online hands, and each account's online and solo caches have independent 25-hand limits,
 * so hands arriving from an account never push out hands kept only on this device.
 */
export function retainHandHistory(hands: readonly SavedHand[]): SavedHand[] {
  const counts = new Map<string, number>();
  return newestHands(hands).filter(hand => {
    const group = `${isOnlineHand(hand) ? "online" : "solo"}:${hand.onlineHistory?.ownerPlayerId ?? ""}`;
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return count < 25;
  });
}
