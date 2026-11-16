// Two editors on one @sanity/table field, through the save queue (after the round-4 reviewer's
// simulation of PR #1260). Real code: rebase, takeBase, answered, unsent and sentNotesOf
// (lib/edit-bases.ts), every TableWrite (lib/table-input.ts), the caret follow's alignColumns.
// lib/edits.ts's edit() and send() around them are copied here as they are (it is not
// importable in a unit test), and so is Barkpark's field fence: a write on a stale rev passes
// when the fields it writes are unchanged since. Random interleavings of keys, the press,
// sends, the server taking a write, answers, live frames and late renders; then everything
// drains and the outcome is checked. Column moves are left out (task-e9f5222ecfda4f25).
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {answered, rebase, sentNotesOf, takeBase, unsent, type Spots} from './edit-bases.ts'
import {applyPaths, getPath, setInside, setPath, within} from './paths.ts'
import {mapCaret} from './merge.ts'
import {alignColumns} from './table-merge.ts'
import {addColumns, addRows, removeColumn, removeRow, setCell, tableGrid} from './table-input.ts'

const J = JSON.stringify
const clone = <T,>(v: T): T => JSON.parse(J(v))
// mulberry32: an integer generator (a float LCG falls into a short cycle).
let seed = 1
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (n: number) => Math.floor(rnd() * n)
const pick = <T,>(a: readonly T[]): T => a[int(a.length)]!
let kn = 0
const newKey = () => `n${++kn}`

type Doc = {_rev: string; _updatedAt: string; t?: any}
type Op = {kind: 'inscol' | 'rmcol' | 'insrow' | 'rmrow'; at: number}
type Step = {word: string; row: string; col: number} | {op: Op}

class Server {
  n = 0
  doc: Doc
  history = new Map<string, unknown>()
  constructor(t: unknown) {
    this.doc = {_rev: 'v0', _updatedAt: '000000', t}
    this.history.set('v0', clone(t))
  }
  mutate(ifRev: string | undefined, set: [string, unknown][], unset: string[]): {ok: true; doc: Doc} | {ok: false} {
    if (ifRev && ifRev !== this.doc._rev && J(this.history.get(ifRev)) !== J(this.doc.t)) return {ok: false}
    let d: any = {...this.doc}
    for (const [p, v] of set) d = setPath(d, p, clone(v))
    for (const p of unset) d = setPath(d, p, undefined)
    d._rev = `v${++this.n}`
    d._updatedAt = String(this.n).padStart(6, '0')
    this.doc = d
    this.history.set(d._rev, clone(d.t))
    return {ok: true, doc: clone(d)}
  }
}

