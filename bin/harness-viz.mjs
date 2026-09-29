#!/usr/bin/env node
// harness-viz — a live, read-only view of any repo built by the harness (specs + task graph +
// loop). Zero dependencies: node's http server, server-sent events, and one static page.
//
//   harness-viz                   serve on http://127.0.0.1:4545 (auto-discovers ~/code/*/harness)
//   harness-viz serve --port 4600
//   harness-viz add <path>        register a project outside ~/code
//   harness-viz remove <path>
//   harness-viz list
//   harness-viz install           run at login via launchd (uninstall | status)

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve, extname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { isHarness, snapshot, signature } from '../lib/project.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(HERE, '..', 'public')
const CONFIG_DIR = join(homedir(), '.config', 'harness-viz')
const REGISTRY = join(CONFIG_DIR, 'projects.json')
const DISCOVER = [join(homedir(), 'code')]

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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function serve(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname

    if (path === '/api/projects') {
      return json(res, 200, projects().map((root) => {
        const s = snapshot(root)
        return { slug: s.name, root, counts: s.counts, total: s.total }
      }))
    }

    const m = path.match(/^\/api\/projects\/([^/]+)(\/events)?$/)
    if (m) {
      const root = bySlug(decodeURIComponent(m[1]))
      if (!root) return json(res, 404, { error: 'no such project' })
      if (!m[2]) return json(res, 200, snapshot(root))

      // Server-sent events: push a fresh snapshot whenever the project's fingerprint changes.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      let last = ''
      const tick = () => {
        const sig = signature(root)
        if (sig !== last) {
          last = sig
          res.write(`data: ${JSON.stringify(snapshot(root))}\n\n`)
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

const LABEL = 'com.julius.harness-viz'
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

function launchdInstall(port) {
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
    <string>${port}</string>
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

/* ---------- cli ------------------------------------------------------------ */

const [cmd = 'serve', ...args] = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

switch (cmd) {
  case 'serve':
    serve(Number(flag('port', process.env.PORT ?? 4545)))
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
  case 'install':
    launchdInstall(Number(flag('port', 4545)))
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
