// A declared object block's preview title (a body field's `blocks.of` entry, the callout),
// read as Barkpark's canvas reads it (inline-object.js `objectBlockValue`): the first
// `text` field that holds text, else the first field holding a scalar (a select's code, a
// number, Yes or No); a block whose fields are all empty shows its type's title. The body
// at rest draws it on the same card, so nothing moves when the body wakes. Pure.

export type ObjectKind = {name: string; title?: string; fields?: {name?: string; type?: string}[]}

/** The declared object kinds of a body field's vocabulary (`of` also lists plain types, "image"). */
export function objectKinds(vocabulary: unknown): ObjectKind[] {
  const of = (vocabulary as {of?: unknown} | undefined)?.of
  return Array.isArray(of) ? of.filter((o): o is ObjectKind => !!o && typeof o === 'object' && typeof (o as ObjectKind).name === 'string') : []
}

export function objectBlockTitle(kind: ObjectKind, block: Record<string, unknown>, yesNo: (v: boolean) => string): string {
  const fields = (kind.fields ?? []).filter((f): f is {name: string; type?: string} => typeof f?.name === 'string')
  const shown = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? yesNo(v) : '')
  const text = fields.find((f) => f.type === 'text' && shown(block[f.name]) !== '')
  if (text) return shown(block[text.name])
  for (const f of fields) {
    const v = shown(block[f.name])
    if (v !== '') return v
  }
  return kind.title ?? kind.name
}
