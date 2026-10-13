// Pins parseArgs in src/args.ts, focused on the --trim-silence flag.
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/args.js";

describe("--trim-silence", () => {
  it("defaults to off", () => {
    expect(parseArgs(["a.m4a"]).trimSilence).toBe(false);
  });

  it("turns on when present, before or after the input", () => {
    expect(parseArgs(["a.m4a", "--trim-silence"]).trimSilence).toBe(true);
    expect(parseArgs(["--trim-silence", "a.m4a"]).trimSilence).toBe(true);
  });

  it("takes no value, so the next argument is still the input", () => {
    const options = parseArgs(["--trim-silence", "file.m4a"]);
    expect(options.input).toBe("file.m4a");
    expect(options.trimSilence).toBe(true);
  });

  it("combines with other options", () => {
    const options = parseArgs(["a.m4a", "--trim-silence", "--format", "srt"]);
    expect(options).toMatchObject({ input: "a.m4a", format: "srt", trimSilence: true });
  });
});
