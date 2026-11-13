import { parsePbn, pbnBoardToRecord, tableResult, type PbnBoard } from "@contractplay/pbn";
import type { BoardSet } from "@contractplay/persistence";
import { cardId, SEATS, type HandRecord, type TravellerRow } from "@contractplay/core";

const tagOf = (board: PbnBoard, name: string) => board.tags.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;

/** Games that are the same board played at different tables share the board number and the deal. */
function boardKey(board: PbnBoard, index: number): string {
  if (!board.deal) return `unreadable:${index}`;
  return `${tagOf(board, "Board") ?? ""}|${SEATS.map((seat) => board.deal![seat].map(cardId).sort().join(",")).join("/")}`;
}

/**
 * The readable boards of a PBN file as a board set at its first board; `skipped` counts boards that could not be read.
 * A board listed once per table (each game with that table's Contract, Declarer, Result, and Score, as RealBridge's
 * "full" export does) becomes one board whose field is those tables' results, and whose original play is the first
 * table's that can be read. A board with a `ScoreTable` keeps that table as its field.
 */
export function boardSetFromPbn(text: string): { set?: BoardSet; skipped: number } {
  const groups = new Map<string, PbnBoard[]>();
  parsePbn(text).boards.forEach((board, index) => {
    const key = boardKey(board, index);
    groups.set(key, [...(groups.get(key) ?? []), board]);
  });
  const records: HandRecord[] = [];
  let skipped = 0;
  for (const games of groups.values()) {
    const readable = games.map(pbnBoardToRecord).filter((record): record is HandRecord => record !== undefined);
    const record = readable.find((candidate) => candidate.original?.length) ?? readable[0];
    if (!record) {
      skipped += 1;
      continue;
    }
    if (games.length === 1 || readable.some((candidate) => candidate.field.length)) {
      records.push(readable.find((candidate) => candidate.field.length) ?? record);
      continue;
    }
    const field = games.map(tableResult).filter((row): row is TravellerRow => row !== undefined);
    records.push({ ...record, field });
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
