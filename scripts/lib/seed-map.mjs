// The Sanity → Barkpark mapping of a fixtures/seed.ndjson document: the seed script
// writes it, and the e2e rig puts one seed document back with it (resetDoc).
// ── Sanity → Barkpark mapping ───────────────────────────────────────────────

const HEADING = /^h([1-6])$/
const MARK_TYPES = {strong: 'strong', em: 'em', code: 'code', underline: 'underline', 'strike-through': 'strikethrough'}

function inline(block) {
  const defs = Object.fromEntries((block.markDefs ?? []).map((d) => [d._key, d]))
  return block.children.map((span) => {
    if (span._type === 'chip') return {type: 'chip', tone: span.tone, text: span.text}
    if (span._type !== 'span') throw new Error(`unmapped inline ${span._type}`)
    // Marks become wrapper nodes, outermost first.
    return (span.marks ?? []).reduceRight((node, mark) => {
      if (MARK_TYPES[mark]) return {type: MARK_TYPES[mark], children: [node]}
      const def = defs[mark]
      if (def?._type === 'link') return {type: 'link', href: def.href, children: [node]}
      const ref = def?._type === 'internalLink' && def.reference._ref
      if (ref) return {type: 'wikilink', target: ref, docId: ref, children: [node]}
      throw new Error(`unmapped mark ${mark}`)
    }, {type: 'text', value: span.text})
  })
}

function portableTextToPortableDoc(blocks) {
  return {
    blocks: blocks.map((b) => {
      const id = b._key
      if (b._type === 'callout') return {id, type: 'callout', tone: b.tone, content: [{type: 'text', value: b.text}]}
      if (b._type !== 'block' || b.listItem) throw new Error(`unmapped body block ${b._type}/${b.listItem}`)
      const h = HEADING.exec(b.style)
      if (h) return {id, type: 'heading', level: Number(h[1]), content: inline(b)}
      if (b.style === 'normal') return {id, type: 'paragraph', content: inline(b)}
      if (b.style === 'blockquote') return {id, type: 'pullquote', content: inline(b)}
      throw new Error(`unmapped block style ${b.style}`)
    }),
  }
}

// Sanity fields Barkpark cannot hold yet; each has a gap task under the goal.
const UNMAPPED = new Set([
  'attachment', // file field (J54): Sanity's seed carries an asset; Barkpark's media is not seeded
])

// Item of a multi-type object array → one composite shape, keyed like Sanity's;
// `_type` becomes `kind` (Barkpark arrayOf takes one member type).
const objectItem = ({_type, _key, ...rest}) => ({
  _key,
  kind: _type,
  ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v?._type === 'reference' ? v._ref : v])),
})

// One Sanity document → the Barkpark content it should equal (no system fields).
export function toBarkpark(doc) {
  const out = {}
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('_') || UNMAPPED.has(k)) continue
    if (v?._type === 'slug') out[k] = v.current
    else if (v?._type === 'reference') out[k] = v._ref
    else if (k === 'body') out[k] = portableTextToPortableDoc(v)
    // Keyed reference arrays keep Sanity's item identity ({_key, _type, _ref}), so
    // reorder/remove and array patches by _key have something to address (J09).
    // From the finish-keys lane's draft (fix/seed-keyed-refs-object-blocks, 8f70b7f).
    else if (Array.isArray(v) && v.every((x) => x?._type === 'reference')) out[k] = v.map(({_key, _ref}) => ({_key, _type: 'reference', _ref}))
    else if (Array.isArray(v) && v.every((x) => x?._type && x._key)) out[k] = v.map(objectItem)
    else out[k] = v
  }
  return out
}
