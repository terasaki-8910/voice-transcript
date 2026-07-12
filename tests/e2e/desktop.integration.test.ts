// ACCEPTANCE G4, G5 -- cross-cutting desktop-GUI behaviour. Per
// prompts/04-build.md, "cross-cutting / e2e tests belong to integration
// acceptance, not to any one feature": this file is NOT a per-feature build
// gate (it is not referenced by any state/gates/<feature> or
// state/features.txt entry) and, unlike tests/e2e/integration.test.ts, it
// does NOT describe.skipIf(...) -- it must fail deterministically and
// offline so it actually gates something at integration acceptance.
//
// G4/G5 depend on interfaces that don't exist yet (the desktop app, its
// invoke() commands, the multi-file queue). Writing a real assertion now
// would mean guessing at that design ahead of the feature that owns it, so
// each item below is a deliberate, zero-guessing expect.unreachable(...)
// placeholder -- genuinely red (unlike `it.todo`, which doesn't fail and
// gates nothing) -- to be replaced with a real assertion when
// apps/desktop is built.
//
// Also recorded here (not as a separate doc, to keep criteria's output to
// exactly failing_tests + lint_config per pipeline.yaml): two ACCEPTANCE
// items in this same G section are intentionally NOT vitest files at all --
//   G1 -- desktop app builds a runnable bundle on windows-latest /
//         ubuntu-latest / macos-latest: verified by the CI build matrix,
//         not a unit test.
//   G3 -- apps/desktop/src-tauri/capabilities/*.json grants are no broader
//         than what registered #[tauri::command]s use: checked by the
//         .claude/agents/tauri-capability-reviewer.md subagent at feature
//         acceptance, not a standalone unit test.
import { describe, it, expect } from "vitest";

describe("G4 - GUI/CLI parity (both call packages/core)", () => {
  it("transcribing the same file+options via the GUI and the CLI yields byte-identical text", () => {
    expect.unreachable(
      "G4 not implemented: assert that invoking the desktop app's transcribe " +
        "command and running the CLI on the same file with the same options " +
        "(model/language/format) produce byte-identical transcript text -- " +
        "both must go through packages/core, never a duplicated code path.",
    );
  });
});

describe("G5 - multi-file queue isolates per-item failure", () => {
  it("one failed file in a queue of N does not abort the other N-1", () => {
    expect.unreachable(
      "G5 not implemented: assert that queuing N files where one fails " +
        "(e.g. an unsupported format) still transcribes the other N-1 to " +
        "completion, and the failed item is reported, not silently dropped " +
        "and not fatal to the queue (extends D2's no-silent-drop principle).",
    );
  });
});
