#!/usr/bin/env bash
# DEMO loop for net-werk — a simulation. Same log format as a real harness loop, but it never
# calls claude. In a copy made by `net-werk demo` it advances the graph for real (marks the next
# task done and commits); anywhere else it only prints.
set -uo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:-build}"; MAX="${2:-10}"
exec > >(tee -a harness/.loop.log) 2>&1
echo; echo "════ $(date '+%Y-%m-%d %H:%M:%S') ════"; echo "── loop: mode=$MODE max=$MAX ──"
t() { date '+%H:%M:%S'; }
say() { sleep "$1"; echo "$(t)  $2"; }
live=0; [[ -f .net-werk-demo && -f harness/bin/graph.mjs ]] && live=1
for (( i = 1; i <= MAX; i++ )); do
  echo; echo "── iteration $i/$MAX ──────────────────────────────────"
  if (( live )); then
    brief=$(node harness/bin/graph.mjs next); status=$?
    [[ $status -eq 3 ]] && { echo "nothing left for the agent — stopping."; exit 0; }
    [[ $status -eq 4 ]] && { echo "every task is done — stopping."; exit 0; }
    echo "$brief" | head -3
    id=$(echo "$brief" | awk '/^id:/{print $2}'); spec=$(echo "$brief" | awk '/^spec:/{print $2}')
  else
    id="search-index"; spec="specs/product.md"
  fi
  say 1 "agent started (demo — no model is called)"
  say 1 "» Orienting: reading the rules and the next task."
  say 1 "▸ \$ node harness/bin/graph.mjs next"
  say 1 "▸ read $spec"
  (( live )) && node harness/bin/graph.mjs set "$id" doing >/dev/null
  say 1 "▸ \$ node harness/bin/graph.mjs set $id doing"
  say 2 "▸ subagent: Read the existing code for $id"
  say 2 "▸ edit src/$id/index.ts"
  say 2 "▸ write src/$id/$id.test.ts"
  say 2 "▸ \$ npm test"
  say 1 "▸ \$ node harness/bin/verify.mjs"
  if (( live )); then
    node harness/bin/graph.mjs set "$id" done >/dev/null
    git add -A harness/graph >/dev/null 2>&1
    git commit -q -m "task($id): $(awk -F': ' '/^title:/{print $2; exit}' "harness/graph/$id.md" | tr -d '"')" >/dev/null 2>&1
  fi
  say 1 "▸ \$ node harness/bin/graph.mjs set $id done && git commit"
  say 1 "agent finished: success in $(( 40 + RANDOM % 300 ))s, $(( 20 + RANDOM % 60 )) turns"
done
echo; echo "── reached iteration cap ──"
