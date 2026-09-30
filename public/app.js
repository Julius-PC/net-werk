// net-work client: one project at a time, live over server-sent events.
//
// Two render paths, on purpose:
//  - the GRAPH re-renders only when a task's status (or a filter) changes, so running
//    animations are not restarted by every log line;
//  - the FLOW (iteration stepper, activity lane, floating actions) updates on every event.

const $ = (id) => document.getElementById(id)
const svgNS = 'http://www.w3.org/2000/svg'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const NODE_W = 244
const NODE_H = 62
const COL_GAP = 92
const ROW_GAP = 16
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
  followed: null, // id of the task the Focus camera last moved to
}

/* ---------- projects & routing ---------------------------------------------- */

async function loadProjects() {
  const list = await renderNav()
  const fromUrl = decodeURIComponent(location.pathname.match(/^\/p\/([^/]+)/)?.[1] ?? '')
  const pick = list.find((p) => p.slug === fromUrl)?.slug ?? list[0]?.slug
  if (pick) open(pick)
}

function open(slug) {
  Object.assign(state, { slug, selected: null, fitted: false, graphKey: '', prevStatus: null, seen: new Set(), followed: null, data: null })
  $('lane').innerHTML = ''
  $('fx').innerHTML = ''
  closePops()
  pending = null
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

// Project tabs, with a yellow dot on any project whose loop is running right now.
async function renderNav() {
  const list = await fetch('/api/projects').then((r) => r.json())
  const nav = $('projects')
  nav.innerHTML = list
    .map((p) => `<a href="/p/${encodeURIComponent(p.slug)}" data-slug="${esc(p.slug)}" aria-current="${p.slug === state.slug ? 'page' : 'false'}">${p.running ? '<i class="running" title="loop running"></i>' : ''}${esc(p.slug)} <small>${p.counts.done ?? 0}/${p.total}</small></a>`)
    .join('')
  nav.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      history.pushState({}, '', a.getAttribute('href'))
      open(a.dataset.slug)
    }),
  )
  return list
}

/* ---------- render ----------------------------------------------------------- */

const statusOf = (t) => (t.status === 'todo' && t.ready ? 'ready' : t.status)

function render(first = false) {
  const d = state.data
  if (!d) return
  document.title = `${d.name} — net-work`
  const navCount = document.querySelector(`#projects a[data-slug="${CSS.escape(d.name)}"] small`)
  if (navCount) navCount.textContent = `${d.counts.done ?? 0}/${d.total}`
  renderSummary(d)
  renderPhases(d)

  const key = JSON.stringify([d.tasks.map((t) => [t.id, statusOf(t), t.notes ?? '']), running(d), replanning(d), $('hideDone').checked, $('onlyHuman').checked, $('phase').value, state.selected])
  if (key !== state.graphKey) {
    renderGraph(d, first)
    state.graphKey = key
  }
  renderFlow(d, first)
  renderCommits(d)
  renderLoop(d)
  renderStats(d)
  renderControls(d)
  if (state.selected) renderDetail(d.tasks.find((t) => t.id === state.selected))
  state.prevStatus = new Map(d.tasks.map((t) => [t.id, statusOf(t)]))
}

const running = (d) => !!d.runner?.running
// The loop is up but re-deriving the graph from the specs, not building a task. The task in
// `doing` is on hold until the planner finishes and the iteration picks its task.
const replanning = (d) => running(d) && d.runner?.run?.phase === 'replanning'
const building = (d) => running(d) && !replanning(d)
const nextAgentTask = (d) => d.tasks.filter((t) => t.ready && t.owner === 'agent').sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0]

