// Presentation speaks Sanity's comlink protocol beside our own bridge, so a next-sanity
// site (`<VisualEditing>`, `useLiveMode`) gets click-to-edit and live preview on Barkpark.
// This file is the pure part: what a frame's message may make the studio do. The frame is
// someone's site, so every payload is checked here before it touches the URL, the panel or
// a query. The channels themselves are lib/presentation-channels.ts (the real @sanity/comlink).
//
//   frame (visual-editing)  ── focus {id, type, path} ──▶ focusTarget → fieldPath → focusPane
//                           ── navigate {url}         ──▶ framePath (this origin only)
//                           ── documents              ──▶ pageDocuments (schema types only)
//   frame (loaders)         ── query-listen           ──▶ loaderListen → hear (dedupe) → the server
//                           ◀─ query-change           ── liveResult (the editor's unsaved values)

import {groqPath} from './vision-groq.ts'

export type Perspective = 'drafts' | 'published'
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

// ── Who may speak ──────────────────────────────────────────────────────────────────────

const DOMAINS = new Set(['sanity/comlink', 'sanity/channels'])
/** A comlink message (either wire format: comlink 3+, or the older channels one). */
export const speaksComlink = (data: unknown) => isObj(data) && typeof data.domain === 'string' && DOMAINS.has(data.domain)

/**
 * A comlink message the studio must not hear: not from the preview frame's window, or from
 * a page on another origin in that window (the frame followed a link away). @sanity/comlink
 * checks the window only; the bridge checks both, and so does this.
 */
export const refusedMessage = (e: {origin: string; source: unknown; data: unknown}, frame: unknown, origin: string) =>
  speaksComlink(e.data) && !(!!frame && e.source === frame && e.origin === origin)

// ── Click to edit ──────────────────────────────────────────────────────────────────────

const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const TYPE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
/** The published id of a draft's or a release version's id. */
export const publishedId = (id: string) => id.replace(/^drafts\./, '').replace(/^versions\.[^.]+\./, '')

export type FocusTarget = {id: string; type?: string; path?: string}

/** A `visual-editing/focus` payload (Sanity's node: {id, type, path, baseUrl, …}); null for anything else. */
export function focusTarget(data: unknown): FocusTarget | null {
  if (!isObj(data) || typeof data.id !== 'string') return null
  const id = publishedId(data.id)
  if (!DOC_ID.test(id)) return null
  if (data.type !== undefined && (typeof data.type !== 'string' || !TYPE.test(data.type))) return null
  return {id, ...(typeof data.type === 'string' && {type: data.type}), ...(typeof data.path === 'string' && data.path && {path: data.path})}
}

type Step = {name: string} | {key: string} | {index: number}
const STEP = /\.?([A-Za-z_][A-Za-z0-9_]*)|\[_key=="([A-Za-z0-9_.:-]+)"\]|\[(\d{1,6})\]/y

/** A Sanity path string's steps (`links[_key=="l1"].title`, `tags[0]`); null when it is not one. */
export function pathSteps(path: string): Step[] | null {
  if (path.length > 512 || !/^[A-Za-z_]/.test(path)) return null
  const steps: Step[] = []
  STEP.lastIndex = 0
  for (let at = 0; at < path.length; at = STEP.lastIndex) {
    const m = STEP.exec(path)
    if (!m) return null
    steps.push(m[1] !== undefined ? {name: m[1]} : m[2] !== undefined ? {key: m[2]} : {index: Number(m[3])})
  }
  return steps
}

/**
 * The field our pane focuses for a clicked value's path (the pane's J52 `path`, as #1140's
 * links). Keyed steps pass as they are. An index (`tags[2]`, a source map without keys)
 * becomes the item's key when the document has one, else the path stops at its array.
 * Barkpark's block body (`body.blocks[1].content[0].value`) is its block: `body[_key=="p1"]`.
 */
export function fieldPath(path: string, doc?: unknown): string | undefined {
  const steps = pathSteps(path)
  if (!steps) return undefined
  let out = ''
  let value: unknown = doc
  for (const [i, step] of steps.entries()) {
    if ('name' in step) {
      const next = steps[i + 1]
      const blocks = isObj(value) ? value[step.name] : undefined
      // Barkpark's block document: {blocks: [{id, …}]} under the field.
      if (step.name === 'blocks' && out && next && 'index' in next && Array.isArray(blocks)) {
        const block = blocks[next.index]
        return isObj(block) && typeof block.id === 'string' && pathSteps(`x[_key=="${block.id}"]`) ? `${out}[_key=="${block.id}"]` : out
      }
      out += out ? `.${step.name}` : step.name
      value = blocks
    } else if ('key' in step) {
      out += `[_key=="${step.key}"]`
      value = Array.isArray(value) ? value.find((item) => isObj(item) && item._key === step.key) : undefined
    } else {
      const item = Array.isArray(value) ? value[step.index] : undefined
      if (!isObj(item) || typeof item._key !== 'string' || !pathSteps(`x[_key=="${item._key}"]`)) return out
      out += `[_key=="${item._key}"]`
      value = item
    }
  }
  return out
}

