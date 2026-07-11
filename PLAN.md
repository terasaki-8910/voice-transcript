# PLAN — Voice Transcript

Stage 3 decomposition of `SPEC.md` against `ACCEPTANCE.md`. No implementation here.

The public API of every unit is already pinned by `docs/contract.md` and the
failing tests in `tests/**`. This plan slices that contract into the smallest
units that are independently verifiable against `ACCEPTANCE.md`, and orders them
by dependency so the parallel/isolated-worktree build stage never depends on an
unbuilt feature.

## Module map (from the pinned contract)

| Module          | Public surface                                   | Imports from `src/`                    |
| --------------- | ------------------------------------------------ | -------------------------------------- |
| `types.ts`      | `Segment`, `TranscriptResult`, `TranscribeParams`, `Transcriber`, `OutputFormat` | none |
| `config.ts`     | `DEFAULT_MODEL`, `MAX_UPLOAD_BYTES`, `CHUNK_TARGET_BYTES`, `MAX_RETRIES`, endpoint/format list | none |
| `chunk.ts`      | `planChunks(input)` (pure)                        | none (defines `ChunkPlanInput` locally) |
| `audio.ts`      | `AudioBackend`, `AudioChunk`, `NormalizedAudio`, `FfmpegNotFoundError`, `createFfmpegBackend()` | none (self-contained ffmpeg adapter) |
| `args.ts`       | `CliOptions`, `UsageError`, `parseArgs(argv)`     | `types` (`OutputFormat`)               |
| `formats.ts`    | `render(result, format)`                          | `types`                                |
| `stitch.ts`     | `stitchChunks(chunks)` (pure)                     | `types`                                |
| `groq.ts`       | `GroqClient`, `GroqApiError`                       | `types`, `config`                      |
| `pipeline.ts`   | `runPipeline(inputFile, deps)`                    | `types`, `config`, `chunk`, `audio`, `stitch` |
| `cli.ts`        | `main(argv, deps)`, `CliDeps`                     | `types`, `config`, `args`, `formats`, `audio`, `groq`, `pipeline` |
| `index.ts`      | bin entry (`process.exit(await main(...))`)       | `cli`, `audio`, `groq`, `config`       |

## Features (smallest useful units)

Each feature owns a disjoint set of files and is verified by the listed
tests / acceptance IDs. Wave = earliest round it can build (a feature may not
depend on an unbuilt feature).

| ID  | Feature slug            | Files                        | Depends on        | Verified by (test → ACCEPTANCE)                              | Wave |
| --- | ----------------------- | ---------------------------- | ----------------- | ----------------------------------------------------------- | ---- |
| F1  | `foundation-contracts`  | `types.ts`, `config.ts`      | —                 | `typecheck`; `hygiene.test` needs these present (F3, F4)     | 1    |
| F2  | `chunk-planner`         | `chunk.ts`                   | —                 | `chunk.test` → B1, B2                                        | 1    |
| F3  | `audio-backend`         | `audio.ts`                   | —                 | `typecheck`; behaviour via `cli.test` B4 + E2E (see note 3)  | 1    |
| F4  | `args-parser`           | `args.ts`                    | F1                | `typecheck`; behaviour via `cli.test` A1/A4 (see note 3)     | 2    |
| F5  | `formats-renderer`      | `formats.ts`                 | F1                | `formats.test` → C1, C2, C3, C4                              | 2    |
| F6  | `stitch`                | `stitch.ts`                  | F1                | `stitch.test` → B3                                           | 2    |
| F7  | `groq-client`           | `groq.ts`                    | F1                | `groq.test` → D1                                             | 2    |
| F8  | `pipeline`              | `pipeline.ts`                | F1, F2, F3, F6, F7 | `pipeline.test` → B1, B2 (request counts), D2              | 3    |
| F9  | `cli`                   | `cli.ts`                     | F1, F3, F4, F5, F7, F8 | `cli.test` → A1-A5, B4                                  | 4    |
| F10 | `index-bin`             | `index.ts`                   | F9                | `typecheck` + integration (E1-E3)                           | 5    |

