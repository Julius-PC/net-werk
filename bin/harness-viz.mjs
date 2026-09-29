#!/usr/bin/env node
// harness-viz — a live, read-only view of any repo built by the harness (specs + task graph +
// loop). Zero dependencies: node's http server, server-sent events, and one static page.
//
//   harness-viz                   serve on http://127.0.0.1:4545 (auto-discovers ~/code/*/harness)
//   harness-viz serve --port 4600
//   harness-viz add <path>        register a project outside ~/code
//   harness-viz remove <path>
//   harness-viz list

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
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
  // Loopback only: this shows private project plans.
  server.listen(port, '127.0.0.1', () => {
    console.log(`harness-viz → http://127.0.0.1:${port}`)
    for (const p of projects()) console.log(`  · ${p}`)
  })
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
  default:
    console.error(`unknown command '${cmd}'. try: serve | add <path> | remove <path> | list`)
    process.exit(2)
}
