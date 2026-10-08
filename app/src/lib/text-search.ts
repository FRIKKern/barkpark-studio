// J38: global search matches every text field the way Sanity 6.17 does (its
// groq2024 strategy: `[@, _id] match text::query(q)` scored with a title boost).
// Barkpark's /v1/data/search finds the candidates; this decides which of them
// Sanity would show and in what order. Checked against the reference project.
import type {Field, Schema} from './data.ts'

type Part = {words: string[]; prefix: boolean}
export type TextQuery = {any: Part[]; not: Part[]; raw: string}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

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
    const part = {words: words(body), prefix: i === last || body.endsWith('*')}
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
  const text: string[][] = [words(String(doc._publishedId ?? doc._id ?? ''))]
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
  text.push(title)
  if (q.not.some((p) => text.some((t) => hit(t, p)))) return 0
  const score = q.any.reduce((s, p) => s + (hit(title, p) ? 10 : 0) + (text.some((t) => hit(t, p)) ? 1 : 0), 0)
  return score || (refs.includes(q.raw) ? 1 : 0)
}