function renderSummary(d) {
  $('pname').textContent = d.name
  $('psub').textContent = `task graph · ${d.tasks.length} tasks${d.counts.dropped ? ` · ${d.counts.dropped} dropped` : ''}`
  $('pdone').textContent = d.counts.done ?? 0
  $('ptotal').textContent = `/ ${d.total} done`
  $('pcount').textContent = `${Math.round((100 * (d.counts.done ?? 0)) / Math.max(1, d.total))}%`
  // Dropped tasks are outside the bar entirely: they're neither done nor outstanding.
  const ready = d.tasks.filter((t) => statusOf(t) === 'ready').length
  const seg = [
    ['done', d.counts.done, 'var(--done)'],
    [running(d) ? 'doing' : 'stalled', d.counts.doing, running(d) ? 'var(--doing)' : 'var(--stalled)'],
    ['ready', ready, 'var(--ready)'],
    ['blocked', d.counts.blocked, 'var(--blocked)'],
  ]
  const waiting = d.total - seg.reduce((a, [, n]) => a + (n || 0), 0)
  seg.push(['waiting', waiting, 'var(--surface-3)'])
  $('bar').innerHTML = seg.filter(([, n]) => n).map(([, n, c]) => `<span style="flex:${n} 1 0;background:${c}"></span>`).join('')
  $('legend').innerHTML =
    seg.filter(([name, n]) => n || name === 'done' || name === 'ready').map(([name, n, c]) => `<span><b style="background:${c}"></b>${name}<em>${n || 0}</em></span>`).join('') +
    (d.counts.dropped ? `<span title="Superseded by a change of direction: terminal, not done, not counted"><b style="background:transparent;border:1px dashed var(--ink-3)"></b>dropped<em>${d.counts.dropped}</em></span>` : '')

  renderRun(d)

  const humans = d.tasks.filter((t) => t.owner === 'human' && t.status !== 'done' && t.status !== 'dropped')
  const readyHumans = humans.filter((t) => t.ready)
  const blocked = d.tasks.filter((t) => t.status === 'blocked')
  $('gates').innerHTML = `<div class="card-head"><span class="eyebrow">Waiting on you</span><span class="count">${readyHumans.length + blocked.length || ''}</span></div>
    ${readyHumans.length || blocked.length
      ? `<ul>${[...blocked, ...readyHumans].map((t) => `<li data-id="${esc(t.id)}" class="${t.status === 'blocked' ? 'blocked' : ''}">
          <span class="t">${esc(t.title)}</span>
          ${t.status === 'blocked' ? `<span class="n">${esc(t.notes ?? 'blocked — no note says why')}</span>` : ''}</li>`).join('')}</ul>`
      : `<div class="muted small">Nothing right now. ${humans.length} of your tasks come later.</div>`}`
  $('gates').querySelectorAll('li').forEach((li) => (li.onclick = () => select(li.dataset.id)))
}

// The loop card. `doing` in a task file only means an iteration took the lock; whether anything
// is actually building comes from the server's process check (d.runner), and when nothing is,
// the card says why the loop stopped instead of pretending.
function renderRun(d) {
  const r = d.runner ?? {}
  const doing = d.tasks.find((t) => t.status === 'doing')
  const next = nextAgentTask(d)
  const now = $('now')
  const iter = r.run?.iteration ? `iteration ${r.run.iteration}${r.run.max ? ` of ${r.run.max}` : ''}` : ''
  const stopBox = r.stop
    ? `<div class="why"><b>${esc(r.stop.title)}</b>${esc(r.stop.why)}<time>stopped ${ago(r.stop.at)} ago · ${clock(r.stop.at)}</time></div>`
    : ''
  const note = (t) => (t?.notes ? `<div class="note"><span class="eyebrow">Notes on the task</span>${esc(t.notes)}</div>` : '')
  let kind, html, target
  if (replanning(d)) {
    kind = 'replanning'
    target = doing?.id ?? next?.id
    html = `<span class="state"><i></i>Re-planning</span>
      <div class="task-line">Re-deriving the graph from the specs</div>
      <div class="meta">${esc(r.run.replan_reason ?? 'the loop is re-planning before it builds')} · ${[iter, `loop up ${ago(r.since)}`].filter(Boolean).join(' · ')}</div>
      ${doing ? `<div class="why"><b>On hold: ${esc(doing.title)}</b><code>${esc(doing.id)}</code> is still in <b>doing</b> from before. Once the plan is done, the iteration resumes it — unless the re-plan dropped or changed it.</div>` : ''}`
  } else if (r.running && doing) {
    kind = 'building'
    target = doing.id
    html = `<span class="state"><i></i>Building</span>
      <div class="task-line">${esc(doing.title)}</div>
      <div class="meta"><code>${esc(doing.id)}</code> · ${[iter, `loop up ${ago(r.since)}`].filter(Boolean).join(' · ')}</div>`
  } else if (r.running) {
    kind = 'between'
    target = next?.id
    html = `<span class="state"><i></i>Running · between tasks</span>
      <div class="task-line">${next ? `Next: ${esc(next.title)}` : 'Choosing the next task'}</div>
      <div class="meta">${[iter, `loop up ${ago(r.since)}`].filter(Boolean).join(' · ')}</div>`
  } else if (doing) {
    kind = 'stalled'
    target = doing.id
    html = `<span class="state"><i></i>Stalled · nothing is running</span>
      <div class="task-line">${esc(doing.title)}</div>
      <div class="meta"><code>${esc(doing.id)}</code> is still marked <b>doing</b>, but no loop is working on it.</div>
      ${stopBox || '<div class="why"><b>No loop log</b>Nothing records how the last run ended.</div>'}
      ${note(doing)}
      <div class="hint">Starting the loop again resumes it: <code>graph.mjs next</code> hands back the task in <code>doing</code> first.</div>`
  } else {
    kind = 'idle'
    target = next?.id
    html = `<span class="state"><i></i>Idle</span>
      <div class="task-line">${next ? `Next up: ${esc(next.title)}` : 'No agent work ready'}</div>
      <div class="meta">${d.loop ? '' : 'No loop has run here yet.'}</div>
      ${stopBox}`
  }
  now.className = `card run ${kind}`
  now.innerHTML = html
  now.toggleAttribute('data-click', !!target)
  now.onclick = target ? () => select(target) : null
}

