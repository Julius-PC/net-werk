// The seeded demo: "Larder", a made-up household pantry and meal-planning app, mid-build. It is
// written fresh by `net-werk demo` into a temp folder (with a backdated commit history and a
// simulated loop that really advances tasks), and by `node scripts/seed-demo.mjs` into
// examples/demo for browsing on GitHub. Nothing here is real: no project, people or accounts.

import { writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// [id, title, phase, owner, depends_on, status, notes?]
const H = 'human'
const A = 'agent'
export const TASKS = [
  ['repo-bootstrap', 'Bootstrap the monorepo and CI', 'scaffold', A, [], 'done'],
  ['db-schema', 'Define the SQLite schema for items, recipes and plans', 'scaffold', A, ['repo-bootstrap'], 'done'],
  ['api-skeleton', 'Stand up the API server with health checks', 'scaffold', A, ['repo-bootstrap'], 'done'],
  ['web-shell', 'Build the web app shell, routes and theme tokens', 'scaffold', A, ['repo-bootstrap'], 'done'],
  ['choose-brand', 'Choose the name, palette and type', 'scaffold', H, [], 'done'],
  ['design-tokens', 'Apply the brand to the token layer', 'scaffold', A, ['choose-brand', 'web-shell'], 'done'],
  ['auth-passkeys', 'Add passkey sign-in', 'scaffold', A, ['api-skeleton', 'db-schema'], 'done'],
  ['items-model', 'Model pantry items with quantities and units', 'data', A, ['db-schema'], 'done'],
  ['units-convert', 'Convert between metric and imperial units', 'data', A, ['items-model'], 'done'],
  ['region-units', "Pick default units from the household's region", 'data', A, ['units-convert'], 'blocked',
    'Blocked: needs a decision — which regions default to imperial? specs/units.md only lists the US. Is the UK metric for weight but imperial for milk? Add the answer to specs/units.md.'],
  ['barcode-lookup', 'Look up products by barcode', 'data', A, ['items-model'], 'done'],
  ['food-db-key', 'Register for the open food database API', 'data', H, [], 'done'],
  ['nutrition-import', 'Import nutrition facts for scanned products', 'data', A, ['barcode-lookup', 'food-db-key'], 'done'],
  ['expiry-tracking', 'Track expiry dates and warn before they pass', 'data', A, ['items-model'], 'done'],
  ['recipes-model', 'Model recipes with steps and ingredients', 'data', A, ['db-schema'], 'done'],
  ['recipe-import', 'Import a recipe from any URL', 'data', A, ['recipes-model'], 'done'],
  ['recipe-ocr', 'Scan recipes from photos of cookbooks', 'data', A, ['recipes-model'], 'dropped',
    'Dropped: OCR quality was too low to trust. Replaced by recipe-import.'],
  ['recipe-scaling', 'Scale a recipe to any number of servings', 'data', A, ['recipes-model', 'units-convert'], 'done'],
  ['pantry-match', "Match recipes against what's in the pantry", 'data', A, ['recipe-scaling', 'items-model'], 'done'],
  ['plans-model', 'Model weekly meal plans', 'data', A, ['recipes-model'], 'done'],
  ['import-csv', 'Import a pantry from a CSV export', 'data', A, ['items-model'], 'done'],
  ['api-items', 'Serve pantry items over the API with filters', 'api', A, ['items-model', 'api-skeleton'], 'done'],
  ['api-recipes', 'Serve recipes over the API', 'api', A, ['recipes-model', 'api-skeleton'], 'done'],
  ['api-plans', 'Serve meal plans over the API', 'api', A, ['plans-model', 'api-skeleton'], 'done'],
  ['shopping-list', "Generate a shopping list from the week's plan", 'api', A, ['plans-model', 'pantry-match'], 'done'],
  ['list-sharing', 'Share a shopping list with the household', 'api', A, ['shopping-list', 'auth-passkeys'], 'done'],
  ['webhooks', 'Send webhooks when the list changes', 'api', A, ['list-sharing'], 'done'],
  ['social-feed', 'Add a feed of what friends are cooking', 'api', A, ['api-recipes'], 'dropped',
    'Dropped: out of scope for v1 (specs/product.md, "not now").'],
  ['grocery-terms', "Read the grocery partner's API terms and decide", 'api', H, [], 'todo'],
  ['grocery-order', 'Send the shopping list to a grocery delivery partner', 'api', A, ['shopping-list', 'grocery-terms'], 'todo'],
  ['ui-pantry', 'Build the pantry screen', 'ui', A, ['api-items', 'design-tokens'], 'done'],
  ['ui-scan', 'Build the barcode scanner screen', 'ui', A, ['barcode-lookup', 'ui-pantry'], 'done'],
  ['ui-recipes', 'Build the recipe browser', 'ui', A, ['api-recipes', 'design-tokens'], 'done'],
  ['ui-recipe-page', 'Build the recipe page with scaling', 'ui', A, ['ui-recipes', 'recipe-scaling'], 'done'],
  ['ui-planner', 'Build the drag-and-drop week planner', 'ui', A, ['api-plans', 'ui-recipes'], 'done'],
  ['ui-shopping', 'Build the shopping list screen', 'ui', A, ['shopping-list', 'design-tokens'], 'done'],
  ['ui-expiry', "Show what's about to expire on the home screen", 'ui', A, ['expiry-tracking', 'ui-pantry'], 'done'],
  ['ui-onboarding', 'Build first-run onboarding', 'ui', A, ['ui-pantry', 'auth-passkeys'], 'done'],
  ['empty-states', 'Write the empty states and error copy', 'ui', A, ['ui-onboarding'], 'done'],
  ['a11y-pass', 'Fix every accessibility issue the audit reports', 'ui', A, ['ui-planner', 'ui-shopping', 'ui-recipe-page'], 'done'],
  ['i18n', 'Translate the app into Spanish and German', 'ui', A, ['empty-states'], 'todo'],
  ['i18n-review', 'Have a native speaker review the translations', 'ui', H, ['i18n'], 'todo'],
  ['sync-engine', 'Sync changes between devices, offline-first', 'sync', A, ['api-items', 'api-plans'], 'done'],
  ['sync-conflicts', 'Resolve sync conflicts without losing edits', 'sync', A, ['sync-engine'], 'done'],
  ['push-notify', 'Send expiry reminders as push notifications', 'sync', A, ['expiry-tracking', 'sync-engine'], 'done'],
  ['push-cert', 'Create the push notification certificate', 'sync', H, [], 'done'],
  ['push-ios', 'Deliver push notifications on iOS', 'sync', A, ['push-notify', 'push-cert'], 'done'],
  ['export-backup', 'Export everything as a backup file', 'sync', A, ['sync-engine'], 'done'],
  ['mobile-shell', 'Wrap the web app as an installable mobile app', 'mobile', A, ['web-shell', 'sync-engine'], 'done'],
  ['mobile-camera', 'Use the native camera for scanning', 'mobile', A, ['mobile-shell', 'ui-scan'], 'done'],
  ['mobile-offline', 'Cache the app for offline use', 'mobile', A, ['mobile-shell', 'sync-conflicts'], 'done'],
  ['app-store-account', 'Enrol in the app store developer program', 'mobile', H, [], 'todo'],
  ['ios-beta', 'Ship an iOS beta build', 'mobile', A, ['mobile-offline', 'app-store-account'], 'todo'],
  ['play-account', 'Create the Play Store developer account', 'mobile', H, [], 'todo'],
  ['android-beta', 'Ship an internal Android build', 'mobile', A, ['mobile-offline', 'play-account'], 'todo'],
  ['infra-as-code', 'Describe the infrastructure as code', 'deploy', A, ['api-skeleton'], 'done'],
  ['cloud-account', 'Create the cloud account and a billing alert', 'deploy', H, [], 'done'],
  ['deploy-staging', 'Deploy staging on every push to main', 'deploy', A, ['infra-as-code', 'cloud-account'], 'done'],
  ['backups-nightly', 'Back up the database every night', 'deploy', A, ['deploy-staging'], 'done'],
  ['observability', 'Add error tracking and uptime checks', 'deploy', A, ['deploy-staging'], 'done'],
  ['rate-limits', 'Rate-limit the public API', 'deploy', A, ['deploy-staging', 'api-items'], 'todo'],
  ['load-test', 'Load-test sync at ten times launch traffic', 'deploy', A, ['sync-conflicts', 'deploy-staging'], 'todo'],
  ['security-review', 'Review auth, sync and sharing for security bugs', 'deploy', A, ['list-sharing', 'sync-conflicts', 'auth-passkeys'], 'todo'],
  ['deploy-prod', 'Deploy production behind a manual approval', 'deploy', A, ['deploy-staging', 'backups-nightly', 'observability'], 'todo'],
  ['domain-dns', 'Point the domain at production', 'deploy', H, ['deploy-prod'], 'todo'],
  ['privacy-policy', 'Approve the privacy policy text', 'launch', H, [], 'todo'],
  ['privacy-page', 'Publish the privacy policy and the data export page', 'launch', A, ['privacy-policy', 'export-backup'], 'todo'],
  ['landing-page', 'Build the landing page', 'launch', A, ['design-tokens'], 'done'],
  ['landing-copy', 'Write the landing page copy', 'launch', H, ['landing-page'], 'todo'],
  ['pricing', 'Decide pricing: free, one-off or subscription', 'launch', H, [], 'todo'],
  ['payments', 'Take payments with the chosen pricing', 'launch', A, ['pricing', 'auth-passkeys'], 'todo'],
  ['store-screenshots', 'Generate store screenshots for every screen size', 'launch', A, ['mobile-camera', 'ui-planner'], 'todo'],
  ['changelog', 'Publish a changelog from finished tasks', 'launch', A, ['landing-page'], 'todo'],
  ['help-centre', 'Write the help centre', 'launch', A, ['ui-planner', 'ui-shopping'], 'todo'],
  ['beta-invites', 'Invite the first 50 beta households', 'launch', H, ['ios-beta', 'android-beta'], 'todo'],
  ['launch-review', 'Review every screen at phone and desktop widths', 'launch', A, ['a11y-pass', 'store-screenshots', 'privacy-page'], 'todo'],
  ['launch-day', 'Flip the launch switch', 'launch', H, ['deploy-prod', 'launch-review', 'beta-invites', 'domain-dns'], 'todo'],
]

const SPECS = {
  product: '# Larder — product\n\nA household pantry, recipe and meal-planning app. Scan what you buy, see what is about to\nexpire, plan the week from what you already have, and share one shopping list.\n\n**Not now:** social features, recipe OCR.\n',
  data: '# Data\n\nPantry items, recipes and weekly plans live in SQLite on the server and sync offline-first to\nevery device. Quantities keep their unit; conversions are exact.\n',
  units: '# Units\n\nDefaults follow the household\'s region. The US defaults to imperial.\n',
  api: '# API\n\nJSON over HTTPS. Every write is authorised against the household. Lists can be shared.\n',
  ui: '# UI\n\nPantry, scanner, recipes, week planner, shopping list. Works at 375px and 1440px, light and dark.\n',
  sync: '# Sync\n\nOffline-first. Conflicts merge field by field; nothing a person typed is ever lost.\n',
  mobile: '# Mobile\n\nThe web app, wrapped and installable on iOS and Android, with the native camera.\n',
  deploy: '# Deploy\n\nStaging on every push; production behind a manual approval; nightly backups.\n',
  launch: '# Launch\n\nA landing page, a privacy page, store listings, 50 beta households, then launch.\n',
}
const specFor = (id, phase) => (id === 'region-units' ? 'specs/units.md' : `specs/${phase === 'scaffold' ? 'product' : phase}.md`)

const quote = (v) => (/[:#]|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v))

function taskFile([id, title, phase, owner, deps, status, notes], i) {
  const verify = owner === 'human' ? null : 'npm test'
  const acceptance = owner === 'human'
    ? `${title} — and say so in the task's notes`
    : `${title}, with a test that fails if it breaks`
  const lines = ['---', `id: ${id}`, `title: ${quote(title)}`, `phase: ${phase}`, `status: ${status}`, `owner: ${owner}`,
    `priority: ${1 + (i % 3)}`]
  if (deps.length) lines.push('depends_on:', ...deps.map((d) => `  - ${d}`))
  lines.push(`spec: ${specFor(id, phase)}`)
  if (verify) lines.push(`verify: ${verify}`)
  lines.push('acceptance:', `  - ${quote(acceptance)}`)
  if (notes) lines.push(`notes: ${quote(notes)}`)
  lines.push('---', '', owner === 'human'
    ? `A gate the loop can't pass: ${title.charAt(0).toLowerCase() + title.slice(1)}. Mark it done in net-werk when it's finished.`
    : `${title}. Read ${specFor(id, phase)} first; keep the change to this task.`, '')
  return lines.join('\n')
}

// A simulated loop with the real log format. In a demo copy made by `net-werk demo` (marked by
// .net-werk-demo) it really advances the graph — takes the next task, marks it done, commits —
// but never calls Claude. Anywhere else it only prints, so it can't change your files.
const LOOP = `#!/usr/bin/env bash
# DEMO loop for net-werk — a simulation. Same log format as a real harness loop, but it never
# calls claude. In a copy made by \`net-werk demo\` it advances the graph for real (marks the next
# task done and commits); anywhere else it only prints.
set -uo pipefail
cd "$(dirname "$0")/../.."
MODE="\${1:-build}"; MAX="\${2:-10}"
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
  say 1 "▸ \\$ node harness/bin/graph.mjs next"
  say 1 "▸ read $spec"
  (( live )) && node harness/bin/graph.mjs set "$id" doing >/dev/null
  say 1 "▸ \\$ node harness/bin/graph.mjs set $id doing"
  say 2 "▸ subagent: Read the existing code for $id"
  say 2 "▸ edit src/$id/index.ts"
  say 2 "▸ write src/$id/$id.test.ts"
  say 2 "▸ \\$ npm test"
  say 1 "▸ \\$ node harness/bin/verify.mjs"
  if (( live )); then
    node harness/bin/graph.mjs set "$id" done >/dev/null
    git add -A harness/graph >/dev/null 2>&1
    git commit -q -m "task($id): $(awk -F': ' '/^title:/{print $2; exit}' "harness/graph/$id.md" | tr -d '"')" >/dev/null 2>&1
  fi
  say 1 "▸ \\$ node harness/bin/graph.mjs set $id done && git commit"
  say 1 "agent finished: success in $(( 40 + RANDOM % 300 ))s, $(( 20 + RANDOM % 60 )) turns"
done
echo; echo "── reached iteration cap ──"
`

// The log of the last run: 20 build iterations that ended at the cap, nine hours before `now`.
function loopLog(now) {
  const end = new Date(now - 9 * 3600e3)
  const start = new Date(end - 20 * 21 * 60e3)
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const hms = (d) => stamp(d).slice(11)
  const done = TASKS.filter((t) => t[5] === 'done' && t[3] === A).slice(-20)
  const out = ['', `════ ${stamp(start)} ════`, '── loop: mode=build max=20 ──']
  done.forEach(([id, title, phase], k) => {
    let at = new Date(+start + k * 21 * 60e3 + 4000)
    const line = (s, gap = 40) => { at = new Date(+at + gap * 1000); out.push(`${hms(at)}  ${s}`) }
    out.push('', `── iteration ${k + 1}/20 ──────────────────────────────────`, `### NEXT TASK — ${id}`)
    line('agent started (claude)', 3)
    line(`▸ read ${specFor(id, phase)}`)
    line(`▸ $ node harness/bin/graph.mjs set ${id} doing`)
    line(`▸ edit src/${id}/index.ts`, 300)
    line('▸ $ npm test', 240)
    line(`▸ $ node harness/bin/graph.mjs set ${id} done && git commit`, 200)
    line(`agent finished: success in ${300 + ((k * 37) % 500)}s, ${30 + ((k * 13) % 70)} turns`, 5)
  })
  out.push('', '── reached iteration cap ──', '')
  return out.join('\n')
}

// Write the project's files. `live` adds the marker that lets the demo loop advance tasks.
export function writeDemo(dir, { now = Date.now(), live = false } = {}) {
  for (const sub of ['specs', 'harness/graph', 'harness/bin', 'harness/prompts']) mkdirSync(join(dir, sub), { recursive: true })
  for (const [name, text] of Object.entries(SPECS)) writeFileSync(join(dir, 'specs', `${name}.md`), text)
  TASKS.forEach((t, i) => writeFileSync(join(dir, 'harness', 'graph', `${t[0]}.md`), taskFile(t, i)))
  writeFileSync(join(dir, 'harness', 'bin', 'loop.sh'), LOOP)
  chmodSync(join(dir, 'harness', 'bin', 'loop.sh'), 0o755)
  writeFileSync(join(dir, 'harness', 'prompts', 'build.md'), 'Demo prompt — the demo loop is a simulation and never reads it.\n')
  writeFileSync(join(dir, 'harness', 'prompts', 'plan.md'), 'Demo prompt — the demo loop is a simulation and never reads it.\n')
  writeFileSync(join(dir, 'harness', '.loop.log'), loopLog(now))
  writeFileSync(join(dir, 'README.md'), '# Larder (net-werk demo)\n\nA made-up project, seeded by `net-werk demo` so you can try the dashboard. Nothing here is real.\n')
  writeFileSync(join(dir, '.gitignore'), 'harness/.loop.log\n.net-werk-demo\n')
  if (live) writeFileSync(join(dir, '.net-werk-demo'), 'This folder is a net-werk demo copy; its loop may change files here.\n')
}

// A believable history: the plan, then one task(...) commit per finished task, spread over the
// two days before the last run ended. Commits are empty except the first; only messages and
// dates matter to the dashboard.
export function seedHistory(dir, { now = Date.now() } = {}) {
  const git = (args, at) => execFileSync('git', ['-C', dir, ...args], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_AUTHOR_NAME: 'net-werk demo', GIT_AUTHOR_EMAIL: 'demo@net-werk.invalid', GIT_COMMITTER_NAME: 'net-werk demo', GIT_COMMITTER_EMAIL: 'demo@net-werk.invalid' },
  })
  git(['init', '-q'], new Date(now).toISOString())
  git(['config', 'user.name', 'net-werk demo'])
  git(['config', 'user.email', 'demo@net-werk.invalid'])
  const done = TASKS.filter((t) => t[5] === 'done')
  const first = now - 2 * 86400e3
  const last = now - 9 * 3600e3
  const step = (last - first) / (done.length + 3)
  git(['add', '-A'], new Date(first).toISOString())
  git(['commit', '-q', '-m', 'plan: scaffold the harness'], new Date(first).toISOString())
  let at = first
  done.forEach(([id, title], k) => {
    at += step
    if (k === 14) git(['commit', '-q', '--allow-empty', '-m', 'spec: drop recipe OCR; import from URLs instead'], new Date(at - step / 2).toISOString())
    if (k === 15) git(['commit', '-q', '--allow-empty', '-m', 'plan: drop recipe-ocr, point at recipe-import'], new Date(at - step / 3).toISOString())
    git(['commit', '-q', '--allow-empty', '-m', `task(${id}): ${title}`], new Date(at).toISOString())
  })
}
