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
- **Wave 5 -- MERGED to `main`:** F10 `index-bin` (`index.ts`). Confirmed by the
  `merge feature/index-bin` (`065a603`) + `feat(index): add bin entry wiring
  process.env.GROQ_API_KEY into main (F10)` (`228a9cf`) commits, by
  `git cat-file -e HEAD:src/index.ts`, and by `src/` now containing all ten
  Wave-1..5 modules (`types`, `config`, `chunk`, `audio`, `args`, `formats`,
  `stitch`, `groq`, `pipeline`, `cli`, `index`) -- i.e. EVERY module in the plan.
- **BUILD COMPLETE (this plan run).** Every feature F1..F10 in this plan now
  exists in `main` and the working tree is clean. Per the Stage 3 rule, this plan
  run therefore writes an **EMPTY `state/features.txt`** -- the signal for the
  driver to stop the build stage and proceed to one-time integration acceptance
  (E1-E3, real ffmpeg + `GROQ_API_KEY`). There is no next wave to schedule; there
  are no `state/gates/*` to regenerate. Re-running plan again will re-observe an
  all-built tree and keep `state/features.txt` empty (idempotent).

## Independent set to build now (-> `state/features.txt`)

**Nothing to build -- `state/features.txt` is EMPTY.** All ten features F1..F10 are
merged to `main`; there is no unbuilt feature whose dependencies are satisfied, because
there is no unbuilt feature at all. The empty file is the terminal signal: the driver
stops the build stage and advances to one-time integration acceptance.

(For the historical record, the final wave was Wave 5 = F10 `index-bin`, a single
feature -- the `cli` -> `index` tail of the dependency chain is inherently serial.
`index.ts` is the bin entry that reads `process.env` and calls
`main(process.argv.slice(2))`; it is the file that finally satisfied the F4
key-handling invariant by making the literal `process.env.GROQ_API_KEY` appear in
`src/**`, gated by `hygiene.test`. It is now merged.)

```
(empty)
```

## Build order (waves)

- **Wave 1 (parallel):** F1, F2, F3  -- DONE, merged to `main`.
- **Wave 2 (parallel, after F1 merges):** F4, F5, F6, F7  -- DONE, merged to `main`.
- **Wave 3:** F8 pipeline (needs F1, F2, F3, F6, F7)  -- DONE, merged to `main`.
- **Wave 4:** F9 cli (needs F1, F3, F4, F5, F7, F8)  -- DONE, merged to `main`.
- **Wave 5:** F10 index/bin (needs F9)  -- DONE, merged to `main`.
- **Integration accept (once):** E1-E3 in `tests/e2e/integration.test.ts` with real
  ffmpeg on `PATH` and `GROQ_API_KEY` set  <- NOW ACTIVE (all features merged;
  `state/features.txt` is empty).

After each wave, `feature_accept` merges green features to `main` (`--no-ff`, local
only) so the next wave branches from a tree where its prerequisites exist. To advance a
wave, regenerate `state/features.txt` + `state/gates/*` for that wave's now-unblocked
features and rerun `run.sh build`.

## Per-feature gates (`state/gates/<slug>`)

A single-feature worktree contains ONLY that feature's source (branched from `main`, so
it also inherits the already-merged Wave-1..4 modules), so the whole-repo `npm test` /
`npm run typecheck` can NEVER pass there (sibling test files -- e.g. the e2e suite --
import behaviour that is exercised only with real ffmpeg / network). Each **active**
feature therefore has a gate that verifies ONLY its own target(s). With
`state/features.txt` now EMPTY, there is no active feature and thus **no gate to
regenerate** -- the driver reads gates only for slugs listed in `features.txt`.
`state/gates/index-bin` remains on disk as the (now inert) record of the final wave:

| Feature slug | Gate runs (historical -- Wave 5, F10)                                            |
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

---

# New scope -- desktop GUI + history DB + release (Waves 6+)

The original F1-F10 above (CLI, Waves 1-5) are **BUILD COMPLETE** and stay as
the historical record. This section extends the same contract to the scope added
this session: the pnpm monorepo migration, `packages/core` engine extraction,
`packages/cli`, the Postgres-backed history layer, the Tauri desktop app and its
sidecar, and the manual release workflow. Same table columns; IDs continue at
F11, waves continue at Wave 6.

