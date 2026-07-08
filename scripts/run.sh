#!/usr/bin/env sh
# POSIX pipeline driver. One project, gated stages. macOS / Linux / WSL.
# No bashisms, no GNU-only flags. Verify `claude` invocation with `claude --help`.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE="$ROOT/state"; PROMPTS="$ROOT/prompts"
mkdir -p "$STATE/logs" "$STATE/worktrees"
MAIN=$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || echo main)

# model per stage (override via env)
: "${MODEL_INTAKE:=opus}"
: "${MODEL_CRITERIA:=opus}"
: "${MODEL_DESIGN:=sonnet}"
: "${MODEL_PLAN:=opus}"
: "${MODEL_BUILD:=sonnet}"
: "${MAX_BUILD_ITERS:=25}"

. "$ROOT/scripts/gates.sh"

have() { command -v "$1" >/dev/null 2>&1; }

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
  read ans || ans=n
  case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

claude_run() {  # headless. $1=model $2=promptfile [extra args]
  model=$1; prompt=$2; shift 2
  have claude || { echo "ERROR: 'claude' CLI not found (install Claude Code)." >&2; exit 127; }
  claude --model "$model" -p "$@" < "$prompt" 2>&1 \
    | tee -a "$STATE/logs/$(date +%Y%m%d-%H%M%S).log"
}

claude_interactive() {  # human converses. $1=model $2=seed promptfile
  model=$1; prompt=$2
  have claude || { echo "ERROR: 'claude' CLI not found." >&2; exit 127; }
  echo "--- seed prompt ($prompt) ---"; cat "$prompt"; echo "--- end seed ---"
  claude --model "$model"
}

stage_intake() {
  echo "== 0. intake (interactive, model=$MODEL_INTAKE) =="
  claude_interactive "$MODEL_INTAKE" "$PROMPTS/00-intake.md"
  confirm "Stage 0: SPEC.md / ACCEPTANCE.md frozen?" || { echo "Not approved."; exit 1; }
}

stage_criteria() {
  echo "== 1. author criteria (model=$MODEL_CRITERIA) =="
  claude_run "$MODEL_CRITERIA" "$PROMPTS/01-criteria.md"
  confirm "Stage 1: failing tests + lint config approved?" || { echo "Not approved."; exit 1; }
}

stage_design_gate() {
  [ -f "$STATE/has_ui" ] || { echo "== 2. design gate: skipped (no UI) =="; return 0; }
  echo "== 2. design gate (model=$MODEL_DESIGN) =="
  claude_run "$MODEL_DESIGN" "$PROMPTS/02-design-gate.md"
  confirm "Stage 2: aesthetic direction / tokens approved (ONE time)?" \
    || { echo "Iterate prompts/02, then rerun 'design'."; exit 1; }
}

stage_plan() {
  echo "== 3. plan (model=$MODEL_PLAN) =="
  claude_run "$MODEL_PLAN" "$PROMPTS/03-plan.md"
  echo "Skim state/PLAN.md and state/features.txt. Press Enter to continue."
  read _ || true
}

build_feature() {  # $1=feature. Runs inside its worktree; bounded Ralph loop.
  feat=$1; wt="$STATE/worktrees/$feat"; i=0
  while [ "$i" -lt "$MAX_BUILD_ITERS" ]; do
    i=$((i+1)); echo "-- build $feat: iter $i/$MAX_BUILD_ITERS --"
    ( cd "$wt" && claude_run "$MODEL_BUILD" "$PROMPTS/04-build.md" ) || true
    if ( cd "$wt" && gate_all ); then echo "$feat: gates GREEN."; return 0; fi
  done
  echo "$feat: MAX_BUILD_ITERS reached, gates not green. See state/BLOCKED-$feat.md." >&2
  return 1
}

stage_build() {
  echo "== 4. build (parallel per feature, model=$MODEL_BUILD) =="
  [ -f "$STATE/features.txt" ] || { echo "Missing state/features.txt (run plan)."; exit 1; }
  # create worktrees serially (avoid concurrent git metadata races)
  while IFS= read -r feat; do
    [ -n "$feat" ] || continue
    git worktree add -B "feature/$feat" "$STATE/worktrees/$feat" 2>/dev/null \
      || git worktree add "$STATE/worktrees/$feat" -b "feature/$feat" 2>/dev/null || true
  done < "$STATE/features.txt"
  # build in parallel, collect statuses
  pids=""
  while IFS= read -r feat; do
    [ -n "$feat" ] || continue
    build_feature "$feat" & pids="$pids $!"
  done < "$STATE/features.txt"
  rc=0; for pid in $pids; do wait "$pid" || rc=1; done
  [ "$rc" -eq 0 ] || echo "Some features failed gates; check state/logs and BLOCKED-*.md."
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
}

stage_integration_accept() {
  echo "== 6. integration acceptance (once) =="
  ( cd "$ROOT" && gate_all ) || { echo "Integration gates failed."; exit 1; }
  confirm "Final smoke test passed on device/browser?" || { echo "Not accepted."; exit 1; }
  echo "== 7. DONE =="
}

main() {
  case "${1:-all}" in
    intake)    stage_intake ;;
    criteria)  stage_criteria ;;
    design)    stage_design_gate ;;
    plan)      stage_plan ;;
    build)     stage_build ;;
    accept)    stage_feature_accept ;;
    integrate) stage_integration_accept ;;
    all) stage_intake; stage_criteria; stage_design_gate; stage_plan
         stage_build; stage_feature_accept; stage_integration_accept ;;
    *) echo "usage: run.sh [intake|criteria|design|plan|build|accept|integrate|all]"; exit 2 ;;
  esac
}
main "$@"
