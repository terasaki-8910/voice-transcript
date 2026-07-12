# Stage 1 -- Author acceptance criteria. NO feature code.

Read SPEC.md and ACCEPTANCE.md. Produce:
- Failing tests (red) encoding every machine-judgeable item in ACCEPTANCE.md.
- Linter/static config encoding non-functional rules where applicable: no emoji in
  source; for UI projects also colors-via-tokens (no hardcoded hex), a11y/contrast,
  responsive breakpoints. Prefer eslint/stylelint plugins over ad-hoc scripts.
  The lint config MUST also:
  * IGNORE runtime/build dirs -- at least `state/**`, `dist/**`, `node_modules/**`,
    `coverage/**` -- so leftover build worktrees under state/ are never linted.
  * Treat `_`-prefixed identifiers as intentionally-unused (no-unused-vars with
    args/vars/caughtErrors IgnorePattern `^_`) AND actually follow that convention in
    the tests you write -- so a correctly-built feature is never blocked later by an
    intentional-unused lint error.

Tests must fail now and pass only when the feature is correct.
List any acceptance item that CANNOT be machine-checked -> it becomes a human gate.
