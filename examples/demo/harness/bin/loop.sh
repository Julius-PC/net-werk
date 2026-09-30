#!/usr/bin/env bash
# DEMO loop — a simulation for trying net-work's play/stop controls. It prints the same log
# format as a real harness loop (see the README) but never calls claude and changes no files
# except harness/.loop.log. A real loop.sh runs one `claude -p` per iteration instead.
set -uo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:-build}"; MAX="${2:-10}"
[[ -f "harness/prompts/${MODE}.md" ]] || { echo "no prompt for mode '$MODE'"; exit 2; }
exec > >(tee -a harness/.loop.log) 2>&1
echo; echo "════ $(date '+%Y-%m-%d %H:%M:%S') ════"; echo "── loop: mode=$MODE max=$MAX ──"
t() { date '+%H:%M:%S'; }
for (( i = 1; i <= MAX; i++ )); do
  echo; echo "── iteration $i/$MAX ──────────────────────────────────"
  sleep 1; echo "$(t)  agent started (demo)"
  sleep 2; echo "$(t)  ▸ read specs/site.md"
  sleep 2; echo "$(t)  ▸ \$ node harness/bin/graph.mjs next"
  sleep 2; echo "$(t)  ▸ edit src/search/index.js"
  sleep 3; echo "$(t)  ▸ \$ npm run build"
  sleep 2; echo "$(t)  agent finished: success in 12s, 9 turns"
  echo "no commit this iteration (demo — nothing is really built)"
done
echo; echo "── reached iteration cap ──"