## Target layout (from SPEC.md > Architecture)

| Workspace member | Role | Notes |
| ---------------- | ---- | ----- |
| `packages/core` | engine (ffmpeg normalize, silence chunk, Groq client+retry, stitch, format renderers) + `src/db` history layer | no UI, no secrets in the DB read path except env; both callers depend on it, never re-implemented |
| `packages/cli`  | existing `transcribe` command, thin wrapper over core | behaviour UNCHANGED (A1-A5, B4, C1-C4) |
| `apps/desktop`  | Tauri app: `src-tauri/` Rust shell + React/Vite webview; runs core as a Node **sidecar** | webview never touches secrets/fs/DB directly (G2) |

## Features (smallest useful units)

| ID  | Feature slug         | Files                                                                                                                                                     | Depends on   | Verified by (test -> ACCEPTANCE)                                                                 | Wave |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- | ---- |
| F11 | `monorepo-core`      | `pnpm-workspace.yaml`; `packages/core/{package.json,tsconfig.json,vitest.config.ts}`; `packages/core/src/{types,config,chunk,audio,formats,stitch,groq,pipeline}.ts`; `packages/core/tests/{chunk,formats,stitch,groq,pipeline}.test.ts`; root `package.json` (workspace root). COPIES engine in; leaves root `src/`+tests intact. | --           | `packages/core/tests/*` -> B1,B2,B3,C1-C4,D1,D2; typecheck of the 8 engine files (F3); eslint (F1) | 6    |
| F12 | `cli-package`        | `packages/cli/{package.json,tsconfig.json}`; `packages/cli/src/{args,cli,index}.ts`; `packages/cli/tests/{cli,hygiene}.test.ts`; REMOVES root `src/**` + root engine/cli/hygiene test files                                             | F11          | `packages/cli/tests/cli.test.ts` -> A1-A5,B4; relocated `hygiene.test` -> F4; typecheck+eslint (F1,F3) | 7    |
| F13 | `core-db`            | `packages/core/src/db/{schema,client,history,index}.ts` + `packages/core/src/db/migrations/*.sql`; `packages/core/package.json` (+ORM/pg dep)             | F11          | `tests/db-hygiene.test.ts` -> H3,H4; typecheck+eslint of `db/**`. H1/H2/H5 -> integration          | 7    |
| F14 | `tauri-scaffold`     | `apps/desktop/{package.json,vite.config.ts,tsconfig.json,index.html}`; `apps/desktop/src/{main.tsx,App.tsx,styles/*}`; `apps/desktop/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,src/main.rs,src/lib.rs,capabilities/default.json}` | F11          | `tests/desktop-hygiene.test.ts` -> G2; typecheck+eslint incl `no-hardcoded-hex` (F1,F3). G1 (CI matrix), G3 (capability-reviewer subagent) NOT vitest | 7    |
| F15 | `desktop-ipc`        | `apps/desktop/src-tauri/src/commands.rs` (+`lib.rs` register); Node sidecar entry (`packages/core/src/sidecar.ts`) + sidecar bundling in `tauri.conf.json`; `apps/desktop/src/lib/tauri.ts` (invoke wrappers)                          | F11,F13,F14  | `tauri-capability-reviewer` (G3+secret boundary); `desktop-hygiene` stays green (G2); cargo+TS checks. G4,H1,H2,H5 -> integration | 8    |
| F16 | `cli-history-wiring` | `packages/cli/src/cli.ts` (inject core-db HistoryStore; persist every CLI run; loud-but-non-blocking on DB failure)                                        | F12,F13      | H1,H5 (CLI path) -> integration (`history.integration.test.ts`) / injected-dep unit test; typecheck+eslint | 8    |
| F17 | `gui-queue`          | `apps/desktop/src/features/queue/**`                                                                                                                       | F15          | G5 -> NOT vitest (exercised in built app + `desktop.integration.test.ts`); typecheck/eslint/no-hex | 9    |
| F18 | `gui-history`        | `apps/desktop/src/features/history/**`; trash/delete commands in `src-tauri/src/commands.rs`                                                               | F15          | G7,G9,H2 -> NOT vitest (built app / integration); `tauri-capability-reviewer` for new fs/trash grants | 9    |
| F19 | `gui-i18n`           | `apps/desktop/src/i18n/**` + language-setting store                                                                                                        | F14          | G6 -> NOT vitest (exercised in built app); typecheck/eslint                                       | 9    |
| F20 | `gui-theme`          | `apps/desktop/src/theme/**`                                                                                                                                | F14          | design-gate confirmed; NOT vitest (built app); `no-hardcoded-hex` enforces tokens                | 9    |
| F21 | `native-menu`        | `apps/desktop/src-tauri/src/menu.rs` (+register); menu->command handlers                                                                                   | F15          | G8 -> NOT vitest (exercised via native OS menu in built app); `tauri-capability-reviewer`         | 9/10 |
| --  | `release-workflow`   | `.github/workflows/release.yml` + README regen                                                                                                             | ALL merged   | I1-I3 -> run once as a manual smoke test. **Post-build only**, per CLAUDE.md > Release -- never a build-wave feature | post-build |

