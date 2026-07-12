# PLAN -- Voice Transcript

Stage 3 decomposition of `SPEC.md` against `ACCEPTANCE.md`. No implementation here.

The public API of every unit is already pinned by `docs/contract.md` and the
failing tests in `tests/**` (authored in Stage 1). This plan slices that contract
into the smallest units that are independently verifiable against `ACCEPTANCE.md`,
and orders them by dependency so the parallel / isolated-worktree build stage never
depends on an unbuilt feature.

## Module map (from the pinned contract)

| Module        | Public surface                                                                   | Imports from `src/`                              |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `types.ts`    | `Segment`, `TranscriptResult`, `TranscribeParams`, `Transcriber`, `OutputFormat` | none                                             |
| `config.ts`   | `DEFAULT_MODEL`, `MAX_UPLOAD_BYTES`, `CHUNK_TARGET_BYTES`, `MAX_RETRIES`, endpoint/format list | none                                |
| `chunk.ts`    | `planChunks(input)` (pure)                                                        | none (defines `ChunkPlanInput` locally)          |
| `audio.ts`    | `AudioBackend`, `AudioChunk`, `NormalizedAudio`, `FfmpegNotFoundError`, `createFfmpegBackend()` | none (self-contained ffmpeg adapter) |
| `args.ts`     | `CliOptions`, `UsageError`, `parseArgs(argv)`                                     | `types` (`OutputFormat`)                         |
| `formats.ts`  | `render(result, format)`                                                          | `types`                                          |
| `stitch.ts`   | `stitchChunks(chunks)` (pure)                                                     | `types`                                          |
| `groq.ts`     | `GroqClient`, `GroqApiError`                                                      | `types`, `config`                                |
| `pipeline.ts` | `runPipeline(inputFile, deps)`                                                    | `types`, `config`, `chunk`, `audio`, `stitch`    |
| `cli.ts`      | `main(argv, deps)`, `CliDeps`                                                     | `types`, `config`, `args`, `formats`, `audio`, `groq`, `pipeline` |
| `index.ts`    | bin entry (`process.exit(await main(...))`)                                       | `cli`, `audio`, `groq`, `config`                 |

## Features (smallest useful units)

Each feature owns a **disjoint** set of files and is verified by the listed tests /
acceptance IDs. `Wave` = earliest round it can build (a feature may not depend on an
unbuilt feature). Slugs match `state/features.txt` and `state/gates/<slug>` exactly.

| ID  | Feature slug           | Files                    | Depends on             | Verified by (test -> ACCEPTANCE)                            | Wave |
| --- | ---------------------- | ------------------------ | ---------------------- | ---------------------------------------------------------- | ---- |
| F1  | `foundation-contracts` | `types.ts`, `config.ts`  | --                     | typecheck of own files (F3); underpins F4 hygiene invariant | 1    |
| F2  | `chunk-planner`        | `chunk.ts`               | --                     | `chunk.test` -> B1, B2                                      | 1    |
| F3  | `audio-backend`        | `audio.ts`               | --                     | typecheck of own file; behaviour via `cli.test` B4 + E2E (note 3) | 1 |
| F4  | `args-parser`          | `args.ts`                | F1                     | typecheck; behaviour via `cli.test` A1/A4 (note 3)         | 2    |
| F5  | `formats-renderer`     | `formats.ts`             | F1                     | `formats.test` -> C1, C2, C3, C4                           | 2    |
| F6  | `stitch`               | `stitch.ts`              | F1                     | `stitch.test` -> B3                                        | 2    |
| F7  | `groq-client`          | `groq.ts`                | F1                     | `groq.test` -> D1                                          | 2    |
| F8  | `pipeline`             | `pipeline.ts`            | F1, F2, F3, F6, F7     | `pipeline.test` -> B1, B2 (request counts), D2            | 3    |
| F9  | `cli`                  | `cli.ts`                 | F1, F3, F4, F5, F7, F8 | `cli.test` -> A1-A5, B4                                    | 4    |
| F10 | `index-bin`            | `index.ts`               | F9                     | typecheck + integration (E1-E3)                            | 5    |

## Progress

- **Wave 1 -- MERGED to `main`:** F1 `foundation-contracts` (`types.ts`, `config.ts`),
  F2 `chunk-planner` (`chunk.ts`), F3 `audio-backend` (`audio.ts`). Confirmed by the
  three `merge feature/*` commits and by `src/` containing exactly those four files.
- **Wave 2 -- ACTIVE (this `state/features.txt`).** Everything below is still unbuilt.

## Independent set to build now (-> `state/features.txt`)

**Wave 2 = F4, F5, F6, F7.** Each depends only on F1 `foundation-contracts`, which is
now committed in `main`, so all of their prerequisites are satisfied. They touch a
**disjoint** set of files and share no mutable state -- `args.ts` / `formats.ts` /
`stitch.ts` / `groq.ts` -- and none of the four imports another (each imports only the
already-merged `types.ts`, and `groq.ts` also `config.ts`). So they build in parallel
in isolated worktrees. F8-F10 remain **dependent** features and stay in this plan (NOT
in `state/features.txt`) until their prerequisites merge.

```
args-parser
formats-renderer
stitch
groq-client
```

## Build order (waves)

