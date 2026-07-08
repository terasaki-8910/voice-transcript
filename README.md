# claude-pipeline-template

A **GitHub template repository** for driving ONE project from a rough idea to a
gated, tested result with Claude Code. Multiple projects run in parallel simply as
separate repos (no shared state). Ralph-style iteration is used *inside* the build
stage only, bounded and gated by tests -- not as an ungated overnight loop.

## Files
- `pipeline.yaml`  -- declarative spec (source of truth). Keep in sync with run.sh.
- `scripts/run.sh` -- POSIX driver: advances stages, stops at human gates (notifies).
- `scripts/gates.sh` -- machine gates (tests / lint / ui). Customize per project.
- `prompts/0X-*.md` -- the "contract" for each stage.
- `CLAUDE.md`      -- project memory (imports your global UI rules).
- `.claude/settings.json` -- SCOPED permissions (see Safety). Not global skip-permissions.
- `Makefile`       -- optional shortcuts (`make plan`, `make build`, ...).

## One-time GLOBAL setup (per machine, NOT in this repo)
1. Stop the git co-author trailer everywhere:
   `~/.claude/settings.json`  ->  { "includeCoAuthoredBy": false }
2. Shared UI direction across all projects:
   copy `docs/ui-rules.starter.md` to `~/.claude/rules/ui.md` and refine it over time.
   `~/.claude/CLAUDE.md` / `~/.claude/rules/` load in every project; scope the UI rule
   to frontend globs so it only loads for UI work (see the rules-directory docs).

## Per-project use
1. On GitHub: make this a Template repository (Settings -> Template repository).
2. For each new project: "Use this template" -> new repo -> clone.
3. Fill in CLAUDE.md (<name>, commands) and, if it has a UI, run `touch state/has_ui`.
4. Run the pipeline:  `sh scripts/run.sh all`   (or stage by stage: `... intake`, etc.)

## Stages (gates)
0 intake (H, once)  1 criteria (H)  2 design_gate (UI only, H, once)
3 plan (skim)  4 build (machine gates, parallel per worktree)
5 feature_accept (machine + light H, LOCAL merge)  6 integration_accept (machine + H, once)

## Models
Spec/criteria = Opus, design/build = Sonnet. Set per stage via env
(MODEL_BUILD=sonnet etc.). `opus-plan` is an interactive mode, not a headless model
string -- for headless `plan`, MODEL_PLAN stays a real model. Fable is MANUAL escalation
only (write the blocker to state/BLOCKED-*.md and escalate by hand); never automated,
because some Fable queries route to Opus and it has availability/safeguard caveats.

## Safety (important)
- Each feature builds in an isolated `git worktree`; that isolation is the safety boundary.
- `.claude/settings.json` grants a SCOPED allowlist and denies push / rm -rf. Do NOT run
  `--dangerously-skip-permissions` on your main machine; if you ever do, keep it inside a
  worktree/sandbox only.
- No push by default -- everything is local git.

## Verify before first run
`claude` flags evolve. Confirm headless invocation and the settings schema with
`claude --help` and the current Claude Code docs; adjust run.sh / settings.json to match.
