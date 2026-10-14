import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js'

const RULES = {
  R1: 'Primary key', R2: 'Atomic values', R3: 'No repeating groups', R4: 'No transitive copies',
  R5: 'One concept, one model', R6: 'Unneeded 1:1 split', R7: 'Declared relations', R8: 'No redundant FK paths',
  R9: 'Join models', R10: 'Closed value sets → enum', R11: 'Precise types', R12: 'Required when always present',
  R13: 'Natural uniqueness', R14: 'FK indexes', R15: 'Naming', R16: 'Snapshots (kept)', R17: 'Derived values',
  R18: 'JSON', R19: 'Possibly unused',
}

const $ = (s, el = document) => el.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const data = await (await fetch('data.json')).json()
const before = new Map(data.before.models.map((m) => [m.name, m]))
const after = new Map(data.after.models.map((m) => [m.name, m]))
const maps = new Map(data.mapping.models.map((m) => [m.source, m]))
const newModels = new Map((data.mapping.new_models ?? []).map((n) => [n.name, n]))
const SUPPORT = new Set(['QuarantinedRow', 'MigrationIdMap'])

// ---------------------------------------------------------------------------
// Classify every source model and every new model
// ---------------------------------------------------------------------------
const sig = (f) => `${f.type}${f.list ? '[]' : f.optional ? '?' : ''} ${f.attrs.filter((a) => !a.startsWith('@map')).join(' ')}`
const scalars = (m) => m.fields.filter((f) => !f.relation)

function rulesOf(mm) {
  const r = new Set(mm.rules ?? [])
  for (const f of mm.fields) for (const x of f.rules ?? []) r.add(x)
  return [...r].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}
function decisionsFor(name, fieldNames = []) {
  const refs = new Set([name, ...fieldNames.map((f) => `${name}.${f}`)])
  const hit = (r) => refs.has(r) || r.startsWith(`${name}.`)
  return {
    ambiguities: (data.decisions.ambiguities ?? []).filter((a) => a.refs.some(hit)),
    snapshots: (data.decisions.snapshots ?? []).filter((s) => s.refs.some(hit)),
    quarantine: (data.decisions.quarantine ?? []).filter((q) => q.source === name),
  }
}

const entries = []
for (const [src, mm] of maps) {
  const b = before.get(src)
  const a = after.get(mm.target ?? '')
  let status = 'unchanged'
  if (mm.action === 'merge') status = 'merged'
  else if (mm.action === 'drop') status = 'dropped'
  else if (mm.action === 'rename') status = 'renamed'
  else {
    const fieldChange = mm.fields.some((f) => f.action !== 'copy' || (f.target && f.target !== `${src}.${f.source}`))
    const bs = new Map(scalars(b).map((f) => [f.name, sig(f)]))
    const as = a ? scalars(a) : []
    const schemaChange = !a || as.some((f) => bs.get(f.name) !== sig(f)) || as.length !== bs.size || JSON.stringify(a.attrs) !== JSON.stringify(b.attrs) || a.fields.filter((f) => f.relation?.fields).length !== b.fields.filter((f) => f.relation?.fields).length
    const d = decisionsFor(src)
    if (fieldChange || schemaChange) status = 'changed'
    else if (d.ambiguities.length || d.snapshots.length) status = 'documented'
  }
  entries.push({ kind: 'source', name: src, status, rules: rulesOf(mm), mm })
}
for (const [name, n] of newModels) {
  if (SUPPORT.has(name) || maps.has(name)) continue
  entries.push({ kind: 'new', name, status: 'new', rules: n.rules ?? [], nm: n })
}
const order = { changed: 0, merged: 1, renamed: 2, new: 3, documented: 4, dropped: 5, unchanged: 6 }
entries.sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name))

// ---------------------------------------------------------------------------
// Databases (two PGlite instances: before = messy, after = messy + refactor migration)
// ---------------------------------------------------------------------------
const status = $('#dbstatus')
const dbs = {}
const ready = (async () => {
  try {
    status.textContent = 'Loading the messy database…'
    const b = new PGlite()
    await b.exec(data.sql.init)
    await b.exec(data.sql.seed)
    dbs.before = b
    status.textContent = 'Applying the refactor migration…'
    const a = new PGlite()
    await a.exec(data.sql.init)
    await a.exec(data.sql.seed)
    await a.exec(data.sql.refactor)
    dbs.after = a
    status.textContent = 'Both databases loaded in your browser'
    status.classList.add('ready')
  } catch (e) {
    status.textContent = `Database error: ${e.message}`
    status.classList.add('error')
    throw e
  }
})()

