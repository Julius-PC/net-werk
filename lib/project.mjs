// Reads one harness project from disk: its task graph, its git history, and its loop log.
// Read-only by design — the visualizer never writes to a project it watches.
//
// The frontmatter parser is the same small YAML subset harness/bin/graph.mjs accepts
// (scalars, inline arrays, dash lists), so any project the harness can load, this can load.

import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs'
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

export function loadLoopLog(root, lines = 250) {
  const path = join(root, 'harness', '.loop.log')
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8')
  const updated_at = statSync(path).mtime.toISOString()
  return { updated_at, tail: text.split('\n').slice(-lines).join('\n'), run: parseLastRun(text, updated_at) }
}

/* ---------- is a loop actually running? ------------------------------------ */
// The question the "Building now" card has to answer honestly. A task file saying `doing` only
// means the last iteration took the lock; if the loop then hit its cap or was killed, nothing
// releases it. So we look for the process itself: loop.sh `cd`s to the repo root before it
// runs anything, so a live loop is a process whose command is loop.sh (or a bare `claude -p`,
// for Ralph-style `while :; do claude -p ...` loops) and whose working directory is the
// project root. Interactive Claude sessions never pass -p, so they don't count.
//
// Why not the log's mtime? It's only written when the agent calls a tool. A long build, a
// test run or a slow think can leave it untouched for many minutes while the loop is fine,
// and a loop killed ten seconds ago still has a fresh log. The mtime is only the fallback
// for when `ps`/`lsof` can't be run.

// Only the program being run counts, not an argument: `vim harness/bin/loop.sh` is not a loop.
const LOOP_CMD = /^(\S*\/)?((ba|z)?sh\s+)?(\S*\/)?loop\.sh(\s|$)|^(\S*\/)?claude\s+(\S+\s+)*?(-p|--print)(\s|$)/
let procCache = { at: 0, byCwd: null }
// lsof reports resolved paths (/private/tmp, not /tmp), so compare against the resolved root.
export const real = (p) => { try { return realpathSync(p) } catch { return p } }

