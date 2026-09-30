#!/usr/bin/env bash
# The loop. State lives in files and git, not in a context window, so each iteration can start
# from nothing and still make progress. (From the net-werk kit: https://github.com/Julius-PC/net-werk)
#
#   ./harness/bin/loop.sh build 10    up to 10 build iterations (default)
#   ./harness/bin/loop.sh plan 1      one planning pass — re-derives the graph from the specs
#   ./harness/bin/loop.sh build 1     one iteration, to watch what it does
#
# Stops on its own when: every task is done, only human tasks are left, the iteration cap is
# reached, or two iterations in a row end without a commit.

set -uo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-build}"
MAX="${2:-10}"
PROMPT="harness/prompts/${MODE}.md"

[[ -f "$PROMPT" ]] || { echo "no prompt for mode '$MODE' (expected $PROMPT)"; exit 2; }
command -v claude >/dev/null || { echo "claude CLI not found"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository — the loop measures progress in commits"; exit 2; }

# Everything the loop prints also goes to harness/.loop.log (gitignored), which net-werk tails.
exec > >(tee -a harness/.loop.log) 2>&1
echo
echo "════ $(date '+%Y-%m-%d %H:%M:%S') ════"
echo "── loop: mode=$MODE max=$MAX ──"

run_agent() {
  # A fresh context every time: the prompt is the only thing carried over; everything else the
  # agent reads from disk. acceptEdits lets it write files without asking, while still refusing
  # anything your hooks block. stream.mjs turns its tool calls into one log line each, live.
  claude -p "$(cat "$1")" --permission-mode acceptEdits --output-format stream-json --verbose \
    | node harness/bin/stream.mjs
  [[ ${PIPESTATUS[0]} -eq 0 ]] || echo "(agent exited non-zero — continuing; the gates decide, not the exit code)"
}

# The graph follows the specs: if specs/ changed since the last `plan:` commit, re-plan before
# building, so no iteration works from a brief the specs have overtaken.
SPEC_PATHS=(specs)
maybe_replan() {
  [[ "$MODE" == "build" ]] || return 0
  if [[ -n "$(git status --porcelain -- "${SPEC_PATHS[@]}")" ]]; then
    echo "(specs have uncommitted changes — not re-planning until they are committed)"
    return 0
  fi
  local last_plan
  last_plan=$(git log -1 --format=%H --grep='^plan:')
  if [[ -z "$last_plan" || -n "$(git rev-list "$last_plan"..HEAD -- "${SPEC_PATHS[@]}" | head -1)" ]]; then
    echo
    echo "── specs changed since the last plan — re-planning before building ──"
    run_agent harness/prompts/plan.md
    node harness/bin/graph.mjs validate || { echo "the re-plan left the graph invalid — stopping."; exit 1; }
  fi
}

last_head=$(git rev-parse HEAD 2>/dev/null || echo "none")
stuck=0

for (( i = 1; i <= MAX; i++ )); do
  echo
  echo "── iteration $i/$MAX ──────────────────────────────────"

  maybe_replan

  # Ask the graph whether there is anything to do BEFORE paying for a model call.
  if [[ "$MODE" == "build" ]]; then
    node harness/bin/graph.mjs next
    status=$?
    if [[ $status -ne 0 ]]; then
      [[ $status -eq 3 ]] && { echo "nothing left for the agent — stopping."; exit 0; }
      [[ $status -eq 4 ]] && { echo "every task is done — stopping."; exit 0; }
      echo "graph is unhappy (exit $status) — stopping so it can be fixed by hand."
      exit $status
    fi
  fi

  run_agent "$PROMPT"

  # Back pressure: progress is measured in commits, not tokens.
  head=$(git rev-parse HEAD 2>/dev/null || echo "none")
  if [[ "$head" == "$last_head" ]]; then
    (( stuck++ ))
    echo "no commit this iteration (${stuck}x in a row)"
    if (( stuck >= 2 )); then
      echo "two iterations without progress — stopping rather than burning tokens."
      echo "look at: node harness/bin/graph.mjs status"
      exit 1
    fi
  else
    stuck=0
    last_head="$head"
  fi
done

echo
echo "── reached iteration cap ──"
node harness/bin/graph.mjs status