async function query(which, sql) {
  await ready
  const r = await dbs[which].query(sql)
  return { columns: r.fields.map((f) => f.name), rows: r.rows }
}

function renderTable({ columns, rows }, mark = {}) {
  if (!rows.length) return '<div class="empty">no rows</div>'
  const cell = (v) => (v === null || v === undefined ? '<td class="null">null</td>' : `<td title="${esc(typeof v === 'object' ? JSON.stringify(v) : v)}">${esc(v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) : typeof v === 'object' ? JSON.stringify(v) : v)}</td>`)
  return `<div class="scroll"><table class="data"><thead><tr>${columns.map((c) => `<th class="${mark[c] ?? ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map((c) => cell(r[c])).join('')}</tr>`).join('')}</tbody></table></div>`
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function overview() {
  const count = (s) => entries.filter((e) => e.status === s).length
  const fieldsChanged = data.mapping.models.flatMap((m) => m.fields).filter((f) => f.action !== 'copy').length
  const q = (data.decisions.quarantine ?? []).reduce((s, x) => s + x.rows, 0)
  const ruleCounts = {}
  for (const e of entries) for (const r of e.rules) ruleCounts[r] = (ruleCounts[r] ?? 0) + 1
  const m = data.run.metrics
  const names = { S1: 'Recall (mess fixed)', S2: 'Restraint (clean untouched)', S3: 'Traps left alone', S4: 'Ambiguities logged', S5: 'Constraints' }
  $('#tab-overview').innerHTML = `
    <div class="cards">
      <div class="card"><div class="n">${data.before.models.length}</div><div class="l">models before</div></div>
      <div class="card"><div class="n">${data.after.models.length}</div><div class="l">models after (incl. 2 support)</div></div>
      <div class="card"><div class="n">${count('changed') + count('renamed')}</div><div class="l">models changed</div></div>
      <div class="card"><div class="n">${count('merged')}</div><div class="l">models merged away</div></div>
      <div class="card"><div class="n">${count('new')}</div><div class="l">new child/join models</div></div>
      <div class="card"><div class="n">${fieldsChanged}</div><div class="l">fields not copied 1:1</div></div>
      <div class="card"><div class="n">${q}</div><div class="l">rows quarantined</div></div>
      <div class="card"><div class="n">${(data.decisions.ambiguities ?? []).length}</div><div class="l">questions for a human</div></div>
    </div>
    <p class="prose">Most models are left alone on purpose: the skill only changes something when it can name a rule and the evidence. Pick a rule to see where it was applied, or open the <b>Models</b> tab. Every change below comes straight from the skill's <code>mapping.yaml</code> and <code>decisions.yaml</code>.</p>
    <h2>Rules applied</h2>
    <div class="rulegrid">${Object.keys(RULES).filter((r) => ruleCounts[r]).map((r) => `<button class="rulecard" data-rule="${r}"><span class="chip r">${r}</span> ${esc(RULES[r])} <span class="chip">${ruleCounts[r]} model${ruleCounts[r] > 1 ? 's' : ''}</span></button>`).join('')}</div>
    <h2>How this run scored</h2>
    <div class="gates">${Object.entries(data.run.gates).map(([g, s]) => `<span class="gate ${s === 'pass' ? '' : 'fail'}">${g} ${s === 'pass' ? '✓' : s}</span>`).join('')}</div>
    <div class="metrics" style="margin-top:10px">${Object.entries(m).map(([k, v]) => `<div class="metric">${k} · ${esc(names[k] ?? '')}<br><b>${v.passed}/${v.total}</b></div>`).join('')}</div>
    ${data.run.cost ? `<p class="prose" style="color:var(--muted)">One headless run: ${data.run.cost.turns} turns, ${Math.round(data.run.cost.wallMs / 60000)} min.</p>` : ''}
  `
  for (const b of document.querySelectorAll('.rulecard')) b.onclick = () => { $('#filter').value = b.dataset.rule; showTab('models'); renderList() }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
let current = null
function renderList() {
  const f = $('#filter').value.trim().toLowerCase()
  const showAll = $('#showUnchanged').checked
  const vis = entries.filter((e) => (showAll || e.status !== 'unchanged') && (!f || e.name.toLowerCase().includes(f) || e.rules.some((r) => r.toLowerCase() === f)))
  const groups = { changed: 'Changed', merged: 'Merged away', renamed: 'Renamed', new: 'New', documented: 'Kept and documented', dropped: 'Dropped', unchanged: 'Unchanged' }
  let html = ''
  for (const [k, label] of Object.entries(groups)) {
    const xs = vis.filter((e) => e.status === k)
    if (!xs.length) continue
    html += `<div class="group">${label} (${xs.length})</div>`
    html += xs.map((e) => `<button class="item" data-name="${esc(e.name)}" aria-current="${e.name === current}">${esc(e.name)}<span class="chips">${e.rules.map((r) => `<span class="chip r">${r}</span>`).join('')}</span></button>`).join('')
  }
  $('#modelList').innerHTML = html || '<div class="empty">nothing matches</div>'
  for (const b of document.querySelectorAll('.item')) b.onclick = () => select(b.dataset.name)
}

function fieldRowsBefore(b, mm) {
  return b.fields.filter((f) => !f.relation || f.relation.fields).map((f) => {
    if (f.relation) return `<tr><td class="fname">${esc(f.name)}</td><td class="ftype">→ ${esc(f.relation.to)}</td><td class="note">relation</td></tr>`
    const fm = mm.fields.find((x) => x.source === f.name)
    let cls = ''
    let note = ''
    if (fm) {
      if (fm.action === 'derive_away' || fm.action === 'drop') { cls = 'del'; note = fm.action === 'derive_away' ? `removed: derivable from ${esc(fm.derivable_from)}` : 'dropped' }
      else if (fm.action === 'explode') { cls = 'chg'; note = `→ rows of ${esc(fm.target.split('.')[0])}` }
      else if (fm.action === 'move' || (fm.target && fm.target.split('.')[0] !== mm.target)) { cls = 'chg'; note = `→ ${esc(fm.target)}` }
      else if (fm.action === 'transform') { cls = 'chg'; note = `${esc(fm.transform)}` }
      else if (fm.target && fm.target !== `${mm.source}.${f.name}`) { cls = 'chg'; note = `→ ${esc(fm.target.split('.')[1])}` }
    }
    return `<tr class="${cls}"><td class="fname">${esc(f.name)}</td><td class="ftype">${esc(sig(f))}</td><td class="note">${note}</td></tr>`
  }).join('')
}

function fieldRowsAfter(a, base, incoming) {
  const bmap = new Map(base ? scalars(base).map((f) => [f.name, f]) : [])
  return a.fields.filter((f) => !f.relation || f.relation.fields).map((f) => {
    if (f.relation) {
      const had = base && base.fields.some((x) => x.relation?.fields && JSON.stringify(x.relation.fields) === JSON.stringify(f.relation.fields))
      return `<tr class="${had || !base && !incoming.size ? '' : had ? '' : 'add'}"><td class="fname">${esc(f.name)}</td><td class="ftype">→ ${esc(f.relation.to)}${f.relation.onDelete ? ` (${esc(f.relation.onDelete)})` : ''}</td><td class="note">${had || !base ? 'relation' : 'new relation'}</td></tr>`
    }
    const old = bmap.get(f.name)
    const inc = incoming.get(f.name)
    let cls = ''
    let note = ''
    if (base && !old) { cls = 'add'; note = inc ? `new, from ${esc(inc)}` : 'new' }
    else if (old && sig(old) !== sig(f)) { cls = 'chg'; note = `was ${esc(sig(old))}` }
    else if (inc) { cls = 'chg'; note = `receives ${esc(inc)}` }
    else if (!base) { note = '' }
    const snap = f.docs.find((d) => d.includes('@snapshot'))
    if (snap) note = `${note ? note + ' · ' : ''}${esc(snap)}`
    return `<tr class="${cls}"><td class="fname">${esc(f.name)}</td><td class="ftype">${esc(sig(f))}</td><td class="note">${note}</td></tr>`
  }).join('')
}

/** Earlier version of an output model: the source that was kept/renamed into it. */
function baseOf(targetName) {
  const mm = data.mapping.models.find((m) => m.target === targetName && (m.action === 'keep' || m.action === 'rename'))
  return mm ? before.get(mm.source) : null
}
/** Fields of the target fed by other source models (moves, merges). */
function incomingFor(targetName, onlySource = null) {
  const o = new Map()
  for (const mm of data.mapping.models) {
    if (onlySource && mm.source !== onlySource) continue
    for (const f of mm.fields) {
      if (!f.target || f.action === 'explode' || f.action === 'derive_away') continue
      const [m, fld] = f.target.split('.')
      if (m !== targetName || (mm.source === targetName && fld === f.source)) continue
      if (mm.source === baseOf(targetName)?.name && !onlySource) continue
      o.set(fld, `${mm.source}.${f.source}`)
    }
  }
  return o
}

function splitSql(sql) {
  const out = []
  let code = ''
  let comments = []
  for (let i = 0; i < sql.length; ) {
    const ch = sql[i]
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      const text = sql.slice(i, end < 0 ? sql.length : end)
      if (!code.trim()) comments.push(text)
      else code += text
      i = end < 0 ? sql.length : end
      continue
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < sql.length && !(sql[j] === ch && sql[j + 1] !== ch)) j += sql[j] === ch ? 2 : 1
      code += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    const dq = ch === '$' && /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
    if (dq) {
      const end = sql.indexOf(dq[0], i + dq[0].length)
      code += sql.slice(i, end < 0 ? sql.length : end + dq[0].length)
      i = end < 0 ? sql.length : end + dq[0].length
      continue
    }
    if (ch === ';') {
      if (code.trim()) out.push({ comments, code: code.trim() + ';' })
      code = ''
      comments = []
      i++
      continue
    }
    code += ch
    i++
  }
  return out
}
const STATEMENTS = splitSql(data.sql.refactor)
const TARGET = /^\s*(?:ALTER\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|CREATE\s+(?:UNIQUE\s+)?INDEX\s+\S+\s+ON)\s+(?:ONLY\s+)?"([^"]+)"/i
function sqlFor(names) {
  const tables = new Set(names.map((n) => before.get(n)?.table ?? after.get(n)?.table ?? n))
  const ann = (c) => c.filter((l) => /^--\s*mapping:/.test(l))
  return STATEMENTS.filter((st) => {
    if (ann(st.comments).some((l) => names.some((n) => new RegExp(`mapping:\\s*${n}\\b`).test(l)))) return true
    const t = TARGET.exec(st.code)
    return t && tables.has(t[1])
  }).map((st) => [...ann(st.comments), st.code].join('\n')).join('\n\n')
}
const hlSql = (s) => esc(s).replace(/^(--.*)$/gm, '<span class="c">$1</span>')

