import { createDeck, deal } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { createDuplicateSession, recordDuplicateResult, sessionRank, sessionStanding } from "./session.js";

const board = (number: number) => ({ number, deal: deal(createDeck()), dealer: "north" as const, vulnerability: "None" as const });

describe("duplicate session", () => {
  it("holds the current board until every table reports a result", () => {
    let session = createDuplicateSession({ id: "s", tables: ["a", "b"], boards: [board(1), board(2)], scoring: "matchpoints" });
    session = recordDuplicateResult(session, "a", 0, 420)!;
    expect(session.currentBoard).toBe(0);
    session = recordDuplicateResult(session, "b", 0, -50)!;
    expect(session.currentBoard).toBe(1);
    expect(sessionStanding(session, "a")).toMatchObject({ completedBoards: 1, matchpoints: { points: 2, top: 2, percentage: 100 } });
  });

  it("makes result reports idempotent and rejects conflicting or stale reports", () => {
    let session = createDuplicateSession({ id: "s", tables: ["a", "b"], boards: [board(1)], scoring: "imps" });
    session = recordDuplicateResult(session, "a", 0, 420)!;
    expect(recordDuplicateResult(session, "a", 0, 420)).toBe(session);
    expect(recordDuplicateResult(session, "a", 0, 430)).toBeUndefined();
    expect(recordDuplicateResult(session, "missing", 0, 0)).toBeUndefined();
    session = recordDuplicateResult(session, "b", 0, -50)!;
    expect(recordDuplicateResult(session, "b", 0, -50)).toBe(session);
    expect(recordDuplicateResult(session, "b", 0, -40)).toBeUndefined();
  });

  it("aggregates cross-IMPs from each table's North-South perspective", () => {
    let session = createDuplicateSession({ id: "s", tables: ["a", "b", "c"], boards: [board(1)], scoring: "imps" });
    session = recordDuplicateResult(session, "a", 0, 420)!;
    session = recordDuplicateResult(session, "b", 0, -50)!;
    session = recordDuplicateResult(session, "c", 0, 0)!;
    expect(sessionStanding(session, "a")).toMatchObject({ completedBoards: 1, crossImps: 19 });
    expect(sessionStanding(session, "b")).toMatchObject({ completedBoards: 1, crossImps: -12 });
    expect(sessionRank(session, "a")).toEqual({ rank: 1, tableCount: 3 });
    expect(sessionRank(session, "c")).toEqual({ rank: 2, tableCount: 3 });
  });
});
