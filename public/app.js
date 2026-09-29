// harness-viz client: one project at a time, live over server-sent events.

const $ = (id) => document.getElementById(id)
const svgNS = 'http://www.w3.org/2000/svg'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const NODE_W = 236
const NODE_H = 50
const COL_GAP = 84
const ROW_GAP = 12

const state = {
  slug: null,
  data: null,
  selected: null,
  view: null, // viewBox {x, y, w, h}
  fitted: false,
  source: null,
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
  else $('graph').innerHTML = ''
}

function open(slug) {
  state.slug = slug
  state.selected = null
  state.fitted = false
  document.querySelectorAll('#projects a').forEach((a) => a.setAttribute('aria-current', a.dataset.slug === slug ? 'page' : 'false'))
  state.source?.close()
  const live = $('live')
  const src = new EventSource(`/api/projects/${encodeURIComponent(slug)}/events`)
  state.source = src
  src.onopen = () => { live.classList.add('on'); live.querySelector('span').textContent = 'live' }
  src.onerror = () => { live.classList.remove('on'); live.querySelector('span').textContent = 'reconnecting' }
  src.onmessage = (e) => {
    state.data = JSON.parse(e.data)
    render()
  }
}

window.addEventListener('popstate', () => loadProjects())

/* ---------- render ----------------------------------------------------------- */

function render() {
  const d = state.data
  if (!d) return
  document.title = `${d.name} — Harness Viz`
  const navCount = document.querySelector(`#projects a[data-slug="${CSS.escape(d.name)}"] small`)
  if (navCount) navCount.textContent = `${d.counts.done ?? 0}/${d.total}`
  renderSummary(d)
  renderPhases(d)
  renderGraph(d)
  renderCommits(d)
  renderLoop(d)
  if (state.selected) renderDetail(d.tasks.find((t) => t.id === state.selected))
}

const statusOf = (t) => (t.status === 'todo' && t.ready ? 'ready' : t.status)

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
      <div class="meta"><code>${esc(doing.id)}</code> · for ${ago(doing.updated_at, true)}</div>`
    now.onclick = () => select(doing.id)
  } else {
    const next = d.tasks
      .filter((t) => t.ready && t.owner === 'agent')
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0]
    const last = d.commits[0]
    now.innerHTML = `<div class="label">Idle</div>
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
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depthOf(x, seen))) : 0
    depth.set(t.id, d)
    return d
  }
  tasks.forEach((t) => depthOf(t))

  const cols = []
  for (const t of tasks) (cols[depth.get(t.id)] ??= []).push(t)
  const phaseOrder = [...new Set(tasks.map((t) => t.phase))]
  cols.forEach((c) => c.sort((a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) || a.priority - b.priority || a.id.localeCompare(b.id)))

  const children = new Map(tasks.map((t) => [t.id, []]))
  for (const t of tasks) for (const d of t.depends_on) children.get(d)?.push(t.id)

  const idx = new Map()
  const reindex = () => cols.forEach((c) => c.forEach((t, i) => idx.set(t.id, i)))
  reindex()
  const bary = (ids) => (ids.length ? ids.reduce((a, id) => a + (idx.get(id) ?? 0), 0) / ids.length : null)
  for (let pass = 0; pass < 6; pass++) {
    const forward = pass % 2 === 0
    const order = forward ? cols.map((_, i) => i) : cols.map((_, i) => cols.length - 1 - i)
    for (const ci of order) {
      const col = cols[ci]
      if (!col) continue
      const key = new Map(col.map((t) => {
        const ids = forward ? t.depends_on.filter((d) => byId.has(d)) : children.get(t.id)
        const b = bary(ids)
        return [t.id, b ?? idx.get(t.id)]
      }))
      col.sort((a, b) => key.get(a.id) - key.get(b.id))
      reindex()
    }
  }

  const tallest = Math.max(...cols.map((c) => c?.length ?? 0))
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
  const up = (x) => byId.get(x)?.depends_on.forEach((d) => { if (!set.has(d)) { set.add(d); up(d) } })
  const down = (x) => children.get(x)?.forEach((c) => { if (!set.has(c)) { set.add(c); down(c) } })
  up(id)
  down(id)
  return set
}