// "Stopped: no progress" → "no progress", for places that already say it stopped.
const stopShort = (stop) => stop.title.replace(/^Stopped: /, '').replace(/^\w/, (c) => c.toLowerCase())
const clock = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })

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
  return d.tasks.filter((t) => (!hideDone || (t.status !== 'done' && t.status !== 'dropped')) && (!onlyHuman || t.owner === 'human') && (!phase || t.phase === phase))
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
  const live = !!doing && building(d) // `doing` with no loop behind it is stalled; during a re-plan it's on hold

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
      p.setAttribute('d', `M${x1 + 4},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 4},${y2}`)
      const cls = ['edge']
      if (byId.get(dep)?.status === 'done') cls.push('done')
      if (byId.get(dep)?.status === 'dropped' || t.status === 'dropped') cls.push('dropped')
      if (live && t.id === doing.id) cls.push('flow') // current flowing into the task being built
      if (justDone.has(dep) && (justReady.has(t.id) || t.status === 'doing')) cls.push('unlock')
      if (focus) cls.push(focus.has(dep) && focus.has(t.id) ? 'hot' : 'dim')
      p.setAttribute('class', cls.join(' '))
      edges.append(p)
    }
  }

  for (const t of tasks) {
    const { x, y } = pos.get(t.id)
    const g = document.createElementNS(svgNS, 'g')
    const s = statusOf(t)
    const stalled = t.status === 'doing' && !running(d)
    const held = t.status === 'doing' && replanning(d)
    const cls = ['node', s]
    if (stalled) cls.push('stalled')
    if (held) cls.push('held')
    if (t.owner === 'human') cls.push('human')
    if (t.id === state.selected) cls.push('selected')
    if (focus && !focus.has(t.id)) cls.push('dim')
    if (justDone.has(t.id)) cls.push('just-done')
    if (justReady.has(t.id)) cls.push('just-ready')
    g.setAttribute('class', cls.join(' '))
    g.setAttribute('transform', `translate(${x},${y})`)
    g.setAttribute('tabindex', '0')
    g.setAttribute('role', 'button')
    const label = stalled ? 'doing, stalled' : held ? 'doing, on hold while re-planning' : s
    const needsYou = t.owner === 'human' && t.status !== 'done' && t.status !== 'dropped'
    g.setAttribute('aria-label', `${t.title} — ${label}${needsYou ? ', needs you' : ''}`)
    const hasIn = t.depends_on.some((dep) => pos.has(dep))
    const hasOut = children.get(t.id)?.length
    // A frame with a header row (status dot + id) around an inset card holding the title, and
    // port dots where edges attach — the node anatomy of the reference.
    g.innerHTML = `<title>${esc(t.title)}\n${esc(t.id)} · ${esc(label)}${needsYou ? ' · needs you' : ''}</title>
      <rect class="frame" width="${NODE_W}" height="${NODE_H}" rx="14"></rect>
      <rect class="underline" x="18" y="${NODE_H - 1.5}" width="${NODE_W - 36}" height="3" rx="1.5" fill="none"></rect>
      <circle class="dot" cx="14" cy="13" r="3"></circle>
      <text class="id" x="23" y="16.5">${esc(clip(t.id, 30))}</text>
      ${t.status === 'done' ? `<text class="mark-done" x="${NODE_W - 12}" y="17" text-anchor="end">✓</text>` : ''}
      ${stalled ? `<text class="id" x="${NODE_W - 12}" y="16.5" text-anchor="end" style="fill:var(--stalled)">stalled</text>` : ''}
      ${held ? `<text class="id" x="${NODE_W - 12}" y="16.5" text-anchor="end" style="fill:var(--ready)">on hold</text>` : ''}
      ${t.status === 'dropped' ? `<text class="id" x="${NODE_W - 12}" y="16.5" text-anchor="end">dropped</text>` : ''}
      <rect class="inner" x="6" y="24" width="${NODE_W - 12}" height="${NODE_H - 30}" rx="9"></rect>
      <text class="title" x="16" y="${24 + (NODE_H - 30) / 2 + 4.5}">${esc(clip(t.title, 34))}</text>
      ${hasIn ? `<circle class="port" cx="0" cy="${NODE_H / 2}" r="4"></circle>` : ''}
      ${hasOut ? `<circle class="port" cx="${NODE_W}" cy="${NODE_H / 2}" r="4"></circle>` : ''}
      ${t.owner === 'human' && t.status !== 'done' && t.status !== 'dropped' ? `<g class="tag" transform="translate(${NODE_W - 44},${NODE_H - 8})"><rect width="38" height="17" rx="6"></rect><text x="19" y="12" text-anchor="middle">you</text></g>` : ''}`
    g.addEventListener('click', (e) => { e.stopPropagation(); select(t.id) })
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id) } })
    nodes.append(g)
  }

  svg.innerHTML = `<defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--dot)"></circle></pattern>
      <filter id="glow" x="-30%" y="-60%" width="160%" height="220%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="var(--doing)" flood-opacity=".35"></feDropShadow></filter>
    </defs><rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#dots)"></rect>`
  svg.append(edges, nodes)
  // Extra room below for the dock that floats over the bottom of the canvas.
  state.bounds = { x: -60, y: -80, w: Math.max(width, 400) + 150, h: Math.max(height, 200) + 280 }
  if (first) state.openFocus = true
  if (!state.fitted || !state.view) {
    fit()
    openFocus()
  } else applyView()

  // One-shot effects on the overlay layer, which survives graph re-renders.
  for (const id of justDone) {
    const p = pos.get(id)
    if (!p) continue
    burst(p.x + NODE_W / 2, p.y + NODE_H / 2)
    toast(`✓ ${byId.get(id).title}`)
  }

  // Follow the build: glide to a newly started task.
  if (live && $('focus').checked && state.followed !== doing.id && pos.has(doing.id)) {
    state.followed = doing.id
    centerOn(pos.get(doing.id))
  }
}