## Independent set to build now (→ `features.txt`)

Only F1, F2, F3 have zero dependency on an unbuilt feature and touch disjoint
files, so only they may build in parallel in the first round. They share no
mutable state (`types.ts`+`config.ts` / `chunk.ts` / `audio.ts` are disjoint).
Everything else is a **dependent** feature and stays in this plan until its
prerequisites merge to `main` — per pipeline rules it does NOT go in
`features.txt` yet.

## Build order (waves)

- **Wave 1 (parallel):** F1, F2, F3  ← this is `features.txt`.
- **Wave 2 (parallel, after F1 merges):** F4, F5, F6, F7 (each depends only on F1).
- **Wave 3:** F8 pipeline (needs F1, F2, F3, F6, F7).
- **Wave 4:** F9 cli (needs F1, F3, F4, F5, F7, F8).
- **Wave 5:** F10 index/bin (needs F9).
- **Integration accept (once):** E1-E3 in `tests/e2e/integration.test.ts` with
  real ffmpeg on `PATH` and `GROQ_API_KEY` set.

After each wave, `feature_accept` merges green features to `main` (`--no-ff`,
local only) so the next wave branches from a tree where its prerequisites exist.

## Notes

1. **Foundation is a real prerequisite, not just convenience.** F4-F7 all import
   `types.ts` (and F7 imports `config.ts`). They cannot start until F1 is merged,
   which is why they are Wave 2 and are absent from `features.txt`.

2. **Cross-cutting gates are not features.** Lint + no-emoji (F1/ACCEPTANCE),
   `tsc --noEmit` (F3/ACCEPTANCE), and the no-hardcoded-key invariant
   (`hygiene.test`, F4/ACCEPTANCE) apply to every feature's own files. Each
   feature must leave lint and typecheck green for the files it adds. The
   hygiene invariant "some file reads `process.env.GROQ_API_KEY`" only turns
   green once the env is actually read (F9 cli / F10 bin) — expect it red until
   Wave 4.

3. **Two units have no dedicated unit test** and are verified by typecheck in
   isolation, then behaviourally at a later wave:
   - `audio.ts` (F3): its `AudioBackend` contract is exercised through mocks in
     `cli.test`/`pipeline.test`; the real ffmpeg adapter is only proven at
     integration (E1-E3) and its `FfmpegNotFoundError` path at B4 (Wave 4).
   - `args.ts` (F4): `parseArgs` is exercised through `cli.test` (A1 usage,
     A4 format validation) at Wave 4.
   Their Wave-1/2 gate is therefore typecheck + contract conformance, with full
   behavioural verification deferred to the wave that consumes them. This is a
   deliberate consequence of the ports-and-adapters shape, not missing coverage.

4. **Per-worktree test scoping.** `npm test`/`tsc` over the whole tree fails in a
   partial worktree because not-yet-built test files import missing modules. The
   build harness must gate each feature on its own target(s) — e.g.
   `vitest run tests/chunk.test.ts` for F2 — or run waves in dependency order so
   the growing suite stays green. Feature→test mapping is the table above.

5. **Config constants carry two thresholds** by design: `CHUNK_TARGET_BYTES`
   (~24 MB, the planning threshold passed to `planChunks` as `maxBytes`) and
   `MAX_UPLOAD_BYTES` (25 MB, the hard cap asserted by E2). Keep both; do not
   collapse them.

6. **Validation ordering in `cli.main`** must be exactly: `parseArgs` →
   `fileExists(input)` → `GROQ_API_KEY` present → `audio.assertAvailable` →
   `runPipeline` → `render` → stdout | writeFile. This ordering is what makes
   A2 (no API/ffmpeg call on missing file) and A3 (no ffmpeg/API call on missing
   key) pass. The transcript never touches stdout when `-o` is given, and only
   logs/errors go to stderr (A5).
