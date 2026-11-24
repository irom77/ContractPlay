import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyAction, compareWithField, createDeck, createGameState, deal, fieldMethod, legalCards,
  type Bid, type Deal, type GameAction, type GameState, type Seat
} from "@contractplay/core";
import authMigration from "../migrations/0001_auth.sql?raw";
import archiveMigration from "../migrations/0003_deal_archive.sql?raw";
import { DealArchive, MAX_FIELD_RESULTS, REPLAY_MIN_AGE_MS, type ArchiveInput } from "./deal-archive.js";

const HOUR = 3_600_000;
const archive = new DealArchive(env.DB);
const sameDeal = deal(createDeck());
const otherDeal = deal(createDeck().reverse());
const sql = (text: string) => text.replace(/--[^\n]*/g, "").replace(/\n/g, " ");

const bids = (dealer: Seat, ...calls: Bid[]): GameAction[] => {
  const order: Seat[] = ["north", "east", "south", "west"];
  const start = order.indexOf(dealer);
  return calls.map((bid, index) => ({ type: "bid", seat: order[(start + index) % 4]!, bid }));
};
/** 4S by South, then West (on lead) claims `defence` tricks for the defenders. */
const fourSpades = (defence = 3): GameAction[] =>
  [...bids("north", "pass", "pass", "4spades", "pass", "pass", "pass"), { type: "claim", seat: "west", tricks: defence }];
const passedOut = bids("north", "pass", "pass", "pass", "pass");
/** 1NT by North played out card by card, each player playing the first legal card. */
function playedOut(): GameAction[] {
  const actions = bids("north", "1notrump", "pass", "pass", "pass");
  let state = createGameState({ deal: sameDeal, dealer: "north", vulnerability: "None" });
  for (const action of actions) state = (applyAction(state, action) as { state: GameState }).state;
  while (state.phase === "play") {
    const seat = state.currentActor;
    const action: GameAction = { type: "play", seat, card: legalCards(state.hands[seat], state.currentTrick[0]?.card.suit)[0]! };
    actions.push(action);
    state = (applyAction(state, action) as { state: GameState }).state;
  }
  return actions;
}
const input = (overrides: Partial<ArchiveInput> = {}): ArchiveInput => ({
  deal: sameDeal, dealer: "north", vulnerability: "None", actions: fourSpades(), source: "solo", playedAt: 0, ...overrides
});
const results = async (dealId: string) => (await env.DB.prepare(
  "SELECT contract, declarer, tricks, ns_score, claimed, vulnerability, source FROM deal_results WHERE deal_id = ? ORDER BY played_at"
).bind(dealId).all()).results;

beforeAll(async () => {
  await env.DB.exec(sql(authMigration));
  await env.DB.exec(sql(archiveMigration));
});
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM deal_results"), env.DB.prepare("DELETE FROM archived_deals")]);
});

describe("DealArchive.record", () => {
  it("stores a fresh finished hand and reuses its id for the same cards and dealer", async () => {
    const id = await archive.record(input());
    expect(id).toEqual(expect.any(String));
    expect(await archive.record(input({ playedAt: 5, source: "online", actions: fourSpades(4) }))).toBe(id);
    const [deals] = (await env.DB.prepare("SELECT COUNT(*) AS n FROM archived_deals").all()).results;
    expect(deals).toEqual({ n: 1 });
    expect(await results(id!)).toEqual([
      { contract: "4S", declarer: "south", tricks: 10, ns_score: 420, claimed: 1, vulnerability: "None", source: "solo" },
      { contract: "4S", declarer: "south", tricks: 9, ns_score: -50, claimed: 1, vulnerability: "None", source: "online" }
    ]);
  });

  it("archives the same cards with another dealer as a different deal", async () => {
    const id = await archive.record(input());
    const east = await archive.record(input({ dealer: "east", actions: bids("east", "pass", "pass", "pass", "pass") }));
    expect(east).toEqual(expect.any(String));
    expect(east).not.toBe(id);
  });

  it("rejects unfinished hands, illegal actions, invalid deals and replays of other cards", async () => {
    expect(await archive.record(input({ actions: fourSpades().slice(0, 6) }))).toBeUndefined();
    expect(await archive.record(input({ actions: [{ type: "bid", seat: "east", bid: "1clubs" }, ...fourSpades()] }))).toBeUndefined();
    expect(await archive.record(input({ deal: { ...sameDeal, north: sameDeal.south } as Deal }))).toBeUndefined();
    const id = await archive.record(input());
    expect(await archive.record(input({ deal: otherDeal, replayOf: id! }))).toBeUndefined();
    expect(await archive.record(input({ replayOf: "missing" }))).toBeUndefined();
    expect(await results(id!)).toHaveLength(1);
  });

  it("adds a replayed result to the named deal, at the vulnerability it was played", async () => {
    const id = await archive.record(input());
    expect(await archive.record(input({ replayOf: id!, vulnerability: "Both", playedAt: 9 }))).toBe(id);
    expect((await results(id!)).map((row) => [row.vulnerability, row.ns_score])).toEqual([["None", 420], ["Both", 620]]);
  });

  it("stores claims, played-out hands and passed-out hands", async () => {
    const played = await archive.record(input({ actions: playedOut() }));
    expect(await results(played!)).toEqual([expect.objectContaining({ contract: "1NT", declarer: "north", claimed: 0 })]);
    const passed = await archive.record(input({ deal: otherDeal, actions: passedOut }));
    expect(await results(passed!)).toEqual([
      { contract: "Pass", declarer: null, tricks: null, ns_score: 0, claimed: 0, vulnerability: "None", source: "solo" }
    ]);
  });
});

