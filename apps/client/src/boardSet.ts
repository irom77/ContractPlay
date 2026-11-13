import { parsePbn, pbnBoardToRecord } from "@contractplay/pbn";
import type { BoardSet } from "@contractplay/persistence";
import type { HandRecord } from "@contractplay/core";

/** The readable boards of a PBN file as a board set at its first board; `skipped` counts boards that could not be read. */
export function boardSetFromPbn(text: string): { set?: BoardSet; skipped: number } {
  const records: HandRecord[] = [];
  let skipped = 0;
  for (const board of parsePbn(text).boards) {
    const record = pbnBoardToRecord(board);
    if (record) records.push(record);
    else skipped += 1;
  }
  return records.length ? { set: { name: records[0]!.event || "Imported boards", records, position: 0 }, skipped } : { skipped };
}

/** A file played as a set: several boards, or boards that carry the field's results. */
export function isBoardSetFile(set: BoardSet): boolean {
  return set.records.length > 1 || set.records.some((record) => record.field.length > 0);
}

export function boardLabel(set: BoardSet): string {
  return `Board ${set.records[set.position]?.board ?? set.position + 1} · ${set.position + 1} of ${set.records.length}`;
}
