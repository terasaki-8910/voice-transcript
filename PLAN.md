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
- **Wave 2 -- MERGED to `main`:** F4 `args-parser` (`args.ts`), F5 `formats-renderer`
  (`formats.ts`), F6 `stitch` (`stitch.ts`), F7 `groq-client` (`groq.ts`). Confirmed by
  the four `merge feature/*` commits (`args-parser`, `formats-renderer`, `stitch`,
  `groq-client`) and by `src/` now containing all eight Wave-1+2 modules.
- **Wave 3 -- MERGED to `main`:** F8 `pipeline` (`pipeline.ts`). Confirmed by the
  `merge feature/pipeline` + `feat(pipeline): add runPipeline orchestration (F8)`
  commits and by `src/` now containing all nine Wave-1..3 modules (`types`, `config`,
  `chunk`, `audio`, `args`, `formats`, `stitch`, `groq`, `pipeline`).
- **Wave 4 -- MERGED to `main`:** F9 `cli` (`cli.ts`). Confirmed by the
  `merge feature/cli` + `feat(cli): add main(argv, deps) wiring args/audio/
  pipeline/formats (F9)` commits and by `src/` now containing all ten Wave-1..4
  modules (`types`, `config`, `chunk`, `audio`, `args`, `formats`, `stitch`,
  `groq`, `pipeline`, `cli`) -- i.e. every module except `index.ts`.
- **Wave 5 -- ACTIVE (this `state/features.txt`).** Only F10 `index-bin`
  (`index.ts`) is now buildable; it is the LAST unbuilt feature. After it merges,
  every feature in this plan exists in `main`, so the next plan run writes an
  EMPTY `state/features.txt` and the driver proceeds to integration acceptance.

## Independent set to build now (-> `state/features.txt`)

**Wave 5 = F10 `index-bin` (single feature).** `index.ts` depends only on F9 `cli`
(`cli.ts`) -- plus the already-merged `audio.ts`, `groq.ts`, `config.ts` it re-exports
into the bin -- all now committed in `main`, so every prerequisite is satisfied. It is
the LAST unbuilt feature in the plan, so this final wave is necessarily a single feature
(the `cli` -> `index` tail of the dependency chain is inherently serial).

Behaviourally, `index.ts` is the bin entry that reads `process.env` and calls
`main(process.argv.slice(2))`. It is also the file that finally satisfies the F4
key-handling invariant: NO merged module contains the literal
`process.env.GROQ_API_KEY` yet (`cli.ts` reads via the injected `deps.env`, defaulting
to `process.env`, and references `env.GROQ_API_KEY` -- not the concatenated literal
`hygiene.test` greps for). So `index.ts` must wire the real environment such that the
string `process.env.GROQ_API_KEY` appears in `src/**`, and `hygiene.test` is its gate.

```
index-bin
```

## Build order (waves)

- **Wave 1 (parallel):** F1, F2, F3  -- DONE, merged to `main`.
- **Wave 2 (parallel, after F1 merges):** F4, F5, F6, F7  -- DONE, merged to `main`.
- **Wave 3:** F8 pipeline (needs F1, F2, F3, F6, F7)  -- DONE, merged to `main`.
- **Wave 4:** F9 cli (needs F1, F3, F4, F5, F7, F8)  -- DONE, merged to `main`.
- **Wave 5:** F10 index/bin (needs F9)  <- this is `state/features.txt`.
- **Integration accept (once):** E1-E3 in `tests/e2e/integration.test.ts` with real
  ffmpeg on `PATH` and `GROQ_API_KEY` set.

After each wave, `feature_accept` merges green features to `main` (`--no-ff`, local
only) so the next wave branches from a tree where its prerequisites exist. To advance a
wave, regenerate `state/features.txt` + `state/gates/*` for that wave's now-unblocked
features and rerun `run.sh build`.

## Per-feature gates (`state/gates/<slug>`)

A single-feature worktree contains ONLY that feature's source (branched from `main`, so
it also inherits the already-merged Wave-1..4 modules), so the whole-repo `npm test` /
`npm run typecheck` can NEVER pass there (sibling test files -- e.g. the e2e suite --
import behaviour that is exercised only with real ffmpeg / network). Each **active**
feature therefore has a gate that verifies ONLY its own target(s). The current
`state/gates/*` is the Wave-5 gate:

| Feature slug | Gate runs                                                                       |
| ------------ | ------------------------------------------------------------------------------- |
| `index-bin`  | `vitest run tests/hygiene.test.ts`; typecheck + eslint `src/index.ts` (F4, F3, F1) |

`hygiene.test` (ACCEPTANCE F4) imports NO `src/` module -- it reads every `src/**/*.ts`
off disk with `node:fs` and asserts statically: (a) source files exist, (b) no hardcoded
`gsk_...` key literal, (c) some file contains `process.env.GROQ_API_KEY`. In a Wave-5
worktree every Wave-1..4 module plus the new `index.ts` is present, so it runs green in a
partial worktree -- and assertion (c) flips from red to green EXACTLY when `index.ts`
wires the real env. That is why `hygiene.test` is F10's own gate, not a whole-tree
concern: it is the machine check that this feature satisfies the F4 invariant. (The e2e
suite still imports `../src/cli.js`, not `index.ts`, and remains integration-only.)

Typecheck fidelity: the gate writes a throwaway tsconfig in the worktree root that
`extends ./tsconfig.json` (exact project compiler options) but sets `"include": []`
and `"files": ["./src/index.ts"]`. The `include: []` override is required -- otherwise
the base `include: ["src","tests"]` unions in the test files and typecheck fails on the
still-red e2e/hygiene expectations. The config must live in the worktree root (not
`/tmp`) so `@types/node` resolves from this worktree's `node_modules`. Because a Wave-5
worktree branches from `main`, every module `index.ts` imports (`cli.ts`, `audio.ts`,
`groq.ts`, `config.ts`) is present and `tsc` follows the imports automatically -- listing
only `index.ts` in `files` is sufficient. This is the final wave; after F10 merges there
are no more `state/gates/*` to regenerate.

## Notes

1. **Foundation is a real prerequisite, not just convenience.** F4-F7 all import
   `types.ts` (and F7 imports `config.ts`). They cannot start until F1 is merged, which
   is why they are Wave 2 and are absent from `state/features.txt`.

2. **Cross-cutting gates are not features.** Lint + no-emoji (ACCEPTANCE F1) and
   `tsc --noEmit` (F3) apply to every feature's own files -- each feature must leave
   lint and typecheck green for the files it adds. The no-hardcoded-key invariant
   (`hygiene.test`, F4) asserts that SOME `src` file contains the literal
   `process.env.GROQ_API_KEY`. Confirmed at plan time: NO merged Wave-1..4 module
   contains that literal (`cli.ts` reads via the injected `deps.env` and references
   `env.GROQ_API_KEY`, not the concatenated string), so assertion (c) stays red through
   Wave 4 and flips green only when F10 `index.ts` wires `process.env`. That makes
   `hygiene.test` the natural per-feature gate for F10 (Wave 5) -- it is included in
   `state/gates/index-bin` above. (`npm test` / `npm run lint` / `npm run typecheck`
   over the whole tree remain the final integration-acceptance gate, not a per-feature
   gate.)

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