export function loopProcesses({ fresh = false } = {}) {
  if (!fresh && Date.now() - procCache.at < 1000) return procCache.byCwd
  let byCwd = null
  try {
    const pids = execFileSync('ps', ['-Ao', 'pid=,lstart=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((l) => l.match(/^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/))
      .filter((m) => m && LOOP_CMD.test(m[3]))
      .map((m) => ({ pid: m[1], started_at: new Date(m[2]).toISOString(), command: m[3] }))
    byCwd = new Map()
    if (pids.length) {
      // One lsof for every candidate: -Fpn prints "p<pid>" then "n<cwd>" per process.
      let out = ''
      try {
        out = execFileSync('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.map((p) => p.pid).join(',')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      } catch (err) {
        out = String(err.stdout ?? '') // lsof exits 1 if any pid vanished; the rest is still good
      }
      let pid = null
      for (const line of out.split('\n')) {
        if (line[0] === 'p') pid = line.slice(1)
        if (line[0] === 'n' && pid) {
          const proc = pids.find((p) => p.pid === pid)
          const list = byCwd.get(line.slice(1)) ?? []
          list.push(proc)
          byCwd.set(line.slice(1), list)
        }
      }
    }
  } catch {
    byCwd = null // no ps/lsof here: callers fall back to the log
  }
  procCache = { at: Date.now(), byCwd }
  return byCwd
}

// Split the log into runs (each starts "════ <date> ════") and read the last one: its mode,
// how far it got, and — if it has ended — which of loop.sh's exits it took.
const STOPS = [
  { kind: 'user', re: /── stopped from (net-werk|net-work|harness-viz) ──/, title: 'Stopped by you', why: (r) => `You stopped it from net-werk during iteration ${r.iteration}${r.max ? ` of ${r.max}` : ''}.` },
  { kind: 'complete', re: /every task is done — stopping/, title: 'All done', why: () => 'Every task in the graph is done or dropped, so the loop stopped.' },
  { kind: 'cap', re: /── reached iteration cap ──/, title: 'Hit its iteration cap', why: (r) => `It ran all ${r.max} iterations it was allowed. Start it again to keep going.` },
  { kind: 'human', re: /nothing left for the agent — stopping\./, title: 'Waiting on you', why: () => 'Only human tasks are ready, so it stopped instead of spinning (graph next exited 3).' },
  { kind: 'stuck', re: /two iterations without progress — stopping/, title: 'Stopped: no progress', why: () => 'Two iterations in a row ended without a commit, so it stopped rather than burn tokens.' },
  { kind: 'replan', re: /the re-plan left the graph invalid — stopping/, title: 'Stopped: re-plan broke the graph', why: () => 'The planning pass left the graph failing validate. Fix it by hand, then start again.' },
  { kind: 'graph', re: /graph is unhappy \(exit (\d+)\)/, title: 'Stopped: graph is invalid', why: (r, m) => `graph.mjs next exited ${m[1]}. Run validate and fix the graph by hand.` },
]

export function parseLastRun(text, updated_at) {
  const lines = text.split('\n')
  let start = -1
  lines.forEach((l, i) => { if (/^════ .+ ════$/.test(l)) start = i })
  if (start === -1) return null
  const run = lines.slice(start)
  const head = run[0].match(/^════ (.+) ════$/)[1]
  const cfg = run.find((l) => l.startsWith('── loop:'))?.match(/mode=(\S+) max=(\d+)/)
  const r = {
    started_at: new Date(head.replace(' ', 'T')).toISOString(),
    mode: cfg?.[1] ?? null,
    max: cfg ? Number(cfg[2]) : null,
    iteration: 0,
    stop: null,
  }
  let iterStart = 0
  run.forEach((l, i) => {
    const m = l.match(/── iteration (\d+)\/\d+/)
    if (m) { r.iteration = Number(m[1]); iterStart = i }
  })
  // When it ended: the run's date plus the last HH:MM:SS stamp in it (rolling past midnight if
  // needed). The file's mtime is the fallback — and it is unreliable, since git resets it on
  // checkout and anything appending to the log bumps it.
  const stamp = run.findLast((l) => /^\d\d:\d\d:\d\d  /.test(l))?.slice(0, 8)
  let lastAt = updated_at
  if (stamp) {
    const d = new Date(`${head.slice(0, 10)}T${stamp}`)
    if (d < new Date(r.started_at)) d.setDate(d.getDate() + 1)
    lastAt = d.toISOString()
  }
  r.last_at = lastAt
  for (const s of STOPS) {
    const i = run.findIndex((l) => s.re.test(l))
    if (i !== -1) {
      // net-werk writes its stop line at the moment of stopping, so there the mtime is exact.
      r.stop = { kind: s.kind, title: s.title, why: s.why(r, run[i].match(s.re)), line: run[i].trim(), at: s.kind === 'user' ? updated_at : lastAt }
      break
    }
  }
  // Clues from the last iteration, for when the run ends without one of the lines above.
  const last = run.slice(iterStart)
  // Is it re-planning right now? A loop may re-derive the graph from the specs before building
  // (once before iteration 1, or at the top of every iteration). That's the case when the last
  // re-plan line has no task brief ("### NEXT TASK" / "### RESUME") printed after it — until
  // then the task in `doing` is a leftover, not what the agent is working on.
  const replanAt = last.findLastIndex((l) => /re-planning before building/.test(l))
  r.phase = replanAt !== -1 && !last.slice(replanAt).some((l) => /^### (NEXT TASK|RESUME)/.test(l)) ? 'replanning' : 'building'
  r.replan_reason = replanAt !== -1 ? last[replanAt].replace(/^[─\s]+|[─\s]+$/g, '') : null
  const finished = last.findLast((l) => /agent finished:/.test(l))?.match(/agent finished: (\S+)/)?.[1] ?? null
  r.agent = {
    exited_nonzero: last.some((l) => l.includes('agent exited non-zero')),
    result: finished, // stream.mjs's result subtype: success | error_max_turns | error_during_execution
    no_commit: last.find((l) => /^no commit this iteration/.test(l)) ?? null,
  }
  return r
}

export function loopState(root, log = loadLoopLog(root)) {
  const procs = loopProcesses()
  const run = log?.run ?? null
  const mine = procs?.get(real(root)) ?? []
  const running = procs ? mine.length > 0 : !!log && !run?.stop && Date.now() - new Date(log.updated_at).getTime() < 3 * 60 * 1000
  const state = {
    running,
    detected_by: procs ? 'process' : 'log',
    pid: mine[0]?.pid ?? null,
    since: mine.length ? mine.map((p) => p.started_at).sort()[0] : null,
    run,
    stop: null,
  }
  if (running || !log) return state
  if (run?.stop) state.stop = run.stop
  else {
    // No ending line: the process went away mid-run (Ctrl-C, a closed terminal, a crash).
    const a = run?.agent
    const detail = a?.result === 'error_max_turns' ? ' The agent had just run out of turns.'
      : a?.exited_nonzero || (a?.result && a.result !== 'success') ? ' The agent had just exited with an error.' : ''
    state.stop = {
      kind: 'interrupted',
      title: 'Interrupted',
      why: run
        ? `The loop was stopped during iteration ${run.iteration}${run.max ? ` of ${run.max}` : ''} without reaching one of its own exits: killed, Ctrl-C, or a closed terminal.${detail}`
        : 'The log has no run header, so there is no record of how it ended.',
      line: null,
      at: run?.last_at ?? log.updated_at,
    }
  }
  return state
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
  // A loop killed with Ctrl-C leaves every file untouched, so the process has to be in here too.
  parts.push(loopProcesses()?.get(real(root))?.map((p) => p.pid).join(',') ?? '?')
  return parts.join('|')
}

export function snapshot(root) {
  const { tasks, problems } = loadGraph(root)
  const commits = loadCommits(root)
  const lastCommitByTask = {}
  for (const c of commits) if (c.task && !lastCommitByTask[c.task]) lastCommitByTask[c.task] = c
  for (const t of tasks) t.commit = lastCommitByTask[t.id] ?? null
  const counts = { todo: 0, doing: 0, done: 0, blocked: 0, dropped: 0 }
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
  const loop = loadLoopLog(root)
  return {
    name: basename(root),
    root,
    tasks,
    problems,
    counts,
    // `dropped` is terminal but not done (superseded by a change of direction), so it counts
    // toward neither side of "x of y done" — the same arithmetic graph.mjs status uses.
    total: tasks.length - counts.dropped,
    commits: commits.slice(0, 25),
    loop,
    runner: loopState(root, loop),
    loaded_at: new Date().toISOString(),
  }
}