## Progress (new scope)

- **Wave 6 -- MERGED to `main`:** F11 `monorepo-core`. Gate green (19/19 unit
  tests, typecheck, lint). Merged as `feature/monorepo-core` --no-ff.
- **Wave 7 -- PARTIAL:**
  - F12 `cli-package` -- MERGED. Gate green (14/14: cli.test.ts + hygiene.test.ts).
    Also corrected ACCEPTANCE F4's scope note (packages/cli, not packages/core --
    that's where the `process.env.GROQ_API_KEY` literal actually lives).
  - F13 `core-db` -- MERGED. Gate green (5/5 db-hygiene.test.ts H3/H4, typecheck,
    lint). Drizzle schema + client + history functions + an initial migration.
  - F14 `tauri-scaffold` -- MERGED, once Rust/pnpm became available. Tauri v2
    app shell (React 19 + Vite webview, Rust src-tauri/), zero custom commands
    registered yet. `capabilities/default.json` grants only `core:default`.
    Pre-merge `tauri-capability-reviewer` review found 2 issues, both fixed
    before merge: `security.csp` was `null` (now an explicit policy) and the
    main window had no explicit `"label"` (now `"main"`, stated not inferred).
    Gate green: desktop-hygiene.test.ts (G2) 4/4, own smoke test 1/1,
    typecheck+lint clean, `cargo check` + `cargo clippy -D warnings` clean,
    vite production build succeeds.
- **Post-merge fixups (commit `6c7f933`, not a feature):** a `resolve.alias`
  in root `vitest.config.ts` for `@voice-transcript/core` (Vite doesn't do
  Node's per-file upward `node_modules` walk, so `tests/e2e/integration.test.ts`
  -> `packages/cli/src/cli.ts` -> `@voice-transcript/core` didn't resolve from
  the repo root); `@types/node` pinned to `^24.0.0` in `packages/core` (a
  transitive dep pulled in `@types/node@26.x`, which broke `groq.ts`'s
  `Blob`/`BlobPart` typing). Also: `packages/core` and `packages/cli` each
  need their own `npm ci` run once per checkout (their `node_modules`,
  including the local `@voice-transcript/core` `file:` dependency, only
  existed inside the isolated build worktrees, not in `main`, until merged
  and installed for real).
- **Wave 8, F16 `cli-history-wiring` -- MERGED.** Injects `recordHistory` into
  `CliDeps`; wires `createDb()` + `recordHistorySafe()`; H5 enforced in
  `cli.ts` itself (not just trusted from the injected function). Gate green
  (packages/cli 17/17, packages/core 19/19, typecheck+lint clean on both).
- **Between F16 and F14, also did an infra migration (commit `7ecc710`,
  merged as `chore/pnpm-migration`, not an F-numbered feature):** replaced
  the npm `file:../core` bridge with real pnpm `workspace:*` linking, now
  that `pnpm` was available -- removed all `package-lock.json` files, added
  one root `pnpm-lock.yaml`. Done *before* F14 specifically so the new
  `apps/desktop` package wouldn't need the same bridge-then-migrate cycle.