function renderGraph(d) {
  const svg = $('graph')
  const tasks = visibleTasks(d)
  const { pos, width, height, children } = layout(tasks)
  const focus = state.selected && pos.has(state.selected) ? related(state.selected, tasks, children) : null

  const frag = document.createDocumentFragment()
  const edges = document.createElementNS(svgNS, 'g')
  const nodes = document.createElementNS(svgNS, 'g')
  frag.append(edges, nodes)

  for (const t of tasks) {
    const to = pos.get(t.id)
    for (const dep of t.depends_on) {
      const from = pos.get(dep)
      if (!from) continue
      const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2, x2 = to.x, y2 = to.y + NODE_H / 2
      const mx = (x1 + x2) / 2
      const p = document.createElementNS(svgNS, 'path')
      p.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`)
      const depTask = d.tasks.find((x) => x.id === dep)
      p.setAttribute('class', `edge${depTask?.status === 'done' ? ' done' : ''}${focus ? (focus.has(dep) && focus.has(t.id) ? ' hot' : ' dim') : ''}`)
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
    g.setAttribute('class', cls.join(' '))
    g.setAttribute('transform', `translate(${x},${y})`)
    g.setAttribute('tabindex', '0')
    g.setAttribute('role', 'button')
    g.setAttribute('aria-label', `${t.title} — ${statusOf(t)}`)
    g.innerHTML = `<title>${esc(t.title)}\n${esc(t.id)} · ${esc(statusOf(t))}${t.owner === 'human' ? ' · needs you' : ''}</title>
      <rect width="${NODE_W}" height="${NODE_H}" rx="8"></rect>
      <text class="id" x="10" y="17">${esc(clip(t.id, 30))}</text>
      ${t.owner === 'human' ? `<text class="badge" x="${NODE_W - 10}" y="17" text-anchor="end">YOU</text>` : ''}
      ${t.status === 'done' ? `<text class="badge" x="${NODE_W - 10}" y="17" text-anchor="end" style="fill:var(--done)">✓</text>` : ''}
      <text class="title" x="10" y="36">${esc(clip(t.title, 36))}</text>`
    g.addEventListener('click', (e) => { e.stopPropagation(); select(t.id) })
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id) } })
    nodes.append(g)
  }

  svg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--edge)"></path></marker></defs>`
  svg.append(frag)
  state.bounds = { x: -40, y: -60, w: Math.max(width, 400) + 80, h: Math.max(height, 200) + 110 }
  if (!state.fitted || !state.view) fit()
  else applyView()
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/* ---------- pan / zoom ------------------------------------------------------- */

function fit() {
  const svg = $('graph')
  const r = svg.getBoundingClientRect()
  const b = state.bounds
  const scale = Math.max(b.w / r.width, b.h / r.height)
  const w = r.width * scale, h = r.height * scale
  state.view = { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h }
  state.fitted = true
  applyView()
}
const applyView = () => {
  const v = state.view
  $('graph').setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`)
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
    const dx = ((e.clientX - drag.x) / r.width) * drag.v.w
    const dy = ((e.clientY - drag.y) / r.height) * drag.v.h
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true
    state.view = { ...drag.v, x: drag.v.x - dx, y: drag.v.y - dy }
    applyView()
  })
  svg.addEventListener('pointerup', () => {
    if (drag && !drag.moved) { state.selected = null; $('detail').className = 'panel detail empty'; $('detail').textContent = 'Select a task to see its brief, acceptance and history.'; render() }
    drag = null
    svg.classList.remove('dragging')
  })
})()

/* ---------- detail / commits / loop ----------------------------------------- */

function select(id) {
  state.selected = id
  render()
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
    ${t.depends_on.length ? `<h4>Depends on</h4><div class="deps">${t.depends_on.map((d) => `<a data-id="${esc(d)}">${esc(d)}</a>`).join('')}</div>` : ''}
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
  pre.textContent = d.loop.tail
  $('loopAge').textContent = `· updated ${ago(d.loop.updated_at)} ago`
  if (atBottom) pre.scrollTop = pre.scrollHeight
}

function ago(iso, short = false) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return short ? `${Math.round(s / 86400)}d` : `${Math.round(s / 86400)}d`
}

/* ---------- controls --------------------------------------------------------- */

for (const id of ['hideDone', 'onlyHuman', 'phase']) $(id).addEventListener('change', () => { state.fitted = false; render() })
$('fit').addEventListener('click', fit)
const zoomBy = (k) => {
  const v = state.view
  const cx = v.x + v.w / 2, cy = v.y + v.h / 2
  state.view = { x: cx - (v.w * k) / 2, y: cy - (v.h * k) / 2, w: v.w * k, h: v.h * k }
  applyView()
}
$('zoomIn').addEventListener('click', () => zoomBy(0.75))
$('zoomOut').addEventListener('click', () => zoomBy(1.33))
window.addEventListener('resize', () => state.data && fit())
setInterval(() => state.data && renderSummary(state.data), 15000) // keep "for 4m" honest between events

loadProjects()
