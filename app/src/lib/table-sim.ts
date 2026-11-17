// Two editors on one @sanity/table field, through the save queue (after the round-4 reviewer's
// simulation of PR #1260). Real code: rebase, takeBase, answered, unsent and sentNotesOf
// (lib/edit-bases.ts), every TableWrite (lib/table-input.ts), the caret follow (caretColumn).
// lib/edits.ts's edit() and send() around them are copied here as they are (it is not
// importable in a unit test), and so is Barkpark's field fence: a write on a stale rev passes
// when the fields it writes are unchanged since. Random interleavings of keys, the press,
// sends, the server taking a write, answers, live frames and late renders; then everything
// drains and the outcome is checked. Column moves are left out (task-e9f5222ecfda4f25).
import assert from 'node:assert/strict'
import {answered, rebase, sentNotesOf, takeBase, unsent, type Spots} from './edit-bases.ts'
import {applyPaths, getPath, setInside, setPath, within} from './paths.ts'
import {mapCaret} from './merge.ts'
import {addKept, typedSince} from './table-keep.ts'
import {addColumns, addRows, caretColumn, caretRows, removeColumn, removeRow, setCell, tableGrid} from './table-input.ts'

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

export class Server {
  n = 0
  doc: Doc
  history = new Map<string, unknown>()
  saved: string[] = [] // every cell text it has stored
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
    for (const r of d.t?.rows ?? []) for (const c of r?.cells ?? []) if (typeof c === 'string' && c) this.saved.push(c)
    return {ok: true, doc: clone(d)}
  }
}

