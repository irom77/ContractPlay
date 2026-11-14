import { describe, expect, it } from "vitest";
import { parseUsebioTravellers } from "./usebio.js";

describe("parseUsebioTravellers", () => {
  it("reads board travellers without retaining player or pair identifiers", () => {
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE USEBIO SYSTEM "https://example.invalid/usebio.dtd">
      <USEBIO><EVENT><SESSIONS><SESSION><BOARDS>
        <BOARD><BOARD_NUMBER>7</BOARD_NUMBER>
          <TRAVELLER_LINE><NS_PAIR_NUMBER>12</NS_PAIR_NUMBER><EW_PAIR_NUMBER>19</EW_PAIR_NUMBER><CONTRACT>4S</CONTRACT><PLAYED_BY>N</PLAYED_BY><TRICKS>10</TRICKS><SCORE>420</SCORE></TRAVELLER_LINE>
          <TRAVELLER_LINE><NS_PAIR_NUMBER>44</NS_PAIR_NUMBER><EW_PAIR_NUMBER>51</EW_PAIR_NUMBER><CONTRACT>3NT</CONTRACT><PLAYED_BY>South</PLAYED_BY><TRICKS>9</TRICKS><SCORE>-400</SCORE></TRAVELLER_LINE>
          <TRAVELLER_LINE><NS_PAIR_NUMBER>60</NS_PAIR_NUMBER><EW_PAIR_NUMBER>61</EW_PAIR_NUMBER><SCORE>A6060</SCORE></TRAVELLER_LINE>
        </BOARD>
        <BOARD><BOARD_NUMBER>8</BOARD_NUMBER><TRAVELLER_LINE><SCORE>50</SCORE></TRAVELLER_LINE></BOARD>
      </BOARDS></SESSION></SESSIONS></EVENT></USEBIO>`;
    const result = parseUsebioTravellers(xml);
    expect(result.diagnostics).toEqual([]);
    expect(result.boards.get("7")).toEqual([
      { nsScore: 420, contract: "4S", declarer: "north", tricks: 10, multiplicity: 1, artificial: false },
      { nsScore: -400, contract: "3NT", declarer: "south", tricks: 9, multiplicity: 1, artificial: false },
      { multiplicity: 1, artificial: true }
    ]);
    expect(result.boards.get("8")).toEqual([{ nsScore: 50, multiplicity: 1, artificial: false }]);
    expect(JSON.stringify([...result.boards])).not.toMatch(/12|19|44|51|60|61/);
  });

  it("reports malformed XML and traveller rows without silently inventing scores", () => {
    expect(parseUsebioTravellers("<USEBIO><BOARD>").diagnostics[0]?.severity).toBe("error");
    const result = parseUsebioTravellers(`<USEBIO><BOARD><BOARD_NUMBER>1</BOARD_NUMBER><TRAVELLER_LINE><SCORE>?</SCORE></TRAVELLER_LINE></BOARD></USEBIO>`);
    expect(result.boards.get("1")).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
