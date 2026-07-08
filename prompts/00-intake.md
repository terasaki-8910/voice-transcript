# Stage 0 -- Intake (interactive). DO NOT write feature code.

Ask me focused questions until you can produce, with no unresolved ambiguity:
- SPEC.md -- what we build; scope IN and explicitly OUT; constraints.
- ACCEPTANCE.md -- machine-judgeable acceptance criteria. Every item must be
  checkable by a test or a lint rule, phrased pass/fail. No vague criteria.
- If this project has a UI: design_brief.md -- aesthetic direction as a few
  concrete rules (do / avoid). Import my global UI rules if present:
  @~/.claude/rules/ui.md

Rules:
- Question my premises before accepting them.
- Separate "can build" from "should build"; propose scope cuts.
- Mark anything unverified as unverified. Do not invent facts.
- Stop only when SPEC.md and ACCEPTANCE.md are complete and internally consistent.