async function select(name) {
  current = name
  renderList()
  const e = entries.find((x) => x.name === name)
  const el = $('#detail')
  if (e.kind === 'new') {
    const a = after.get(name)
    const d = decisionsFor(name)
    el.innerHTML = `
      <h2>${esc(name)} <span class="badge b-new">new model</span></h2>
      <div class="why"><b>Why:</b> ${e.rules.map((r) => `<span class="chip r">${r}</span> ${esc(RULES[r] ?? '')}`).join(', ')} — filled from ${(e.nm.filled_from ?? []).map((x) => `<code>${esc(x)}</code>`).join(', ')}.</div>
      <h3>Schema after</h3>
      <div class="box"><table class="fields">${fieldRowsAfter(a, null, new Map())}</table></div>
      <h3>Data after</h3><div class="box" id="dAfter"><div class="empty">loading…</div></div>
      <h3>Migration</h3><div class="box"><pre class="sql">${hlSql(sqlFor([name, ...(e.nm.filled_from ?? []).map((x) => x.split('.')[0])])) || 'no statements'}</pre></div>
      ${d.quarantine.length ? '' : ''}`
    const pk = a.pk.map(qi).join(', ')
    $('#dAfter').innerHTML = renderTable(await query('after', `SELECT * FROM ${qi(a.table)} ORDER BY ${pk} LIMIT 10`))
    return
  }
  const mm = e.mm
  const b = before.get(name)
  const a = after.get(mm.target ?? '')
  const d = decisionsFor(name, scalars(b).map((f) => f.name))
  const notes = mm.fields.filter((f) => f.action !== 'copy' || f.decision || (f.rules ?? []).length || (f.target && f.target !== `${name}.${f.source}`))
  const actionBadge = { merge: `<span class="badge b-merge">merged into ${esc(mm.target)}</span>`, rename: `<span class="badge b-rename">renamed to ${esc(mm.target)}</span>`, drop: '<span class="badge b-drop">dropped</span>', keep: e.status === 'changed' ? '<span class="badge b-changed">changed</span>' : '<span class="badge b-keep">kept</span>' }[mm.action]
  el.innerHTML = `
    <h2>${esc(name)} ${actionBadge}</h2>
    <div class="why">
      ${mm.reason ? `<div><b>Why:</b> ${(mm.rules ?? []).map((r) => `<span class="chip r">${r}</span>`).join(' ')} ${esc(mm.reason)}</div>` : !notes.length && !d.ambiguities.length && !d.snapshots.length ? '<div><b>No rule applies.</b> Default is keep: a model only changes when a rule and its evidence say so.</div>' : ''}
      ${mm.dedupe ? `<div>Dedupe on <code>${esc(mm.dedupe.key.join(', '))}</code>, winner: ${esc(mm.dedupe.winner)}</div>` : ''}
      ${notes.length ? `<ul>${notes.map((f) => `<li><code>${esc(f.source)}</code> <span class="badge b-${f.action === 'derive_away' ? 'removed' : f.action === 'copy' ? 'same' : f.action === 'move' ? 'moved' : f.action}">${esc(f.action.replace('_', ' '))}</span> ${(f.rules ?? []).map((r) => `<span class="chip r" title="${esc(RULES[r] ?? '')}">${r}</span>`).join(' ')} ${esc(f.reason ?? '')}${f.derivable_from ? ` — derivable from <code>${esc(f.derivable_from)}</code>` : ''}${f.values ? ` — ${Object.entries(f.values).map(([k, v]) => `<code>${esc(JSON.stringify(k))}</code>→${esc(v)}`).join(', ')}` : ''}${f.decision ? ` <span class="chip">${esc(f.decision)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${d.snapshots.map((s) => `<div style="margin-top:6px"><span class="chip r">R16</span> <b>${esc(s.id)}</b> kept on purpose: ${esc(s.reason)} (${s.refs.map((r) => `<code>${esc(r)}</code>`).join(', ')})</div>`).join('')}
      ${d.ambiguities.map((x) => `<div style="margin-top:6px"><span class="chip r">${esc(x.rule ?? '')}</span> <b>${esc(x.id)}</b> open question: ${esc(x.question)} <i>Chosen: ${esc(x.chosen ?? '')}</i></div>`).join('')}
      ${d.quarantine.map((x) => `<div style="margin-top:6px">${x.rows} row(s) quarantined (${esc(x.reason)})</div>`).join('')}
    </div>
    <h3>Schema</h3>
    <div class="cols">
      <div class="box"><div class="hd">Before <span class="mono">${esc(b.table)}</span></div><table class="fields">${fieldRowsBefore(b, mm)}</table>${b.attrs.length ? `<div class="empty mono">${b.attrs.map(esc).join('<br>')}</div>` : ''}</div>
      <div class="box"><div class="hd">After ${a ? `<span class="mono">${esc(a.name)} → ${esc(a.table)}</span>` : ''}</div>${a ? `<table class="fields">${fieldRowsAfter(a, baseOf(a.name), incomingFor(a.name, mm.action === 'merge' ? name : null))}</table>${a.attrs.length ? `<div class="empty mono">${a.attrs.map(esc).join('<br>')}</div>` : ''}` : '<div class="empty">no model</div>'}</div>
    </div>
    <h3>Data</h3>
    <div class="cols">
      <div class="box"><div class="hd">Before</div><div id="dBefore"><div class="empty">loading the database…</div></div></div>
      <div class="box"><div class="hd">After${mm.action === 'merge' ? ` <span class="note">rows of ${esc(mm.target)} that came from ${esc(name)}</span>` : ''}</div><div id="dAfter"><div class="empty">loading the database…</div></div></div>
    </div>
    <h3>Migration statements</h3>
    <div class="box"><pre class="sql">${hlSql(sqlFor([name])) || 'No statements: this model is unchanged in the database.'}</pre></div>
  `
  const bpk = b.pk.map(qi).join(', ')
  const bres = await query('before', `SELECT * FROM ${qi(b.table)} ORDER BY ${bpk} LIMIT 8`)
  if (current !== name) return
  const afterCols = new Set(a ? (await query('after', `SELECT * FROM ${qi(a.table)} LIMIT 0`)).columns : [])
  const bmark = mm.action === 'merge' ? {} : Object.fromEntries(bres.columns.filter((c) => !afterCols.has(c)).map((c) => [c, 'del']))
  $('#dBefore').innerHTML = renderTable(bres, bmark)
  if (!a) { $('#dAfter').innerHTML = '<div class="empty">model removed</div>'; return }
  let ares
  if (mm.action === 'merge' && b.pk.length === 1) {
    ares = await query('after', `SELECT t.* FROM ${qi(a.table)} t JOIN migration_id_map m ON m."targetId" = t.${qi(a.pk[0])}::text AND m."sourceModel" = ${lit(name)} ORDER BY m."sourceId"::int LIMIT 8`)
    if (!ares.rows.length) ares = await query('after', `SELECT * FROM ${qi(a.table)} ORDER BY 1 LIMIT 8`)
  } else {
    ares = await query('after', `SELECT * FROM ${qi(a.table)} ORDER BY ${a.pk.map(qi).join(', ')} LIMIT 8`)
  }
  if (current !== name) return
  const bcols = new Set(bres.columns)
  const amark = Object.fromEntries(ares.columns.filter((c) => !bcols.has(c)).map((c) => [c, 'add']))
  $('#dAfter').innerHTML = renderTable(ares, amark)
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
async function decisionsTab() {
  const d = data.decisions
  $('#tab-decisions').innerHTML = `
    <h2>Questions for a human (${(d.ambiguities ?? []).length})</h2>
    <p class="prose">Where the right answer depends on business meaning that the schema and data can't establish, the skill keeps the safe default and asks.</p>
    ${(d.ambiguities ?? []).map((a) => `<div class="amb"><span class="chip r">${esc(a.rule ?? '')}</span> <b>${esc(a.id)}</b> <span class="mono">${a.refs.map(esc).join(', ')}</span><div class="q">${esc(a.question)}</div><div class="opts">Options: ${(a.options ?? []).map(esc).join(' · ')} — chosen: <b>${esc(a.chosen ?? '')}</b></div></div>`).join('')}
    <h2>Snapshots kept on purpose (${(d.snapshots ?? []).length})</h2>
    ${(d.snapshots ?? []).map((s) => `<div class="amb"><b>${esc(s.id)}</b> <span class="mono">${s.refs.map(esc).join(', ')}</span><div class="q">${esc(s.reason ?? '')}</div></div>`).join('')}
    <h2>Quarantined rows</h2>
    <div class="box" id="qrows"><div class="empty">loading the database…</div></div>
    ${(d.assumptions ?? []).length ? `<h2>Assumptions</h2><ul class="prose">${d.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  `
  try {
    $('#qrows').innerHTML = renderTable(await query('after', `SELECT "sourceModel", "sourceId", reason, payload FROM quarantined_row ORDER BY "sourceModel", id LIMIT 100`))
  } catch (e) {
    $('#qrows').innerHTML = `<div class="err">${esc(e.message)}</div>`
  }
}

// ---------------------------------------------------------------------------
// Tabs and console
// ---------------------------------------------------------------------------
function showTab(t) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t))
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${t}`
  if (t === 'models' && !current) select(entries[0].name)
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => showTab(b.dataset.tab)
$('#filter').oninput = renderList
$('#showUnchanged').onchange = renderList
$('#qrun').onclick = async () => {
  const out = $('#qout')
  out.innerHTML = '<div class="empty">running…</div>'
  try {
    out.innerHTML = renderTable(await query($('#qdb').value, $('#qtext').value))
  } catch (e) {
    out.innerHTML = `<div class="err">${esc(e.message)}</div>`
  }
}

overview()
renderList()
decisionsTab()
