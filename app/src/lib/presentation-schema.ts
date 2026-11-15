// The Barkpark schema as @sanity/visual-editing reads one: Sanity's Presentation sends its
// workspace schema to the page (`visual-editing/schema`, sanity's PostMessageSchema), and the
// overlays take from it the document type's icon, the title in an array item's menu, and
// whether a value is an array item at all (only those get the menu and the drag handle).
// Pure: the channel is lib/presentation-overlay.ts.
//
//   Barkpark field                 Sanity's node
//   string, text, url, date …      {type: 'string'}             select: a union of its values
//   number, integer, float         {type: 'number'}
//   reference                      {type: 'object', fields: {_ref, _type, _weak}, dereferencesTo}
//   composite, image, file, slug   {type: 'object', fields}
//   arrayOf, one member            {type: 'array', of: {type: 'arrayItem', name, title, value}}
//   arrayOf, several members       {type: 'union', of: [{type: 'unionOption', name, title, value}]}
//   richText                       its stored shape: Portable Text blocks, or Barkpark's {blocks}

import type {Field, Rule, Schema} from './data'
import {memberFor, memberName, membersOf} from './array-members.ts'
import {pathSteps, publishedId} from './presentation-comlink.ts'

type Node = {type: string; [key: string]: unknown}
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const STRING: Node = {type: 'string'}
const objectField = (name: string, value: Node, more: Obj = {}): Node => ({type: 'objectField', name, value, ...more})
const constant = (name: string, value: string) => objectField(name, {type: 'string', value})
const object = (fields: Record<string, Node>): Node => ({type: 'object', fields})
const keyed = (): Node => object({_key: objectField('_key', STRING)})

const NUMBERS = new Set(['number', 'integer', 'float'])
const STRINGS = new Set(['string', 'text', 'url', 'email', 'date', 'datetime', 'time', 'color', 'markdown', 'codelist', 'source'])
const DEPTH = 8

/** A reference to `to`, as Sanity's extractor writes one. */
const reference = (to: string): Node => ({
  ...object({_ref: objectField('_ref', STRING), _type: constant('_type', 'reference'), _weak: objectField('_weak', {type: 'boolean'}, {optional: true})}),
  dereferencesTo: to,
})

const targets = (f: Field): string[] => [...new Set([...(f.to ?? []).map((t) => t.type), ...(f.refType ? [f.refType] : [])])]
const required = (f: Field) => ([] as (Rule | undefined)[]).concat(f.validation).some((rule) => rule?.required === true)

/** A select's values: `options` is the list, or holds it. */
function choices(f: Field): unknown[] | undefined {
  const list = Array.isArray(f.options) ? f.options : f.options?.list
  if (!Array.isArray(list) || !list.length) return undefined
  return list.map((item) => (isObj(item) ? item.value : item))
}

function fieldsOf(fields: Field[] | undefined, depth: number): Record<string, Node> {
  const out: Record<string, Node> = {}
  for (const f of fields ?? []) if (typeof f?.name === 'string') out[f.name] = objectField(f.name, nodeOf(f, depth), {...(f.title && {title: f.title}), optional: !required(f)})
  return out
}

function arrayOf(f: Field, depth: number): Node {
  const members = membersOf(f)
  const options = members.map((m) => {
    const value = nodeOf(m, depth)
    // An object item carries its `_key` beside its own fields (Sanity's `rest`).
    return {type: 'unionOption', name: memberName(m), title: m.title || (members.length === 1 ? f.title : undefined), value: value.type === 'object' ? {...value, rest: keyed()} : value}
  })
  if (!options.length) return {type: 'null'}
  if (options.length > 1) return {type: 'union', of: options}
  const {name, title, value} = options[0]!
  return {type: 'array', of: {type: 'arrayItem', name, ...(title && {title}), value}}
}

/** A rich text field by how it is stored: Portable Text (an array of blocks), else Barkpark's block document. */
function richText(f: Field): Node {
  if (f.format === 'portableText') {
    const span = {...object({_type: constant('_type', 'span'), text: objectField('text', STRING)}), rest: keyed()}
    const block = object({_type: constant('_type', 'block'), style: objectField('style', STRING, {optional: true}), children: objectField('children', {type: 'array', of: {type: 'arrayItem', name: 'span', value: span}})})
    return {type: 'array', of: {type: 'arrayItem', name: 'block', value: {...block, rest: keyed()}}}
  }
  const content = object({value: objectField('value', STRING, {optional: true})})
  const block = object({id: objectField('id', STRING), type: objectField('type', STRING), content: objectField('content', {type: 'array', of: {type: 'arrayItem', name: 'text', value: content}}, {optional: true})})
  return object({blocks: objectField('blocks', {type: 'array', of: {type: 'arrayItem', name: 'block', value: block}})})
}