/** The `?pane=` value that opens the document on the field. Every part was checked above: no `;`, `,` or `|` can ride in. */
export const focusPane = (target: {id: string; type: string; path?: string}) => `${target.type};${target.id}${target.path ? `,path=${target.path}` : ''}`

// ── Navigation ─────────────────────────────────────────────────────────────────────────

/** Where the frame says it is, as a path on the preview's own origin; null for anywhere else (the studio never follows it). */
export function framePath(url: unknown, origin: string): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null
  try {
    const target = new URL(url, origin)
    return target.origin === origin ? target.pathname + target.search : null
  } catch {
    return null
  }
}

/** The documents a page reports (a source map's `documents`), by published id, once each, of types the schema has. */
export function pageDocuments(documents: unknown, types: ReadonlySet<string>): {_id: string; _type: string}[] {
  const out = new Map<string, {_id: string; _type: string}>()
  for (const d of Array.isArray(documents) ? documents.slice(0, 500) : []) {
    if (!isObj(d) || typeof d._id !== 'string' || typeof d._type !== 'string' || !types.has(d._type)) continue
    const _id = publishedId(d._id)
    if (DOC_ID.test(_id) && !out.has(_id)) out.set(_id, {_id, _type: d._type})
  }
  return [...out.values()]
}

// ── Loader queries ─────────────────────────────────────────────────────────────────────

export const QUERY_MAX = 8_000
export const PARAMS_MAX = 4_000
/** Live queries one page may hold: each is a read on the editor's own budget. */
export const QUERIES_MAX = 24
export const API_VERSION = 'v2025-02-19'
const PARAM = /^[A-Za-z_][A-Za-z0-9_]*$/

export type LoaderListen = {projectId: string; dataset: string; perspective: string; query: string; params: Obj; heartbeat: number | false}

/** A `loader/query-listen` payload, checked; null for anything the studio will not run. */
export function loaderListen(data: unknown): LoaderListen | null {
  if (!isObj(data) || typeof data.query !== 'string' || !data.query.trim() || data.query.length > QUERY_MAX) return null
  if (typeof data.dataset !== 'string' || typeof data.perspective !== 'string') return null
  const params = data.params === undefined || data.params === null ? {} : data.params
  if (!isObj(params) || !Object.keys(params).every((k) => PARAM.test(k))) return null
  let text: string
  try {
    text = JSON.stringify(params)
  } catch {
    return null
  }
  if (text.length > PARAMS_MAX) return null
  return {projectId: typeof data.projectId === 'string' ? data.projectId : '', dataset: data.dataset, perspective: data.perspective, query: data.query, params: JSON.parse(text) as Obj, heartbeat: typeof data.heartbeat === 'number' && data.heartbeat >= 1000 ? data.heartbeat : false}
}

/** One live query's identity: the same query, params (in any key order) and perspective is one read. */
export function queryKey(perspective: string, query: string, params: Obj): string {
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v)
  return `${perspective}:${query}:${JSON.stringify(sorted(params))}`
}

export type Heard<T = unknown> = LoaderListen & {heardAt: number; state?: T}
export type QueryBook<T = unknown> = Map<string, Heard<T>>

/**
 * A listen, heard: `fresh` when the studio has to run it (a new query), false for one it
 * already follows (the loader repeats every listen on a heartbeat and whenever any query on
 * the page changes). A page holds QUERIES_MAX at most: a new one past that takes the place
 * of the one heard longest ago.
 */
export function hear<T>(book: QueryBook<T>, listen: LoaderListen, now: number): {key: string; fresh: boolean} {
  const key = queryKey(listen.perspective, listen.query, listen.params)
  const known = book.get(key)
  if (known) {
    known.heardAt = now
    known.heartbeat = listen.heartbeat
    return {key, fresh: false}
  }
  if (book.size >= QUERIES_MAX) book.delete([...book].reduce((a, b) => (b[1].heardAt < a[1].heardAt ? b : a))[0])
  book.set(key, {...listen, heardAt: now})
  return {key, fresh: true}
}

/** Reads a page may ask of the studio in a minute: they come out of the editor's own budget (Barkpark's 300 a minute). */
export const READS_A_MINUTE = 90
/** Whether one more read fits the minute; counted when it does. `stamps` is the page's tally. */
export function mayRead(stamps: number[], now: number, max = READS_A_MINUTE): boolean {
  while (stamps.length && stamps[0]! <= now - 60_000) stamps.shift()
  if (stamps.length >= max) return false
  stamps.push(now)
  return true
}

/** Drop the queries the page stopped repeating (two heartbeats unheard), or that are not in `perspective`; the keys dropped. */
export function forget<T>(book: QueryBook<T>, now: number, perspective: string): string[] {
  const gone: string[] = []
  for (const [key, q] of book) if (q.perspective !== perspective || (q.heartbeat !== false && now > q.heardAt + 2 * q.heartbeat)) (book.delete(key), gone.push(key))
  return gone
}

