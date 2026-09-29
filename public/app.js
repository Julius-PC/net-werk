// harness-viz client: one project at a time, live over server-sent events.
//
// Two render paths, on purpose:
//  - the GRAPH re-renders only when a task's status (or a filter) changes, so running
//    animations are not restarted by every log line;
//  - the FLOW (iteration stepper, activity lane, floating actions) updates on every event.

const $ = (id) => document.getElementById(id)
const svgNS = 'http://www.w3.org/2000/svg'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const NODE_W = 236
const NODE_H = 50
const COL_GAP = 84
const ROW_GAP = 12
const STAGES = ['orient', 'implement', 'verify', 'commit']

const state = {
  slug: null,
  data: null,
  selected: null,
  view: null,
  fitted: false,
  source: null,
  pos: new Map(),
  graphKey: '',
  prevStatus: null, // Map id -> status from the previous snapshot (null on first load)
  seen: new Set(), // loop-log lines already turned into chips/floaters
  followed: null, // id of the doing task the camera last moved to
}

/* ---------- projects & routing ---------------------------------------------- */

async function loadProjects() {
  const list = await fetch('/api/projects').then((r) => r.json())
  const nav = $('projects')
  nav.innerHTML = list
    .map((p) => `<a href="/p/${encodeURIComponent(p.slug)}" data-slug="${esc(p.slug)}">${esc(p.slug)} <small>${p.counts.done ?? 0}/${p.total}</small></a>`)
    .join('')
  nav.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      history.pushState({}, '', a.getAttribute('href'))
      open(a.dataset.slug)
    }),
  )
  const fromUrl = decodeURIComponent(location.pathname.match(/^\/p\/([^/]+)/)?.[1] ?? '')
  const pick = list.find((p) => p.slug === fromUrl)?.slug ?? list[0]?.slug
  if (pick) open(pick)
}

function open(slug) {
  Object.assign(state, { slug, selected: null, fitted: false, graphKey: '', prevStatus: null, seen: new Set(), followed: null, data: null })
  $('lane').innerHTML = ''
  $('fx').innerHTML = ''
  document.querySelectorAll('#projects a').forEach((a) => a.setAttribute('aria-current', a.dataset.slug === slug ? 'page' : 'false'))
  state.source?.close()
  const live = $('live')
  const src = new EventSource(`/api/projects/${encodeURIComponent(slug)}/events`)
  state.source = src
  src.onopen = () => { live.classList.add('on'); live.querySelector('span').textContent = 'live' }
  src.onerror = () => { live.classList.remove('on'); live.querySelector('span').textContent = 'reconnecting' }
  src.onmessage = (e) => {
    const next = JSON.parse(e.data)
    const first = !state.data
    state.data = next
    render(first)
  }
}

window.addEventListener('popstate', () => loadProjects())

/* ---------- render ----------------------------------------------------------- */

const statusOf = (t) => (t.status === 'todo' && t.ready ? 'ready' : t.status)

function render(first = false) {
  const d = state.data
  if (!d) return
  document.title = `${d.name} — Harness Viz`
  const navCount = document.querySelector(`#projects a[data-slug="${CSS.escape(d.name)}"] small`)
  if (navCount) navCount.textContent = `${d.counts.done ?? 0}/${d.total}`
  renderSummary(d)
  renderPhases(d)

  const key = JSON.stringify([d.tasks.map((t) => [t.id, statusOf(t), t.notes ?? '']), $('hideDone').checked, $('onlyHuman').checked, $('phase').value, state.selected])
  if (key !== state.graphKey) {
    renderGraph(d, first)
    state.graphKey = key
  }
  renderFlow(d, first)
  renderCommits(d)
  renderLoop(d)
  if (state.selected) renderDetail(d.tasks.find((t) => t.id === state.selected))
  state.prevStatus = new Map(d.tasks.map((t) => [t.id, statusOf(t)]))
}