// Open zoomed in on the work, not on a map too small to read: the task in doing, else the next
// task the agent would pick. Fit (⤢) still shows the whole graph. If the canvas has no size yet
// (a hidden tab or pane), this waits until the ResizeObserver below sees one.
function openFocus() {
  const d = state.data
  if (!state.openFocus || !state.view || !d) return
  state.openFocus = false
  const target = d.tasks.find((t) => t.status === 'doing') ?? nextAgentTask(d) ?? d.tasks.find((t) => statusOf(t) === 'ready')
  if (!target || !state.pos.has(target.id)) return
  if (building(d) && target.status === 'doing') state.followed = target.id
  centerOn(state.pos.get(target.id), true)
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/* ---------- the flow: iteration stepper, activity lane, floaters -------------- */

const LINE = /^(\d\d:\d\d:\d\d)\s{2}(.*)$/

// Commands that count as the Verify stage: test runners, type checks, linters, builds, gates.
const VERIFY = /(^|[\s/])(\.\/\S+ (test|check)|(py|vi|je)test|cargo (test|check|clippy)|go (test|vet)|(npm|pnpm|yarn|bun)( --prefix \S+)?( run)? (build|typecheck|test|lint|check)|make (test|check)|ruff|eslint|tsc|mypy|verify\.\w+)\b/

function classify(text) {
  if (text.startsWith('✗')) return { stage: null, kind: 'error', icon: '✗', label: text.slice(1).trim() }
  if (text.startsWith('»')) return { stage: null, kind: 'say', icon: '»', label: text.slice(1).trim() }
  if (text.startsWith('agent started')) return { stage: 'start', kind: 'orient', icon: '◆', label: 'agent started' }
  if (text.startsWith('agent finished')) {
    // stream.mjs prints the result subtype: success, or error_max_turns / error_during_execution.
    const ok = /^agent finished: success/.test(text)
    return { stage: 'end', kind: ok ? 'commit' : 'error', icon: ok ? '◆' : '✗', label: text.replace(/^agent finished: /, ok ? 'finished: ' : 'agent: ') }
  }
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
    if (VERIFY.test(cmd)) return { stage: 'verify', kind: 'verify', icon: '✓', label: clip(cmd, 48) }
    if (/graph\.mjs set \S+ doing/.test(cmd)) return { stage: 'orient', kind: 'implement', icon: '▶', label: `start ${cmd.match(/set (\S+) doing/)?.[1] ?? ''}` }
    if (/(pip|npm|npx) (install|ci)|\.\/y bootstrap/.test(cmd)) return { stage: 'implement', kind: 'implement', icon: '⬇', label: clip(cmd, 48) }
    return { stage: 'orient', kind: 'orient', icon: '$', label: clip(cmd, 48) }
  }
  return { stage: 'orient', kind: 'orient', icon: '·', label: clip(body, 48) }
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
  const active = running(d) && !finished
  const steps = $('steps')
  steps.classList.toggle('idle', !active)
  const r = d.runner ?? {}
  $('flow').classList.toggle('stopped', !r.running && !!r.stop)
  $('flowLabel').textContent = replanning(d) ? 'Re-planning the graph' : r.running ? (finished ? 'Iteration finished' : 'Iteration in progress') : d.loop ? 'Last iteration' : 'Iteration'
  $('flowMeta').textContent = r.run?.iteration
    ? `${r.run.iteration}${r.run.max ? `/${r.run.max}` : ''}${r.running ? '' : r.stop ? ` · ${stopShort(r.stop)}` : ''}`
    : d.loop ? '' : 'no loop log yet'
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

  if (!first && building(d)) {
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
    c.setAttribute('rx', 14)
    c.style.animationDelay = `${delay}ms`
    $('fx').append(c)
    setTimeout(() => c.remove(), 1400 + delay)
  }
}

