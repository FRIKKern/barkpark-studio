import type {Field, Schema} from './data'

// J39, broken values: what another client can write that the schema doesn't allow,
// found before an input draws it (Sanity's InvalidValueInput, the array "Missing
// keys" / "Non-unique keys" alerts, the unknown-fields card). Each finding carries
// the value that fixes it, so the card only has to write it.

export type JsonType = 'string' | 'number' | 'boolean' | 'array' | 'object'

const EXPECTED: Record<string, JsonType> = {
  string: 'string', text: 'string', url: 'string', email: 'string', markdown: 'string', date: 'string', time: 'string', datetime: 'string',
  number: 'number', float: 'number', integer: 'number',
  boolean: 'boolean',
  arrayOf: 'array', tags: 'array',
  composite: 'object', image: 'object', file: 'object', localizedText: 'object', richText: 'object',
  // slug and reference: Barkpark stores a plain string or Sanity's object; both are fine.
}

export const typeOf = (v: unknown): JsonType => (Array.isArray(v) ? 'array' : (typeof v as JsonType))

export type Invalid = {expected: JsonType; actual: JsonType; convert?: unknown}

/** A value stored as the wrong JSON type for its field (null when it fits, or the type is free-form). */
export function invalidValue(field: Field, value: unknown): Invalid | null {
  const expected = EXPECTED[field.type]
  if (!expected || value === undefined || value === null) return null
  const actual = typeOf(value)
  if (actual === expected) return null
  return {expected, actual, ...converted(value, expected)}
}

// Sanity's converters: a numeric string to a number, "true"/"false" to a boolean,
// a number or a boolean to a string.
function converted(value: unknown, to: JsonType): {convert?: unknown} {
  if (to === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return {convert: Number(value)}
  if (to === 'boolean' && (value === 'true' || value === 'false')) return {convert: value === 'true'}
  if (to === 'string' && (typeof value === 'number' || typeof value === 'boolean')) return {convert: String(value)}
  return {}
}

const randomKey = () => Math.random().toString(36).slice(2, 14).padEnd(12, '0')

export type KeyProblem = {kind: 'missing' | 'duplicate'; fixed: unknown[]}

/** Items of an object list without a `_key`, or sharing one; `fixed` gives each a fresh unique key. */
export function keyProblem(items: unknown[]): KeyProblem | null {
  const objects = items.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && !Array.isArray(i))
  if (!objects.length) return null
  const missing = objects.some((i) => typeof i._key !== 'string' || !i._key)
  const keys = objects.map((i) => i._key).filter((k) => typeof k === 'string' && k)
  const duplicate = new Set(keys).size !== keys.length
  if (!missing && !duplicate) return null
  const seen = new Set<unknown>()
  const fixed = items.map((i) => {
    if (!i || typeof i !== 'object' || Array.isArray(i)) return i
    const item = i as Record<string, unknown>
    const ok = typeof item._key === 'string' && item._key && !seen.has(item._key)
    const key = ok ? item._key : randomKey()
    seen.add(key)
    return ok ? item : {...item, _key: key}
  })
  return {kind: missing ? 'missing' : 'duplicate', fixed}
}

export type BlockProblem = {index: number; reason: string}
export type RichTextProblem = {problems: BlockProblem[]; fixed: {blocks: unknown[]}}

/**
 * A rich text value whose blocks Barkpark's canvas can't draw: not an object,
 * no `type`, or content that is not a list. A block that only lacks its `id`
 * gets one; any other broken block is dropped.
 */
export function richTextProblem(value: unknown): RichTextProblem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const blocks = (value as {blocks?: unknown}).blocks
  if (blocks === undefined) return null
  if (!Array.isArray(blocks)) return {problems: [{index: -1, reason: '`blocks` is not a list'}], fixed: {...value, blocks: []}}
  const problems: BlockProblem[] = []
  const fixed: unknown[] = []
  blocks.forEach((b, index) => {
    const block = b as Record<string, unknown>
    if (!b || typeof b !== 'object' || Array.isArray(b)) return problems.push({index, reason: 'not a block'})
    if (typeof block.type !== 'string') return problems.push({index, reason: 'no block type'})
    if ('content' in block && !Array.isArray(block.content)) return problems.push({index, reason: 'its content is not a list'})
    if (typeof block.id !== 'string' || !block.id) return (problems.push({index, reason: 'no block id'}), fixed.push({...block, id: randomKey()}))
    fixed.push(block)
  })
  return problems.length ? {problems, fixed: {...value, blocks: fixed}} : null
}

// Barkpark adds these to some docs itself (a row's title, a block doc's body).
const SERVER_KEYS = new Set(['title', 'body', 'preview', 'body_html', 'blocks'])

/** Top-level keys the schema doesn't define (system `_` keys and server-derived ones aside). */
export function unknownFields(schema: Schema, doc: Record<string, unknown>): string[] {
  const known = new Set(schema.fields.map((f) => f.name))
  return Object.keys(doc).filter((k) => !k.startsWith('_') && !known.has(k) && !SERVER_KEYS.has(k) && doc[k] !== undefined && doc[k] !== null)
}

export type UnsupportedAsset = {reason: 'sanityAsset' | 'foreignRef'; source: string}

/**
 * An image or file value holding an asset this studio can't show: Sanity's export form
 * ({_sanityAsset: 'image@file://…'}) or a ref that is not a Barkpark media id
 * (Sanity's 'image-<sha>-640x400-png'). Read as empty, one save would drop it: the field
 * shows it as it is, read-only, with Reset (task-ec9b4c0c78185fa4).
 */
export function unsupportedAsset(field: Field, value: unknown): UnsupportedAsset | null {
  if (field.type !== 'image' && field.type !== 'file') return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as {_sanityAsset?: unknown; asset?: {_ref?: unknown}}
  if (typeof v._sanityAsset === 'string') return {reason: 'sanityAsset', source: v._sanityAsset}
  const ref = v.asset?._ref
  if (typeof ref === 'string' && !ref.startsWith('asset-')) return {reason: 'foreignRef', source: ref}
  return null
}
