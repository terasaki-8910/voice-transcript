# Project: Voice Transcript

## What this is
音声ファイルをクラウドAPIを用いてトランスクリプトを出力する（1時間越えの音声ファイルでも可能に、テストファイルをtests/test.m4aに示す）、ターミナルで使えるように. Scope in SPEC.md; pass/fail criteria in ACCEPTANCE.md.

## Workflow
Driven by scripts/run.sh through gated stages (see pipeline.yaml). Do NOT skip gates.
Intake proposes per-project tools (MCP/plugins/skills): Claude proposes, I approve, I
run state/init-tools.sh myself. Never auto-install or enable tools.

## Language
Generated artifacts (code, comments, docs, commit messages, UI copy) default to English.
Change here to override per project. The language I chat in is separate and unaffected.

## Commands
pnpm workspace (`packages/core`, `packages/cli`, `apps/desktop` once it
exists), real `workspace:*` linking (migrated 2026-07-12, once `pnpm`/`cargo`
were available -- no more `npm ci` per package).
- Tests:     pnpm -r test        (vitest, per-package unit/mocked tests only)
- Root tests: pnpm test          (root-level cross-cutting hygiene + tests/e2e/**;
  integration E2E runs only when GROQ_API_KEY is set; DB-backed tests need DATABASE_URL)
- Lint:      pnpm -r lint        (eslint + no-emoji check, now covers GUI copy too)
- Typecheck: pnpm -r typecheck   (tsc --noEmit)
- Desktop dev loop: pnpm --filter desktop tauri dev

## UI rules
IMPORTANT: colors ONLY via design tokens; never hardcode hex. No emoji in UI or source.
Shared personal UI direction: @~/.claude/rules/ui.md
See also design_brief.md for the desktop app's concrete do/avoid rules.

## Do not touch
state/ (runtime), design tokens (change only via the design gate), auto-generated
files, Rust build artifacts (`**/target/`).

## Git
Local only by default; do NOT push unless asked. Feature branches merge to main with --no-ff.

## Release (do this automatically once ALL implementation is done -- i.e. at/after integration_accept, not mid-build)
1. Regenerate README.md + README.en.md from SPEC.md via the existing `run.sh readme`
   utility (reproducible, not hand-authored -- see pipeline.yaml footer).
2. Add `.github/workflows/release.yml`: manually triggered (`workflow_dispatch`, so it
   runs from a button in the GitHub UI, never on push), with `title` and `version`/`tag`
   inputs only (see SPEC.md > Release automation and ACCEPTANCE.md > I). Builds
   apps/desktop ONLY (not packages/cli) for windows-latest/ubuntu-latest/macos-latest and
   uploads each platform's native installer (.dmg / .exe / .AppImage-.deb) to a GitHub
   Release.
Note: state/done/ already has build/accept/integrate markers left over from the
original CLI-only pipeline run (before this session's GUI/DB scope was added) --
these are stale for the new scope. Run `scripts/run.sh reset` before build for the
new features so `run.sh status` doesn't misreport them as already done.

### Ongoing patch releases (post-launch, confirmed 2026-07-14)
Once the app has an initial GitHub Release, later fix/small-feature batches release the
same way but the version is picked automatically, not asked each time:
- Read the latest existing tag (`git tag -l` / `gh release list`) and bump the PATCH
  (third) number by default -- e.g. v0.1.3 -> v0.1.4. Only bump minor/major if the change
  is clearly that scale (a judgment call, not automatic).
- `gh workflow run release.yml -f title="Voice Transcript vX.Y.Z" -f version="vX.Y.Z"`,
  then monitor to completion same as always.
- After code changes are verified (tests/typecheck/lint green) and BEFORE pushing/
  releasing, also build a local debug app (`pnpm --filter desktop tauri build --debug`)
  and copy the resulting `.app` to `/Applications` (overwriting the previous install,
  quitting it first if running) -- gives immediate local use without waiting on/
  downloading the GitHub release. Do this in addition to the real release, not instead
  of it.
