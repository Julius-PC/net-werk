#!/usr/bin/env node
// The gates. An agent will tell you it finished; this decides whether it did. Every build
// iteration runs it before marking a task done. (From the net-werk kit.)
//
//   node harness/bin/verify.mjs          every gate, cheapest first; stops at the first failure
//   node harness/bin/verify.mjs <name>   one gate
//
// Add this project's gates below: tests, typecheck, build, lint, and anything that must never
// ship (secrets, private data). A gate for code that doesn't exist yet should skip and say so —
// never pass silently.

import { execSync } from 'node:child_process'

const GATES = [
  { name: 'graph', cmd: 'node harness/bin/graph.mjs validate' },
  // { name: 'test', cmd: 'npm test' },
  // { name: 'build', cmd: 'npm run build' },
]

const only = process.argv[2]
const gates = only ? GATES.filter((g) => g.name === only) : GATES
if (only && !gates.length) {
  console.error(`no gate named '${only}'. gates: ${GATES.map((g) => g.name).join(', ')}`)
  process.exit(2)
}
for (const g of gates) {
  process.stdout.write(`▸ ${g.name}: ${g.cmd}\n`)
  try {
    execSync(g.cmd, { stdio: 'inherit' })
  } catch {
    console.error(`✗ gate '${g.name}' failed`)
    process.exit(1)
  }
}
console.log(`✓ ${gates.length} gate(s) passed`)
