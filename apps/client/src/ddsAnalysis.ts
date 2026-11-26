import { Dds, Direction, Vulnerable, loadDds } from "bridge-dds";
import type { DoubleDummyBaseline, DoubleDummyRequest } from "./doubleDummy.js";

const direction = { north: Direction.North, east: Direction.East, south: Direction.South, west: Direction.West } as const;
const vulnerable = { None: Vulnerable.None, Both: Vulnerable.Both, NS: Vulnerable.NorthSouth, EW: Vulnerable.EastWest } as const;

let solver: Promise<Dds> | undefined;

export async function solveBoard(input: Omit<DoubleDummyRequest, "deal"> & { cards: string }): Promise<DoubleDummyBaseline> {
  const dds = await (solver ??= loadDds().then((module) => new Dds(module)));
  const table = dds.CalcDDTablePBN({ cards: input.cards });
  const par = dds.DealerPar(table, direction[input.dealer], vulnerable[input.vulnerability]);
  return { source: "bridge-dds-1.4.0", parNS: par.score, tricks: table.resTable };
}
