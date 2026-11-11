import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "./route.js";

describe("online routes", () => {
  it("parses the known hashes", () => {
    expect(parseRoute("")).toEqual({ screen: "solo" });
    expect(parseRoute("#/")).toEqual({ screen: "solo" });
    expect(parseRoute("#/online")).toEqual({ screen: "lobby" });
    expect(parseRoute("#/table/ABC234")).toEqual({ screen: "table", id: "ABC234" });
  });

  it("upper-cases table ids and accepts both id lengths", () => {
    expect(parseRoute("#/table/abc234")).toEqual({ screen: "table", id: "ABC234" });
    expect(parseRoute("#/table/abcdefghj234")).toEqual({ screen: "table", id: "ABCDEFGHJ234" });
  });

  it("falls back to solo for unknown hashes", () => {
    expect(parseRoute("#/nowhere")).toEqual({ screen: "solo" });
    expect(parseRoute("#/table/")).toEqual({ screen: "solo" });
    expect(parseRoute("#/table/a/b")).toEqual({ screen: "solo" });
    expect(parseRoute("#/table/ab-c")).toEqual({ screen: "solo" });
  });

  it("round-trips through routeHash", () => {
    expect(routeHash({ screen: "solo" })).toBe("");
    expect(routeHash({ screen: "lobby" })).toBe("#/online");
    expect(routeHash({ screen: "table", id: "ABC234" })).toBe("#/table/ABC234");
    expect(parseRoute(routeHash({ screen: "table", id: "ABC234" }))).toEqual({ screen: "table", id: "ABC234" });
  });
});
