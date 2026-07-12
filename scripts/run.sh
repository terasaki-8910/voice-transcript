#!/usr/bin/env sh
# POSIX pipeline driver. One project, gated stages. macOS / Linux / WSL.
# No bashisms, no GNU-only flags. Verify `claude` invocation with `claude --help`.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE="$ROOT/state"; PROMPTS="$ROOT/prompts"
mkdir -p "$STATE/logs" "$STATE/worktrees"
MAIN=$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || echo main)

# One Ctrl+C tears everything down. build spawns child agents; without this the loop
# and its background jobs can survive SIGINT and keep spending your quota.
trap 'trap - INT TERM; echo; echo "[run.sh] interrupted -- stopping." >&2; kill 0 2>/dev/null' INT TERM

# model per stage (override via env)
: "${MODEL_INTAKE:=opus}"
: "${MODEL_CRITERIA:=opus}"
: "${MODEL_DESIGN:=sonnet}"
: "${MODEL_PLAN:=opus}"
: "${MODEL_BUILD:=sonnet}"
: "${MAX_BUILD_ITERS:=6}"   # keep low: each iter is a full paid agent run
# Headless permission mode. acceptEdits auto-approves edits + common fs commands so
# unattended stages don't hang waiting for approval that a headless run can't answer.
# settings.json still denies push/rm-rf/WebFetch; the allowlist governs test/git.
: "${PERMISSION_MODE:=acceptEdits}"
# INTERACTIVE=1 runs the single-agent stages (criteria/design/plan) in the visible
# Claude Code TUI instead of headless: you watch progress, get native notifications,
# can correct mid-course, and /exit to continue. Default 0 = headless/unattended.
# (build always stays headless -- it runs features in parallel worktrees.)
: "${INTERACTIVE:=0}"

. "$ROOT/scripts/gates.sh"

have() { command -v "$1" >/dev/null 2>&1; }

mark_done() { mkdir -p "$STATE/done"; : > "$STATE/done/$1"; }  # checkpoint read by `status`

record_session() {  # best-effort: map the Claude session just run (in CWD) to a stage label
  prompt=$1
  cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  slug=$(printf '%s' "$PWD" | sed 's#/#-#g')          # Claude keys sessions by cwd path
  f=$(ls -t "$cfg/projects/$slug/"*.jsonl 2>/dev/null | head -1)
  [ -n "$f" ] || return 0
  id=$(basename "$f" .jsonl)
  label=$(basename "$prompt" .md | sed 's/^[0-9][0-9]*-//')   # 04-build.md -> build
  case "$PWD" in *"/worktrees/"*) label="$label-$(basename "$PWD")" ;; esac
  mkdir -p "$STATE/sessions"
  printf '%s\t%-26s\t%s\n' "$(date +%H:%M:%S)" "$label" "$id" >> "$STATE/sessions/index.tsv"
  printf '%s\n' "$id" > "$STATE/sessions/$label"
  echo ">> session[$label] = $id   (resume: claude --resume $id)"
}

notify() {  # best-effort desktop notification; always prints
  m=$1
  if have terminal-notifier; then terminal-notifier -title pipeline -message "$m" >/dev/null 2>&1 || true
  elif have osascript; then osascript -e "display notification \"$m\" with title \"pipeline\"" >/dev/null 2>&1 || true
  elif have notify-send; then notify-send pipeline "$m" >/dev/null 2>&1 || true
  else printf '\a'; fi
  printf '\n>>> %s\n' "$m"
}

