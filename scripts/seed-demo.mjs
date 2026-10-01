#!/usr/bin/env node
// Regenerates examples/demo — the seeded "Larder" project — from lib/demo.mjs, at a fixed date
// so the committed files don't churn. `net-werk demo` builds a live copy with today's dates.
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeDemo } from '../lib/demo.mjs'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'demo')
rmSync(out, { recursive: true, force: true })
writeDemo(out, { now: Date.parse('2026-09-28T18:00:00Z') })
console.log(`wrote ${out}`)