function renderSummary(d) {
  $('pname').textContent = d.name
  $('pcount').textContent = `${d.counts.done ?? 0}/${d.total} done`
  const seg = [
    ['done', d.counts.done, 'var(--done)'],
    ['doing', d.counts.doing, 'var(--doing)'],
    ['ready', d.tasks.filter((t) => statusOf(t) === 'ready').length, 'var(--ready)'],
    ['blocked', d.counts.blocked, 'var(--blocked)'],
  ]
  $('bar').innerHTML = seg.map(([, n, c]) => `<span style="width:${(100 * (n || 0)) / Math.max(1, d.total)}%;background:${c}"></span>`).join('')
  const waiting = d.total - seg.reduce((a, [, n]) => a + (n || 0), 0)
  $('legend').innerHTML =
    seg.map(([name, n, c]) => `<span><b style="background:${c}"></b>${name} ${n || 0}</span>`).join('') +
    `<span><b style="background:var(--surface-2);border:1px solid var(--line)"></b>waiting ${waiting}</span>`

  const doing = d.tasks.find((t) => t.status === 'doing')
  const now = $('now')
  now.classList.toggle('active', !!doing)
  if (doing) {
    now.innerHTML = `<div class="label">Building now</div>
      <div class="task-line">${esc(doing.title)}</div>
      <div class="meta"><code>${esc(doing.id)}</code> · for ${ago(doing.updated_at)}</div>`
    now.onclick = () => select(doing.id)
  } else {
    const next = d.tasks.filter((t) => t.ready && t.owner === 'agent').sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0]
    const last = d.commits[0]
    now.innerHTML = `<div class="label">${loopActive(d) ? 'Between tasks' : 'Idle'}</div>
      ${next ? `<div class="task-line">Next: ${esc(next.title)}</div>` : '<div class="task-line">No agent work ready</div>'}
      ${last ? `<div class="meta">last commit ${ago(last.date)} ago · ${esc(last.subject.slice(0, 60))}</div>` : ''}`
    now.onclick = next ? () => select(next.id) : null
  }

  const humans = d.tasks.filter((t) => t.owner === 'human' && t.status !== 'done')
  const readyHumans = humans.filter((t) => t.ready)
  const blocked = d.tasks.filter((t) => t.status === 'blocked')
  $('gates').innerHTML = `<div class="label">Waiting on you</div>
    ${readyHumans.length || blocked.length
      ? `<ul>${[...blocked, ...readyHumans].map((t) => `<li data-id="${esc(t.id)}">${esc(t.title)}${t.status === 'blocked' ? ' <span class="pill blocked">blocked</span>' : ''}</li>`).join('')}</ul>`
      : `<div class="muted">Nothing right now. ${humans.length} of your tasks come later.</div>`}`
  $('gates').querySelectorAll('li').forEach((li) => (li.onclick = () => select(li.dataset.id)))
}

function renderPhases(d) {
  const sel = $('phase')
  const phases = [...new Set(d.tasks.map((t) => t.phase))]
  if (sel.options.length - 1 === phases.length) return
  const current = sel.value
  sel.innerHTML = '<option value="">All phases</option>' + phases.map((p) => `<option ${p === current ? 'selected' : ''}>${esc(p)}</option>`).join('')
}

/* ---------- graph layout ----------------------------------------------------- */