let toastTimer
function toast(text, kind = '') {
  const el = $('toast')
  el.textContent = text
  el.classList.toggle('error', kind === 'error')
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3200)
}

/* ---------- pan / zoom / camera --------------------------------------------- */

function fit() {
  const r = $('graph').getBoundingClientRect()
  const b = state.bounds
  // The canvas can be 0×0 for a moment (before layout, or while hidden); dividing by that gives
  // Infinity/NaN, which the SVG rejects as a viewBox. Wait for a real size instead.
  if (!b || !r.width || !r.height || !b.w || !b.h) return
  const scale = Math.max(b.w / r.width, b.h / r.height)
  if (!Number.isFinite(scale) || scale <= 0) return
  const w = r.width * scale, h = r.height * scale
  state.view = { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h }
  state.fitted = true
  applyView()
}

const applyView = () => {
  const v = state.view
  if (!v || ![v.x, v.y, v.w, v.h].every(Number.isFinite) || v.w <= 0 || v.h <= 0) return
  const vb = `${v.x} ${v.y} ${v.w} ${v.h}`
  $('graph').setAttribute('viewBox', vb)
  $('fx').setAttribute('viewBox', vb)
}

function centerOn(p, instant = false) {
  const v = state.view
  const r = $('graph').getBoundingClientRect()
  if (!v || !r.width || !r.height) return
  // Zoom in until a node is about 210px wide — readable — but never zoom out from where the
  // user is. The task sits a little above centre, clear of the dock.
  const w = Math.min(v.w, (r.width / 210) * NODE_W)
  const h = v.h * (w / v.w)
  const to = { x: p.x + NODE_W / 2 - w / 2, y: p.y + NODE_H / 2 - h * 0.38, w, h }
  if (instant) { state.view = to; return applyView() }
  tweenView(to)
}

function tweenView(to, ms = 900) {
  // No glide when motion is reduced, or when the page is hidden (no animation frames run there,
  // so a tween would leave the camera where it was until you come back).
  if (reducedMotion || document.hidden) { state.view = to; return applyView() }
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
    setFocus(false)
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
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) { drag.moved = true; setFocus(false) }
    state.view = { ...drag.v, x: drag.v.x - ((e.clientX - drag.x) / r.width) * drag.v.w, y: drag.v.y - ((e.clientY - drag.y) / r.height) * drag.v.h }
    applyView()
  })
  svg.addEventListener('pointerup', () => {
    if (drag && !drag.moved && state.selected) {
      state.selected = null
      $('detail').className = 'detail empty'
      $('detail').textContent = 'Click a task in the graph to see its brief, acceptance and history.'
      render()
    }
    drag = null
    svg.classList.remove('dragging')
  })
})()