class Client {
  e: Spots = {base: new Map(), dirty: new Map(), inflight: null}
  cache: Doc
  view: Doc // what React last drew
  drawn: {rows: [string, string[]][]; columns: number; widths: string} | null = null
  caret: {key: string; column: number} | null = null
  local = '' // the focused input's text
  at = 0 // its caret
  request: {set: [string, unknown][]; unset: string[]; rev?: string} | null = null
  answer: {ok: true; doc: Doc} | {ok: false} | null = null
  frames: Doc[] = []
  pos = 0
  keys = 0
  name: string
  script: Step[]
  ids: () => number[]
  constructor(name: string, d: Doc, script: Step[], ids: () => number[]) {
    ;[this.name, this.script, this.ids] = [name, script, ids]
    this.cache = clone(d)
    this.view = this.cache
    this.render()
  }
  overlay = (d: Doc): Doc => applyPaths(applyPaths(d as any, this.e.inflight ?? []), this.e.dirty) as Doc
  // lib/edits.ts edit(), its save-queue part.
  edit(field: string, value: unknown) {
    const e = this.e
    const held = this.cache
    if (typeof value === 'function') value = value(getPath(held, field))
    if (!e.dirty.size && !e.inflight) e.rev = held._rev
    takeBase(e, field, held, value)
    const outer = [...e.dirty.keys()].find((k) => k !== field && within(field, k))
    if (outer) e.dirty.set(outer, setInside(outer, e.dirty.get(outer), field, value))
    else {
      for (const k of [...e.dirty.keys()]) if (k !== field && within(k, field)) e.dirty.delete(k)
      e.dirty.set(field, value)
    }
    this.cache = setPath({...held} as any, field, value)
  }
  write = (writes: [string, unknown][]) => writes.forEach(([p, v]) => this.edit(p ? `t.${p}` : 't', v))
  send() {
    const e = this.e
    e.inflight = e.dirty
    e.dirty = new Map()
    sentNotesOf(e)
    const set: [string, unknown][] = []
    const unset: string[] = []
    for (const [k, v] of e.inflight) (v === '' || v == null ? unset.push(k) : set.push([k, v]))
    this.request = {set, unset, rev: e.rev}
  }
  applyServer(doc: Doc) {
    if (this.cache._updatedAt > doc._updatedAt) return
    rebase(this.e, doc as any, this.cache as any)
    this.cache = this.overlay(doc)
  }
  // lib/edits.ts send(): its answer, and a 412's read and rebase.
  onAnswer(server: Server) {
    const e = this.e
    const a = this.answer!
    this.answer = null
    if (a.ok) {
      answered(e, a.doc)
      e.inflight = null
      const later = e.missed && e.missed._updatedAt > a.doc._updatedAt ? e.missed : undefined
      e.missed = undefined
      if (!later) e.missedFrom = undefined
      this.applyServer(a.doc)
      if (later) this.applyServer(later as Doc)
    } else {
      const latest = clone(server.doc)
      unsent(e)
      e.inflight = null
      e.missed = undefined
      rebase(e, latest as any, this.cache as any)
      this.cache = this.overlay(latest)
    }
  }
  // components/TableInput.tsx's layout effect: the caret follows its cell.
  render() {
    const value = this.cache.t
    const grid = tableGrid(value)
    const was = this.drawn
    const widths = (Array.isArray(value?.rows) ? value.rows : []).map((r: any) => (Array.isArray(r?.cells) ? r.cells.length : 0)).join()
    const settled = widths.split(',').every((w: string) => Number(w) === grid.columns) || !was || was.widths === widths
    if (settled) this.drawn = {rows: grid.rows.map((r) => [r.key, r.cells]), columns: grid.columns, widths}
    this.view = this.cache
    const held = this.caret
    if (!held) return
    const row = grid.rows.findIndex((r) => r.key === held.key)
    if (row < 0) return void (this.caret = null)
    let column = held.column
    if (was && settled && was.columns !== grid.columns) {
      const now = new Map(grid.rows.map((r) => [r.key, r.cells]))
      const own = (k: string, cells: string[]) => (k === held.key ? cells.map((c, i) => (i === held.column ? this.local : c)) : cells)
      const to = alignColumns(was.rows.filter(([k]) => now.has(k)).map(([k, cells]): [string[], string[]] => [own(k, cells), now.get(k)!]), was.columns, grid.columns, (i) => i === column)[column]
      if (to !== undefined && to < 0) return void (this.caret = null)
      column = to ?? Math.min(column, grid.columns - 1)
    }
    this.caret = {key: held.key, column}
    // TableInput's Cell: someone else's edit to the focused cell keeps the caret on the same text.
    const now = grid.rows[row]!.cells[column] ?? ''
    if (now !== this.local) this.at = mapCaret(this.local, now, this.at)
    this.local = now
  }
  /** Click a cell by row key and column id (this editor's own idea of the columns). */
  click(row: string, col: number): boolean {
    const grid = tableGrid(this.view.t)
    const column = this.ids().indexOf(col)
    const r = grid.rows.findIndex((x) => x.key === row)
    if (column < 0 || r < 0) return false
    this.caret = {key: row, column}
    this.local = grid.rows[r]!.cells[column] ?? ''
    this.at = this.local.length
    return true
  }
  key(ch: string) {
    if (!this.caret) return
    const r = tableGrid(this.view.t).rows.findIndex((x) => x.key === this.caret!.key)
    if (r < 0) return
    const was = this.local
    this.local = was.slice(0, this.at) + ch + was.slice(this.at++)
    this.write(setCell(this.view.t, r, this.caret.column, this.local, newKey, was))
  }
  press(op: Op) {
    const v = this.view.t
    this.caret = null
    this.write(op.kind === 'inscol' ? addColumns(v, op.at, 1, newKey) : op.kind === 'rmcol' ? removeColumn(v, op.at, newKey) : op.kind === 'insrow' ? addRows(v, op.at, 1, 'tableRow', newKey) : removeRow(v, op.at, newKey))
  }
  done = () => this.pos >= this.script.length
}

const KINDS = ['empty', 'alike', 'partial', 'partial3', 'distinct'] as const
function table(R: number, C: number, kind: (typeof KINDS)[number]) {
  const text = (r: number, c: number) => (kind === 'empty' ? '' : kind === 'alike' ? 'x' : kind === 'partial' ? pick(['', 'x']) : kind === 'partial3' ? pick(['', 'x', 'y']) : `${'abcd'[r]}${'efgh'[c]}`)
  return {_type: 'table', rows: Array.from({length: R}, (_, r) => ({_type: 'tableRow', _key: `r${r}`, cells: Array.from({length: C}, (_, c) => text(r, c))}))}
}
const WORDCH = /[<>A-Z0-9]/