function layout(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const depth = new Map()
  const depthOf = (t, seen = new Set()) => {
    if (depth.has(t.id)) return depth.get(t.id)
    if (seen.has(t.id)) return 0
    seen.add(t.id)
    const deps = t.depends_on.map((id) => byId.get(id)).filter(Boolean)
    const dd = deps.length ? 1 + Math.max(...deps.map((x) => depthOf(x, seen))) : 0
    depth.set(t.id, dd)
    return dd
  }
  tasks.forEach((t) => depthOf(t))

  const cols = []
  for (const t of tasks) (cols[depth.get(t.id)] ??= []).push(t)
  const phaseOrder = [...new Set(tasks.map((t) => t.phase))]
  cols.forEach((c) => c.sort((a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) || a.priority - b.priority || a.id.localeCompare(b.id)))

  const children = new Map(tasks.map((t) => [t.id, []]))
  for (const t of tasks) for (const dep of t.depends_on) children.get(dep)?.push(t.id)

  const idx = new Map()
  const reindex = () => cols.forEach((c) => c?.forEach((t, i) => idx.set(t.id, i)))
  reindex()
  const bary = (ids) => (ids.length ? ids.reduce((a, id) => a + (idx.get(id) ?? 0), 0) / ids.length : null)
  for (let pass = 0; pass < 6; pass++) {
    const forward = pass % 2 === 0
    const order = forward ? cols.map((_, i) => i) : cols.map((_, i) => cols.length - 1 - i)
    for (const ci of order) {
      const col = cols[ci]
      if (!col) continue
      const key = new Map(col.map((t) => {
        const ids = forward ? t.depends_on.filter((x) => byId.has(x)) : children.get(t.id)
        return [t.id, bary(ids) ?? idx.get(t.id)]
      }))
      col.sort((a, b) => key.get(a.id) - key.get(b.id))
      reindex()
    }
  }

  const tallest = Math.max(1, ...cols.map((c) => c?.length ?? 0))
  const pos = new Map()
  cols.forEach((col, ci) => {
    if (!col) return
    const offset = ((tallest - col.length) * (NODE_H + ROW_GAP)) / 2
    col.forEach((t, ri) => pos.set(t.id, { x: ci * (NODE_W + COL_GAP), y: offset + ri * (NODE_H + ROW_GAP) }))
  })
  return { pos, width: cols.length * (NODE_W + COL_GAP) - COL_GAP, height: tallest * (NODE_H + ROW_GAP) - ROW_GAP, children }
}

function visibleTasks(d) {
  const hideDone = $('hideDone').checked
  const onlyHuman = $('onlyHuman').checked
  const phase = $('phase').value
  return d.tasks.filter((t) => (!hideDone || t.status !== 'done') && (!onlyHuman || t.owner === 'human') && (!phase || t.phase === phase))
}

function related(id, tasks, children) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const set = new Set([id])
  const up = (x) => byId.get(x)?.depends_on.forEach((dep) => { if (!set.has(dep)) { set.add(dep); up(dep) } })
  const down = (x) => children.get(x)?.forEach((c) => { if (!set.has(c)) { set.add(c); down(c) } })
  up(id)
  down(id)
  return set
}

