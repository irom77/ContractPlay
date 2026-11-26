// Run with node after building the workspace packages. All inputs are deterministic.
import { writeFile } from "node:fs/promises";
import { botCharacter, createDeck, deal, SEATS, shuffle } from "@contractplay/core";
import { createBenchmarkProfile, createRotation, rotationCycleLength } from "@contractplay/benchmark";
import { chooseBotAction, createTable, dealBotSessionHand, reduce, seatSessionBots } from "@contractplay/table";

const rosters = [
  ["tess", "will", "bea", "pat"], ["ray", "wes", "sam", "kim"], ["eddie", "cora", "pia", "dex"]
];
const vul = ["None", "NS", "EW", "Both", "NS", "EW", "Both", "None", "EW", "Both", "None", "NS", "Both", "None", "NS", "EW"];
const seed = 20261125, boardsPerSession = 8;
let randomState = seed;
function random() {
  randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
  return randomState / 4294967296;
}
async function play(assignment, style, board) {
  const characters = Object.fromEntries(SEATS.map(seat => [seat, assignment[seat].profileId]));
  const table = { ...createTable({ id: "fixture", name: "Calibration", style, scoring: "duplicate", listed: false, at: 0 }), sessionId: "fixture" };
  const seated = seatSessionBots(table, characters);
  const started = dealBotSessionHand(seated.state, { ...board, index: 0 }, 0);
  if (seated.refused || started.refused) throw new Error("Could not start calibration table");
  let state = started.state;
  while (state.game.phase === "auction" || state.game.phase === "play") {
    const action = await chooseBotAction(state);
    if (!action) throw new Error("Calibration bot returned no action");
    const next = reduce(state, { type: "bot", action, revision: state.revision, at: state.revision });
    if (next.refused || next.state === state) throw new Error("Illegal calibration action");
    state = next.state;
  }
  return state.game.score?.score ?? 0;
}

const sessions = [];
for (const sample of ["fit", "check"]) {
  for (const style of ["SAYC", "2/1"]) {
    for (const roster of rosters) {
      const profiles = roster.map(id => {
        const { aggression, skill } = botCharacter(id);
        return createBenchmarkProfile({ aggression, skill, biddingStyle: style, version: "v1", engineVersion: "contractplay-bots-v1" });
      });
      for (let round = 0; round < rotationCycleLength(roster.length, 2); round++) {
        const [first] = createRotation(profiles, seed, round, 2);
        const mirror = { north: first.east, east: first.south, south: first.west, west: first.north };
        const scores = [];
        for (let i = 0; i < boardsPerSession; i++) {
          const position = (round * boardsPerSession + i) % 16;
          const board = { number: i + 1, dealer: SEATS[position % 4], vulnerability: vul[position], deal: deal(shuffle(createDeck(), random)) };
          scores.push([await play(first, style, board), await play(mirror, style, board)]);
        }
        sessions.push({ sample, style, round, seats: SEATS.map(s => first[s].profileId), scores });
      }
    }
  }
}
const output = new URL("../src/fixtures/benchmark-calibration.json", import.meta.url);
const lines = sessions.map(session => JSON.stringify(session));
await writeFile(output, "[\n" + lines.join(",\n") + "\n]\n");