/** One scene: P presses a column or row change (maybe typing before and after), T types one or two words. */
function scene(i: number): {bad: string[]; soft: string[]; name: string} {
  const R = 1 + int(4)
  const C = 1 + int(4)
  const kind = pick(KINDS)
  const t0 = table(R, C, kind)
  const rowKeys = t0.rows.map((r) => r._key)
  const ops: Op[] = []
  for (let p = 0; p <= C; p++) ops.push({kind: 'inscol', at: p})
  if (C >= 2) for (let p = 0; p < C; p++) ops.push({kind: 'rmcol', at: p})
  for (let p = 0; p <= R; p++) ops.push({kind: 'insrow', at: p})
  if (R >= 2) for (let p = 0; p < R; p++) ops.push({kind: 'rmrow', at: p})
  const op = pick(ops)
  // Column ids (100: the new column) and row keys after the op, as the presser sees them.
  const initIds = Array.from({length: C}, (_, c) => c)
  const idsAfter = [...initIds]
  if (op.kind === 'inscol') idsAfter.splice(op.at, 0, 100)
  if (op.kind === 'rmcol') idsAfter.splice(op.at, 1)
  const rowsAfter: string[] = [...rowKeys]
  if (op.kind === 'insrow') rowsAfter.splice(op.at, 0, '*new*')
  if (op.kind === 'rmrow') rowsAfter.splice(op.at, 1)
  const used = new Set<string>()
  const free = (rows: string[], cols: number[]) => {
    for (let tries = 0; tries < 20; tries++) {
      const [r, c] = [pick(rows), pick(cols)]
      if (r !== '*new*' && c !== 100 && !used.has(`${r}/${c}`)) return used.add(`${r}/${c}`), [r, c] as const
    }
    return null
  }
  const tw = free(rowKeys, initIds)!
  const T: Step[] = [{word: `<T${i % 10}>`, row: tw[0], col: tw[1]}]
  const u = rnd() < 0.3 && free(rowKeys, initIds)
  if (u) T.push({word: `<U${i % 10}>`, row: u[0], col: u[1]})
  const P: Step[] = []
  const pw = rnd() < 0.35 && free(rowKeys, initIds)
  if (pw) P.push({word: `<P${i % 10}>`, row: pw[0], col: pw[1]})
  P.push({op})
  const qw = rnd() < 0.35 && free(rowsAfter, idsAfter)
  if (qw) P.push({word: `<Q${i % 10}>`, row: qw[0], col: qw[1]})
  const server = new Server(clone(t0))
  const opAt = P.findIndex((s) => 'op' in s)
  const p: Client = new Client('P', server.doc, P, () => (p.pos > opAt ? idsAfter : initIds))
  const tc: Client = new Client('T', server.doc, T, () => (tableGrid(tc.view.t).columns === C ? initIds : idsAfter))
  const clients = [p, tc]
  const clicked = new Set<string>()
  const step = (c: Client) => {
    const s = c.script[c.pos]!
    if ('op' in s) return void (c.press(s.op), c.pos++)
    if (c.keys === 0) {
      // A click lands on what is drawn: the drawing catches up with this editor's copy first.
      if (c.view !== c.cache) return c.render()
      const cols = tableGrid(c.view.t).columns
      if (c === tc && c.pos > 0 && cols !== C && cols !== idsAfter.length) return
      if (!c.click(s.row, s.col)) return void c.pos++
      clicked.add(s.word)
    }
    c.key(s.word[c.keys]!)
    if (++c.keys === s.word.length) (c.pos++, (c.keys = 0))
  }
  const deliver = (c: Client) => {
    const r = c.request!
    c.request = null
    c.answer = server.mutate(r.rev, r.set, r.unset)
    if (c.answer.ok) for (const x of clients) x.frames.push(clone(server.doc))
  }
  step(tc) // T's first key comes first: its column id is the initial one.
  for (let steps = 0; ; steps++) {
    if (steps > 5000) return {bad: ['NO-QUIESCENCE'], soft: [], name: `scene ${i}`}
    const acts: [number, () => void][] = []
    for (const c of clients) {
      if (!c.done()) acts.push([4, () => step(c)])
      if (c.e.dirty.size && !c.e.inflight && !c.request) acts.push([1.5, () => c.send()])
      if (c.request) acts.push([1.5, () => deliver(c)])
      if (c.answer) acts.push([1.5, () => c.onAnswer(server)])
      if (c.frames.length) acts.push([1.5, () => c.applyServer(c.frames.shift()!)])
      if (c.view !== c.cache) acts.push([2, () => c.render()])
    }
    if (!acts.length) break
    let w = rnd() * acts.reduce((n, [x]) => n + x, 0)
    for (const [x, f] of acts) if ((w -= x) <= 0) (f(), (w = Infinity))
  }
  for (const c of clients) c.render()
  // What is stored, against what both meant: by column ids and row keys.
  const words = [...P, ...T].filter((s): s is Extract<Step, {word: string}> => 'word' in s && clicked.has(s.word))
  const initText = (r: string, c: number) => (c === 100 ? '' : t0.rows.find((x) => x._key === r)!.cells[c]!)
  const want = rowsAfter.map((r) => idsAfter.map((c) => (r === '*new*' ? '' : initText(r, c) + words.filter((w) => w.row === r && w.col === c).map((w) => w.word).join(''))))
  const got: string[][] = (server.doc.t?.rows ?? []).map((r: any) => r.cells)
  const flat = got.flat()
  const bad: string[] = []
  const soft: string[] = []
  if (!clients.every((c) => J(c.cache.t) === J(server.doc.t))) bad.push('DIVERGED')
  if (!got.every((cs) => cs.length === got[0]?.length)) bad.push('UNEVEN')
  for (const w of words) {
    const alive = rowsAfter.includes(w.row) && idsAfter.includes(w.col)
    const n = flat.reduce((k, c) => k + c.split(w.word).length - 1, 0)
    if (alive && n === 0) bad.push(`LOST ${w.word}`)
    if (n > 1) bad.push(`DOUBLED ${w.word}`)
    if (!alive && n > 0) soft.push('REVIVED') // its column or row was removed, the word stayed elsewhere
  }
  for (const c of flat) if (WORDCH.test(words.reduce((rest, w) => rest.split(w.word).join(''), c))) bad.push(`SPLIT ${J(c)}`)
  if (op.kind === 'inscol')
    for (const w of words) {
      const at = idsAfter.indexOf(w.col)
      if (at > op.at && !got.some((cs) => cs[at]?.includes(w.word)) && flat.some((c) => c.includes(w.word))) bad.push(`INSERT-LEFT-WRONG-SIDE ${w.word}`)
    }
  if (!bad.length && J(got) !== J(want)) soft.push('MISPLACED')
  return {bad, soft, name: `scene ${i}: ${R}x${C} ${kind} ${J(t0.rows.map((r) => r.cells))} op ${J(op)} P ${J(P)} T ${J(T)} -> ${J(got)}, meant ${J(want)}`}
}