/* ---------- detail / commits / loop ----------------------------------------- */

function select(id) {
  state.selected = id
  showTab('task')
  render()
  const p = state.pos.get(id)
  if (p && state.view) {
    const v = state.view
    const inView = p.x > v.x && p.x + NODE_W < v.x + v.w && p.y > v.y && p.y + NODE_H < v.y + v.h
    if (!inView) centerOn(p)
  }
}

const NOTES_HEADING = { blocked: 'Why it is blocked', dropped: 'What replaced it', doing: 'Notes from the last attempt' }

function renderDetail(t) {
  const el = $('detail')
  if (!t) { el.className = 'detail empty'; return }
  const s = statusOf(t)
  const stalled = t.status === 'doing' && !running(state.data)
  el.className = `detail ${s}`
  el.innerHTML = `
    <div class="idline">${esc(t.id)} · ${esc(t.phase)} · p${t.priority}</div>
    <h2>${esc(t.title)}</h2>
    <span class="pill ${stalled ? 'stalled' : s}">${stalled ? 'doing · stalled' : esc(s)}</span>${t.owner === 'human' && t.status !== 'dropped' ? '<span class="pill human">needs you</span>' : ''}
    ${t.commit ? `<div class="muted small" style="margin-top:8px"><code>${esc(t.commit.hash)}</code> ${ago(t.commit.date)} ago</div>` : ''}
    ${t.notes ? `<h4>${NOTES_HEADING[t.status] ?? 'Notes'}</h4><div class="notes ${esc(t.status)}">${esc(t.notes)}</div>` : ''}
    ${t.depends_on.length ? `<h4>Depends on</h4><div class="deps">${t.depends_on.map((x) => `<a data-id="${esc(x)}">${esc(x)}</a>`).join('')}</div>` : ''}
    ${t.waits_on?.length && t.status === 'todo' ? `<div class="muted small" style="margin-top:6px">waiting on ${t.waits_on.map(esc).join(', ')}</div>` : ''}
    <h4>Acceptance</h4><ul>${(t.acceptance ?? []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
    ${t.verify ? `<h4>Verify</h4><div class="verify">${esc(t.verify)}</div>` : ''}
    ${t.spec ? `<h4>Spec</h4><code>${esc(t.spec)}</code>` : ''}
    ${t.body ? `<h4>Brief</h4><div class="brief">${esc(t.body)}</div>` : ''}`
  el.querySelectorAll('.deps a').forEach((a) => (a.onclick = () => select(a.dataset.id)))
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)))
  document.querySelectorAll('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name))
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)))

// Faint corner readout, like the reference's T/I/N/S stats.
function renderStats(d) {
  const r = d.runner ?? {}
  const rows = [
    ['loop', r.running ? `${replanning(d) ? 're-planning' : 'running'} · pid ${r.pid}` : r.stop ? stopShort(r.stop) : d.loop ? 'stopped' : 'never run'],
    ['iter', r.run?.iteration ? `${r.run.iteration}${r.run.max ? `/${r.run.max}` : ''} · ${r.run.mode ?? ''}` : '—'],
    ['head', d.commits[0]?.hash ?? '—'],
  ]
  if (d.problems.length) rows.push(['graph', `${d.problems.length} problem(s)`])
  $('stats').innerHTML = rows.map(([k, v]) => `<div>${k}: <b>${esc(v)}</b></div>`).join('')
}

function renderCommits(d) {
  $('commits').innerHTML = d.commits
    .map((c) => `<li><code>${esc(c.hash)}</code><div><span class="${c.task ? 't' : ''}" data-id="${esc(c.task ?? '')}">${esc(c.subject)}</span><time>${ago(c.date)} ago</time></div></li>`)
    .join('')
  $('commits').querySelectorAll('.t').forEach((s) => (s.onclick = () => select(s.dataset.id)))
}