confirm() {  # human gate. $1=message. 0 on yes.
  notify "$1"; printf 'Approve? [y/N] '
  # Read from the terminal, NOT the caller's stdin -- feature_accept calls this inside
  # `while read feat < features.txt`, so a plain `read` would eat feature lines instead
  # of your keypress. Fall back to stdin, then to N, for headless/CI runs.
  read ans </dev/tty 2>/dev/null || read ans || ans=n
  case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

claude_run() {  # headless. $1=model $2=promptfile [extra args]
  model=$1; prompt=$2; shift 2
  have claude || { echo "ERROR: 'claude' CLI not found (install Claude Code)." >&2; exit 127; }
  # Headless: pass the prompt as the -p argument (documented invocation).
  # --permission-mode keeps unattended runs from blocking on approval prompts.
  claude --model "$model" --permission-mode "$PERMISSION_MODE" "$@" -p "$(cat "$prompt")" 2>&1 \
    | tee -a "$STATE/logs/$(date +%Y%m%d-%H%M%S).log"
  record_session "$prompt"
}

claude_interactive() {  # human converses. $1=model $2=seed promptfile
  model=$1; prompt=$2
  have claude || { echo "ERROR: 'claude' CLI not found." >&2; exit 127; }
  # Interactive session seeded with the prompt as the first message:
  # `claude "<text>"` opens the REPL AND sends that as message 1, so Claude
  # starts the intake Q&A itself instead of opening blank. (documented flag form)
  claude --model "$model" "$(cat "$prompt")"
}

agent_stage() {  # single-agent stage. $1=model $2=promptfile. Honors INTERACTIVE.
  if [ "$INTERACTIVE" = "1" ]; then claude_interactive "$1" "$2"
  else claude_run "$1" "$2"; fi
}

stage_intake() {
  echo "== 0. intake (interactive, model=$MODEL_INTAKE) =="
  # Intake also PROPOSES per-project tools (MCP/plugins/skills). Claude proposes,
  # you approve, you run init-tools.sh. Nothing is installed automatically.
  claude_interactive "$MODEL_INTAKE" "$PROMPTS/00-intake.md"
  confirm "Stage 0: SPEC.md / ACCEPTANCE.md frozen AND tool proposal (state/TOOLING.md) approved?" \
    || { echo "Not approved."; exit 1; }
  if [ -f "$STATE/init-tools.sh" ]; then
    notify "Optional: review state/init-tools.sh, then run it YOURSELF to add tools. Nothing was installed automatically."
  fi
  mark_done intake
}

stage_criteria() {
  echo "== 1. author criteria (model=$MODEL_CRITERIA) =="
  agent_stage "$MODEL_CRITERIA" "$PROMPTS/01-criteria.md"
  confirm "Stage 1: failing tests + lint config approved?" || { echo "Not approved."; exit 1; }
  mark_done criteria
}

stage_design_gate() {
  [ -f "$STATE/has_ui" ] || { echo "== 2. design gate: skipped (no UI) =="; mark_done design; return 0; }
  echo "== 2. design gate (model=$MODEL_DESIGN) =="
  agent_stage "$MODEL_DESIGN" "$PROMPTS/02-design-gate.md"
  confirm "Stage 2: aesthetic direction / tokens approved (ONE time)?" \
    || { echo "Iterate prompts/02, then rerun 'design'."; exit 1; }
  mark_done design
}

stage_plan() {
  echo "== 3. plan (model=$MODEL_PLAN) =="
  agent_stage "$MODEL_PLAN" "$PROMPTS/03-plan.md"
  echo "Skim PLAN.md and state/features.txt. Press Enter to continue."
  read _ || true
  mark_done plan
}

gate_feature() {  # $1=feature. Gate ONLY this feature if a per-feature gate exists,
  # else fall back to the whole-repo gate. A single-feature worktree does NOT contain
  # sibling features' code, so the whole-repo suite can never be green here.
  gf="$STATE/gates/$1"
  if [ -f "$gf" ]; then ( sh "$gf" ); else gate_all; fi
}

build_feature() {  # $1=feature. Runs inside its worktree; bounded, self-limiting loop.
  feat=$1; wt="$STATE/worktrees/$feat"; i=0; prev=""
  while [ "$i" -lt "$MAX_BUILD_ITERS" ]; do
    i=$((i+1)); echo "-- build $feat: iter $i/$MAX_BUILD_ITERS --"
    ( cd "$wt" && claude_run "$MODEL_BUILD" "$PROMPTS/04-build.md" ) || true
    if ( cd "$wt" && gate_feature "$feat" ); then echo "$feat: gates GREEN."; return 0; fi
    # No-progress guard: if the agent made no new commit (stuck / API error / spend
    # limit hit), STOP now instead of burning the remaining paid iterations.
    head=$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo none)
    if [ "$head" = "$prev" ]; then
      echo "$feat: no progress (HEAD unchanged) -- stopping. See state/BLOCKED-$feat.md." >&2
      return 1
    fi
    prev=$head
  done
  echo "$feat: MAX_BUILD_ITERS reached, gates not green. See state/BLOCKED-$feat.md." >&2
  return 1
}

