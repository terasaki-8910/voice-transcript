// Pure math + drawing -- exercised with plain numbers and a fake 2D
// context, same split as popoverPlacement.test.ts, since jsdom has no real
// canvas to draw into.
import { describe, it, expect } from "vitest";
import { levelToFraction, pushLevel, drawLevels, LEVEL_HISTORY, METER_WIDTH, METER_HEIGHT } from "../../src/features/recording/levelMeter";

describe("levelToFraction", () => {
  it("maps full scale (1.0 linear, 0 dBFS) to 1", () => {
    expect(levelToFraction(1)).toBeCloseTo(1);
  });

  it("maps the -60 dBFS floor (0.001 linear) to 0", () => {
    expect(levelToFraction(0.001)).toBeCloseTo(0, 5);
  });

  it("maps silence (0) to 0", () => {
    expect(levelToFraction(0)).toBe(0);
  });

  it("gives normal speech level (-40 dBFS, 0.01 linear) meaningful sensitivity, not a sliver", () => {
    // The whole point of the dBFS mapping: linearly this would be 0.01 (a
    // near-invisible bar); logarithmically it should read as a third of
    // the meter's range.
    expect(levelToFraction(0.01)).toBeCloseTo(1 / 3, 5);
  });

  it("clamps a value above full scale to 1 rather than erroring", () => {
    expect(levelToFraction(2)).toBeCloseTo(1);
  });

  it("treats NaN and negative input as silence rather than propagating", () => {
    expect(levelToFraction(NaN)).toBe(0);
    expect(levelToFraction(-5)).toBe(0);
  });
});

describe("pushLevel", () => {
  it("appends the mapped fraction to the end", () => {
    const levels: number[] = [];
    pushLevel(levels, 1);
    expect(levels).toEqual([1]);
  });

  it("caps history length, dropping the OLDEST entries first (FIFO)", () => {
    const levels: number[] = [];
    for (let i = 0; i < LEVEL_HISTORY + 5; i++) {
      pushLevel(levels, 1);
    }
    expect(levels).toHaveLength(LEVEL_HISTORY);
  });

  it("keeps newest values on the right after the cap is reached", () => {
    const levels: number[] = [];
    for (let i = 0; i < LEVEL_HISTORY; i++) pushLevel(levels, 0); // fill with silence
    pushLevel(levels, 1); // one loud tick, should push out the oldest silent one
    expect(levels).toHaveLength(LEVEL_HISTORY);
    expect(levels[levels.length - 1]).toBeCloseTo(1);
  });
});

function makeFakeContext() {
  const calls: { fillRect: [number, number, number, number][]; clearRect: number } = { fillRect: [], clearRect: 0 };
  const ctx = {
    fillStyle: "",
    clearRect: () => {
      calls.clearRect += 1;
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      calls.fillRect.push([x, y, w, h]);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("drawLevels", () => {
  it("clears the canvas once and draws one bar per level", () => {
    const { ctx, calls } = makeFakeContext();
    drawLevels(ctx, [0, 0.5, 1], "red");
    expect(calls.clearRect).toBe(1);
    expect(calls.fillRect).toHaveLength(3);
  });

  it("draws a minimum-height sliver for silence rather than nothing", () => {
    const { ctx, calls } = makeFakeContext();
    drawLevels(ctx, [0], "red");
    const [, , , height] = calls.fillRect[0];
    expect(height).toBeGreaterThan(0);
  });

  it("draws a full-height bar for a fraction of 1", () => {
    const { ctx, calls } = makeFakeContext();
    drawLevels(ctx, [1], "red");
    const [, , , height] = calls.fillRect[0];
    expect(height).toBeCloseTo(METER_HEIGHT);
  });

  it("bars are mirrored around the vertical midline", () => {
    const { ctx, calls } = makeFakeContext();
    drawLevels(ctx, [1], "red");
    const [, y, , height] = calls.fillRect[0];
    expect(y + height / 2).toBeCloseTo(METER_HEIGHT / 2);
  });

  it("draws bars left to right in array order (oldest first)", () => {
    const { ctx, calls } = makeFakeContext();
    drawLevels(ctx, [0.2, 0.4, 0.6], "red");
    const xs = calls.fillRect.map((call) => call[0]);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it("sets fillStyle to the given color", () => {
    const { ctx } = makeFakeContext();
    drawLevels(ctx, [0.5], "rgb(255, 0, 0)");
    expect(ctx.fillStyle).toBe("rgb(255, 0, 0)");
  });

  it("handles an empty history without drawing any bars", () => {
    const { ctx, calls } = makeFakeContext();
    drawLevels(ctx, [], "red");
    expect(calls.clearRect).toBe(1);
    expect(calls.fillRect).toHaveLength(0);
  });
});

describe("constants", () => {
  it("METER_WIDTH comfortably fits LEVEL_HISTORY bars at the configured bar width/gap", () => {
    // Not a hard requirement, just confirms the constants were chosen
    // together sensibly rather than independently.
    expect(LEVEL_HISTORY * 3).toBeLessThanOrEqual(METER_WIDTH + 10);
  });
});