- **Wave 8, F15 `desktop-ipc` -- MERGED.** Node sidecar
  (`packages/core/src/sidecar.ts` + `sidecar-bin.ts` entry) exposing
  `ping`/`transcribe`; Rust `commands.rs` proxies both via
  `tauri_plugin_shell::ShellExt`; `shell:allow-execute` scoped to the
  sidecar binary name only. `tauri-capability-reviewer` pre-merge review:
  clean, no findings. Sidecar build
  (`packages/core/scripts/build-sidecar.mjs`): esbuild bundles to CJS,
  `@yao-pkg/pkg` (not the unmaintained original `pkg` -- no prebuilt
  binaries past ~Node 18) compiles a standalone binary named
  `core-sidecar-<rust-target-triple>`. Gate green: packages/core 25/25
  (incl. 6 sidecar tests), desktop-hygiene (G2) 4/4, apps/desktop smoke
  test 1/1, typecheck+lint clean, `cargo check`/`clippy -D warnings`
  clean, compiled-binary smoke test passes.
- **Wave 9 (F17-F21) now unblocked** -- all five depend only on F15 (F17,
  F19, F20) or on F15 (F18, F21 also touch `src-tauri/src/commands.rs` --
  see Note 11 on why they may not all be truly parallel).
- **F17 `gui-queue` -- MERGED.** F17/F19/F20 (the file-disjoint first batch of
  Wave 9) are now all merged. F18 `gui-history` and F21 `native-menu` remain
  -- both touch `src-tauri/src/commands.rs`/new files, so per Note 11 they
  build sequentially too. F21's "Open history" menu item (SPEC.md > Native
  OS menu integration) needs a real History screen to invoke, so F18 goes
  first.
- **F18 `gui-history` -- MERGED.** F21 `native-menu` is now the last Wave 9
  feature. Its scope stays exactly as originally specified (Add files, Open
  history, Export, View on GitHub) -- it does NOT yet include a
  "Preferences" menu item / Cmd+,, even though the user asked for that in
  the same conversation turn this merged, because that item opens the
  API-key-configuration screen from the Backlog section above, which is
  blocked on a still-unanswered storage-design question (OS keychain vs.
  local config file). F21 builds now with its original 4 items; Preferences
  gets its own SPEC.md addition + feature once that question is answered.

## Independent set to build now (-> state/features.txt)

