// ACCEPTANCE F4: no hardcoded API key in the repo; the key is read only from
// process.env.GROQ_API_KEY. This is a static guard over src/**.
//
// Note: unlike the behavioural tests, F4 is an invariant. It fails now because
// src/ does not yet exist (the positive requirement below cannot be satisfied),
// and it stays green once the CLI reads the key from the environment.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

function readSourceFiles(): { path: string; text: string }[] {
  let entries: string[];
  try {
    entries = readdirSync(SRC, { recursive: true }) as string[];
  } catch {
    return []; // src/ absent -> empty; assertions below will fail (red).
  }
  return entries
    .filter((e) => e.endsWith(".ts"))
    .map((e) => ({ path: e, text: readFileSync(join(SRC, e), "utf8") }));
}

describe("F4 - API key handling", () => {
  const files = readSourceFiles();

  it("has source files to inspect", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains no hardcoded Groq API key literal (gsk_...)", () => {
    const offenders = files.filter((f) => /gsk_[A-Za-z0-9]{8,}/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("reads the key from process.env.GROQ_API_KEY", () => {
    const readsEnv = files.some((f) => f.text.includes("process.env.GROQ_API_KEY"));
    expect(readsEnv).toBe(true);
  });
});
