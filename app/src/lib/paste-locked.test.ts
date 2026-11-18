// task-be96d37504cf4ed3: pastes at any depth. Read-only is judged on the document as it is;
// hidden on the document as it is and as the paste leaves it (hidden in both: kept).
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Field} from './data.ts'
import type {FieldConditions} from './conditions.ts'
import {keepLocked, pasteDocument, type PasteContext} from './paste-locked.ts'

const post = JSON.parse(readFileSync(new URL('../../../fixtures/barkpark-schema/post.json', import.meta.url), 'utf8')) as {fields: Field[]}
const F = (name: string) => post.fields.find((f) => f.name === name)!
const seo = {name: 'seo', type: 'composite', fields: [{name: 'metaTitle', type: 'string'}, {name: 'metaDescription', type: 'text'}]} as unknown as Field
const links = {name: 'links', type: 'arrayOf', of: {type: 'composite', fields: [{name: 'title', type: 'string'}, {name: 'url', type: 'url'}]}} as unknown as Field
const user = {id: 'u1', name: 'A', email: 'a@example.com', roles: [{name: 'editor', title: 'Editor'}]}
const ctx = (rules: Record<string, FieldConditions> | undefined, doc: Record<string, unknown>, after?: Record<string, unknown>): PasteContext => ({type: 'post', doc, after, user, rules})

test('a hidden field inside an object keeps the target\'s value; the rest of the object pastes', () => {
  const doc = {seo: {metaTitle: 'A', metaDescription: 'HIDDEN A'}}
  const c = ctx({'post.seo.metaDescription': {hidden: () => true}}, doc)
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B', metaDescription: 'HIDDEN B'}, doc.seo, c), {metaTitle: 'B', metaDescription: 'HIDDEN A'})
  // The target has none: the pasted one is not written either.
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B', metaDescription: 'HIDDEN B'}, {metaTitle: 'A'}, c), {metaTitle: 'B'})
})

test('a read-only field in an array item keeps its value, matched by _key and _type; an item only the source has comes in whole', () => {
  const doc = {links: [{_key: 'l1', title: 'Docs A', url: 'https://a.example'}]}
  const c = ctx({'post.links.title': {readOnly: () => true}}, doc)
  const pasted = [
    {_key: 'l1', title: 'Docs B', url: 'https://b.example'},
    {_key: 'n1', title: 'New', url: 'https://n.example'},
  ]
  assert.deepEqual(keepLocked(links, 'links', pasted, doc.links, c), [
    {_key: 'l1', title: 'Docs A', url: 'https://b.example'},
    {_key: 'n1', title: 'New', url: 'https://n.example'},
  ])
  // The same key on an item of another type is another item: nothing of the target's goes into it.
  const multi = {name: 'parts', type: 'arrayOf', of: [{name: 'quote', type: 'composite', fields: [{name: 'text', type: 'string'}]}, {name: 'note', type: 'composite', fields: [{name: 'lock', type: 'string'}]}]} as unknown as Field
  const parts = [{_key: 'k', _type: 'note', lock: 'L'}]
  const out = keepLocked(multi, 'parts', [{_key: 'k', _type: 'quote', text: 'Q'}], parts, ctx({'post.parts.lock': {readOnly: () => true}}, {parts}))
  assert.deepEqual(out, [{_key: 'k', _type: 'note', lock: 'L'}, {_key: 'k', _type: 'quote', text: 'Q'}])
})

test('Paste field on an object keeps its hidden child when the copy lacks it; a paste that removes the object keeps only what is read-only', () => {
  const doc = {seo: {metaTitle: 'A', metaDescription: 'HIDDEN A'}}
  const hidden = ctx({'post.seo.metaDescription': {hidden: () => true}}, doc)
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B'}, doc.seo, hidden), {metaTitle: 'B', metaDescription: 'HIDDEN A'})
  assert.equal(keepLocked(seo, 'seo', undefined, doc.seo, hidden), undefined)
  assert.deepEqual(keepLocked(seo, 'seo', undefined, doc.seo, ctx({'post.seo.metaDescription': {readOnly: () => true}}, doc)), {metaDescription: 'HIDDEN A'})
  // Nothing locked: the paste is what was copied.
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B'}, doc.seo, ctx({}, doc)), {metaTitle: 'B'})
})

test('a paste that would remove an item holding a read-only value leaves it where it was, duplicate keys too', () => {
  const doc = {links: [{_key: 'l1', title: 'Docs A', url: 'https://a.example'}, {_key: 'l2', url: 'https://untitled.example'}, {_key: 'l3', title: 'Kept', url: 'https://k.example'}]}
  const c = ctx({'post.links.title': {readOnly: () => true}}, doc)
  // l1 and l3 hold a read-only title and stay; l2 holds none and goes, as pasted.
  assert.deepEqual(keepLocked(links, 'links', [{_key: 'n1', title: 'New', url: 'https://n.example'}], doc.links, c), [
    {_key: 'l1', title: 'Docs A', url: 'https://a.example'},
    {_key: 'n1', title: 'New', url: 'https://n.example'},
    {_key: 'l3', title: 'Kept', url: 'https://k.example'},
  ])
  const twice = [{_key: 'd', title: 'One', url: 'https://1.example'}, {_key: 'd', title: 'Two', url: 'https://2.example'}]
  assert.deepEqual(keepLocked(links, 'links', [{_key: 'd', title: 'X', url: 'https://x.example'}], twice, ctx({'post.links.title': {readOnly: () => true}}, {links: twice})), [
    {_key: 'd', title: 'One', url: 'https://x.example'},
    {_key: 'd', title: 'Two', url: 'https://2.example'},
  ])
})

