// ACCEPTANCE G2: static scan of the webview source tree (apps/desktop/src/**,
// excluding src-tauri/) finds no GROQ_API_KEY, no DATABASE_URL/DB credential
// literal, and no direct network call to api.groq.com. Mirrors F4's
// grep-enforced pattern (tests/hygiene.test.ts), extended to the GUI's trust
// boundary: the webview must never hold a secret or talk to Groq/Postgres
// directly -- all of that goes through apps/desktop/src-tauri (see
// .claude/agents/tauri-capability-reviewer.md).
//
// Note: unlike the behavioural tests, G2 is an invariant. It fails now
// because apps/desktop/src/ does not yet exist (the positive "has files"
// requirement below cannot be satisfied), and it stays green once the
// webview is built without leaking secrets across the IPC boundary.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Rooting at ".../src/" (not "apps/desktop/") inherently excludes the sibling
// "apps/desktop/src-tauri/" directory -- no extra filtering needed.
const WEBVIEW_SRC = new URL("../apps/desktop/src/", import.meta.url).pathname;

function readWebviewFiles(): { path: string; text: string }[] {
  let entries: string[];
  try {
    entries = readdirSync(WEBVIEW_SRC, { recursive: true }) as string[];
  } catch {
    return []; // apps/desktop/src absent -> empty; assertions below fail (red).
  }
  return entries
    .filter((e) => /\.(ts|tsx|js|jsx)$/.test(e))
    .map((e) => ({ path: e, text: readFileSync(join(WEBVIEW_SRC, e), "utf8") }));
}

describe("G2 - webview never holds secrets or talks to Groq/DB directly", () => {
  const files = readWebviewFiles();

  it("has webview source files to inspect", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains no GROQ_API_KEY reference", () => {
    const offenders = files.filter((f) => f.text.includes("GROQ_API_KEY"));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("contains no DATABASE_URL or hardcoded DB connection string", () => {
    const CONN_STRING = /(?:postgres(?:ql)?|mysql):\/\//;
    const offenders = files.filter(
      (f) => f.text.includes("DATABASE_URL") || CONN_STRING.test(f.text),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("makes no direct reference to api.groq.com", () => {
    const offenders = files.filter((f) => f.text.includes("api.groq.com"));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});
