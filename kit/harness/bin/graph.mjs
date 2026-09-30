#!/usr/bin/env node
// Task graph engine. Zero dependencies on purpose — the harness must not rot when the
// project's dependencies change. (From the net-werk kit: https://github.com/Julius-PC/net-werk)
//
//   node harness/bin/graph.mjs validate      schema + DAG check (run in CI and before every commit)
//   node harness/bin/graph.mjs next          the one task to do now (exit 3: only human work
//                                          left; exit 4: every task is done)
//   node harness/bin/graph.mjs status        where the build is
//   node harness/bin/graph.mjs set <id> <status> [--notes "..."]
//                                          status 'dropped' = superseded, not done; needs --notes
//   node harness/bin/graph.mjs mermaid       graph as a mermaid diagram

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GRAPH_DIR = join(ROOT, 'harness', 'graph')
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'harness', 'schema', 'task.schema.json'), 'utf8'))

/* ---------- frontmatter ---------------------------------------------------- */
// A deliberately small YAML subset: scalars, inline arrays, and dash lists. If a task needs
// more expressiveness than this, the task is too big.

function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`${file}: missing YAML frontmatter`)
  const [, head, body] = m
  const data = {}
  let listKey = null

  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) {
      data[listKey].push(unquote(item[1]))
      continue
    }

    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!kv) throw new Error(`${file}: cannot parse frontmatter line: ${line}`)
    const [, key, rawValue] = kv
    const value = rawValue.trim()
    listKey = null

    if (value === '') {
      data[key] = []
      listKey = key
    } else if (value.startsWith('[')) {
      const inner = value.slice(1, value.lastIndexOf(']')).trim()
      data[key] = inner ? inner.split(',').map((s) => unquote(s.trim())) : []
    } else if (/^-?\d+$/.test(value)) {
      data[key] = Number(value)
    } else {
      data[key] = unquote(value)
    }
  }
  return { data, body: body.trimEnd() }
}

const unquote = (s) => s.replace(/^["'](.*)["']$/, '$1')

function serialize(task, body) {
  const order = ['id', 'title', 'phase', 'status', 'owner', 'priority', 'depends_on', 'spec', 'verify', 'artifacts', 'acceptance', 'notes']
  const lines = ['---']
  for (const key of order) {
    const value = task[key]
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${key}:`)
      for (const v of value) lines.push(`  - ${quote(v)}`)
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`)
    } else {
      lines.push(`${key}: ${quote(value)}`)
    }
  }
  lines.push('---', '', body.trim(), '')
  return lines.join('\n')
}

const quote = (v) => (/[:#]|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v))

/* ---------- schema validation ---------------------------------------------- */
// Subset of JSON Schema: enough to catch the mistakes an agent actually makes.

function validate(task, file) {
  const errors = []
  const props = SCHEMA.properties

  for (const key of SCHEMA.required) {
    if (task[key] === undefined) errors.push(`missing required field '${key}'`)
  }
  for (const [key, value] of Object.entries(task)) {
    const rule = props[key]
    if (!rule) {
      errors.push(`unknown field '${key}'`)
      continue
    }
    const type = Array.isArray(value) ? 'array' : typeof value === 'number' ? 'integer' : 'string'
    if (rule.type !== type) {
      errors.push(`field '${key}': expected ${rule.type}, got ${type}`)
      continue
    }
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`field '${key}': '${value}' not in ${rule.enum.join(' | ')}`)
    }
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
      errors.push(`field '${key}': '${value}' fails ${rule.pattern}`)
    }
    if (rule.minLength && value.length < rule.minLength) {
      errors.push(`field '${key}': shorter than ${rule.minLength}`)
    }
    if (rule.maxLength && value.length > rule.maxLength) {
      errors.push(`field '${key}': longer than ${rule.maxLength}`)
    }
    if (rule.minItems && value.length < rule.minItems) {
      errors.push(`field '${key}': needs at least ${rule.minItems} item(s)`)
    }
    if (rule.items?.pattern) {
      for (const v of value) {
        if (!new RegExp(rule.items.pattern).test(v)) errors.push(`field '${key}': item '${v}' fails ${rule.items.pattern}`)
      }
    }
  }
  if (task.id && basename(file, '.md') !== task.id) {
    errors.push(`id '${task.id}' does not match filename '${basename(file)}'`)
  }
  return errors
}

/* ---------- graph ----------------------------------------------------------- */

