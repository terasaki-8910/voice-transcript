// Pure helpers behind History's bulk selection: Shift+click range rules and the
// clipboard format for several transcripts at once.
import { describe, it, expect } from "vitest";
import { rangeIds, formatBulkTranscripts } from "../../src/features/history/bulkSelection";

describe("rangeIds", () => {
  const visible = [10, 20, 30, 40, 50];

  it("covers the rows between anchor and target, inclusive, in either direction", () => {
    expect(rangeIds(visible, 20, 40)).toEqual([20, 30, 40]);
    expect(rangeIds(visible, 40, 20)).toEqual([20, 30, 40]);
  });

  it("is just the target when the anchor is the target", () => {
    expect(rangeIds(visible, 30, 30)).toEqual([30]);
  });

  it("falls back to only the target when the anchor is no longer visible", () => {
    expect(rangeIds(visible, 99, 40)).toEqual([40]);
    expect(rangeIds(visible, 20, 99)).toEqual([99]);
  });
});

describe("formatBulkTranscripts", () => {
  it("separates each entry's name and text, and entries from each other", () => {
    expect(
      formatBulkTranscripts([
        { name: "a.m4a", text: "hello a" },
        { name: "c.m4a", text: "hello c" },
      ]),
    ).toBe("a.m4a\n\nhello a\n\n---\n\nc.m4a\n\nhello c");
  });

  it("is empty for no entries", () => {
    expect(formatBulkTranscripts([])).toBe("");
  });
});