export class Client {
  e: Spots = {base: new Map(), dirty: new Map(), inflight: null}
  cache: Doc
  view: Doc // what React last drew
  drawn: {rows: [string, string[]][]; columns: number; widths: string} | null = null
  caret: {key: string; column: number; width?: number} | null = null
  local = '' // the focused input's text
  // Text of mine a table change left out (lib/table-keep.ts), on TableInput's card; `card`: the
  // one the caret moved to (its cell's text was kept: typing goes on there).
  kept: {row: string; column: number; text: string}[] = []
  card: {row: string; column: number; text: string} | null = null
  at = 0 // its caret
  request: {set: [string, unknown][]; unset: string[]; rev?: string} | null = null
  answer: {ok: true; doc: Doc} | {ok: false} | null = null
  frames: Doc[] = []
  pos = 0
  keys = 0
  name: string
  script: Step[]
  ids: (width: number) => number[] // column ids of a row drawn this wide
  constructor(name: string, d: Doc, script: Step[], ids: (width: number) => number[]) {
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
    if (typeof value === 'function') value = value(getPath(held, field), (held as any).t)
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
    this.takeKept()
    this.cache = this.overlay(doc)
  }
  takeKept() {
    for (const k of this.e.kept?.splice(0) ?? []) addKept(this.kept, {row: k.row, column: k.column, text: k.text})
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
      this.takeKept()
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
    // The caret's own text was kept: TableInput moves it to the card, typing goes on there.
    // Only what was typed since the click (what the cell held then stands in the row: theirs typed on from it).
    const since = (text: string) => typedSince(text, this.start, grid.rows.find((r) => r.key === held.key)?.cells ?? [])
    const card = this.kept.find((k) => k.row === held.key && k.column === held.column && k.text === this.local)
    if (card) return void ((card.text = since(card.text)), (this.card = card), (this.caret = null))
    const row = grid.rows.findIndex((r) => r.key === held.key)
    if (row < 0) return this.lose(held)
    let column = held.column
    const follow = caretRows(was, settled, value, grid, held)
    if (follow) {
      const both = follow.rows
      const to = caretColumn(both.map(([, cells, now]): [string[], string[]] => [cells, now]), was!.columns, follow.columns, column, both.findIndex(([k]) => k === held.key), this.local)
      if (to !== undefined && to < 0) return this.lose(held)
      column = to ?? Math.min(column, follow.columns - 1)
    }
    this.caret = {key: held.key, column, width: follow ? follow.columns : held.width === grid.columns ? grid.columns : held.width}
    // TableInput's Cell: someone else's edit to the focused cell keeps the caret on the same text.
    const now = grid.rows[row]!.cells[column] ?? ''
    if (now !== this.local) this.at = mapCaret(this.local, now, this.at)
    this.local = now
  }
  /** The caret's cell was removed: text typed in it goes to the card (TableInput), typing goes on there. */
  lose(held: {key: string; column: number}) {
    this.caret = null
    if (this.typed && this.local) this.card = addKept(this.kept, {row: held.key, column: held.column, text: this.local})
  }
  typed = false
  start = '' // what the cell held when this editor clicked it
  // The keys this editor's inputs (or its card) took: since the last click, and each click's before.
  keysNow = ''
  keysBefore: string[] = []
  /** Click a cell by row key and column id (this editor's own idea of the columns). */
  click(row: string, col: number): boolean {
    const grid = tableGrid(this.view.t)
    const r = grid.rows.findIndex((x) => x.key === row)
    // The editor clicks the cell it sees: by the row as drawn (a row of mine on its way at the old width).
    const column = this.ids((this.view.t?.rows?.[r]?.cells ?? []).length || grid.columns).indexOf(col)
    if (column < 0 || r < 0) return false
    this.caret = {key: row, column, width: (this.view.t?.rows?.[r]?.cells ?? []).length}
    ;[this.card, this.typed] = [null, false]
    if (this.keysNow) this.keysBefore.push(this.keysNow)
    this.keysNow = ''
    this.local = this.start = grid.rows[r]!.cells[column] ?? ''
    this.at = this.local.length
    return true
  }
  key(ch: string) {
    if (this.card) return void ((this.card.text += ch), (this.keysNow += ch))
    if (!this.caret) return
    const r = tableGrid(this.view.t).rows.findIndex((x) => x.key === this.caret!.key)
    if (r < 0) return
    this.keysNow += ch
    const was = this.local
    this.typed = true
    this.local = was.slice(0, this.at) + ch + was.slice(this.at++)
    // A key from an input whose text was kept, before the card took the caret: onto the kept text.
    const kept = this.kept.find((k) => k.row === this.caret!.key && k.column === this.caret!.column && k.text === was)
    if (kept) return void ((kept.text = typedSince(this.local, this.start, tableGrid(this.cache.t).rows.find((x) => x.key === this.caret!.key)?.cells ?? [])), (this.card = kept), (this.caret = null))
    // A key the row cannot place: the input's text to the card (TableKeptCard's refuse).
    const at = this.caret
    this.write(setCell(this.view.t, r, at.column, this.local, newKey, was, (text) => void addKept(this.kept, {row: at.key, column: at.column, text})))
  }
  press(op: Op) {
    const v = this.view.t
    this.caret = null
    ;[this.card, this.typed] = [null, false]
    // What the presser typed before is its own to remove: the scene's judge counts it.
    ;[this.keysNow, this.keysBefore] = ['', []]
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

/**
 * A cell whose text is not only whole words (`rest`: the cell less them), read as a word's first
 * keys left over (not SPLIT): those keys, saved, begin the cell after its own text (`origin`, what
 * it held before the scene), and a typed word they begin is whole on a card and in no cell. Either
 * the cell is only them (its column could not be told; Put it back replaces them), or the other
 * editor typed on after them as they saw them (review 7, seed 96019 #208: P's '<' then T's '<U8>'
 * in one cell, P's '<Q8>' whole on P's card). No word is lost or cut; the keys stay until edited.
 */
export function leftover(cell: string, rest: string, origin: readonly string[], words: readonly string[], card: readonly string[], table: readonly string[]): boolean {
  const o = origin.find((t) => t !== '' && rest.startsWith(t) && cell.startsWith(t)) ?? ''
  const keys = rest.slice(o.length)
  const on = (texts: readonly string[], w: string) => texts.some((t) => t.includes(w))
  return keys !== '' && cell.startsWith(o + keys) && words.some((w) => w.length > keys.length && w.startsWith(keys) && on(card, w) && !on(table, w))
}

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
  const tc: Client = new Client('T', server.doc, T, (w) => (w === C ? initIds : idsAfter))
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
      // The click is a step of its own: a frame can come in before the first key, and that key
      // can come before the drawing catches up (review 8).
      return void (c.keys = -1)
    }
    // The caret went (its column removed) before a key: the editor sees no caret and clicks again.
    if (c.keys < 0 && !c.caret && !c.card) return void (c.keys = 0)
    if (c.keys < 0) (c.keys = 0), clicked.add(s.word)
    c.key(s.word[c.keys]!)
    if (++c.keys === s.word.length) (c.pos++, (c.keys = 0))
  }
  // Every key an input or card took is somewhere: in the editor's table, on its card, in its input,
  // in its save queue, or stored once (then theirs may remove it: the judge below counts the words).
  let keyLost = ''
  const keysKept = () => {
    for (const c of clients)
      for (const k of [...c.keysBefore, c.keysNow]) {
        if (!k) continue
        const cells: string[] = (c.cache.t?.rows ?? []).flatMap((r: any) => r?.cells ?? [])
        if (cells.some((x) => typeof x === 'string' && x.includes(k)) || c.kept.some((x) => x.text.includes(k))) continue
        if ((c.caret && c.local.includes(k)) || server.saved.some((x) => x.includes(k))) continue
        // On its way (a write in the queue: its answer keeps it, lib/table-keep.ts).
        if ([...c.e.dirty.values(), ...(c.e.inflight?.values() ?? [])].some((v) => J(v).includes(k))) continue
        keyLost ||= `KEY-LOST ${c.name} ${J(k)}`
      }
  }
  const deliver = (c: Client) => {
    const r = c.request!
    c.request = null
    c.answer = server.mutate(r.rev, r.set, r.unset)
    if (c.answer.ok) for (const x of clients) x.frames.push(clone(server.doc))
  }
  step(tc) // T clicks first: its column id is the initial one.
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
    keysKept()
  }
  for (const c of clients) c.render()
  keysKept()
  // What is stored, against what both meant: by column ids and row keys.
  const words = [...P, ...T].filter((s): s is Extract<Step, {word: string}> => 'word' in s && clicked.has(s.word))
  const initText = (r: string, c: number) => (c === 100 ? '' : t0.rows.find((x) => x._key === r)!.cells[c]!)
  const want = rowsAfter.map((r) => idsAfter.map((c) => (r === '*new*' ? '' : initText(r, c) + words.filter((w) => w.row === r && w.col === c).map((w) => w.word).join(''))))
  const got: string[][] = (server.doc.t?.rows ?? []).map((r: any) => r.cells)
  const flat = got.flat()
  const bad: string[] = keyLost ? [keyLost] : []
  const soft: string[] = []
  if (!clients.every((c) => J(c.cache.t) === J(server.doc.t))) bad.push('DIVERGED')
  if (!got.every((cs) => cs.length === got[0]?.length)) bad.push('UNEVEN')
  // Every word typed is whole in exactly one cell, or on its typer's card (kept); none is gone.
  const kept = clients.flatMap((c) => c.kept.map((k) => k.text))
  const count = (texts: string[], w: string) => texts.reduce((k, c) => k + c.split(w).length - 1, 0)
  for (const w of words) {
    const alive = rowsAfter.includes(w.row) && idsAfter.includes(w.col)
    const [n, m] = [count(flat, w.word), count(kept, w.word)]
    if (alive && n + m === 0) bad.push(`LOST ${w.word}`)
    if (n + m > 1) bad.push(`DOUBLED ${w.word}`)
    if (m) soft.push('KEPT')
    soft.push('TYPED')
    if (!alive && n > 0) soft.push('REVIVED') // its column or row was removed, the word stayed elsewhere
  }
  for (const c of [...flat, ...kept]) {
    const rest = words.reduce((r, w) => r.split(w.word).join(''), c)
    if (!WORDCH.test(rest)) continue
    if (flat.includes(c) && leftover(c, rest, t0.rows.flatMap((r) => r.cells), words.map((w) => w.word), kept, flat)) soft.push('LEFTOVER')
    else bad.push(`SPLIT ${J(c)}`)
  }
  if (op.kind === 'inscol')
    for (const w of words) {
      const at = idsAfter.indexOf(w.col)
      if (at > op.at && !got.some((cs) => cs[at]?.includes(w.word)) && flat.some((c) => c.includes(w.word))) bad.push(`INSERT-LEFT-WRONG-SIDE ${w.word}`)
    }
  if (kept.length) soft.push('KEPT-SCENES')
  if (!bad.length && !kept.length && J(got) !== J(want)) soft.push('MISPLACED')
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
 * The gate (table-sim*.test.ts, a seed set each so they run side by side): `seeds` x 4,000
 * scenes. No word lost, doubled or split, no rows uneven, both agree: none of these may happen.
 * A column's place is not guessed (lib/table-keep.ts): text of mine the other's column change
 * leaves without a sure place is kept, on my card (KEPT, counted). Two ceilings per seed set
 * that may only fall: INSERT-LEFT-WRONG-SIDE (both words whole, in one cell: the typer clicked
 * by column in a row drawn at the old width) and LEFTOVER (above). MISPLACED and REVIVED (text
 * kept, in another cell) are counted, not failed. SIM_N: fewer scenes, ceilings then 0 or any.
 */
export function simGate(seeds: number[], ceiling: Record<string, number>) {
  const n = Number(process.env.SIM_N || 4000)
  const {tally, examples} = simulate(n, seeds)
  const full = n === 4000
  const broke = [...tally].filter(([k]) => !SOFT.includes(k) && (full ? (tally.get(k) ?? 0) > (ceiling[k] ?? 0) : !(k in ceiling)))
  assert.deepEqual(broke, [], examples.join('\n'))
  return tally
}
const SOFT = ['MISPLACED', 'REVIVED', 'KEPT', 'KEPT-SCENES', 'TYPED']
