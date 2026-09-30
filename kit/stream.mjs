#!/usr/bin/env node
// Turns `claude -p --output-format stream-json` into short, human-readable lines, so the loop
// log (harness/.loop.log, tailed by net-work) shows what the agent is doing as it does it,
// instead of nothing until the iteration ends.
//
//   claude -p "..." --output-format stream-json --verbose | node harness/bin/stream.mjs

import { createInterface } from 'node:readline'

const clip = (s, n = 140) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
const time = () => new Date().toTimeString().slice(0, 8)
const say = (line) => process.stdout.write(`${time()}  ${line}\n`)

function describeTool(name, input = {}) {
  switch (name) {
    case 'Bash': return `$ ${clip(input.command, 160)}`
    case 'Read': return `read ${input.file_path ?? ''}`
    case 'Write': return `write ${input.file_path ?? ''}`
    case 'Edit': case 'MultiEdit': return `edit ${input.file_path ?? ''}`
    case 'Grep': return `grep ${clip(input.pattern, 60)}${input.path ? ` in ${input.path}` : ''}`
    case 'Glob': return `glob ${input.pattern ?? ''}`
    case 'Agent': case 'Task': return `subagent: ${clip(input.description ?? input.prompt, 80)}`
    case 'TodoWrite': return 'update todo list'
    default: return `${name} ${clip(JSON.stringify(input), 80)}`
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let ev
  try {
    ev = JSON.parse(line)
  } catch {
    if (line.trim()) say(line)
    return
  }
  if (ev.type === 'system' && ev.subtype === 'init') {
    say(`agent started (${ev.model ?? 'model'})`)
  } else if (ev.type === 'assistant') {
    for (const block of ev.message?.content ?? []) {
      if (block.type === 'text' && block.text?.trim()) say(`» ${clip(block.text, 220)}`)
      if (block.type === 'tool_use') say(`▸ ${describeTool(block.name, block.input)}`)
    }
  } else if (ev.type === 'user') {
    for (const block of ev.message?.content ?? []) {
      if (block.type === 'tool_result' && block.is_error) {
        const text = Array.isArray(block.content) ? block.content.map((c) => c.text ?? '').join(' ') : block.content
        say(`  ✗ ${clip(text, 180)}`)
      }
    }
  } else if (ev.type === 'result') {
    const secs = ev.duration_ms ? Math.round(ev.duration_ms / 1000) : '?'
    say(`agent finished: ${ev.subtype ?? 'done'} in ${secs}s${ev.num_turns ? `, ${ev.num_turns} turns` : ''}`)
    if (ev.result) say(`» ${clip(ev.result, 400)}`)
  }
})