function renderLoop(d) {
  if (!d.loop) { $('loop').textContent = ''; $('loopAge').textContent = 'No harness/.loop.log in this project yet.'; return }
  const pre = $('loop')
  const box = pre.parentElement // the pane scrolls, not the <pre>
  const atBottom = box.hidden || box.scrollTop + box.clientHeight >= box.scrollHeight - 8
  pre.textContent = d.loop.tail.split('\n').slice(-80).join('\n')
  $('loopAge').textContent = `updated ${ago(d.loop.updated_at)} ago`
  if (atBottom) box.scrollTop = box.scrollHeight
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
$('fit').addEventListener('click', () => { setFocus(false); fit() })
const zoomBy = (k) => {
  setFocus(false)
  const v = state.view
  const cx = v.x + v.w / 2, cy = v.y + v.h / 2
  tweenView({ x: cx - (v.w * k) / 2, y: cy - (v.h * k) / 2, w: v.w * k, h: v.h * k }, 250)
}
$('zoomIn').addEventListener('click', () => zoomBy(0.75))
$('zoomOut').addEventListener('click', () => zoomBy(1.33))

// Focus is a toggle: switching it on glides to the task that matters — the one in doing (running
// or stalled), else the next the agent would pick — and keeps following the build as it moves to
// new tasks. Moving the camera yourself (drag, scroll, pinch, zoom, fit) switches it off.
function setFocus(on) {
  const box = $('focus')
  if (box.checked === on) return
  box.checked = on
  if (on) focusNow()
}
function focusNow() {
  const d = state.data
  if (!d) return
  const target = d.tasks.find((t) => t.status === 'doing') ?? nextAgentTask(d) ?? d.tasks.find((t) => statusOf(t) === 'ready')
  if (!target || !state.pos.has(target.id)) return
  state.followed = target.id
  centerOn(state.pos.get(target.id))
}
$('focus').addEventListener('change', () => { if ($('focus').checked) focusNow() })
// Watch the canvas itself rather than the window: it can go from 0×0 to a real size without the
// window resizing (a hidden pane or tab being shown), and the first real size is when to frame it.
new ResizeObserver(() => {
  if (!state.data) return
  if (!state.view) { fit(); openFocus() }
  else if ($('focus').checked) focusNow()
  else fit()
}).observe($('graph'))
setInterval(() => state.data && (renderSummary(state.data), renderFlow(state.data, false)), 15000)
setInterval(() => renderNav().catch(() => {}), 15000)

/* ---------- loop controls: ▶ start (with a popover), ■ stop (with a confirm) -------- */

const ICON = {
  play: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5z"/></svg>',
  stop: '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2"/></svg>',
}
let pending = null // 'start' | 'stop' while a request is in flight or the loop hasn't caught up yet
let pendingTimer
const store = { get: (k) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } }
let mode = store.get('loop.mode') ?? 'build'

function renderControls(d) {
  const r = d.runner ?? {}
  const c = d.controls ?? {}
  const btn = $('runBtn')
  // Once the server sees the change we asked for, stop showing "starting…/stopping…".
  if ((pending === 'start' && r.running) || (pending === 'stop' && !r.running)) { pending = null; clearTimeout(pendingTimer) }
  const on = r.running
  btn.innerHTML = on ? ICON.stop : ICON.play
  btn.classList.toggle('running', on)
  btn.classList.toggle('busy', !!pending)
  btn.disabled = !!pending || (!on && (!c.script || !c.modes?.length))
  btn.setAttribute('aria-label', on ? 'Stop the loop' : 'Start the loop')
  btn.title = on ? 'Stop the loop'
    : c.read_only ? 'This server was started with --read-only'
    : !c.script ? 'This project has no harness/bin/loop.sh'
    : !c.modes?.length ? 'No harness/prompts/*.md to run' : 'Start the loop'

  const iter = r.run?.iteration ?? 0
  const max = r.run?.max ?? 0
  const label = $('runState').querySelector('.l')
  const bar = $('runState').querySelector('.track span')
  if (pending === 'start') label.innerHTML = '<b>Starting…</b>'
  else if (pending === 'stop') label.innerHTML = '<b>Stopping…</b> signalling the loop and its agent'
  else if (on && replanning(d)) label.innerHTML = `<i></i><b>Re-planning</b> · before iteration ${iter}${max ? ` of ${max}` : ''} · ${ago(r.since)}`
  else if (on) label.innerHTML = `<i></i><b>In progress</b> · ${r.run?.mode ?? 'loop'} · iteration ${iter}${max ? ` of ${max}` : ''} · ${ago(r.since)}`
  else if (r.stop) label.innerHTML = `<b>Stopped</b> · ${esc(stopShort(r.stop))} · ${ago(r.stop.at)} ago`
  else label.innerHTML = c.script ? '<b>Not running</b> · press play to start the loop' : '<b>Not running</b>'
  // The track fills with iterations used; while one is in flight it counts as half done.
  bar.style.width = on && max ? `${Math.min(100, (100 * Math.max(0, iter - 0.5)) / max)}%` : '0%'

  if (!$('stopPop').hidden && !on) closePops()
  if (!$('startPop').hidden && on) closePops()
}