test('no rules, shipped post.json: Paste field on cta turning it to a link brings the url and drops the page, as main', () => {
  const doc = {cta: {kind: 'internal', page: 'post-02'}}
  const copy = {kind: 'url', url: 'https://b.example'}
  assert.deepEqual(keepLocked(F('cta'), 'cta', copy, doc.cta, ctx(undefined, doc, {cta: copy})), copy)
})

test('no rules, shipped post.json: Paste document of a featured post into one that is not writes featuredNote and promoLine', () => {
  const values = {featured: true, featuredNote: 'Note B', promoLine: 'Promo B'}
  const {writes} = pasteDocument(post.fields, values, {type: 'post', doc: {featured: false}, user: null, rules: undefined})
  assert.deepEqual(Object.fromEntries(writes), values)
})

test('no rules: an item whose own condition hides a stale value is replaced by the paste, as main', () => {
  const ctas = {name: 'ctas', type: 'arrayOf', of: {type: 'composite', fields: F('cta').fields}} as unknown as Field
  const target = [{_key: 'old', kind: 'internal', page: 'post-02', url: 'https://stale.example'}]
  const pasted = [{_key: 'new', kind: 'url', url: 'https://new.example'}]
  assert.deepEqual(keepLocked(ctas, 'ctas', pasted, target, ctx(undefined, {ctas: target}, {ctas: pasted})), pasted)
})

test("a callback hidden: ({parent}) => parent?.kind !== 'url' lets the copied url in once the paste makes the kind url", () => {
  const cta = {...F('cta'), fields: F('cta').fields!.map((f) => ({...f, visibleWhen: undefined}))} as Field
  const rules: Record<string, FieldConditions> = {'post.cta.url': {hidden: ({parent}) => (parent as {kind?: string} | null)?.kind !== 'url'}}
  const doc = {cta: {kind: 'internal', url: 'https://kept.example'}}
  assert.deepEqual(keepLocked(cta, 'cta', {kind: 'url', url: 'https://b.example'}, doc.cta, ctx(rules, doc)), {kind: 'url', url: 'https://b.example'})
  // Still internal after the paste: the hidden url keeps the document's.
  assert.deepEqual(keepLocked(cta, 'cta', {kind: 'internal', url: 'https://b.example'}, doc.cta, ctx(rules, doc)), {kind: 'internal', url: 'https://kept.example'})
})

test('Portable Text: a custom block\'s hidden field and an annotation\'s read-only field keep the target\'s values', () => {
  const pt = {name: 'ptBody', type: 'richText', format: 'portableText', blocks: {of: [{name: 'callout', type: 'composite', fields: [{name: 'note', type: 'string'}, {name: 'secret', type: 'string'}]}], annotations: [{name: 'link', fields: [{name: 'href', type: 'url'}, {name: 'owner', type: 'string'}]}]}} as unknown as Field
  const rules: Record<string, FieldConditions> = {'post.ptBody.callout.secret': {hidden: () => true}, 'post.ptBody.link.owner': {readOnly: () => true}}
  const text = (owner: string, href: string, word: string) => ({_key: 't', _type: 'block', style: 'normal', markDefs: [{_key: 'm', _type: 'link', href, owner}], children: [{_key: 's', _type: 'span', text: word, marks: ['m']}]})
  const target = [{_key: 'c', _type: 'callout', note: 'a', secret: 'A'}, text('Ann', 'https://a.example', 'old')]
  const pasted = [{_key: 'c', _type: 'callout', note: 'b', secret: 'B'}, text('Bob', 'https://b.example', 'new')]
  assert.deepEqual(keepLocked(pt, 'ptBody', pasted, target, ctx(rules, {ptBody: target})), [{_key: 'c', _type: 'callout', note: 'b', secret: 'A'}, text('Ann', 'https://b.example', 'new')])
})

test('no rules, every pair of shipped posts: Paste document writes what main writes, less a field read-only now', () => {
  const posts = readFileSync(new URL('../../../fixtures/seed.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d._type === 'post')
  const empty = (v: unknown) => v == null || (Array.isArray(v) && !v.length)
  assert.ok(posts.length > 10)
  for (const from of posts)
    for (const into of posts) {
      // Main's paste: every field of the copy that has a value.
      const main = Object.fromEntries(post.fields.filter((f) => !empty(from[f.name])).map((f) => [f.name, from[f.name]]))
      const {writes} = pasteDocument(post.fields, main, {type: 'post', doc: into, user: null, rules: undefined})
      // reviewNote is read-only once the stage is done (post.json): skipped there, as Sanity's paste does.
      const expected = Object.entries(main).filter(([k]) => !(k === 'reviewNote' && into.stage === 'done'))
      assert.deepEqual(writes, expected, `${from._id} into ${into._id}`)
    }
})
