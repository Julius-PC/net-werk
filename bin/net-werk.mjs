#!/usr/bin/env node
// net-werk — a live view of any repo built by the harness (specs + task graph + loop): the net
// of tasks, and whether it's working.
// Zero dependencies: node's http server, server-sent events, and one static page. It reads
// projects; the only things it changes are starting/stopping a project's own loop.sh from the
// page (off with --read-only) and one "stopped" line in that loop's log.
//
//   net-werk                      serve on http://127.0.0.1:4545 (auto-discovers ~/code/*/harness)
//   net-werk serve --port 4600 [--read-only]
//   net-werk open [path]          start the server if needed and open that project's page
//   net-werk info [path]          plain-text state: progress, doing, loop, why it stopped
//   net-werk demo                 open a seeded demo project you can run and poke at safely
//   net-werk init [path]          copy the harness kit (engine, loop, gates, prompts) into a project
//   net-werk start [path] [--mode build] [--iterations 10]
//   net-werk stop [path]
//   net-werk done <path> <task>   mark one of your (owner: human) tasks done, and commit it
//   net-werk unblock <path> <task> [--note "what you provided"]
//   net-werk add <path> | remove <path> | list
//   net-werk install              run at login via launchd (uninstall | status)

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, openSync, copyFileSync, statSync, chmodSync, appendFileSync, rmSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join, dirname, resolve, extname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { isHarness, snapshot, signature, loopProcesses, real } from '../lib/project.mjs'
import { writeDemo, seedHistory } from '../lib/demo.mjs'
import { controls, startLoop, stopLoop, markTask } from '../lib/control.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(HERE, '..', 'public')
// NET_WERK_CONFIG points at a different registry, e.g. to try fixtures without touching yours.
// (This tool used to be called harness-viz, then net-work; the old config folder and env names
// still work.)
const LEGACY_DIR = join(homedir(), '.config', 'harness-viz')
const CONFIG_DIR = process.env.NET_WERK_CONFIG ?? process.env.NET_WORK_CONFIG ?? process.env.HARNESS_VIZ_CONFIG
  ?? (existsSync(LEGACY_DIR) && !existsSync(join(homedir(), '.config', 'net-werk')) ? LEGACY_DIR : join(homedir(), '.config', 'net-werk'))
const REGISTRY = join(CONFIG_DIR, 'projects.json')
// Folders whose immediate subfolders are checked for harness/graph/. NET_WERK_DISCOVER takes a
// PATH-style list; the default is ~/code.
const DISCOVER = (process.env.NET_WERK_DISCOVER ?? process.env.NET_WORK_DISCOVER ?? process.env.HARNESS_VIZ_DISCOVER ?? join(homedir(), 'code')).split(':').filter(Boolean)

/* ---------- registry ------------------------------------------------------- */

const readRegistry = () => (existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : { projects: [] })
const writeRegistry = (r) => {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(REGISTRY, JSON.stringify(r, null, 2) + '\n')
}

function projects() {
  const roots = new Set(readRegistry().projects.map((p) => resolve(p)))
  for (const base of DISCOVER) {
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base)) {
      const root = join(base, entry)
      if (isHarness(root)) roots.add(root)
    }
  }
  return [...roots].filter(isHarness).sort()
}

const bySlug = (slug) => projects().find((p) => p.split('/').pop() === slug)

