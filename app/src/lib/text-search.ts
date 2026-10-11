// J38: global search matches every text field the way Sanity 6.17 does (its
// groq2024 strategy: `[@, _id] match text::query(q)` scored with a title boost).
// Barkpark's /v1/data/search finds the candidates; this decides which of them
// Sanity would show and in what order. Checked against the reference project.
import type {Field, Schema} from './data.ts'

type Part = {words: string[]; prefix: boolean; idWords: string[]}
export type TextQuery = {any: Part[]; not: Part[]; raw: string}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
// A document id as Sanity's search reads it: a dot stays inside a word, so a draft's id
// "drafts.sq-fox" is ["drafts.sq", "fox"] and "sq-fox" does not find it; "drafts.sq-fox"
// and "fox-rev" (in "drafts.sq-fox-rev") do, and a published "post-01" is ["post", "01"].
const idWords = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}.]+/gu)?.map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean) ?? []
// Titles fold æøå, as Barkpark's title search does (#22703): "aerlig" finds "Ærlig" (Sanity
// too), "okonomi" and "oekonomi" find "Økonomi", "arsrapport" and "aarsrapport" find
// "Årsrapport" (more than Sanity finds: never fewer hits). A title as typed ranks first.
// Body text matches as written, as on Sanity ("aerlighet" does not find a body's "Ærlighet").
const forms = (w: string) => [w, w.replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a'), w.replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')]
const sameFolded = (t: string, w: string, prefix: boolean) => forms(t).some((a) => forms(w).some((b) => (prefix ? a.startsWith(b) : a === b)))
const foldedHit = (text: string[], p: Part) => text.some((_, i) => p.words.every((w, j) => text[i + j] !== undefined && sameFolded(text[i + j]!, w, j === p.words.length - 1 && p.prefix)))

/**
 * Sanity's query syntax: terms are OR-ed, `-term` excludes, `"a b"` and `a-b`
 * are phrases (words next to each other), and the last plain term is a prefix
 * (prefixLast), so results follow typing.
 */
export function parseTextQuery(raw: string): TextQuery {
  const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  const plain = tokens.map((t) => !t.startsWith('-') && !/^".*"$/.test(t))
  const last = plain.lastIndexOf(true)
  const any: Part[] = []
  const not: Part[] = []
  tokens.forEach((t, i) => {
    const negated = t.startsWith('-')
    const body = negated ? t.slice(1) : t
    const part = {words: words(body), prefix: i === last || body.endsWith('*'), idWords: idWords(body.replace(/^"|"$/g, ''))}
    if (part.words.length) (negated ? not : any).push(part)
  })
  return {any, not, raw: raw.trim()}
}

const hit = (text: string[], p: Part) =>
  text.some((_, i) => p.words.every((w, j) => (j === p.words.length - 1 && p.prefix ? text[i + j]?.startsWith(w) : text[i + j] === w)))

/**
 * A doc's searchable text, one word list per value: every string it holds,
 * except references (Sanity matches a reference only by its exact id, below),
 * system keys and the block structure (ids, block types, heading levels).
 */
export function docText(doc: Record<string, unknown>, schema?: Schema): {text: string[][]; refs: string[]} {
  const text: string[][] = []
  const refs: string[] = []
  const walk = (v: unknown, f: Field | undefined, inBlocks: boolean) => {
    if (f?.type === 'reference') return void (typeof v === 'string' && refs.push(v))
    if (typeof v === 'string') return void text.push(words(v))
    if (Array.isArray(v)) return v.forEach((x) => walk(x, f?.of, inBlocks))
    if (!v || typeof v !== 'object') return
    const blocks = inBlocks || f?.type === 'richText'
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('_') || (blocks && BLOCK_KEYS.has(k))) continue
      if (blocks && LINK_KEYS.has(k)) {
        if (typeof x === 'string') refs.push(x)
        continue
      }
      walk(x, f?.fields?.find((s) => s.name === k), blocks)
    }
  }
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('_') && k !== 'title') walk(v, schema?.fields.find((s) => s.name === k), false)
  return {text, refs}
}
const BLOCK_KEYS = new Set(['id', 'type', 'level'])
// A wikilink's target is a reference.
const LINK_KEYS = new Set(['target', 'docId'])

/**
 * Sanity's score, or 0 when the doc is not a hit: each term found in the title
 * (the preview title, boost 10) or anywhere else (1). A doc that references the
 * exact id typed is a hit too.
 */
export function textScore(doc: Record<string, unknown>, q: TextQuery, schema?: Schema): number {
  const title = words(String(doc.title ?? ''))
  const {text, refs} = docText(doc, schema)
  if (excludes(text, title, q)) return 0
  text.push(title)
  // As typed: 10; only with æøå folded: 8, so the exact spelling ranks first.
  const titleScore = (p: Part) => (hit(title, p) ? 10 : foldedHit(title, p) ? 8 : 0)
  const ids = docIds(doc)
  const idHit = (p: Part) => ids.some((id) => hit(id, {...p, words: p.idWords}))
  const score = q.any.reduce((s, p) => s + titleScore(p) + (titleScore(p) || text.some((t) => hit(t, p)) || idHit(p) ? 1 : 0), 0)
  return score || (refs.includes(q.raw) ? 1 : 0)
}

/** The ids Sanity's search sees for this row: its draft's ("drafts.…") and, when published, the published one. */
const docIds = (doc: Record<string, unknown>) => {
  const published = String(doc._publishedId ?? doc._id ?? '').replace(/^drafts\./, '')
  const ids = [doc._draft ? `drafts.${published}` : '', doc._hasPublished !== false || !doc._draft ? published : ''].filter(Boolean)
  return ids.map(idWords)
}

const excludes = (text: string[][], title: string[], q: TextQuery) => q.not.some((p) => foldedHit(title, p) || text.some((t) => hit(t, p)))

/** A `-term` in the query rules this doc out. */
export function excluded(doc: Record<string, unknown>, q: TextQuery, schema?: Schema): boolean {
  const {text} = docText(doc, schema)
  return excludes(text, words(String(doc.title ?? '')), q)
}
