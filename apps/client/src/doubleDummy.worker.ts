import { Dds, Direction, Vulnerable, loadDds } from "bridge-dds";

type Request = Readonly<{
  id: number;
  cards: string;
  dealer: "north" | "east" | "south" | "west";
  vulnerability: "None" | "NS" | "EW" | "Both";
}>;
type Reply = Readonly<{ id: number; score?: number; error?: string }>;

const direction = { north: Direction.North, east: Direction.East, south: Direction.South, west: Direction.West } as const;
const vulnerable = { None: Vulnerable.None, Both: Vulnerable.Both, NS: Vulnerable.NorthSouth, EW: Vulnerable.EastWest } as const;

let solver: Promise<Dds> | undefined;
const loadSolver = () => solver ??= loadDds().then((module) => new Dds(module));

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  void loadSolver().then((dds) => {
    const table = dds.CalcDDTablePBN({ cards: request.cards });
    const par = dds.DealerPar(table, direction[request.dealer], vulnerable[request.vulnerability]);
    const reply: Reply = { id: request.id, score: par.score };
    self.postMessage(reply);
  }).catch((error: unknown) => {
    const reply: Reply = { id: request.id, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(reply);
  });
});