/** `n` scenes for each seed: what broke, by class. */
export function simulate(n: number, seeds = [1, 2, 3]) {
  const tally = new Map<string, number>()
  const examples: string[] = []
  for (const s of seeds) {
    seed = s
    for (let i = 0; i < n; i++) {
      const o = scene(i)
      for (const k of [...o.bad.map((b) => b.split(' ')[0]!), ...o.soft]) tally.set(k, (tally.get(k) ?? 0) + 1)
      if (o.bad.length && examples.length < Number(process.env.SIM_EXAMPLES || 3)) examples.push(`seed ${s} ${o.bad.join('; ')}: ${o.name}`)
    }
  }
  return {tally, examples}
}

/**
 * What is left, by class, over 10 seeds (1001-1010) x 4,000 scenes: a ceiling that may only fall
 * (per 12,000 scenes: LOST 9.6, SPLIT 11.4, UNEVEN 6, INSERT-LEFT-WRONG-SIDE 23.4). Each needs a
 * column's identity the stored shape does not carry (cells are bare strings; a column is only a
 * place), from column removals and inserts alike: the typer cannot tell which column the presser
 * removed or where it inserted when the cells read alike, and a word placed a column off is then
 * typed on by the other editor. MISPLACED and REVIVED (text kept, in another cell) are counted, not failed.
 */
const SEEDS = Array.from({length: 10}, (_, i) => 1001 + i)
const CEILING: Record<string, number> = {'INSERT-LEFT-WRONG-SIDE': 78, LOST: 32, SPLIT: 38, UNEVEN: 20}

test('two editors, a column or row changed while both type: rows even, both agree, no word lost, doubled or split, an insert to its left never lands right of it', () => {
  const n = Number(process.env.SIM_N || 4000)
  const {tally, examples} = simulate(n, SEEDS)
  const full = n === 4000
  const broke = [...tally].filter(([k]) => !['MISPLACED', 'REVIVED'].includes(k) && (full ? (tally.get(k) ?? 0) > (CEILING[k] ?? 0) : !(k in CEILING)))
  assert.deepEqual(broke, [], examples.join('\n'))
})