/* ---------- server --------------------------------------------------------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

// Only this machine, by this name. The Host check stops DNS rebinding (a web page whose domain
// re-resolves to 127.0.0.1 would otherwise be same-origin with us); the custom header on writes
// stops cross-site requests, because a page can't send it without a CORS preflight we never answer.
const hostOk = (req, port) => [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)
const writeOk = (req) =>
  req.headers['x-net-werk'] === '1' && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)

async function body(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 4096) throw Object.assign(new Error('body too large'), { status: 413 })
  }
  try { return JSON.parse(raw || '{}') } catch { throw Object.assign(new Error('body must be JSON'), { status: 400 }) }
}

function projectSummary(root) {
  const s = snapshot(root)
  return { slug: s.name, root, counts: s.counts, total: s.total, running: s.runner.running }
}

function serve(port, readOnly) {
  const server = createServer(async (req, res) => {
    if (!hostOk(req, port)) return json(res, 421, { error: 'wrong host' })
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname

    const act = path.match(/^\/api\/projects\/([^/]+)\/loop\/(start|stop)$/)
    if (act) {
      if (req.method !== 'POST' || !writeOk(req)) return json(res, 403, { error: 'forbidden' })
      if (readOnly) return json(res, 403, { error: 'this server was started with --read-only' })
      const root = bySlug(decodeURIComponent(act[1]))
      if (!root) return json(res, 404, { error: 'no such project' })
      try {
        const result = act[2] === 'start' ? await startLoop(root, await body(req), CONFIG_DIR) : await stopLoop(root)
        return json(res, 200, result)
      } catch (err) {
        return json(res, err.status ?? 500, { error: err.message })
      }
    }
    const mark = path.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/)
    if (mark) {
      if (req.method !== 'POST' || !writeOk(req)) return json(res, 403, { error: 'forbidden' })
      if (readOnly) return json(res, 403, { error: 'this server was started with --read-only' })
      const root = bySlug(decodeURIComponent(mark[1]))
      if (!root) return json(res, 404, { error: 'no such project' })
      try {
        return json(res, 200, markTask(root, decodeURIComponent(mark[2]), await body(req)))
      } catch (err) {
        return json(res, err.status ?? 500, { error: err.message })
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })

    if (path === '/api/projects') {
      return json(res, 200, projects().flatMap((root) => {
        try { return [projectSummary(root)] } catch { return [] } // skip one that vanished mid-scan
      }))
    }

    const m = path.match(/^\/api\/projects\/([^/]+)(\/events)?$/)
    if (m) {
      const root = bySlug(decodeURIComponent(m[1]))
      if (!root) return json(res, 404, { error: 'no such project' })
      const snap = () => ({ ...snapshot(root), controls: readOnly ? { script: false, modes: [], read_only: true } : controls(root) })
      if (!m[2]) {
        try { return json(res, 200, snap()) } catch (err) { return json(res, 410, { error: `can't read ${root}: ${err.message}` }) }
      }

      // Server-sent events: push a fresh snapshot whenever the project's fingerprint changes.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      let last = ''
      let timer = null
      const tick = () => {
        try {
          const sig = signature(root)
          if (sig !== last) {
            last = sig
            res.write(`data: ${JSON.stringify(snap())}\n\n`)
          } else {
            res.write(': ping\n\n')
          }
        } catch (err) {
          // The project went away under us (deleted, moved, renamed). Tell the page and stop
          // watching it — one vanished folder must not take the whole server down.
          clearInterval(timer)
          res.write(`event: gone\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
          res.end()
        }
      }
      tick()
      timer = setInterval(tick, 1500)
      req.on('close', () => clearInterval(timer))
      return
    }

    const file = path === '/' || path.startsWith('/p/') ? 'index.html' : path.slice(1)
    const abs = join(PUBLIC, file)
    if (!abs.startsWith(PUBLIC) || !existsSync(abs)) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, { 'content-type': TYPES[extname(abs)] ?? 'text/plain', 'cache-control': 'no-store' })
    res.end(readFileSync(abs))
  })
  // A second launch is usually harmless: say whether net-werk already owns the port.
  server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') throw err
    const ours = await fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.ok, () => false)
    if (ours) {
      console.log(`net-werk is already running → http://127.0.0.1:${port}`)
      process.exit(0)
    }
    console.error(`port ${port} is taken by something else — try: net-werk serve --port ${port + 1}`)
    process.exit(1)
  })
  // Loopback only: this shows private project plans.
  server.listen(port, '127.0.0.1', () => {
    console.log(`net-werk → http://127.0.0.1:${port}`)
    for (const p of projects()) console.log(`  · ${p}`)
  })
}

/* ---------- launchd -------------------------------------------------------- */
// A per-user LaunchAgent: starts at login, restarts if it dies. KeepAlive + ThrottleInterval
// means that if the port is briefly busy (another copy running), launchd simply retries.