- **Wave 1 (parallel):** F1, F2, F3  -- DONE, merged to `main`.
- **Wave 2 (parallel, after F1 merges):** F4, F5, F6, F7  <- this is `state/features.txt`.
- **Wave 3:** F8 pipeline (needs F1, F2, F3, F6, F7).
- **Wave 4:** F9 cli (needs F1, F3, F4, F5, F7, F8).
- **Wave 5:** F10 index/bin (needs F9).
- **Integration accept (once):** E1-E3 in `tests/e2e/integration.test.ts` with real
  ffmpeg on `PATH` and `GROQ_API_KEY` set.

After each wave, `feature_accept` merges green features to `main` (`--no-ff`, local
only) so the next wave branches from a tree where its prerequisites exist. To advance a
wave, regenerate `state/features.txt` + `state/gates/*` for that wave's now-unblocked
features and rerun `run.sh build`.

## Per-feature gates (`state/gates/<slug>`)

A single-feature worktree contains ONLY that feature's source (branched from `main`,
so it also inherits the already-merged Wave-1 modules `types.ts` / `config.ts`), so the
whole-repo `npm test` / `npm run typecheck` can NEVER pass there (sibling test files
import src modules that do not exist yet). Each **active** feature therefore has a gate
that verifies ONLY its own target(s). The current `state/gates/*` are the Wave-2 gates:

| Feature slug        | Gate runs                                                                     |
| ------------------- | ----------------------------------------------------------------------------- |
| `args-parser`       | typecheck `src/args.ts`; eslint the same (no isolatable unit test -- see note 3) |
| `formats-renderer`  | `vitest run tests/formats.test.ts`; typecheck + eslint `src/formats.ts` (C1-C4) |
| `stitch`            | `vitest run tests/stitch.test.ts`; typecheck + eslint `src/stitch.ts` (B3)     |
| `groq-client`       | `vitest run tests/groq.test.ts`; typecheck + eslint `src/groq.ts` (D1)         |

Each Wave-2 test imports only its own new module plus the already-merged `types.ts`
(`groq.test` also mocks the network), so it runs green in a partial worktree. The
Wave-1 gates (`foundation-contracts`, `chunk-planner`, `audio-backend`) were removed
now that those features are merged; a later wave regenerates `state/gates/*` again.

Typecheck fidelity: each gate writes a throwaway tsconfig in the worktree root that
`extends ./tsconfig.json` (exact project compiler options) but sets `"include": []`
and `"files": [<the feature's files>]`. The `include: []` override is required --
otherwise the base `include: ["src","tests"]` unions in the test files and typecheck
fails on unbuilt modules. The config must live in the worktree root (not `/tmp`) so
`@types/node` resolves from this worktree's `node_modules`. Because a Wave-2 worktree
branches from `main`, the imported Wave-1 modules (`types.ts`, `config.ts`) are present
and `tsc` follows the imports automatically -- listing only the feature's own file in
`files` is sufficient.

## Notes

1. **Foundation is a real prerequisite, not just convenience.** F4-F7 all import
   `types.ts` (and F7 imports `config.ts`). They cannot start until F1 is merged, which
   is why they are Wave 2 and are absent from `state/features.txt`.

2. **Cross-cutting gates are not features.** Lint + no-emoji (ACCEPTANCE F1) and
   `tsc --noEmit` (F3) apply to every feature's own files -- each feature must leave
   lint and typecheck green for the files it adds. The no-hardcoded-key invariant
   (`hygiene.test`, F4) is different: it asserts that SOME `src` file reads
   `process.env.GROQ_API_KEY`, which only becomes true once the env is actually read
   (F9 cli / F10 bin). It is therefore an integration-level invariant, NOT part of any
   Wave-1 feature gate, and stays red until Wave 4. (`npm test` / `npm run lint` /
   `npm run typecheck` over the whole tree are the integration-acceptance gate, not a
   per-feature gate.)

3. **Two units have no isolatable unit test** and are gated by typecheck (+ lint) of
   their own files, then verified behaviourally at a later wave:
   - `audio.ts` (F3): its `AudioBackend` contract is exercised through mocks in
     `cli.test` / `pipeline.test`; the real ffmpeg adapter is proven only at
     integration (E1-E3) and its `FfmpegNotFoundError` path at B4 (cli, Wave 4).
   - `args.ts` (F4): `parseArgs` is exercised through `cli.test` (A1 usage,
     A4 format validation) at Wave 4.
   This is a deliberate consequence of the ports-and-adapters shape, not missing
   coverage.

4. **Config carries two distinct thresholds** by design: `CHUNK_TARGET_BYTES` (~24 MB,
   the planning threshold passed to `planChunks` as `maxBytes`) and `MAX_UPLOAD_BYTES`
   (25 MB, the hard cap asserted by E2). Keep both; do not collapse them.

5. **Validation ordering in `cli.main`** must be exactly: `parseArgs` ->
   `fileExists(input)` -> `GROQ_API_KEY` present -> `audio.assertAvailable` ->
   `runPipeline` -> `render` -> stdout | writeFile. This ordering is what makes A2
   (no API/ffmpeg call on missing file) and A3 (no ffmpeg/API call on missing key)
   pass. The transcript never touches stdout when `-o` is given; only logs/errors go
   to stderr (A5).
