// Pins how the sidecar's PipelineEvents fold into a queue row's progress
// (src/features/queue/queueProgress.ts).
import { describe, it, expect } from "vitest";
import { applyProgressEvent, latestResume } from "../../src/features/queue/queueProgress";
import type { QueueProgress } from "../../src/features/queue/queueProgress";

describe("applyProgressEvent", () => {
  it("records the hourly-budget notice, the plan, and finished parts", () => {
    let p: QueueProgress | undefined;
    p = applyProgressEvent(p, { type: "over-hourly-budget", audioSeconds: 9000, budgetSeconds: 7200 });
    p = applyProgressEvent(p, { type: "chunks-planned", total: 5 });
    p = applyProgressEvent(p, { type: "chunk-done", chunk: 2, done: 1, total: 5 });
    expect(p).toEqual({ overBudget: { audioSeconds: 9000, budgetSeconds: 7200 }, total: 5, done: 1, waits: {} });
  });

  it("tracks each waiting chunk and drops it once that chunk finishes", () => {
    let p = applyProgressEvent(undefined, { type: "chunks-planned", total: 5 });
    p = applyProgressEvent(p, { type: "rate-limit-wait", chunk: 4, total: 5, waitSeconds: 990, resumeAt: "2026-10-12T10:16:30.000Z" });
    p = applyProgressEvent(p, { type: "rate-limit-wait", chunk: 5, total: 5, waitSeconds: 1000, resumeAt: "2026-10-12T10:16:40.000Z" });
    expect(latestResume(p)).toBe("2026-10-12T10:16:40.000Z");

    p = applyProgressEvent(p, { type: "chunk-done", chunk: 5, done: 4, total: 5 });
    expect(latestResume(p)).toBe("2026-10-12T10:16:30.000Z");
    p = applyProgressEvent(p, { type: "chunk-done", chunk: 4, done: 5, total: 5 });
    expect(latestResume(p)).toBeUndefined();
  });
});