describe("DealArchive.pickReplay", () => {
  it("only offers deals first played at least a day ago", async () => {
    expect(REPLAY_MIN_AGE_MS).toBe(24 * HOUR);
    expect(await archive.pickReplay(0)).toBeUndefined();
    const id = await archive.record(input());
    expect(await archive.pickReplay(23 * HOUR)).toBeUndefined();
    const replay = await archive.pickReplay(25 * HOUR);
    expect(replay?.dealId).toBe(id);
    expect(replay?.record).toMatchObject({
      deal: sameDeal, dealer: "north", vulnerability: "None", scoring: "IMP", event: "Replay", original: fourSpades(),
      field: [{ contract: "4S", declarer: "south", tricks: 10, nsScore: 420, multiplicity: 1, artificial: false }],
      replay: { dealId: id, firstPlayedAt: 0, rescored: false,
        original: { contract: "4S", declarer: "south", tricks: 10, nsScore: 420, multiplicity: 1, artificial: false } }
    });
    expect(compareWithField(replay!.record.field, 0, "NS", fieldMethod(replay!.record.scoring))!.method).toBe("butler");
  });

  it("rescores the field to a target vulnerability", async () => {
    await archive.record(input());
    const vulnerable = await archive.pickReplay(25 * HOUR, "NS");
    expect(vulnerable?.record.vulnerability).toBe("NS");
    expect(vulnerable?.record.field[0]?.nsScore).toBe(620);
    expect(vulnerable?.record.replay).toMatchObject({ rescored: true, original: { nsScore: 620 } });
    const same = await archive.pickReplay(25 * HOUR, "None");
    expect(same?.record.field[0]?.nsScore).toBe(420);
    expect(same?.record.replay?.rescored).toBe(false);
  });

  it("rescores results played at another vulnerability to the deal's own", async () => {
    const id = await archive.record(input());
    await archive.record(input({ replayOf: id!, vulnerability: "Both", playedAt: 1 }));
    const replay = await archive.pickReplay(25 * HOUR);
    expect(replay?.record.vulnerability).toBe("None");
    expect(replay?.record.field).toEqual([expect.objectContaining({ nsScore: 420, multiplicity: 2 })]);
    expect(replay?.record.replay?.rescored).toBe(true);
  });

  it("holds the original plus the most recent results, grouping identical ones", async () => {
    const id = await archive.record(input({ actions: passedOut }));
    for (let at = 1; at < 10; at += 1) await archive.record(input({ replayOf: id!, playedAt: at, actions: fourSpades(4) }));
    for (let at = 10; at < 60; at += 1) await archive.record(input({ replayOf: id!, playedAt: at, actions: fourSpades(3) }));
    const replay = await archive.pickReplay(25 * HOUR);
    expect(MAX_FIELD_RESULTS).toBe(50);
    expect(replay?.record.field).toEqual([
      { contract: "Pass", nsScore: 0, multiplicity: 1, artificial: false },
      { contract: "4S", declarer: "south", tricks: 10, nsScore: 420, multiplicity: 50, artificial: false }
    ]);
    expect(replay?.record.original).toEqual(passedOut);
  });

  it("groups three identical results into one row", async () => {
    const id = await archive.record(input());
    await archive.record(input({ replayOf: id!, playedAt: 1, actions: fourSpades(4) }));
    await archive.record(input({ replayOf: id!, playedAt: 2 }));
    await archive.record(input({ replayOf: id!, playedAt: 3 }));
    expect((await archive.pickReplay(25 * HOUR))?.record.field).toEqual([
      expect.objectContaining({ tricks: 10, multiplicity: 3 }),
      expect.objectContaining({ tricks: 9, multiplicity: 1 })
    ]);
  });

  it("picks among eligible deals with the random probe", async () => {
    const first = await archive.record(input());
    const second = await archive.record(input({ deal: otherDeal, playedAt: HOUR }));
    await archive.record(input({ dealer: "south", actions: bids("south", "pass", "pass", "pass", "pass"), playedAt: 20 * HOUR }));
    const now = 25.5 * HOUR;
    expect((await archive.pickReplay(now, undefined, () => 0))?.dealId).toBe(first);
    expect((await archive.pickReplay(now, undefined, () => 0.99))?.dealId).toBe(second);
  });
});