const LABEL = 'dev.net-werk'
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const LOG = join(homedir(), 'Library', 'Logs', 'net-werk.log')
const uid = () => execFileSync('id', ['-u'], { encoding: 'utf8' }).trim()
const launchctl = (...a) => {
  try {
    return execFileSync('launchctl', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    return String(err.stdout || '') + String(err.stderr || '')
  }
}

function launchdInstall(port, readOnly) {
  const script = fileURLToPath(import.meta.url)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${script}</string>
    <string>serve</string>
    <string>--port</string>
    <string>${port}</string>${readOnly ? '\n    <string>--read-only</string>' : ''}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string></dict>
</dict>
</plist>
`
  mkdirSync(dirname(PLIST), { recursive: true })
  launchctl('bootout', `gui/${uid()}/${LABEL}`) // replace any older version
  writeFileSync(PLIST, xml)
  const out = launchctl('bootstrap', `gui/${uid()}`, PLIST)
  if (out.trim()) console.log(out.trim())
  console.log(`installed ${PLIST}`)
  console.log(`net-werk will run at login → http://127.0.0.1:${port}  (log: ${LOG})`)
}

function launchdUninstall() {
  launchctl('bootout', `gui/${uid()}/${LABEL}`)
  if (existsSync(PLIST)) unlinkSync(PLIST)
  console.log(`removed ${LABEL}`)
}

async function launchdStatus(port) {
  const installed = existsSync(PLIST)
  const loaded = !/could not find/i.test(launchctl('print', `gui/${uid()}/${LABEL}`))
  const up = await fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.ok, () => false)
  console.log(`launch agent: ${installed ? (loaded ? 'installed, loaded' : 'installed, not loaded') : 'not installed'}`)
  console.log(`server:       ${up ? `answering on http://127.0.0.1:${port}` : 'not answering'}`)
}

/* ---------- on demand ------------------------------------------------------- */
// `open`, `start` and `stop` are the no-launchd path: make sure a server is answering (start a
// detached one if not) and register the project if it lives outside the discovered folders.

const base = (port) => `http://127.0.0.1:${port}`
const up = (port) => fetch(`${base(port)}/api/projects`).then((r) => r.ok, () => false)

async function ensureServer(port) {
  if (await up(port)) return
  mkdirSync(dirname(LOG), { recursive: true })
  const out = openSync(LOG, 'a')
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', out, out],
  }).unref()
  for (let i = 0; i < 40 && !(await up(port)); i++) await new Promise((r) => setTimeout(r, 100))
}

function register(root) {
  if (isHarness(root) && !projects().includes(root)) {
    const r = readRegistry()
    r.projects.push(root)
    writeRegistry(r)
  }
}

const slugOf = (root) => root.split('/').pop()

async function openProject(root, port, noBrowser) {
  register(root)
  await ensureServer(port)
  const slug = isHarness(root) ? slugOf(root) : null
  const url = `${base(port)}${slug ? `/p/${encodeURIComponent(slug)}` : ''}`
  if (!slug) console.log(`${root} has no harness/graph/ yet — opening the project list`)
  console.log(url)
  if (!noBrowser) {
    try { execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }) } catch {}
  }
}

