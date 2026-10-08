import { describe, expect, test } from "vitest";
import { matchesSearch } from "./tableSearch";

describe("table search", () => {
  test("case-insensitive substring over any field", () => {
    const row = ["microtubule", "tracer", "1", "Instance", 21.6];
    expect(matchesSearch("", row)).toBe(true);
    expect(matchesSearch("  ", row)).toBe(true);
    expect(matchesSearch("TUBU", row)).toBe(true);
    expect(matchesSearch("trac", row)).toBe(true);
    expect(matchesSearch("instance", row)).toBe(true);
    expect(matchesSearch("21.6", row)).toBe(true);
    expect(matchesSearch("ribosome", row)).toBe(false);
    expect(matchesSearch("x", [null, undefined])).toBe(false);
  });
});
