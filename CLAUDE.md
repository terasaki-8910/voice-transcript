# Project: <name>

## What this is
<one-paragraph purpose>. Scope in SPEC.md; pass/fail criteria in ACCEPTANCE.md.

## Workflow
Driven by scripts/run.sh through gated stages (see pipeline.yaml). Do NOT skip gates.

## Commands
- Tests: <e.g. npm test / pytest>
- Lint:  <e.g. npm run lint>   (MUST include: no-emoji, design-tokens-only, a11y)

## UI rules
IMPORTANT: colors ONLY via design tokens; never hardcode hex. No emoji in UI or source.
Shared personal UI direction: @~/.claude/rules/ui.md

## Do not touch
state/ (runtime), design tokens (change only via the design gate), auto-generated files.

## Git
Local only by default; do NOT push unless asked. Feature branches merge to main with --no-ff.
