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
- Tests:     npm test        (vitest; unit/mocked. Integration E2E runs only when GROQ_API_KEY is set)
- Lint:      npm run lint     (eslint + no-emoji check. No UI here, so design-tokens/a11y/responsive are N/A)
- Typecheck: npm run typecheck (tsc --noEmit)

## UI rules
IMPORTANT: colors ONLY via design tokens; never hardcode hex. No emoji in UI or source.
Shared personal UI direction: @~/.claude/rules/ui.md

## Do not touch
state/ (runtime), design tokens (change only via the design gate), auto-generated files.

## Git
Local only by default; do NOT push unless asked. Feature branches merge to main with --no-ff.
