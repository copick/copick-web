import { describe, expect, test } from "vitest";
import { matchesSearch, noMatchText } from "./tableSearch";

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

describe("no-match messages", () => {
  test("say whether the search, the shown-only filter or both left no rows", () => {
    expect(noMatchText("picks", " ribo ", false)).toBe("No picks match “ribo”");
    expect(noMatchText("picks", "", true)).toBe("None of the picks are shown");
    expect(noMatchText("picks", "ribo", true)).toBe(
      "No shown picks match “ribo”",
    );
  });
});