function closePops() {
  for (const id of ['startPop', 'stopPop']) $(id).hidden = true
  $('runBtn').setAttribute('aria-expanded', 'false')
}
function openPop(id, focus) {
  closePops()
  $(id).hidden = false
  $('runBtn').setAttribute('aria-expanded', 'true')
  focus?.focus()
}

$('runBtn').addEventListener('click', () => {
  const d = state.data
  if (!d) return
  if (!$('startPop').hidden || !$('stopPop').hidden) return closePops()
  if (d.runner?.running) {
    const doing = d.tasks.find((t) => t.status === 'doing')
    $('stopWhat').innerHTML = doing
      ? `The agent is cut off mid-iteration. <code>${esc(doing.id)}</code> stays in <b>doing</b>, and the next run picks it back up.`
      : 'The agent is cut off mid-iteration; anything it hasn\'t committed stays in the working tree.'
    openPop('stopPop', $('stopGo'))
  } else {
    const modes = d.controls?.modes ?? []
    if (!modes.includes(mode)) mode = modes[0]
    $('modes').innerHTML = modes.map((m) => `<button type="button" data-mode="${esc(m)}" aria-pressed="${m === mode}">${esc(m)}</button>`).join('')
    $('iters').value = store.get('loop.iterations') ?? 10
    updateCmd()
    openPop('startPop', $('startGo'))
  }
})

function iterations() {
  const n = Math.round(Number($('iters').value))
  return Math.min(200, Math.max(1, Number.isFinite(n) ? n : 10))
}
const updateCmd = () => { $('cmd').textContent = `./harness/bin/loop.sh ${mode} ${iterations()}` }
$('modes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]')
  if (!b) return
  mode = b.dataset.mode
  $('modes').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
  updateCmd()
})
$('iters').addEventListener('input', updateCmd)
$('itersDown').addEventListener('click', () => { $('iters').value = Math.max(1, iterations() - 1); updateCmd() })
$('itersUp').addEventListener('click', () => { $('iters').value = Math.min(200, iterations() + 1); updateCmd() })
document.querySelectorAll('.stepper .quick button').forEach((b) => b.addEventListener('click', () => { $('iters').value = b.dataset.n; updateCmd() }))
document.querySelectorAll('.pop [data-close]').forEach((b) => b.addEventListener('click', closePops))
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops() })
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.pop, #runBtn')) closePops() })
$('iters').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('startGo').click() })

async function loopAction(action, payload) {
  const slug = state.slug
  pending = action
  closePops()
  renderControls(state.data)
  clearTimeout(pendingTimer)
  // If the snapshot never reflects the change, give the button back rather than hang.
  pendingTimer = setTimeout(() => { pending = null; state.data && renderControls(state.data) }, 12000)
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/loop/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-net-work': '1' },
      body: JSON.stringify(payload ?? {}),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`)
    toast(action === 'start' ? `▶ Loop started · ${payload.mode} × ${payload.iterations}` : '■ Loop stopped')
  } catch (err) {
    pending = null
    clearTimeout(pendingTimer)
    toast(`Couldn't ${action} the loop: ${err.message}`, 'error')
  }
  if (state.data && state.slug === slug) renderControls(state.data)
}

$('startGo').addEventListener('click', () => {
  const n = iterations()
  store.set('loop.mode', mode)
  store.set('loop.iterations', String(n))
  loopAction('start', { mode, iterations: n })
})
$('stopGo').addEventListener('click', () => loopAction('stop'))

/* ---------- theme ------------------------------------------------------------- */
// Follows the system until you press the toggle; then your choice sticks (per browser).

function theme() {
  const set = document.documentElement.dataset.theme
  return set ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
}
function paintThemeButton() {
  const next = theme() === 'dark' ? 'light' : 'dark'
  $('theme').textContent = next === 'light' ? '☀' : '☾'
  $('theme').setAttribute('aria-label', `Switch to ${next} theme`)
  $('theme').title = `Switch to ${next} theme`
}
$('theme').addEventListener('click', () => {
  const next = theme() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  store.set('theme', next)
  paintThemeButton()
})
matchMedia('(prefers-color-scheme: light)').addEventListener('change', paintThemeButton)
paintThemeButton()

loadProjects()
