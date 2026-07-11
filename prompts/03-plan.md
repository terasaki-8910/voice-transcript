# Stage 3 -- Plan. NO implementation.

Read SPEC.md and ACCEPTANCE.md. Produce (exact paths matter -- run.sh reads them):
- PLAN.md (repo root): decompose into the smallest useful feature units; note
  dependencies. Root, so it is committed and visible inside build worktrees.
- state/features.txt: ONE INDEPENDENT feature per line (no dependency on another
  unbuilt feature). These build in PARALLEL in isolated worktrees, so they must not
  share mutable state. Dependent features go in PLAN.md notes, NOT in state/features.txt.

Keep each feature small enough to verify against ACCEPTANCE.md.
