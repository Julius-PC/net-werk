#!/usr/bin/env node
// harness-viz — a live view of any repo built by the harness (specs + task graph + loop).
// Zero dependencies: node's http server, server-sent events, and one static page. It reads
// projects; the only things it changes are starting/stopping a project's own loop.sh from the
// page (off with --read-only) and one "stopped" line in that loop's log.
//
//   harness-viz                   serve on http://127.0.0.1:4545 (auto-discovers ~/code/*/harness)
//   harness-viz serve --port 4600 [--read-only]
//   harness-viz add <path>        register a project outside the discovered folders
//   harness-viz remove <path>
//   harness-viz open [path]       start the server if needed and open that project's page
//   harness-viz list
//   harness-viz install           run at login via launchd (uninstall | status)

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, openSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join, dirname, resolve, extname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { isHarness, snapshot, signature } from '../lib/project.mjs'
import { controls, startLoop, stopLoop } from '../lib/control.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(HERE, '..', 'public')
// HARNESS_VIZ_CONFIG points at a different registry, e.g. to try fixtures without touching yours.
const CONFIG_DIR = process.env.HARNESS_VIZ_CONFIG ?? join(homedir(), '.config', 'harness-viz')
const REGISTRY = join(CONFIG_DIR, 'projects.json')
// Folders whose immediate subfolders are checked for harness/graph/. HARNESS_VIZ_DISCOVER takes
// a PATH-style list; the default is ~/code.
const DISCOVER = (process.env.HARNESS_VIZ_DISCOVER ?? join(homedir(), 'code')).split(':').filter(Boolean)

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
  req.headers['x-harness-viz'] === '1' && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)

async function body(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 4096) throw Object.assign(new Error('body too large'), { status: 413 })
  }
  try { return JSON.parse(raw || '{}') } catch { throw Object.assign(new Error('body must be JSON'), { status: 400 }) }
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
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })

    if (path === '/api/projects') {
      return json(res, 200, projects().map((root) => {
        const s = snapshot(root)
        return { slug: s.name, root, counts: s.counts, total: s.total, running: s.runner.running }
      }))
    }

    const m = path.match(/^\/api\/projects\/([^/]+)(\/events)?$/)
    if (m) {
      const root = bySlug(decodeURIComponent(m[1]))
      if (!root) return json(res, 404, { error: 'no such project' })
      const snap = () => ({ ...snapshot(root), controls: readOnly ? { script: false, modes: [], read_only: true } : controls(root) })
      if (!m[2]) return json(res, 200, snap())

      // Server-sent events: push a fresh snapshot whenever the project's fingerprint changes.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      let last = ''
      const tick = () => {
        const sig = signature(root)
        if (sig !== last) {
          last = sig
          res.write(`data: ${JSON.stringify(snap())}\n\n`)
        } else {
          res.write(': ping\n\n')
        }
      }
      tick()
      const timer = setInterval(tick, 1500)
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
  // A second launch is usually harmless: say whether harness-viz already owns the port.
  server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') throw err
    const ours = await fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.ok, () => false)
    if (ours) {
      console.log(`harness-viz is already running → http://127.0.0.1:${port}`)
      process.exit(0)
    }
    console.error(`port ${port} is taken by something else — try: harness-viz serve --port ${port + 1}`)
    process.exit(1)
  })
  // Loopback only: this shows private project plans.
  server.listen(port, '127.0.0.1', () => {
    console.log(`harness-viz → http://127.0.0.1:${port}`)
    for (const p of projects()) console.log(`  · ${p}`)
  })
}

/* ---------- launchd -------------------------------------------------------- */
// A per-user LaunchAgent: starts at login, restarts if it dies. KeepAlive + ThrottleInterval
// means that if the port is briefly busy (another copy running), launchd simply retries.

const LABEL = 'dev.harness-viz'
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const LOG = join(homedir(), 'Library', 'Logs', 'harness-viz.log')
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
  console.log(`harness-viz will run at login → http://127.0.0.1:${port}  (log: ${LOG})`)
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
// `open` is the no-launchd path: make sure a server is answering (start a detached one if
// not), register the project if it lives outside ~/code, then open its page.

async function openProject(pathArg, port, noBrowser) {
  const root = resolve(pathArg ?? '.')
  const slug = isHarness(root) ? root.split('/').pop() : null
  if (isHarness(root) && !projects().includes(root)) {
    const r = readRegistry()
    r.projects.push(root)
    writeRegistry(r)
  }
  const up = () => fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.ok, () => false)
  if (!(await up())) {
    mkdirSync(dirname(LOG), { recursive: true })
    const out = openSync(LOG, 'a')
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--port', String(port)], {
      detached: true,
      stdio: ['ignore', out, out],
    }).unref()
    for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100))
  }
  const url = `http://127.0.0.1:${port}${slug ? `/p/${encodeURIComponent(slug)}` : ''}`
  if (!slug) console.log(`${root} has no harness/graph/ yet — opening the project list`)
  console.log(url)
  if (!noBrowser) execFileSync('open', [url])
}

/* ---------- cli ------------------------------------------------------------ */

const [cmd = 'serve', ...args] = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

switch (cmd) {
  case 'serve':
    serve(Number(flag('port', process.env.PORT ?? 4545)), args.includes('--read-only'))
    break
  case 'add': {
    const root = resolve(args[0] ?? '.')
    if (!isHarness(root)) {
      console.error(`${root} has no harness/graph/ — not a harness project`)
      process.exit(1)
    }
    const r = readRegistry()
    if (!r.projects.includes(root)) r.projects.push(root)
    writeRegistry(r)
    console.log(`added ${root}`)
    break
  }
  case 'remove': {
    const root = resolve(args[0] ?? '.')
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
    openProject(args.find((a) => !a.startsWith('--')), Number(flag('port', 4545)), args.includes('--no-browser'))
    break
  case 'install':
    launchdInstall(Number(flag('port', 4545)), args.includes('--read-only'))
    break
  case 'uninstall':
    launchdUninstall()
    break
  case 'status':
    launchdStatus(Number(flag('port', 4545)))
    break
  default:
    console.error(`unknown command '${cmd}'. try: serve | add <path> | remove <path> | list`)
    process.exit(2)
}
