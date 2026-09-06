// Recording has no duration cap (SPEC.md > Microphone recording), so the
// elapsed-time display must scale cleanly past an hour, not just MM:SS.
import { describe, it, expect } from "vitest";
import { formatElapsed } from "../../src/features/recording/formatElapsed";

describe("formatElapsed", () => {
  it("formats sub-minute durations as MM:SS", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5)).toBe("00:05");
    expect(formatElapsed(59)).toBe("00:59");
  });

  it("formats minutes as MM:SS", () => {
    expect(formatElapsed(60)).toBe("01:00");
    expect(formatElapsed(125)).toBe("02:05");
    expect(formatElapsed(3599)).toBe("59:59");
  });

  it("switches to H:MM:SS past one hour -- no duration cap means this must not wrap or break", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(3661)).toBe("1:01:01");
    expect(formatElapsed(7325)).toBe("2:02:05");
  });

  it("handles a very long recording (multi-hour) without overflow", () => {
    expect(formatElapsed(10 * 3600 + 61)).toBe("10:01:01");
  });

  it("floors fractional seconds and clamps negative input to zero", () => {
    expect(formatElapsed(5.9)).toBe("00:05");
    expect(formatElapsed(-3)).toBe("00:00");
  });
});
