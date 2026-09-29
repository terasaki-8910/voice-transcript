// placePopover is pure and plain-number-based specifically so its
// placement logic can be pinned without fighting jsdom, which does no real
// layout (see useClampedPopoverPosition.ts).
import { describe, it, expect } from "vitest";
import { placePopover } from "../../src/features/notes/useClampedPopoverPosition";

const viewport = { width: 1024, height: 768 };
const MARGIN = 8;

describe("placePopover", () => {
  it("places below the anchor when there's room", () => {
    const anchor = { top: 100, bottom: 120, left: 200, right: 300 };
    const result = placePopover(anchor, { width: 260, height: 150 }, viewport);
    expect(result).toEqual({ top: 126, left: 200 });
  });

  it("flips above the anchor when there's no room below but room above", () => {
    const anchor = { top: 650, bottom: 670, left: 200, right: 300 };
    const result = placePopover(anchor, { width: 260, height: 150 }, viewport);
    expect(result).toEqual({ top: 494, left: 200 });
  });

  it("pins to the bottom margin when neither side fully fits", () => {
    // Anchor near vertical center of a short viewport -- below overflows
    // (670+400 > 768-8) and above doesn't fit either (300-6-400 < 8).
    const anchor = { top: 300, bottom: 320, left: 200, right: 300 };
    const result = placePopover(anchor, { width: 260, height: 400 }, { width: 1024, height: 500 });
    expect(result.top).toBe(500 - 8 - 400);
  });

  it("clamps to the top margin when the popover is taller than the viewport", () => {
    const anchor = { top: 10, bottom: 30, left: 200, right: 300 };
    const result = placePopover(anchor, { width: 260, height: 900 }, viewport);
    expect(result.top).toBe(MARGIN);
  });

  it("clamps against the right edge for a selection near the right side", () => {
    const anchor = { top: 100, bottom: 120, left: 900, right: 1000 };
    const result = placePopover(anchor, { width: 260, height: 150 }, viewport);
    expect(result.left).toBe(1024 - 8 - 260);
  });

  it("clamps against the left edge for a selection near the left side", () => {
    const anchor = { top: 100, bottom: 120, left: 2, right: 50 };
    const result = placePopover(anchor, { width: 260, height: 150 }, viewport);
    expect(result.left).toBe(8);
  });
});
