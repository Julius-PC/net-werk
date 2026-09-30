// Starting and stopping a project's loop. This is the only place net-werk changes anything:
// it runs the project's own harness/bin/loop.sh, signals that loop's processes, and appends one
// line to harness/.loop.log when you stop it (so the log says why the run ended).

import { existsSync, readdirSync, appendFileSync, openSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname, delimiter } from 'node:path'
import { homedir } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { loopProcesses, real } from './project.mjs'

export const STOP_LINE = '── stopped from net-werk ──'
const LOOP = join('harness', 'bin', 'loop.sh')
const NAME = /^[a-z0-9][a-z0-9-]*$/

// What the play button may offer: one mode per harness/prompts/<mode>.md, which is exactly
// what loop.sh accepts.
export function controls(root) {
  const script = existsSync(join(root, LOOP))
  const dir = join(root, 'harness', 'prompts')
  const modes = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter((m) => NAME.test(m))
    : []
  modes.sort((a, b) => (a === 'build' ? -1 : b === 'build' ? 1 : a.localeCompare(b)))
  return { script, modes }
}

// A server started by launchd or from the Dock gets a thin PATH; the loop needs claude and node.
function loopEnv() {
  const extra = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), join(homedir(), '.claude', 'local')]
  const PATH = [...new Set([...(process.env.PATH ?? '').split(delimiter), ...extra])].filter(Boolean).join(delimiter)
  return { ...process.env, PATH }
}

export async function startLoop(root, { mode, iterations }, outDir) {
  const { script, modes } = controls(root)
  if (!script) throw httpError(409, `no ${LOOP} in this project`)
  if (!modes.includes(mode)) throw httpError(400, `unknown mode '${mode}' — expected one of ${modes.join(', ')}`)
  const n = Number(iterations)
  if (!Number.isInteger(n) || n < 1 || n > 200) throw httpError(400, 'iterations must be a whole number from 1 to 200')
  if (loopProcesses()?.get(real(root))?.length) throw httpError(409, 'a loop is already running here')
  const env = loopEnv()

  // loop.sh tees its own output into harness/.loop.log. Its stdout goes to a file of ours rather
  // than a pipe, so the loop survives this server exiting; the file also catches anything loop.sh
  // prints before that tee starts (a missing prompt, a missing CLI).
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, `loop-${real(root).replace(/[^a-zA-Z0-9]+/g, '_')}.out`)
  const out = openSync(outFile, 'w')
  const child = spawn('bash', [LOOP, mode, String(n)], { cwd: root, env, detached: true, stdio: ['ignore', out, out] })
  child.unref()

  // If it dies in the first moments (no claude on PATH, say), report what loop.sh printed
  // instead of leaving a silent "idle".
  const early = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 1500)
    child.once('exit', (code) => { clearTimeout(t); resolve(code) })
    child.once('error', (err) => { clearTimeout(t); resolve(err.message) })
  })
  if (early !== null && early !== 0) {
    const said = readFileSync(outFile, 'utf8').trim().split('\n').slice(-3).join(' · ')
    throw httpError(500, `loop.sh exited straight away (${early})${said ? `: ${said}` : ''}`)
  }
  return { pid: child.pid, mode, iterations: n }
}

export async function stopLoop(root) {
  const procs = loopProcesses({ fresh: true })?.get(real(root)) ?? []
  if (!procs.length) throw httpError(409, 'no loop is running here')

  // Signal the whole tree, not just loop.sh: bash dies on SIGTERM but its `claude -p` child
  // would carry on as an orphan, still editing files and spending tokens.
  const children = new Map()
  for (const line of execFileSync('ps', ['-Ao', 'pid=,ppid='], { encoding: 'utf8' }).split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (pid && ppid) (children.get(ppid) ?? children.set(ppid, []).get(ppid)).push(pid)
  }
  const tree = new Set()
  const walk = (pid) => { if (tree.has(pid) || pid === process.pid) return; tree.add(pid); (children.get(pid) ?? []).forEach(walk) }
  procs.forEach((p) => walk(Number(p.pid)))
  const signal = (sig) => tree.forEach((pid) => { try { process.kill(pid, sig) } catch {} })
  signal('SIGTERM')
  await new Promise((r) => setTimeout(r, 2500))
  signal('SIGKILL') // anything that ignored the polite request

  // The tee died with the loop, so write the ending ourselves; the dashboard reads it as the reason.
  const log = join(root, 'harness', '.loop.log')
  if (existsSync(log)) appendFileSync(log, `\n${STOP_LINE}\n`)
  return { stopped: [...tree].length }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}
