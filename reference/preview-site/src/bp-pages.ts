// Barkpark mode: a page from the documents the server read (references expanded),
// with the studio's unsaved edits laid over them first (J60), so typing shows at once.

export type Doc = {_id: string; _type: string; _publishedId?: string; [k: string]: unknown}
export type SourceMap = {documents: Ref[]; paths: string[]; mappings: Record<string, {source: {document: number; path: number}}>}
export type Raw = {posts?: Doc[]; post?: Doc | null; author?: Doc | null; maps?: (SourceMap | null)[]}
/** J59: the attributes that make a value click-to-edit: `data-bp-edit="type:id:field"`, and its document's title for the label. */
export type Edit = (field: string) => Record<string, string> | undefined
type Ref = {_id: string; _type: string}

const id = (d: Doc) => d._publishedId ?? d._id.replace(/^drafts\./, '')
const isDoc = (v: unknown): v is Doc => !!v && typeof v === 'object' && '_id' in v

/**
 * Lay each edited document over its copy, wherever it is (a reference expanded too).
 * `replace`: the edit is the whole document (a listen frame's), so a field it no
 * longer has goes too.
 */
export function overlay<T>(value: T, edits: Map<string, Doc>, replace = false): T {
  if (!edits.size) return value
  if (Array.isArray(value)) return value.map((v) => overlay(v, edits, replace)) as T
  if (!value || typeof value !== 'object') return value
  if (!isDoc(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, overlay(v, edits, replace)])) as T
  const edit = edits.get(id(value))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) if (!replace || !edit || k.startsWith('_') || k in edit) out[k] = overlay(v, edits, replace)
  if (!edit) return out as T
  for (const [k, v] of Object.entries(edit)) {
    if (k.startsWith('_')) continue
    // The edit holds a reference as its id; keep the expanded copy we already have.
    const held = out[k]
    if (isDoc(held) && (v === id(held) || (v as {_ref?: string})?._ref === id(held))) continue
    out[k] = v
  }
  return out as T
}

const ref = (d: unknown): Ref | undefined => (isDoc(d) ? {_id: id(d), _type: d._type} : undefined)
const seen = (refs: (Ref | undefined)[]) => [...new Map(refs.filter((r): r is Ref => !!r).map((r) => [r._id, r])).values()]
const row = (p: Doc) => ({_id: id(p), title: p.title, slug: p.slug, excerpt: p.excerpt, author: isDoc(p.author) ? {_id: id(p.author), name: p.author.name} : undefined})
// A PortableDoc's text blocks, in the shape the page renders (Sanity's blocks).
const blocks = (body: unknown) =>
  ((body as {blocks?: {id: string; type: string; content?: {value?: string}[]}[]})?.blocks ?? [])
    .filter((b) => b.type === 'paragraph' || b.type === 'heading')
    .map((b) => ({_key: b.id, _type: 'block', children: [{_key: `${b.id}-0`, text: (b.content ?? []).map((c) => c.value ?? '').join('')}]}))

// A source map's `$["field"]` → that field of its document, as data attributes.
function editOf(map: SourceMap | null | undefined, label: unknown): Edit {
  return (field) => {
    const hit = map?.mappings[`$["${field}"]`]
    const doc = hit && map!.documents[hit.source.document]
    const path = hit && map!.paths[hit.source.path]?.match(/^\$\["(.+)"\]$/)?.[1]
    return doc && path ? {'data-bp-edit': `${doc._type}:${doc._id.replace(/^drafts\./, '')}:${path}`, 'data-bp-label': String(label ?? '')} : undefined
  }
}

export function toPage(kind: string, raw: Raw): {data: unknown; documents: Ref[]} {
  if (kind === 'home') {
    const posts = (raw.posts ?? []).filter((p) => p.slug)
    return {data: posts.map(row), documents: seen(posts.flatMap((p) => [ref(p), ref(p.author)]))}
  }
  if (kind === 'post') {
    const p = raw.post
    if (!p) return {data: null, documents: []}
    const related = isDoc(p.related) ? p.related : undefined
    const categories = ((p.categories as unknown[]) ?? []).filter(isDoc)
    return {
      data: {
        ...row(p),
        $edit: editOf(raw.maps?.[0], p.title),
        categories: categories.map((c) => ({_id: id(c), title: c.title})),
        body: blocks(p.body),
        related: related && {_type: related._type, _id: id(related), title: related.title, name: related.name, slug: related.slug},
      },
      documents: seen([ref(p), ref(p.author), ...categories.map(ref), ref(related)]),
    }
  }
  if (kind === 'author') {
    const a = raw.author
    if (!a) return {data: null, documents: []}
    const posts = raw.posts ?? []
    return {data: {_id: id(a), name: a.name, bio: a.bio, $edit: editOf(raw.maps?.[0], a.name), posts: posts.map((p) => ({...row(p), author: {_id: id(a), name: a.name}}))}, documents: seen([ref(a), ...posts.map(ref)])}
  }
  return {data: null, documents: []}
}
