# Stage 3 -- Plan. NO implementation.

Read SPEC.md and ACCEPTANCE.md. Produce (exact paths matter -- run.sh reads them):
- PLAN.md (repo root): decompose into the smallest useful feature units; note
  dependencies. Root, so it is committed and visible inside build worktrees.
- state/features.txt: ONE INDEPENDENT feature per line (no dependency on another
  unbuilt feature). These build in isolated worktrees, so they must not share mutable
  state. Dependent features go in PLAN.md notes, NOT in state/features.txt.
- state/gates/<feature>: for EACH feature in features.txt, a shell snippet that gates
  ONLY that feature -- run just its own test file(s) and typecheck/lint its own source
  (e.g. `npx vitest run tests/chunk.test.ts` plus eslint/tsc on that feature's files).
  A single-feature worktree does NOT contain sibling features' code, so the whole-repo
  `npm test` can NEVER pass there -- that is why the per-feature gate is mandatory.
  Cross-cutting / e2e tests belong to integration acceptance, not to any one feature.
  If a feature has no unit test, gate it on typecheck of its own files only.

Keep each feature small enough to verify against ACCEPTANCE.md.