stage_build() {
  echo "== 4. build (parallel per feature, model=$MODEL_BUILD) =="
  [ -f "$STATE/features.txt" ] || { echo "Missing state/features.txt (run plan)."; exit 1; }
  # Commit approved scaffolding (spec + criteria + plan: SPEC/ACCEPTANCE/PLAN, package.json,
  # tests, configs) to the base branch so each feature worktree inherits it. state/ is
  # gitignored, so orchestration artifacts stay out of git.
  git -C "$ROOT" add -A >/dev/null 2>&1 || true
  git -C "$ROOT" commit -q -m "pipeline: baseline (spec + criteria + plan)" >/dev/null 2>&1 || true
  # clean stale worktrees from a previous run, then (re)create them
  git -C "$ROOT" worktree prune 2>/dev/null || true
  while IFS= read -r feat; do
    [ -n "$feat" ] || continue
    git worktree add -B "feature/$feat" "$STATE/worktrees/$feat" 2>/dev/null \
      || git worktree add "$STATE/worktrees/$feat" -b "feature/$feat" 2>/dev/null || true
  done < "$STATE/features.txt"
  # Build features. SEQUENTIAL by default (safer for cost + killability). Set PARALLEL=1
  # to build them concurrently in their worktrees.
  rc=0
  if [ "${PARALLEL:-0}" = "1" ]; then
    pids=""
    while IFS= read -r feat; do
      [ -n "$feat" ] || continue
      build_feature "$feat" & pids="$pids $!"
    done < "$STATE/features.txt"
    for pid in $pids; do wait "$pid" || rc=1; done
  else
    while IFS= read -r feat; do
      [ -n "$feat" ] || continue
      build_feature "$feat" || rc=1
    done < "$STATE/features.txt"
  fi
  [ "$rc" -eq 0 ] || { echo "Some features failed gates; see state/BLOCKED-*.md. Resume: sh scripts/run.sh from build"; exit 1; }
  mark_done build
}

stage_feature_accept() {
  echo "== 5. feature acceptance + LOCAL merge (no push) =="
  while IFS= read -r feat; do
    [ -n "$feat" ] || continue
    echo "--- feature: $feat ---"
    git -C "$ROOT" --no-pager log --oneline "$MAIN..feature/$feat" 2>/dev/null || true
    confirm "Merge feature/$feat to main? (gates green + GUI look done)" \
      || { echo "Skipped $feat."; continue; }
    git -C "$ROOT" checkout "$MAIN"
    git -C "$ROOT" merge --no-ff "feature/$feat" -m "merge feature/$feat"
    git worktree remove "$STATE/worktrees/$feat" 2>/dev/null || true
  done < "$STATE/features.txt"
  mark_done accept
}

stage_integration_accept() {
  echo "== 6. integration acceptance (once) =="
  # gates run in the MAIN repo; deps were installed in the worktrees, so install here too.
  if [ -f "$ROOT/package.json" ]; then ( cd "$ROOT" && npm install >/dev/null 2>&1 || true ); fi
  ( cd "$ROOT" && gate_all ) \
    || { echo "Integration gates failed. Fix, then resume: sh scripts/run.sh from integrate"; exit 1; }
  confirm "Final smoke test passed on device/browser?" || { echo "Not accepted."; exit 1; }
  echo "== 7. DONE =="
  mark_done integrate
}

stage_survey() {  # OPTIONAL prior-art survey; NOT part of `all`. Needs WebSearch enabled.
  echo "== survey: prior-art (interactive, model=$MODEL_INTAKE) =="
  claude_interactive "$MODEL_INTAKE" "$PROMPTS/survey.md"
}

stage_readme() {  # generate project README.md + README.en.md from SPEC (reproducible)
  [ -f "$ROOT/SPEC.md" ] || { echo "readme: SPEC.md missing (run intake first)."; return 0; }
  echo "== readme: generate project README(s) from SPEC (model=$MODEL_INTAKE) =="
  claude_run "$MODEL_INTAKE" "$PROMPTS/readme.md"
}