function nodeOf(f: Field, depth = 0): Node {
  if (depth > DEPTH) return {type: 'unknown'}
  if (NUMBERS.has(f.type)) return {type: 'number'}
  if (f.type === 'boolean') return {type: 'boolean'}
  if (f.type === 'select') {
    const values = choices(f)?.filter((v) => typeof v === 'string' || typeof v === 'number')
    return values?.length ? {type: 'union', of: values.map((value) => ({type: typeof value, value}))} : STRING
  }
  if (STRINGS.has(f.type)) return STRING
  if (f.type === 'tags') return {type: 'array', of: {type: 'arrayItem', name: 'string', value: STRING}}
  if (f.type === 'slug') return object({_type: constant('_type', 'slug'), current: objectField('current', STRING)})
  if (f.type === 'reference') {
    const to = targets(f)
    return to.length > 1 ? {type: 'union', of: to.map((name) => ({type: 'unionOption', name, value: reference(name)}))} : reference(to[0] ?? 'document')
  }
  if (f.type === 'image' || f.type === 'file')
    return object({_type: constant('_type', f.type), asset: objectField('asset', reference(f.type === 'image' ? 'sanity.imageAsset' : 'sanity.fileAsset'), {optional: true}), ...fieldsOf(f.fields, depth + 1)})
  if (f.type === 'composite') return object(fieldsOf(f.fields, depth + 1))
  if (f.type === 'arrayOf') return arrayOf(f, depth + 1)
  if (f.type === 'richText') return richText(f)
  return {type: 'unknown'}
}

/** An icon's SVG body (25×25, lib/desk-icons) as the markup the overlay puts in its label. */
export const iconMarkup = (body: string) => `<svg data-sanity-icon width="1em" height="1em" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`

/**
 * The schema a page's overlays ask for: every document type, Sanity-shaped. `icons` is each
 * type's icon body (the desk's); a type without one gets Sanity's document icon on the page.
 * Object types need no entry of their own: Barkpark serves them expanded where they are used.
 */
export function previewSchema(schemas: Schema[], icons: Record<string, string | undefined> = {}): Node[] {
  return schemas
    .filter((s) => s.kind !== 'object' && typeof s.name === 'string')
    .map((s) => ({
      type: 'document',
      name: s.name,
      title: s.title || s.name,
      ...(icons[s.name] && {icon: iconMarkup(icons[s.name]!)}),
      fields: {
        _id: objectField('_id', STRING),
        _type: constant('_type', s.name),
        _createdAt: objectField('_createdAt', STRING),
        _updatedAt: objectField('_updatedAt', STRING),
        _rev: objectField('_rev', STRING),
        ...fieldsOf(s.fields, 0),
      },
    }))
}

// ── Which member an item is ────────────────────────────────────────────────────────────

export const UNION_PATHS_MAX = 200

/**
 * `visual-editing/schema-union-types`: for each keyed item a page shows, the member type it is
 * (Sanity reads the item's `_type` with a query). Here from the editor's own copy of the
 * document: `doc(id)` by published id, undefined for one the page may not ask about. The
 * answer is keyed as the page asked (its id, its path), which is how it looks it up.
 */
export function unionTypes(paths: unknown, doc: (id: string) => {_type: string; [k: string]: unknown} | undefined, schemas: Schema[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const asked of Array.isArray(paths) ? paths.slice(0, UNION_PATHS_MAX) : []) {
    if (!isObj(asked) || typeof asked.id !== 'string' || typeof asked.path !== 'string' || asked.id.length > 140) continue
    const steps = pathSteps(asked.path)
    const held = doc(publishedId(asked.id))
    if (!steps || !held) continue
    // Down the document and its schema together: the member is the schema's word, the item says which.
    let value: unknown = held
    let fields: Field[] | undefined = schemas.find((s) => s.name === held._type)?.fields
    let array: Field | undefined
    let name: string | undefined
    for (const step of steps) {
      name = undefined
      if ('name' in step) {
        const field: Field | undefined = fields?.find((f) => f.name === step.name)
        value = isObj(value) && Object.hasOwn(value, step.name) ? value[step.name] : undefined
        array = field?.type === 'arrayOf' ? field : undefined
        fields = array ? undefined : field?.fields
        continue
      }
      const item: unknown = !Array.isArray(value) ? undefined : 'key' in step ? value.find((x) => isObj(x) && x._key === step.key) : value[step.index]
      const member: Field | undefined = array && item !== undefined ? memberFor(membersOf(array), item) : undefined
      if (!member) break
      name = memberName(member)
      value = item
      array = member.type === 'arrayOf' ? member : undefined
      fields = array ? undefined : member.fields
    }
    if (!name) continue
    const byPath = out.get(asked.id) ?? new Map<string, string>()
    out.set(asked.id, byPath.set(asked.path, name))
  }
  return out
}
