import { SaxesParser } from "saxes";
import type { Seat, TravellerRow } from "@contractplay/core";

export type UsebioDiagnostic = Readonly<{ severity: "error" | "warning"; message: string }>;
export type UsebioTravellers = Readonly<{ boards: ReadonlyMap<string, readonly TravellerRow[]>; diagnostics: readonly UsebioDiagnostic[] }>;

type XmlNode = { name: string; text: string; children: XmlNode[] };
const localName = (name: string): string => name.split(":").at(-1)!.toUpperCase();
const childText = (node: XmlNode, name: string): string | undefined => {
  const child = node.children.find((entry) => entry.name === name);
  const text = child?.text.trim();
  return text || undefined;
};

function parseXml(input: string): { root?: XmlNode; error?: string } {
  const parser = new SaxesParser({ xmlns: false });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let error: string | undefined;
  parser.on("error", (cause) => { error ??= cause.message; });
  parser.on("opentag", (tag) => {
    const node: XmlNode = { name: localName(tag.name), text: "", children: [] };
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    else root ??= node;
    stack.push(node);
  });
  parser.on("text", (text) => { if (stack.length) stack[stack.length - 1]!.text += text; });
  parser.on("cdata", (text) => { if (stack.length) stack[stack.length - 1]!.text += text; });
  parser.on("closetag", () => { stack.pop(); });
  try { parser.write(input).close(); } catch (cause) { error ??= cause instanceof Error ? cause.message : String(cause); }
  return { ...(root ? { root } : {}), ...(error ? { error } : {}) };
}

function declarer(value: string | undefined): Seat | undefined {
  if (!value) return undefined;
  const first = value.trim().toUpperCase()[0];
  return ({ N: "north", E: "east", S: "south", W: "west" } as const)[first as "N" | "E" | "S" | "W"];
}

function contract(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/[=+-][0-9]+$/, "").replace(/\s/g, "").replace(/[XDR]+$/, (match) => match.replace(/D/g, "X").replace(/R/g, "XX"));
  if (/^(?:PASS|AP)$/.test(normalized)) return "Pass";
  const match = /^([1-7])(C|D|H|S|N|NT)(X|XX)?$/.exec(normalized);
  if (!match) return undefined;
  const strain = match[2] === "N" || match[2] === "NT" ? "NT" : match[2]!;
  return match[1]! + strain + (match[3] ?? "");
}

/** Reads board-numbered USEBIO traveller lines. Names, pair identifiers, and director percentage scores are discarded. */
export function parseUsebioTravellers(input: string): UsebioTravellers {
  const parsed = parseXml(input);
  if (parsed.error || !parsed.root) {
    return { boards: new Map(), diagnostics: [{ severity: "error", message: "Invalid USEBIO XML" + (parsed.error ? ": " + parsed.error : "") }] };
  }
  const diagnostics: UsebioDiagnostic[] = [];
  const boards = new Map<string, TravellerRow[]>();
  const visit = (node: XmlNode) => {
    if (node.name === "BOARD") {
      const number = childText(node, "BOARD_NUMBER");
      if (!number) {
        diagnostics.push({ severity: "warning", message: "USEBIO board without a board number was skipped" });
      } else {
        const rows = boards.get(number) ?? [];
        for (const line of node.children.filter((child) => child.name === "TRAVELLER_LINE")) {
          const score = childText(line, "SCORE");
          const adjusted = score ? /^A[0-9]{4}$/i.test(score) : false;
          const nsScore = score !== undefined && !adjusted && /^-?[0-9]+$/.test(score) ? Number(score) : undefined;
          if (nsScore === undefined && !adjusted) {
            diagnostics.push({ severity: "warning", message: "USEBIO traveller on board " + number + " has no usable score and was skipped" });
            continue;
          }
          const tricksText = childText(line, "TRICKS");
          const tricks = tricksText && /^(?:[0-9]|1[0-3])$/.test(tricksText) ? Number(tricksText) : undefined;
          const contractValue = contract(childText(line, "CONTRACT"));
          const declarerValue = declarer(childText(line, "PLAYED_BY"));
          rows.push({
            ...(nsScore !== undefined ? { nsScore } : {}),
            ...(contractValue ? { contract: contractValue } : {}),
            ...(declarerValue ? { declarer: declarerValue } : {}),
            ...(tricks !== undefined ? { tricks } : {}),
            multiplicity: 1,
            artificial: adjusted
          });
        }
        boards.set(number, rows);
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(parsed.root);
  if (!boards.size) diagnostics.push({ severity: "error", message: "USEBIO XML contains no numbered boards" });
  return { boards, diagnostics };
}