function renderGraph(d, first) {
  const svg = $('graph')
  const tasks = visibleTasks(d)
  const { pos, width, height, children } = layout(tasks)
  state.pos = pos
  const focus = state.selected && pos.has(state.selected) ? related(state.selected, tasks, children) : null
  const byId = new Map(d.tasks.map((t) => [t.id, t]))

  // What changed since the last snapshot — drives the one-shot animations.
  const prev = first ? null : state.prevStatus
  const justDone = new Set()
  const justReady = new Set()
  if (prev) {
    for (const t of d.tasks) {
      const was = prev.get(t.id)
      const is = statusOf(t)
      if (was && was !== is && is === 'done') justDone.add(t.id)
      if (was && was !== is && is === 'ready') justReady.add(t.id)
    }
  }
  const doing = d.tasks.find((t) => t.status === 'doing')

  const edges = document.createElementNS(svgNS, 'g')
  const nodes = document.createElementNS(svgNS, 'g')

  for (const t of tasks) {
    const to = pos.get(t.id)
    for (const dep of t.depends_on) {
      const from = pos.get(dep)
      if (!from) continue
      const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2, x2 = to.x, y2 = to.y + NODE_H / 2
      const mx = (x1 + x2) / 2
      const p = document.createElementNS(svgNS, 'path')
      p.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`)
      const cls = ['edge']
      if (byId.get(dep)?.status === 'done') cls.push('done')
      if (doing && t.id === doing.id) cls.push('flow') // current flowing into the task being built
      if (justDone.has(dep) && (justReady.has(t.id) || t.status === 'doing')) cls.push('unlock')
      if (focus) cls.push(focus.has(dep) && focus.has(t.id) ? 'hot' : 'dim')
      p.setAttribute('class', cls.join(' '))
      p.setAttribute('marker-end', 'url(#arrow)')
      edges.append(p)
    }
  }

  for (const t of tasks) {
    const { x, y } = pos.get(t.id)
    const g = document.createElementNS(svgNS, 'g')
    const cls = ['node', statusOf(t)]
    if (t.owner === 'human') cls.push('human')
    if (t.id === state.selected) cls.push('selected')
    if (focus && !focus.has(t.id)) cls.push('dim')
    if (justDone.has(t.id)) cls.push('just-done')
    if (justReady.has(t.id)) cls.push('just-ready')
    g.setAttribute('class', cls.join(' '))
    g.setAttribute('transform', `translate(${x},${y})`)
    g.setAttribute('tabindex', '0')
    g.setAttribute('role', 'button')
    g.setAttribute('aria-label', `${t.title} — ${statusOf(t)}`)
    g.innerHTML = `<title>${esc(t.title)}\n${esc(t.id)} · ${esc(statusOf(t))}${t.owner === 'human' ? ' · needs you' : ''}</title>
      <rect width="${NODE_W}" height="${NODE_H}" rx="8"></rect>
      <text class="id" x="10" y="17">${esc(clip(t.id, 30))}</text>
      ${t.owner === 'human' && t.status !== 'done' ? `<text class="badge" x="${NODE_W - 10}" y="17" text-anchor="end">YOU</text>` : ''}
      ${t.status === 'done' ? `<text class="badge" x="${NODE_W - 10}" y="17" text-anchor="end" style="fill:var(--done)">✓</text>` : ''}
      <text class="title" x="10" y="36">${esc(clip(t.title, 36))}</text>`
    g.addEventListener('click', (e) => { e.stopPropagation(); select(t.id) })
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id) } })
    nodes.append(g)
  }

  svg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--edge)"></path></marker></defs>`
  svg.append(edges, nodes)
  state.bounds = { x: -40, y: -70, w: Math.max(width, 400) + 80, h: Math.max(height, 200) + 120 }
  if (!state.fitted || !state.view) fit()
  else applyView()

  // One-shot effects on the overlay layer, which survives graph re-renders.
  for (const id of justDone) {
    const p = pos.get(id)
    if (!p) continue
    burst(p.x + NODE_W / 2, p.y + NODE_H / 2)
    toast(`✓ ${byId.get(id).title}`)
  }

  // Follow the build: glide to a newly started task.
  if (doing && $('follow').checked && state.followed !== doing.id && pos.has(doing.id)) {
    state.followed = doing.id
    centerOn(pos.get(doing.id))
  }
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/* ---------- the flow: iteration stepper, activity lane, floaters -------------- */

const LINE = /^(\d\d:\d\d:\d\d)\s{2}(.*)$/

function classify(text) {
  if (text.startsWith('✗')) return { stage: null, kind: 'error', icon: '✗', label: text.slice(1).trim() }
  if (text.startsWith('»')) return { stage: null, kind: 'say', icon: '»', label: text.slice(1).trim() }
  if (text.startsWith('agent started')) return { stage: 'start', kind: 'orient', icon: '◆', label: 'agent started' }
  if (text.startsWith('agent finished')) return { stage: 'end', kind: 'commit', icon: '◆', label: text }
  if (!text.startsWith('▸')) return null
  const body = text.slice(1).trim()
  const base = (p) => p.split('/').filter(Boolean).pop() ?? p
  if (/^(write|edit) /.test(body)) return { stage: 'implement', kind: 'implement', icon: '✎', label: base(body.replace(/^(write|edit) /, '')) }
  if (/^(read|grep|glob) /.test(body)) return { stage: 'orient', kind: 'orient', icon: '👁', label: body.startsWith('read ') ? base(body.slice(5)) : body }
  if (/^subagent/.test(body)) return { stage: 'orient', kind: 'orient', icon: '⑂', label: body }
  if (body.startsWith('$ ')) {
    const cmd = body.slice(2)
    if (/graph\.mjs set \S+ done|git commit|git add/.test(cmd)) {
      const done = cmd.match(/set (\S+) done/)?.[1]
      return { stage: 'commit', kind: 'commit', icon: '●', label: done ? `${done} → done` : clip(cmd, 48) }
    }
    if (/\.\/y test|pytest|verify\.mjs|npm (--prefix \S+ )?run (build|typecheck|test)|ruff|tsc|plutil/.test(cmd)) return { stage: 'verify', kind: 'verify', icon: '✓', label: clip(cmd, 48) }
    if (/graph\.mjs set \S+ doing/.test(cmd)) return { stage: 'orient', kind: 'implement', icon: '▶', label: `start ${cmd.match(/set (\S+) doing/)?.[1] ?? ''}` }
    if (/(pip|npm|npx) (install|ci)|\.\/y bootstrap/.test(cmd)) return { stage: 'implement', kind: 'implement', icon: '⬇', label: clip(cmd, 48) }
    return { stage: 'orient', kind: 'orient', icon: '$', label: clip(cmd, 48) }
  }
  return { stage: 'orient', kind: 'orient', icon: '·', label: clip(body, 48) }
}

function loopActive(d) {
  return !!d.loop && Date.now() - new Date(d.loop.updated_at).getTime() < 3 * 60 * 1000
}

function renderFlow(d, first) {
  const lines = (d.loop?.tail ?? '').split('\n')
  let start = 0
  lines.forEach((l, i) => { if (/── iteration \d+/.test(l)) start = i })
  const current = lines.slice(start)

  const counts = { orient: 0, implement: 0, verify: 0, commit: 0 }
  let stage = null
  let finished = false
  for (const l of current) {
    const m = l.match(LINE)
    const ev = m && classify(m[2])
    if (!ev) continue
    if (ev.stage === 'end') { finished = true; continue }
    if (STAGES.includes(ev.stage)) {
      counts[ev.stage]++
      // Stages only move forward within an iteration: a read during verify is still "verify".
      if (STAGES.indexOf(ev.stage) >= STAGES.indexOf(stage ?? 'orient')) stage = ev.stage
    }
  }
  const active = loopActive(d) && !finished
  const steps = $('steps')
  steps.classList.toggle('idle', !active)
  steps.querySelectorAll('li').forEach((li) => {
    const i = STAGES.indexOf(li.dataset.stage)
    const cur = STAGES.indexOf(stage ?? '')
    li.classList.toggle('past', cur > i || (!active && finished && cur >= i))
    li.classList.toggle('now', cur === i && !(finished && !active))
    li.querySelector('em').textContent = counts[li.dataset.stage] || ''
  })

  // New lines → chips in the lane and floaters above the task being built.
  const fresh = []
  for (const l of lines) {
    if (!l.match(LINE) || state.seen.has(l)) continue
    state.seen.add(l)
    const ev = classify(l.match(LINE)[2])
    if (ev) fresh.push(ev)
  }
  const lane = $('lane')
  const toShow = first ? fresh.slice(-14) : fresh
  for (const ev of toShow) {
    const chip = document.createElement('span')
    chip.className = `chip ${ev.kind}`
    chip.title = ev.label
    chip.innerHTML = `<i>${esc(ev.icon)}</i>${esc(clip(ev.label, 40))}`
    if (first) chip.style.animation = 'none'
    lane.append(chip)
  }
  while (lane.children.length > 16) lane.firstChild.remove()

  if (!first) {
    const doing = d.tasks.find((t) => t.status === 'doing')
    const p = doing && state.pos.get(doing.id)
    fresh.filter((ev) => ev.kind !== 'say').slice(-6).forEach((ev, i) => {
      setTimeout(() => floater(p, ev), i * 380)
    })
  }
}

function floater(p, ev) {
  if (!p || reducedMotion) return
  const t = document.createElementNS(svgNS, 'text')
  t.setAttribute('class', `floater ${ev.kind}`)
  t.setAttribute('x', p.x + NODE_W / 2 + (Math.random() * 60 - 30))
  t.setAttribute('y', p.y - 6)
  t.setAttribute('text-anchor', 'middle')
  t.textContent = `${ev.icon} ${clip(ev.label, 28)}`
  $('fx').append(t)
  setTimeout(() => t.remove(), 2700)
}

function burst(cx, cy) {
  if (reducedMotion) return
  for (const delay of [0, 180]) {
    const c = document.createElementNS(svgNS, 'rect')
    c.setAttribute('class', 'burst')
    c.setAttribute('x', cx - NODE_W / 2)
    c.setAttribute('y', cy - NODE_H / 2)
    c.setAttribute('width', NODE_W)
    c.setAttribute('height', NODE_H)
    c.setAttribute('rx', 10)
    c.style.animationDelay = `${delay}ms`
    $('fx').append(c)
    setTimeout(() => c.remove(), 1400 + delay)
  }
}

let toastTimer
function toast(text) {
  const el = $('toast')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200)
}

/* ---------- pan / zoom / camera --------------------------------------------- */

function fit() {
  const r = $('graph').getBoundingClientRect()
  const b = state.bounds
  if (!b || !r.width) return
  const scale = Math.max(b.w / r.width, b.h / r.height)
  const w = r.width * scale, h = r.height * scale
  state.view = { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h }
  state.fitted = true
  applyView()
}

const applyView = () => {
  const v = state.view
  const vb = `${v.x} ${v.y} ${v.w} ${v.h}`
  $('graph').setAttribute('viewBox', vb)
  $('fx').setAttribute('viewBox', vb)
}

function centerOn(p) {
  const v = state.view
  // Zoom in enough to read the task, but never zoom out from where the user is.
  const w = Math.min(v.w, (NODE_W + COL_GAP) * 4.2)
  const h = v.h * (w / v.w)
  tweenView({ x: p.x + NODE_W / 2 - w / 2, y: p.y + NODE_H / 2 - h / 2, w, h })
}

function tweenView(to, ms = 900) {
  if (reducedMotion) { state.view = to; return applyView() }
  const from = { ...state.view }
  const t0 = performance.now()
  const ease = (t) => 1 - Math.pow(1 - t, 3)
  const step = (now) => {
    const k = ease(Math.min(1, (now - t0) / ms))
    state.view = Object.fromEntries(Object.keys(to).map((key) => [key, from[key] + (to[key] - from[key]) * k]))
    applyView()
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

;(function panZoom() {
  const svg = $('graph')
  let drag = null
  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = svg.getBoundingClientRect()
    const v = state.view
    // Two-finger scroll pans; pinch (which arrives as ctrlKey) or ⌘/ctrl + wheel zooms.
    if (!e.ctrlKey && !e.metaKey) {
      state.view = { ...v, x: v.x + (e.deltaX / r.width) * v.w, y: v.y + (e.deltaY / r.height) * v.h }
      return applyView()
    }
    const k = Math.exp(e.deltaY * 0.01)
    const px = v.x + ((e.clientX - r.left) / r.width) * v.w
    const py = v.y + ((e.clientY - r.top) / r.height) * v.h
    state.view = { x: px - (px - v.x) * k, y: py - (py - v.y) * k, w: v.w * k, h: v.h * k }
    applyView()
  }, { passive: false })
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node')) return
    drag = { x: e.clientX, y: e.clientY, v: { ...state.view }, moved: false }
    svg.classList.add('dragging')
    svg.setPointerCapture(e.pointerId)
  })
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return
    const r = svg.getBoundingClientRect()
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true
    state.view = { ...drag.v, x: drag.v.x - ((e.clientX - drag.x) / r.width) * drag.v.w, y: drag.v.y - ((e.clientY - drag.y) / r.height) * drag.v.h }
    applyView()
  })
  svg.addEventListener('pointerup', () => {
    if (drag && !drag.moved && state.selected) {
      state.selected = null
      $('detail').className = 'panel detail empty'
      $('detail').textContent = 'Select a task to see its brief, acceptance and history.'
      render()
    }
    drag = null
    svg.classList.remove('dragging')
  })
})()

