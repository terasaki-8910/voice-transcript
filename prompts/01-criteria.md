# Stage 1 -- Author acceptance criteria. NO feature code.

Read SPEC.md and ACCEPTANCE.md. Produce:
- Failing tests (red) encoding every machine-judgeable item in ACCEPTANCE.md.
- Linter/static config encoding non-functional UI rules where applicable:
  no emoji in source, colors ONLY via design tokens (no hardcoded hex),
  accessibility/contrast checks, responsive breakpoints. Prefer eslint/stylelint
  plugins over ad-hoc scripts.

Tests must fail now and pass only when the feature is correct.
List any acceptance item that CANNOT be machine-checked -> it becomes a human gate.