function load() {
  const files = readdirSync(GRAPH_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')
  const tasks = []
  const problems = []

  for (const file of files.sort()) {
    const path = join(GRAPH_DIR, file)
    try {
      const { data, body } = parseFrontmatter(readFileSync(path, 'utf8'), file)
      const errors = validate(data, file)
      if (errors.length) problems.push(...errors.map((e) => `${file}: ${e}`))
      tasks.push({ ...data, depends_on: data.depends_on ?? [], priority: data.priority ?? 3, _file: path, _body: body })
    } catch (err) {
      problems.push(`${file}: ${err.message}`)
    }
  }

  const byId = new Map(tasks.map((t) => [t.id, t]))
  if (byId.size !== tasks.length) problems.push('duplicate task ids')

  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!byId.has(dep)) problems.push(`${t.id}: depends on unknown task '${dep}'`)
      // A dropped task never becomes done, so anything still waiting on it would wait forever.
      else if (byId.get(dep).status === 'dropped' && t.status !== 'done' && t.status !== 'dropped') {
        problems.push(`${t.id}: depends on dropped task '${dep}' — point it at whatever replaced it`)
      }
    }
    if (t.status === 'dropped' && !t.notes) problems.push(`${t.id}: dropped without notes saying what replaced it`)
  }
  problems.push(...findCycles(tasks, byId))

  const doing = tasks.filter((t) => t.status === 'doing')
  if (doing.length > 1) problems.push(`more than one task in progress: ${doing.map((t) => t.id).join(', ')}`)

  return { tasks, byId, problems }
}

function findCycles(tasks, byId) {
  const state = new Map() // 0 = visiting, 1 = done
  const problems = []

  const walk = (task, trail) => {
    if (state.get(task.id) === 1) return
    if (state.get(task.id) === 0) {
      problems.push(`dependency cycle: ${[...trail.slice(trail.indexOf(task.id)), task.id].join(' -> ')}`)
      return
    }
    state.set(task.id, 0)
    for (const dep of task.depends_on) {
      const next = byId.get(dep)
      if (next) walk(next, [...trail, task.id])
    }
    state.set(task.id, 1)
  }

  for (const t of tasks) walk(t, [])
  return [...new Set(problems)]
}

const isReady = (task, byId) =>
  task.status === 'todo' && task.depends_on.every((d) => byId.get(d)?.status === 'done')

/* ---------- commands -------------------------------------------------------- */

function cmdValidate({ tasks, problems }) {
  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s):`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`✓ ${tasks.length} tasks, graph is valid`)
}

function cmdNext({ tasks, byId, problems }) {
  if (problems.length) {
    console.error('✗ graph is invalid — run `validate` and fix it before asking for work.')
    process.exit(1)
  }

  const inProgress = tasks.find((t) => t.status === 'doing')
  if (inProgress) {
    console.log(brief(inProgress, 'RESUME — this task was already in progress'))
    return
  }

  const ready = tasks.filter((t) => isReady(t, byId))
  const mine = ready.filter((t) => t.owner === 'agent').sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))

  if (mine.length === 0) {
    const gates = ready.filter((t) => t.owner === 'human')
    const blocked = tasks.filter((t) => t.status === 'blocked')
    if (gates.length === 0 && blocked.length === 0 && tasks.every((t) => t.status === 'done' || t.status === 'dropped')) {
      console.log('DONE — every task in the graph is complete.')
      process.exit(4) // the loop reads this: finished, stop
    }
    console.log('NO AGENT WORK AVAILABLE.')
    if (gates.length) console.log(`Waiting on you: ${gates.map((t) => `${t.id} (${t.title})`).join(', ')}`)
    if (blocked.length) console.log(`Blocked: ${blocked.map((t) => `${t.id} — ${t.notes ?? 'no note'}`).join(', ')}`)
    process.exit(3) // the loop reads this: stop, do not spin
  }

  const live = tasks.filter((t) => t.status !== 'dropped')
  console.log(brief(mine[0], `NEXT TASK — ${mine.length} ready, ${live.filter((t) => t.status === 'done').length}/${live.length} done`))
}

function brief(task, header) {
  const lines = [
    `### ${header}`,
    '',
    `id:      ${task.id}`,
    `title:   ${task.title}`,
    `phase:   ${task.phase}`,
    task.spec ? `spec:    ${task.spec}  <- read this first` : null,
    task.verify ? `verify:  ${task.verify}` : null,
    task.artifacts?.length ? `expects: ${task.artifacts.join(', ')}` : null,
    '',
    'Acceptance:',
    ...task.acceptance.map((a) => `  - ${a}`),
    task.notes ? `\nNotes from a previous attempt:\n  ${task.notes}` : null,
    '',
    '--- brief ---',
    task._body,
  ]
  return lines.filter((l) => l !== null).join('\n')
}