/* ---------- detail / commits / loop ----------------------------------------- */

function select(id) {
  state.selected = id
  render()
  const p = state.pos.get(id)
  if (p && state.view) {
    const v = state.view
    const inView = p.x > v.x && p.x + NODE_W < v.x + v.w && p.y > v.y && p.y + NODE_H < v.y + v.h
    if (!inView) centerOn(p)
  }
}

function renderDetail(t) {
  const el = $('detail')
  if (!t) { el.className = 'panel detail empty'; return }
  el.className = 'panel detail'
  const s = statusOf(t)
  el.innerHTML = `
    <div class="idline">${esc(t.id)} · ${esc(t.phase)} · p${t.priority}</div>
    <h2>${esc(t.title)}</h2>
    <span class="pill ${s}">${esc(s)}</span>${t.owner === 'human' ? '<span class="pill human">needs you</span>' : ''}
    ${t.commit ? `<div class="muted" style="margin-top:6px"><code>${esc(t.commit.hash)}</code> ${ago(t.commit.date)} ago</div>` : ''}
    ${t.notes ? `<h4>Notes from the last attempt</h4><div class="notes">${esc(t.notes)}</div>` : ''}
    ${t.depends_on.length ? `<h4>Depends on</h4><div class="deps">${t.depends_on.map((x) => `<a data-id="${esc(x)}">${esc(x)}</a>`).join('')}</div>` : ''}
    ${t.waits_on?.length && t.status === 'todo' ? `<div class="muted" style="margin-top:4px">waiting on ${t.waits_on.map(esc).join(', ')}</div>` : ''}
    <h4>Acceptance</h4><ul>${(t.acceptance ?? []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
    ${t.verify ? `<h4>Verify</h4><div class="verify">${esc(t.verify)}</div>` : ''}
    ${t.spec ? `<h4>Spec</h4><code>${esc(t.spec)}</code>` : ''}
    ${t.body ? `<h4>Brief</h4><div class="brief">${esc(t.body)}</div>` : ''}`
  el.querySelectorAll('.deps a').forEach((a) => (a.onclick = () => select(a.dataset.id)))
}

