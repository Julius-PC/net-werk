// Reads one harness project from disk: its task graph, its git history, and its loop log.
// Read-only by design — the visualizer never writes to a project it watches.
//
// The frontmatter parser is the same small YAML subset harness/bin/graph.mjs accepts
// (scalars, inline arrays, dash lists), so any project the harness can load, this can load.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const unquote = (s) => {
  const m = s.match(/^"(.*)"$/)
  if (m) {
    try { return JSON.parse(s) } catch { return m[1] }
  }
  return s.replace(/^'(.*)'$/, '$1')
}

export function parseTask(raw, file) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`${file}: missing YAML frontmatter`)
  const [, head, body] = m
  const data = {}
  let listKey = null
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) { data[listKey].push(unquote(item[1].trim())); continue }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, rawValue] = kv
    const value = rawValue.trim()
    listKey = null
    if (value === '') { data[key] = []; listKey = key }
    else if (value.startsWith('[')) {
      const inner = value.slice(1, value.lastIndexOf(']')).trim()
      data[key] = inner ? inner.split(',').map((s) => unquote(s.trim())) : []
    } else if (/^-?\d+$/.test(value)) data[key] = Number(value)
    else data[key] = unquote(value)
  }
  return { ...data, depends_on: data.depends_on ?? [], priority: data.priority ?? 3, body: body.trim() }
}

export function isHarness(root) {
  return existsSync(join(root, 'harness', 'graph'))
}

export function loadGraph(root) {
  const dir = join(root, 'harness', 'graph')
  const tasks = []
  const problems = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
    const path = join(dir, file)
    try {
      const task = parseTask(readFileSync(path, 'utf8'), file)
      task.updated_at = statSync(path).mtime.toISOString()
      tasks.push(task)
    } catch (err) {
      problems.push(err.message)
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const t of tasks) {
    t.ready = t.status === 'todo' && t.depends_on.every((d) => byId.get(d)?.status === 'done')
    t.waits_on = t.depends_on.filter((d) => byId.get(d)?.status !== 'done')
    for (const d of t.depends_on) if (!byId.has(d)) problems.push(`${t.id}: unknown dependency '${d}'`)
  }
  return { tasks, problems }
}

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

export function loadCommits(root, n = 60) {
  const SEP = '\x1f'
  const out = git(root, ['log', `-n${n}`, `--pretty=%h${SEP}%aI${SEP}%s`])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, date, subject] = line.split(SEP)
      const task = subject.match(/^task\(([a-z0-9-]+)\)/)?.[1] ?? null
      return { hash, date, subject, task }
    })
}

export function loadLoopLog(root, lines = 80) {
  const path = join(root, 'harness', '.loop.log')
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8')
  return { updated_at: statSync(path).mtime.toISOString(), tail: text.split('\n').slice(-lines).join('\n') }
}

// A cheap fingerprint: changes whenever a task file, git HEAD or the loop log changes.
export function signature(root) {
  const parts = []
  const dir = join(root, 'harness', 'graph')
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) parts.push(f + statSync(join(dir, f)).mtimeMs)
  }
  parts.push(git(root, ['rev-parse', 'HEAD']).trim())
  const log = join(root, 'harness', '.loop.log')
  if (existsSync(log)) parts.push(String(statSync(log).mtimeMs))
  return parts.join('|')
}

export function snapshot(root) {
  const { tasks, problems } = loadGraph(root)
  const commits = loadCommits(root)
  const lastCommitByTask = {}
  for (const c of commits) if (c.task && !lastCommitByTask[c.task]) lastCommitByTask[c.task] = c
  for (const t of tasks) t.commit = lastCommitByTask[t.id] ?? null
  const counts = { todo: 0, doing: 0, done: 0, blocked: 0 }
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
  return {
    name: basename(root),
    root,
    tasks,
    problems,
    counts,
    total: tasks.length,
    commits: commits.slice(0, 25),
    loop: loadLoopLog(root),
    loaded_at: new Date().toISOString(),
  }
}