- **F20 `gui-theme` -- MERGED.** ThemeContext/ThemeProvider/ThemeToggle
  (apps/desktop/src/theme/**), persisted to localStorage, applies
  `data-theme` on `<html>`. Also introduced
  `apps/desktop/src/styles/toolbar.css` (shared toolbar/tabs/settings/
  btn-primary chrome, copied from the approved reference screen) -- F19 and
  F17 reuse these classes. Built SEQUENTIALLY (not in a truly separate
  parallel worktree kept isolated until the end) because F19/F17 both need
  to compose into the same `App.tsx` toolbar F20 started -- branching each
  next feature's worktree from the just-merged `main` avoids any
  App.tsx merge conflict, same safety property as parallel worktrees
  without fighting a real shared-file dependency. Gate green: apps/desktop
  3/3, desktop-hygiene (G2) 4/4, typecheck+lint clean.
- **F19 `gui-i18n` -- MERGED.** I18nContext/I18nProvider/LanguageToggle
  (apps/desktop/src/i18n/**), en/ja, persisted, sets `document.
  documentElement.lang`. Rewired `ThemeToggle` (F20) to read its labels
  through the shared `t()` instead of its own local dictionary -- one
  source of translation truth. G6 tested cross-component (switching
  language flips an unrelated consumer's labels in the same render, no
  remount). Gate green: apps/desktop 6/6, desktop-hygiene (G2) 4/4,
  typecheck+lint clean.
- **F17 `gui-queue` -- MERGED.** QueueContext (sequential one-at-a-time
  processing via an injectable `transcribeFn`; a failed item never blocks
  the next queued one, ACCEPTANCE G5), QueueRow (status chip, inline "View"
  expand, "Retry"), QueueView (native "Add files" picker via
  `tauri-plugin-dialog`'s scoped `dialog:allow-open`, native OS drag-and-drop
  via the core webview API). `tauri-capability-reviewer` pre-merge review:
  clean, `dialog:allow-open` confirmed minimal (not the broader
  `dialog:default`), no trust-boundary violation (the picker only returns
  user-selected paths, no file-content/broader-fs access). Gate green:
  apps/desktop 14/14 (incl. 3 new queue test files), desktop-hygiene (G2)
  4/4, typecheck+lint clean, `cargo check`/`clippy -D warnings` clean,
  sidecar rebuild + binary smoke test pass.
- **F18 `gui-history` -- MERGED.** HistoryContext (fetch-on-mount list,
  local optimistic state for the two delete actions), HistoryRow/HistoryView
  (empty/loading/error/populated states -- the History tab now switches
  immediately even with zero entries, fixing the earlier design feedback
  that it must respond instead of staying inert). `list_history` proxies to
  a new sidecar `list-history` action; `trash_audio`/`delete_history_entry`
  proxy to `get-history`/`delete-history-entry` for a DB-backed path lookup,
  then move the file via the `trash` crate (never a permanent delete) --
  both take only an integer id from the webview, never a raw path.
  `tauri-capability-reviewer` pre-merge review caught a real bug before
  merge: `HistoryFileRef` was missing `#[serde(rename_all = "camelCase")]`,
  so both destructive commands always failed to parse the sidecar's
  response -- and for delete, the DB row was already gone by the time that
  surfaced. Fixed, with 2 new Rust unit tests decoding literal camelCase
  JSON through the real structs, plus HistoryContext.trash()/remove() now
  catch and surface per-row errors instead of an unhandled rejection. Gate
  green (after the fix): apps/desktop 25/25, desktop-hygiene (G2) 4/4,
  typecheck+lint clean, `cargo check`/`clippy -D warnings`/`cargo test`
  (2/2) clean, sidecar rebuild + ping/list-history binary smoke test pass.
- **F21 `native-menu` -- next.**

```
native-menu
```

## Build order (waves, new scope)

- **Wave 6:** F11 `monorepo-core` (foundation; owns `pnpm-workspace.yaml`).
- **Wave 7 (parallel, after F11):** F12 `cli-package`, F13 `core-db`,
  F14 `tauri-scaffold` -- disjoint trees (`packages/cli` / `packages/core/src/db` /
  `apps/desktop`).
- **Wave 8 (after Wave 7):** F15 `desktop-ipc` (needs core+db+scaffold),
  F16 `cli-history-wiring` (needs cli+db).
- **Wave 9 (after F15):** F17 `gui-queue`, F18 `gui-history`, F19 `gui-i18n`,
  F20 `gui-theme`, F21 `native-menu` -- see Note 11 for why these may serialize.
- **Post-build (at integration_accept, per CLAUDE.md > Release):** regenerate
  README(s) via `run.sh readme`, add `.github/workflows/release.yml` (I1-I3),
  run it once as a manual multi-OS smoke test.

## Notes (new scope)

6. **The migration is copy-then-cut, not a big-bang move.** F11 COPIES the engine
   into `packages/core` and leaves root `src/` + root tests working, so F11's
   worktree is self-contained and every already-green root test stays green in the
   F13/F14 worktrees (which branch from a main that still has root `src/`). Root
   `src/**` and the root engine/cli/hygiene tests are removed only by F12
   `cli-package`, which owns that cut. This keeps each wave's file sets disjoint.

7. **F11 has real unit gates, not typecheck-only.** The engine's five unit tests
   (chunk/formats/stitch/groq/pipeline) relocate into `packages/core/tests/` and
   run green in the worktree; `audio.ts` remains typecheck-only (its `AudioBackend`
   is exercised via mocks in the CLI tests and for real at integration -- unchanged
   from original Note 3).

8. **The new hygiene tests are per-feature gates for exactly one feature each.**
   `tests/db-hygiene.test.ts` (H3/H4) is `core-db`'s gate; `tests/desktop-hygiene.test.ts`
   (G2) is `tauri-scaffold`'s. Both are root-relative disk scans that go green the
   moment their target directory exists correctly. The two e2e files
   (`desktop.integration.test.ts` G4/G5, `history.integration.test.ts` H1/H2/H5)
   are `expect.unreachable(...)` cross-cutting suites -- integration acceptance, NOT
   any feature's gate (they must never be listed in a `state/gates/<feature>`).

9. **Non-vitest acceptance items keep their stated verifier, not a faked unit test.**
   G1 -> CI build matrix (windows/ubuntu/macos-latest); G3 -> the
   `tauri-capability-reviewer` subagent at feature acceptance; G6/G7/G8/G9 ->
   exercised in the built app; I1-I3 -> running the workflow once. Their features
   are gated on typecheck+lint (+`cargo check`/`cargo test` for Rust) of their own
   files, plus the relevant subagent/CI/manual step at acceptance.

10. **Secret trust boundary is enforced by design, not just tests.** Per SPEC's
    reuse strategy, all Groq/DB/ffmpeg access lives in `apps/desktop/src-tauri` or
    the Node sidecar it supervises; the webview only calls narrow `invoke()`
    wrappers. F13's `db/**` reads `process.env.DATABASE_URL` (H3, H5 fail-loud), uses
    the ORM/query-builder only outside `migrations/` (H4), and never blocks a
    transcription on DB failure.

11. **Wave 9 GUI features may serialize.** F17-F21 all live under `apps/desktop/src`
    and F18/F21 also add to `src-tauri/src/commands.rs`/`menu.rs`. They are only
    truly file-disjoint if F14's scaffold exposes screen "slots" (a screen registry
    plus a split `commands.rs`) so each mounts without editing a shared shell/handler.
    If that shape isn't adopted, they build in successive single-feature waves
    (9a, 9b, ...); the `run.sh waves` loop re-plans each round and schedules only
    what is unblocked AND disjoint, so post-Wave-6 wave numbers are provisional.

12. **Release is post-build, never mid-build.** `.github/workflows/release.yml`
    (workflow_dispatch only; `title`+`version` inputs only; builds `apps/desktop`
    across the 3 OS matrix; uploads .dmg/.exe/.AppImage-.deb) and the README regen
    are added at/after integration_accept per CLAUDE.md > Release, so they are NOT a
    buildable wave feature.

## Backlog (requested 2026-07-13, not yet scheduled into a wave)

Both items below were explicitly deferred by the user ("まだやらなくていい") --
tracked here so they aren't lost, not started.

- **API key configuration in a Preferences/Settings screen.** Today
  `GROQ_API_KEY` is read from the environment only (CLI and the desktop
  sidecar both). Concrete requirements now given by the user (2026-07-13):
  Cmd+, opens Preferences on macOS, Ctrl+, on Windows (matches VS Code/
  Slack/Discord convention on that platform too), and a native menu entry
  reaches it as well -- so this is now scoped as an extension of F21
  `native-menu`'s item list, not a separate standalone screen's placement
  question. What's still unresolved and blocks starting the build: HOW the
  key is stored. Asked the user to choose between (a) OS keychain via a
  Tauri/Rust `keyring`-style crate (more secure, one more dependency,
  needs per-OS behavior verified) or (b) a local config file in the OS's
  app-config directory, written by the Rust shell and read by the sidecar
  at startup (simpler, matches this app's existing "personal tool" scope).
  Once answered: needs its own SPEC.md addition (the chosen storage
  mechanism changes the trust-boundary design in SPEC's Architecture
  section) and a criteria/design-gate pass before a build wave, same as any
  other new feature -- not a bug fix.
- **Richer README with screenshots, post-integration_accept.** CLAUDE.md's
  existing Release step (1) says the README is regenerated from SPEC.md via
  `run.sh readme` specifically because that keeps it reproducible, not
  hand-authored. The user now wants something closer to a well-known OSS
  project's README -- real screenshots, polish -- which is in tension with
  "reproducible, not hand-authored" as currently written; that tension isn't
  resolved here, it's flagged for when this task is actually picked up.
  Also requested: check whether a Claude Code skill or MCP server exists
  for README authoring before hand-rolling one. Requires the user's
  explicit go-ahead once implementation is complete (their words: "実装が
  完了して私の許可を得られたら").