function cmdStatus({ tasks, byId, problems }) {
  const icon = { done: '●', doing: '◐', todo: '○', blocked: '✗', dropped: '⊘' }
  // Phases in the order they first appear, so any phase names work.
  const order = [...new Set(tasks.map((t) => t.phase ?? 'other'))]

  for (const phase of order) {
    const inPhase = tasks.filter((t) => (t.phase ?? 'other') === phase)
    if (!inPhase.length) continue
    console.log(`\n${phase}`)
    for (const t of inPhase.sort((a, b) => a.priority - b.priority)) {
      const ready = isReady(t, byId) ? '' : t.status === 'todo' ? `  (waits on ${t.depends_on.filter((d) => byId.get(d)?.status !== 'done').join(', ')})` : ''
      const gate = t.owner === 'human' && t.status !== 'dropped' ? '  [needs you]' : ''
      const why = t.status === 'dropped' ? '  (dropped)' : ''
      console.log(`  ${icon[t.status]} ${t.id.padEnd(24)} ${t.title}${gate}${ready}${why}`)
    }
  }

  const live = tasks.filter((t) => t.status !== 'dropped')
  const dropped = tasks.length - live.length
  const done = live.filter((t) => t.status === 'done').length
  console.log(`\n${done}/${live.length} done${dropped ? ` · ${dropped} dropped` : ''}`)
  if (problems.length) console.log(`✗ ${problems.length} graph problem(s) — run validate`)
}

function cmdSet({ tasks, byId }, id, status, notes) {
  const task = byId.get(id)
  if (!task) throw new Error(`no such task: ${id}`)
  if (!SCHEMA.properties.status.enum.includes(status)) {
    throw new Error(`status must be one of ${SCHEMA.properties.status.enum.join(' | ')}`)
  }
  if (status === 'doing') {
    const other = tasks.find((t) => t.status === 'doing' && t.id !== id)
    if (other) throw new Error(`${other.id} is already in progress — finish or release it first`)
    const unmet = task.depends_on.filter((d) => byId.get(d)?.status !== 'done')
    if (unmet.length) throw new Error(`${id} depends on unfinished task(s): ${unmet.join(', ')}`)
  }
  if (status === 'blocked' && !notes) throw new Error('blocking a task requires --notes explaining why')
  if (status === 'dropped' && !notes) throw new Error('dropping a task requires --notes naming what replaced it')

  const { _file, _body, ...rest } = task
  rest.status = status
  if (notes) rest.notes = notes
  writeFileSync(_file, serialize(rest, _body))
  console.log(`${id}: ${status}${notes ? ` (${notes})` : ''}`)
}

function cmdMermaid({ tasks }) {
  const style = { done: ':::done', doing: ':::doing', blocked: ':::blocked', dropped: ':::dropped', todo: '' }
  console.log('```mermaid\ngraph TD')
  for (const t of tasks) {
    console.log(`  ${t.id}["${t.title}"]${style[t.status]}`)
    for (const dep of t.depends_on) console.log(`  ${dep} --> ${t.id}`)
  }
  console.log('  classDef done fill:#dcfce7,stroke:#16a34a')
  console.log('  classDef doing fill:#fef9c3,stroke:#ca8a04')
  console.log('  classDef blocked fill:#fee2e2,stroke:#dc2626')
  console.log('  classDef dropped fill:#f4f4f5,stroke:#a1a1aa,color:#a1a1aa,stroke-dasharray:4 3')
  console.log('```')
}

/* ---------- main ------------------------------------------------------------ */

const [cmd, ...args] = process.argv.slice(2)
const graph = load()

try {
  switch (cmd) {
    case 'validate': cmdValidate(graph); break
    case 'next': cmdNext(graph); break
    case 'status': case undefined: cmdStatus(graph); break
    case 'set': {
      const notesFlag = args.indexOf('--notes')
      const notes = notesFlag === -1 ? null : args.slice(notesFlag + 1).join(' ')
      cmdSet(graph, args[0], args[1], notes)
      break
    }
    case 'mermaid': cmdMermaid(graph); break
    default:
      console.error(`unknown command '${cmd}'. try: validate | next | status | set | mermaid`)
      process.exit(2)
  }
} catch (err) {
  console.error(`✗ ${err.message}`)
  process.exit(1)
}