stage_status() {  # show which stages are done + the command to continue
  echo "== pipeline status: $(basename "$ROOT") =="
  next=""
  for s in intake criteria design plan build accept integrate; do
    if [ "$s" = design ] && [ ! -f "$STATE/has_ui" ] && [ ! -f "$STATE/done/design" ]; then
      printf '  [-] %s (n/a: no UI)\n' "$s"; continue
    fi
    if [ -f "$STATE/done/$s" ]; then printf '  [x] %s\n' "$s"
    else printf '  [ ] %s\n' "$s"; [ -z "$next" ] && next="$s"; fi
  done
  echo ""
  if [ -z "$next" ]; then echo "All stages complete."; return 0; fi
  echo "Next: $next"
  echo "  run:           sh scripts/run.sh from $next"
  echo "  watch in TUI:  INTERACTIVE=1 sh scripts/run.sh from $next"
}

stage_sessions() {  # list recorded Claude session ids (resume a headless run by id)
  f="$STATE/sessions/index.tsv"
  [ -f "$f" ] || { echo "No sessions recorded yet (they are written as stages run)."; return 0; }
  echo "== recorded sessions -- resume any with: claude --resume <id> =="
  printf 'time\t\tstage\t\t\tsession-id\n'
  cat "$f"
}

stage_reset() {  # clear BUILD artifacts (worktrees, feature/* branches, checkpoints) so you
  # can cleanly re-run. Keeps spec/criteria/plan (SPEC/ACCEPTANCE/PLAN/tests/gates/features).
  git -C "$ROOT" worktree prune 2>/dev/null || true
  for w in "$STATE"/worktrees/*/; do
    [ -d "$w" ] && git -C "$ROOT" worktree remove --force "$w" 2>/dev/null || true
  done
  for b in $(git -C "$ROOT" branch --list 'feature/*' 2>/dev/null | sed 's/[* ]//g'); do
    git -C "$ROOT" branch -D "$b" 2>/dev/null || true
  done
  rm -rf "$STATE/worktrees" "$STATE/done" 2>/dev/null || true
  rm -f "$STATE"/BLOCKED-*.md 2>/dev/null || true
  mkdir -p "$STATE/worktrees"
  echo "reset: worktrees + feature/* branches + checkpoints cleared. spec/criteria/plan kept."
  echo "re-run:  sh scripts/run.sh from build   (or  from plan  to redo planning)"
}

stage_waves() {  # plan -> build -> accept, looped over successive dependency waves
  w=0
  while [ "$w" -lt 12 ]; do
    w=$((w + 1)); echo "== wave $w =="
    stage_plan   # re-plans: writes the NEXT wave to features.txt, or EMPTY when all built
    if ! grep -q '[^[:space:]]' "$STATE/features.txt" 2>/dev/null; then
      echo "== all planned features are built =="; return 0
    fi
    stage_build
    stage_feature_accept
  done
  echo "waves: safety cap (12) hit -- a wave is not clearing; check PLAN.md / features.txt." >&2
  exit 1
}

run_from() {  # run the given stage and every stage after it, in order
  start=$1
  case "$start" in plan|build|accept|waves) start=waves ;; esac  # these collapse into the wave loop
  on=0
  for s in intake readme criteria design waves integrate; do
    [ "$s" = "$start" ] && on=1
    [ "$on" = "1" ] || continue
    case "$s" in
      intake)    stage_intake ;;
      readme)    stage_readme ;;
      criteria)  stage_criteria ;;
      design)    stage_design_gate ;;
      waves)     stage_waves ;;
      integrate) stage_integration_accept ;;
    esac
  done
  [ "$on" = "1" ] || { echo "unknown stage: $start" >&2; exit 2; }
}

main() {
  case "${1:-all}" in
    intake)    stage_intake ;;
    criteria)  stage_criteria ;;
    design)    stage_design_gate ;;
    plan)      stage_plan ;;
    build)     stage_build ;;
    accept)    stage_feature_accept ;;
    waves)     stage_waves ;;                  # build ALL remaining dependency waves
    integrate) stage_integration_accept ;;
    survey)    stage_survey ;;
    readme)    stage_readme ;;
    status)    stage_status ;;                # show progress + next command
    sessions)  stage_sessions ;;              # list recorded session ids (resume/inspect)
    reset)     stage_reset ;;                 # clear build artifacts to recover cleanly
    from)      run_from "${2:-criteria}" ;;   # resume: run this stage -> end
    all)       run_from intake ;;
    *) echo "usage: run.sh [status|sessions|intake|readme|criteria|design|plan|build|accept|waves|integrate|survey|reset|all|from <stage>]"; exit 2 ;;
  esac
}
main "$@"
