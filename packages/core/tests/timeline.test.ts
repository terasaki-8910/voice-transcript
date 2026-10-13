// Pins src/timeline.ts: which parts of the audio silence trimming keeps, and
// how times on the compacted audio map back to the original timeline.
import { describe, it, expect } from "vitest";
import { createTimeMap, planKeptIntervals, remapToOriginal } from "../src/timeline.js";
import type { Interval } from "../src/timeline.js";

const OPTS = { minSilenceSec: 2, padSec: 0.5, sampleRate: 16000 };

describe("planKeptIntervals", () => {
  it("keeps everything when there are no silences", () => {
    expect(planKeptIntervals([], 100, OPTS)).toEqual([{ start: 0, end: 100 }]);
  });

  it("ignores silences shorter than the minimum", () => {
    expect(planKeptIntervals([{ start: 10, end: 11.9 }], 100, OPTS)).toEqual([{ start: 0, end: 100 }]);
  });

  it("removes the middle of a long silence and keeps the pad on each side", () => {
    expect(planKeptIntervals([{ start: 10, end: 40 }], 100, OPTS)).toEqual([
      { start: 0, end: 10.5 },
      { start: 39.5, end: 100 },
    ]);
  });

  it("handles a silence at the very start and at the very end", () => {
    expect(
      planKeptIntervals(
        [
          { start: 0, end: 10 },
          { start: 90, end: 100 },
        ],
        100,
        OPTS,
      ),
    ).toEqual([
      { start: 0, end: 0.5 },
      { start: 9.5, end: 90.5 },
      { start: 99.5, end: 100 },
    ]);
  });

  it("keeps only the pads of a file that is all silence", () => {
    expect(planKeptIntervals([{ start: 0, end: 60 }], 60, OPTS)).toEqual([
      { start: 0, end: 0.5 },
      { start: 59.5, end: 60 },
    ]);
  });

  it("rounds every boundary to a whole sample", () => {
    const kept = planKeptIntervals([{ start: 10.00001, end: 20.00003 }], 30, OPTS);
    for (const part of kept) {
      expect(Number.isInteger(Math.round(part.start * 16000))).toBe(true);
      expect(Math.abs(part.start * 16000 - Math.round(part.start * 16000))).toBeLessThan(1e-6);
      expect(Math.abs(part.end * 16000 - Math.round(part.end * 16000))).toBeLessThan(1e-6);
    }
    expect(kept[0].end).toBe(Math.round(10.50001 * 16000) / 16000);
  });

  it("returns ordered, non-overlapping, non-empty parts", () => {
    const silences: Interval[] = [
      { start: 50, end: 60 },
      { start: 5, end: 9 },
      { start: 20, end: 20.5 },
    ];
    const kept = planKeptIntervals(silences, 100, OPTS);
    for (let i = 0; i < kept.length; i++) {
      expect(kept[i].end).toBeGreaterThan(kept[i].start);
      if (i > 0) expect(kept[i].start).toBeGreaterThanOrEqual(kept[i - 1].end);
    }
    expect(kept).toHaveLength(3);
  });
});

describe("createTimeMap", () => {
  const kept: Interval[] = [
    { start: 0, end: 10 },
    { start: 40, end: 50 },
    { start: 90, end: 100 },
  ];
  const map = createTimeMap(kept);

  it("sums the kept seconds", () => {
    expect(map.keptSeconds).toBe(30);
  });

  it("maps inside a part by offset", () => {
    expect(map.toOriginal(5, "start")).toBe(5);
    expect(map.toOriginal(15, "start")).toBe(45);
    expect(map.toOriginal(25, "end")).toBe(95);
  });

  it("sends a junction to the next part for start and the previous part for end", () => {
    expect(map.toOriginal(10, "start")).toBe(40);
    expect(map.toOriginal(10, "end")).toBe(10);
    expect(map.toOriginal(20, "start")).toBe(90);
    expect(map.toOriginal(20, "end")).toBe(50);
  });

  it("clamps below zero and past the end", () => {
    const shifted = createTimeMap([{ start: 5, end: 10 }, { start: 20, end: 25 }]);
    expect(shifted.toOriginal(-3, "start")).toBe(5);
    expect(shifted.toOriginal(0, "end")).toBe(5);
    expect(shifted.toOriginal(99, "end")).toBe(25);
    expect(shifted.toOriginal(10, "start")).toBe(25);
  });

  it("stays exact across thousands of cuts", () => {
    const many: Interval[] = [];
    for (let i = 0; i < 5000; i++) many.push({ start: i * 10, end: i * 10 + 5 });
    const big = createTimeMap(many);
    expect(big.keptSeconds).toBe(25000);
    expect(big.toOriginal(12502, "start")).toBe(25000 + 2);
    expect(big.toOriginal(12500, "end")).toBe(24990 + 5);
    expect(big.toOriginal(12500, "start")).toBe(25000);
  });
});

describe("remapToOriginal", () => {
  const map = createTimeMap([
    { start: 0, end: 10 },
    { start: 40, end: 50 },
  ]);

  it("moves a segment after a removed 30 s stretch to its original time", () => {
    const out = remapToOriginal(
      { text: "a b", language: "en", duration: 20, segments: [{ start: 2, end: 4, text: "a" }, { start: 12, end: 14, text: "b" }] },
      map,
      50,
    );
    expect(out.segments).toEqual([
      { start: 2, end: 4, text: "a" },
      { start: 42, end: 44, text: "b" },
    ]);
    expect(out.duration).toBe(50);
    expect(out.text).toBe("a b");
    expect(out.language).toBe("en");
  });

  it("keeps segments monotonic, including ones that straddle a junction", () => {
    const out = remapToOriginal(
      {
        text: "x",
        segments: [
          { start: 8, end: 12, text: "x" },
          { start: 12, end: 12, text: "y" },
          { start: 12, end: 19, text: "z" },
        ],
      },
      map,
      50,
    );
    expect(out.segments[0]).toEqual({ start: 8, end: 42, text: "x" });
    for (const seg of out.segments) expect(seg.end).toBeGreaterThanOrEqual(seg.start);
    for (let i = 1; i < out.segments.length; i++) {
      expect(out.segments[i].start).toBeGreaterThanOrEqual(out.segments[i - 1].start);
    }
  });
});