// Start/stop through the server's own API, so the CLI gets the same checks as the page's buttons
// and the page shows the change live.
async function loopCommand(action, root, port, payload = {}) {
  if (!isHarness(root)) {
    console.error(`${root} has no harness/graph/ — scaffold the harness first`)
    process.exit(1)
  }
  register(root)
  await ensureServer(port)
  const res = await fetch(`${base(port)}/api/projects/${encodeURIComponent(slugOf(root))}/loop/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-net-werk': '1' },
    body: JSON.stringify(payload),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`✗ ${out.error ?? `HTTP ${res.status}`}`)
    process.exit(1)
  }
  console.log(action === 'start'
    ? `▶ started: ./harness/bin/loop.sh ${out.mode} ${out.iterations} (pid ${out.pid}) — watch at ${base(port)}/p/${encodeURIComponent(slugOf(root))}`
    : `■ stopped (${out.stopped} process${out.stopped === 1 ? '' : 'es'})`)
}

// What a harness needs before a loop can run: at least one task, a loop script and a build prompt.
function scaffolding(root) {
  const missing = []
  const graph = join(root, 'harness', 'graph')
  const tasks = existsSync(graph) ? readdirSync(graph).filter((f) => f.endsWith('.md') && f !== 'README.md') : []
  if (!existsSync(graph)) missing.push('harness/graph/')
  else if (!tasks.length) missing.push('tasks in harness/graph/')
  if (!existsSync(join(root, 'harness', 'bin', 'loop.sh'))) missing.push('harness/bin/loop.sh')
  if (!existsSync(join(root, 'harness', 'prompts', 'build.md'))) missing.push('harness/prompts/build.md')
  return missing
}

// `init` copies the harness kit (kit/harness/) into a project: the graph engine, the loop, the
// log formatter, the gates, the task schema and the two prompts. It never overwrites a file that
// is already there. The specs, the tasks and the project rules in the prompts are the plan's to
// write — init only lays down the machinery.
function init(root) {
  if (!existsSync(root)) {
    console.error(`${root} does not exist`)
    process.exit(1)
  }
  const { made, kept } = copyKit(root)
  const rel = (p) => p.slice(root.length + 1)
  console.log(`scaffolded the harness kit into ${root}`)
  for (const p of made) console.log(`  + ${rel(p)}`)
  for (const p of kept) console.log(`  = ${rel(p)} (already there, kept)`)
  try { execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: 'ignore' }) } catch { console.log('  ! not a git repository yet — run `git init`: the loop measures progress in commits') }
  console.log('next: write specs/, the tasks in harness/graph/, the project rules in harness/prompts/*.md')
  console.log('      and the gates in harness/bin/verify.mjs; then validate, verify and commit as `plan: …`')
}

function copyKit(root) {
  const kit = join(HERE, '..', 'kit', 'harness')
  const made = []
  const kept = []
  const copy = (from, to) => {
    for (const name of readdirSync(from)) {
      const src = join(from, name)
      const dst = join(to, name)
      if (statSync(src).isDirectory()) { mkdirSync(dst, { recursive: true }); copy(src, dst); continue }
      if (existsSync(dst)) { kept.push(dst); continue }
      copyFileSync(src, dst)
      if (/\.(sh|mjs)$/.test(name) && dirname(dst).endsWith(join('harness', 'bin'))) chmodSync(dst, 0o755)
      made.push(dst)
    }
  }
  mkdirSync(join(root, 'harness', 'graph'), { recursive: true })
  mkdirSync(join(root, 'specs'), { recursive: true })
  copy(kit, join(root, 'harness'))
  const ignore = join(root, '.gitignore')
  const ignored = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  if (!ignored.split('\n').includes('harness/.loop.log')) {
    appendFileSync(ignore, `${ignored && !ignored.endsWith('\n') ? '\n' : ''}# the loop's live log, tailed by net-werk\nharness/.loop.log\n`)
    made.push(ignore + ' (+ harness/.loop.log)')
  }
  return { made, kept }
}

// `demo` builds a throwaway copy of the seeded demo project ("Larder") in the temp folder — files,
// the harness kit, and a backdated commit history — then opens it. Its loop is a simulation that
// really advances tasks there, without calling Claude. Each run starts fresh, unless the demo's
// loop is running right now.
async function demo(port, noBrowser) {
  const dir = join(tmpdir(), 'net-werk-demo', 'larder')
  const running = existsSync(dir) && loopProcesses({ fresh: true })?.get(real(dir))?.length
  if (existsSync(dir) && !running) {
    if (!existsSync(join(dir, '.net-werk-demo'))) {
      console.error(`${dir} exists and isn't a net-werk demo — not touching it`)
      process.exit(1)
    }
    rmSync(dir, { recursive: true, force: true })
  }
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    writeDemo(dir, { live: true })
    copyKit(dir)
    seedHistory(dir)
    console.log(`seeded the demo project in ${dir}`)
  } else {
    console.log('the demo loop is running — opening it as it is')
  }
  await openProject(dir, port, noBrowser)
  console.log('press ▶ to watch it build (simulated: no model is called), or try ✓ Mark done on a "you" task')
}