/** The server's answer to a page's query: the result and its source map, or why not. Nothing else leaves the server. */
export type PreviewAnswer = {ok: true; perspective: Perspective; result: unknown; resultSourceMap?: unknown; tags?: string[]} | {ok: false; error: string}

/** What the studio's server runs for a listen: checked again there (the browser is not trusted either). */
export function previewQueryPath(data: unknown, dataset: string): {error: string} | {path: string; perspective: Perspective} {
  const listen = loaderListen(data)
  if (!listen) return {error: 'Not a query the studio runs for a preview'}
  if (listen.perspective !== 'drafts' && listen.perspective !== 'published') return {error: `The preview reads drafts or published, not ${listen.perspective.slice(0, 40)}`}
  if (listen.dataset !== dataset) return {error: 'The preview site reads another dataset than this studio'}
  return {path: `${groqPath(dataset, API_VERSION, listen.query, listen.params, listen.perspective)}&resultSourceMap=withKeyArraySelector`, perspective: listen.perspective}
}

// ── Source maps ────────────────────────────────────────────────────────────────────────

export type SourceMap = {documents: {_id: string; _type?: string}[]; paths: string[]; mappings: Record<string, {type?: string; source?: {type?: string; document?: number; path?: number}}>}
export const EMPTY_MAP: SourceMap = {documents: [], paths: [], mappings: {}}

/** A source map as Barkpark answered it, or the empty one (a query that matched nothing). */
export function sourceMapOf(value: unknown): SourceMap {
  if (!isObj(value) || !Array.isArray(value.documents) || !Array.isArray(value.paths) || !isObj(value.mappings)) return EMPTY_MAP
  return value as unknown as SourceMap
}

/** Whether a query's result reads the document `id` (its published id). */
export const readsDocument = (map: SourceMap, id: string) => map.documents.some((d) => typeof d?._id === 'string' && publishedId(d._id) === id)

const JSON_STEP = /\['((?:[^'\\]|\\.)*)'\]|\[(\d+)\]|\[\?\(@\._key=='((?:[^'\\]|\\.)*)'\)\]/y
/** A source map's JSONPath (`$['links'][?(@._key=='l1')]['title']`, `$[0]['title']`) as steps; null when it is not one. */
export function jsonPathSteps(path: string): Step[] | null {
  if (!path.startsWith('$')) return null
  const steps: Step[] = []
  JSON_STEP.lastIndex = 1
  for (let at = 1; at < path.length; at = JSON_STEP.lastIndex) {
    const m = JSON_STEP.exec(path)
    if (!m) return null
    steps.push(m[1] !== undefined ? {name: m[1].replace(/\\(.)/g, '$1')} : m[2] !== undefined ? {index: Number(m[2])} : {key: m[3]!.replace(/\\(.)/g, '$1')})
  }
  return steps
}

const stepIn = (value: unknown, step: Step): unknown =>
  'name' in step ? (isObj(value) ? value[step.name] : undefined) : 'index' in step ? (Array.isArray(value) ? value[step.index] : undefined) : Array.isArray(value) ? value.find((item) => isObj(item) && item._key === step.key) : undefined

function setAt(value: unknown, steps: Step[], next: unknown): unknown {
  const [step, ...rest] = steps
  if (!step) return next
  if ('name' in step) return isObj(value) ? {...value, [step.name]: setAt(value[step.name], rest, next)} : value
  if (!Array.isArray(value)) return value
  const at = 'index' in step ? step.index : value.findIndex((item) => isObj(item) && item._key === step.key)
  return at < 0 || at >= value.length ? value : value.map((item, i) => (i === at ? setAt(item, rest, next) : item))
}

const plain = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/**
 * J60 over the loader channel: a query's result with the editor's unsaved values laid over
 * it, so a key typed in the form is on the page before its save and the next read. Through
 * the source map: each mapped value is read from the open document (`doc`, by published id)
 * at the path it came from. Only a plain value over a plain value, and never a system field:
 * the studio's copy of a document is Barkpark-shaped, so a slug or a reference stays as read.
 */
export function liveResult(result: unknown, map: SourceMap, doc: (id: string) => unknown): unknown {
  let out = result
  for (const [at, mapping] of Object.entries(map.mappings)) {
    const source = mapping?.source
    if (mapping?.type !== 'value' || source?.type !== 'documentValue' || typeof source.document !== 'number' || typeof source.path !== 'number') continue
    const id = map.documents[source.document]?._id
    const live = typeof id === 'string' ? doc(publishedId(id)) : undefined
    if (!live) continue
    const [to, from] = [jsonPathSteps(at), jsonPathSteps(map.paths[source.path] ?? '')]
    const last = from?.[from.length - 1]
    if (!to || !from || !last || !('name' in last) || last.name.startsWith('_')) continue
    const [shown, typed] = [to.reduce(stepIn, out), from.reduce(stepIn, live)]
    if (plain(shown) && plain(typed) && typeof shown === typeof typed && shown !== typed) out = setAt(out, to, typed)
  }
  return out
}