function renderCommits(d) {
  $('commits').innerHTML = d.commits
    .map((c) => `<li><code>${esc(c.hash)}</code><div><span class="${c.task ? 't' : ''}" data-id="${esc(c.task ?? '')}">${esc(c.subject)}</span><time>${ago(c.date)} ago</time></div></li>`)
    .join('')
  $('commits').querySelectorAll('.t').forEach((s) => (s.onclick = () => select(s.dataset.id)))
}

function renderLoop(d) {
  const panel = $('loopPanel')
  panel.hidden = !d.loop
  if (!d.loop) return
  const pre = $('loop')
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8
  pre.textContent = d.loop.tail.split('\n').slice(-80).join('\n')
  $('loopAge').textContent = `· updated ${ago(d.loop.updated_at)} ago`
  if (atBottom) pre.scrollTop = pre.scrollHeight
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/* ---------- controls --------------------------------------------------------- */

for (const id of ['hideDone', 'onlyHuman', 'phase']) $(id).addEventListener('change', () => { state.fitted = false; state.graphKey = ''; render() })
$('fit').addEventListener('click', fit)
const zoomBy = (k) => {
  const v = state.view
  const cx = v.x + v.w / 2, cy = v.y + v.h / 2
  tweenView({ x: cx - (v.w * k) / 2, y: cy - (v.h * k) / 2, w: v.w * k, h: v.h * k }, 250)
}
$('zoomIn').addEventListener('click', () => zoomBy(0.75))
$('zoomOut').addEventListener('click', () => zoomBy(1.33))
$('follow').addEventListener('change', () => {
  const doing = state.data?.tasks.find((t) => t.status === 'doing')
  if ($('follow').checked && doing && state.pos.has(doing.id)) { state.followed = doing.id; centerOn(state.pos.get(doing.id)) }
})
window.addEventListener('resize', () => state.data && fit())
setInterval(() => state.data && (renderSummary(state.data), renderFlow(state.data, false)), 15000)

loadProjects()