async function taskCommand(root, id, to, note, port) {
  if (!id) {
    console.error(`usage: net-werk ${to === 'done' ? 'done' : 'unblock'} <path> <task-id>${to === 'todo' ? ' [--note "what you provided"]' : ''}`)
    process.exit(2)
  }
  register(root)
  await ensureServer(port)
  const res = await fetch(`${base(port)}/api/projects/${encodeURIComponent(slugOf(root))}/tasks/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-net-werk': '1' },
    body: JSON.stringify({ to, note }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`✗ ${out.error ?? `HTTP ${res.status}`}`)
    process.exit(1)
  }
  console.log(`${to === 'done' ? '✓' : '↺'} ${id} → ${out.status}${out.committed ? ' (committed)' : ''}`)
  if (out.warning) console.log(`  ! ${out.warning}`)
}

// A plain-text read of a project, for terminals and for agents: what's done, what's in doing,
// whether a loop is running, why it last stopped, and what's waiting on a human.
function info(root) {
  const missing = scaffolding(root)
  if (!isHarness(root) || missing.includes('tasks in harness/graph/')) {
    console.log(`${root}: not scaffolded — missing ${missing.join(', ')}`)
    process.exit(1)
  }
  const s = snapshot(root)
  const c = controls(root)
  const r = s.runner
  const doing = s.tasks.find((t) => t.status === 'doing')
  const ready = s.tasks.filter((t) => t.ready)
  const lines = [
    `${s.name}: ${s.counts.done}/${s.total} done${s.counts.dropped ? ` · ${s.counts.dropped} dropped` : ''}${s.counts.blocked ? ` · ${s.counts.blocked} blocked` : ''}`,
    r.running
      ? `loop: ${r.run?.phase === 'replanning' ? 're-planning' : 'running'} (pid ${r.pid}) · ${r.run?.mode ?? '?'} iteration ${r.run?.iteration ?? '?'}/${r.run?.max ?? '?'}`
      : r.stop ? `loop: not running — ${r.stop.title}: ${r.stop.why} (${r.stop.at})` : `loop: not running${s.loop ? '' : ' — no loop has run here yet'}`,
    doing ? `doing: ${doing.id} — ${doing.title}${!r.running ? ' (STALLED: nothing is working on it)' : r.run?.phase === 'replanning' ? ' (on hold while the loop re-plans)' : ''}${doing.notes ? `\n  notes: ${doing.notes}` : ''}` : 'doing: —',
    `ready for the agent: ${ready.filter((t) => t.owner === 'agent').map((t) => t.id).join(', ') || '—'}`,
    `waiting on you: ${ready.filter((t) => t.owner === 'human').map((t) => t.id).join(', ') || '—'}`,
    ...s.tasks.filter((t) => t.status === 'blocked').map((t) => `blocked: ${t.id} — ${t.notes ?? 'no note'}`),
    `can start: ${missing.length ? `no — missing ${missing.join(', ')}` : `yes — modes ${c.modes.join(', ')}`}`,
  ]
  if (s.problems.length) lines.push(`graph problems: ${s.problems.join('; ')}`)
  console.log(lines.join('\n'))
}

/* ---------- cli ------------------------------------------------------------ */

const [cmd = 'serve', ...args] = process.argv.slice(2)
const VALUED = new Set(['--port', '--mode', '--iterations', '--note'])
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
// Positional arguments, skipping flags and the values that belong to them.
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]))
const rootArg = () => resolve(positional[0] ?? '.')
const PORT = Number(flag('port', process.env.PORT ?? 4545))

switch (cmd) {
  case 'serve':
    serve(PORT, args.includes('--read-only'))
    break
  case 'add': {
    const root = rootArg()
    if (!isHarness(root)) {
      console.error(`${root} has no harness/graph/ — not a harness project`)
      process.exit(1)
    }
    register(root)
    console.log(`added ${root}`)
    break
  }
  case 'remove': {
    const root = rootArg()
    const r = readRegistry()
    r.projects = r.projects.filter((p) => p !== root)
    writeRegistry(r)
    console.log(`removed ${root}`)
    break
  }
  case 'list':
    for (const p of projects()) console.log(p)
    break
  case 'open':
    openProject(rootArg(), PORT, args.includes('--no-browser'))
    break
  case 'demo':
    demo(PORT, args.includes('--no-browser'))
    break
  case 'init':
    init(rootArg())
    break
  case 'info':
    info(rootArg())
    break
  case 'start':
    loopCommand('start', rootArg(), PORT, { mode: flag('mode', 'build'), iterations: Number(flag('iterations', 10)) })
    break
  case 'stop':
    loopCommand('stop', rootArg(), PORT)
    break
  case 'done':
    taskCommand(rootArg(), positional[1], 'done', null, PORT)
    break
  case 'unblock':
    taskCommand(rootArg(), positional[1], 'todo', flag('note', ''), PORT)
    break
  case 'install':
    launchdInstall(PORT, args.includes('--read-only'))
    break
  case 'uninstall':
    launchdUninstall()
    break
  case 'status':
    launchdStatus(PORT)
    break
  default:
    console.error(`unknown command '${cmd}'. try: serve | open | demo | init | info | start | stop | done | unblock | add | remove | list | install | uninstall | status`)
    process.exit(2)
}
