// task-be96d37504cf4ed3: pastes at any depth. A lock is a field read-only for this person, or
// hidden from them while another role sees it (now or as the paste leaves the document);
// visibility from the data pastes as on main.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Field} from './data.ts'
import {pasteSkips, type FieldConditions} from './conditions.ts'
import {keepLocked, pasteDocument, type PasteContext} from './paste-locked.ts'

const post = JSON.parse(readFileSync(new URL('../../../fixtures/barkpark-schema/post.json', import.meta.url), 'utf8')) as {fields: Field[]}
const F = (name: string) => post.fields.find((f) => f.name === name)!
const seo = {name: 'seo', type: 'composite', fields: [{name: 'metaTitle', type: 'string'}, {name: 'metaDescription', type: 'text'}]} as unknown as Field
const links = {name: 'links', type: 'arrayOf', of: {type: 'composite', fields: [{name: 'title', type: 'string'}, {name: 'url', type: 'url'}]}} as unknown as Field
const user = {id: 'u1', name: 'A', email: 'a@example.com', roles: [{name: 'editor', title: 'Editor'}]}
const isAdmin = (u: {roles: {name: string}[]} | null) => !!u?.roles.some((r) => r.name === 'administrator')
const notAdmin: FieldConditions['hidden'] = ({currentUser}) => !isAdmin(currentUser)
const admin = {...user, roles: [{name: 'administrator', title: 'Administrator'}]}
const ctx = (rules: Record<string, FieldConditions> | undefined, doc: Record<string, unknown>): PasteContext => ({type: 'post', doc, user, rules})

test('a role-hidden field inside an object keeps the target\'s value; the rest of the object pastes', () => {
  const doc = {seo: {metaTitle: 'A', metaDescription: 'HIDDEN A'}}
  const c = ctx({'post.seo.metaDescription': {hidden: notAdmin}}, doc)
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

test('Paste field on an object keeps its role-hidden child when the copy lacks it; a paste that removes the object keeps only its locked part', () => {
  const doc = {seo: {metaTitle: 'A', metaDescription: 'HIDDEN A'}}
  const hidden = ctx({'post.seo.metaDescription': {hidden: notAdmin}}, doc)
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B'}, doc.seo, hidden), {metaTitle: 'B', metaDescription: 'HIDDEN A'})
  assert.deepEqual(keepLocked(seo, 'seo', undefined, doc.seo, hidden), {metaDescription: 'HIDDEN A'})
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

// The review's five cases (review-1288b), as written there.
const editor = {id: 'u', name: 'A', email: 'a@x', roles: [{name: 'editor', title: 'Editor'}]}

test('1a no rules, shipped post.json: Paste field on cta {kind url, url} into cta {kind internal} keeps the url', () => {
  const doc = {cta: {kind: 'internal', page: {_ref: 'p1'}}}
  assert.deepEqual(keepLocked(F('cta'), 'cta', {kind: 'url', url: 'https://b.example'}, doc.cta, {type: 'post', doc, user: null, rules: undefined}), {kind: 'url', url: 'https://b.example'})
})

test('1b no rules, shipped post.json: Paste document of a featured post writes featuredNote and promoLine', () => {
  const {skip} = pasteSkips('post', post.fields, {featured: false}, null, undefined)
  assert.deepEqual([skip.has('featuredNote'), skip.has('promoLine')], [false, false])
  const values = {featured: true, featuredNote: 'Note B', promoLine: 'Promo B'}
  assert.deepEqual(Object.fromEntries(pasteDocument(post.fields, values, {type: 'post', doc: {featured: false}, user: null, rules: undefined}).writes), values)
})

test('1c no rules: a paste that replaces an array keeps no item for a stale value in a field its condition hides', () => {
  const f = {name: 'ctas', type: 'arrayOf', of: {type: 'composite', fields: F('cta').fields}} as unknown as Field
  const target = [{_key: 'old', kind: 'internal', page: {_ref: 'p'}, url: 'https://stale'}]
  assert.deepEqual(keepLocked(f, 'ctas', [{_key: 'new', kind: 'url', url: 'https://new'}], target, {type: 'post', doc: {ctas: target}, user: null, rules: undefined}), [{_key: 'new', kind: 'url', url: 'https://new'}])
})

test('1d a Sanity-style callback hidden: ({parent}) => parent?.kind !== "url" gets the copied url', () => {
  const rules: Record<string, FieldConditions> = {'post.cta.url': {hidden: ({parent}) => (parent as {kind?: string} | null)?.kind !== 'url'}}
  const f = {...F('cta'), fields: F('cta').fields!.map((x) => ({...x, visibleWhen: undefined}))} as Field
  const doc = {cta: {kind: 'internal'}}
  assert.deepEqual(keepLocked(f, 'cta', {kind: 'url', url: 'https://b'}, doc.cta, {type: 'post', doc, user: editor, rules}), {kind: 'url', url: 'https://b'})
  // A callback that reads the data is visibility, not a lock: the paste is the copy whatever the kind.
  const had = {cta: {kind: 'internal', url: 'https://kept.example'}}
  assert.deepEqual(keepLocked(f, 'cta', {kind: 'internal', url: 'https://b'}, had.cta, {type: 'post', doc: had, user: editor, rules}), {kind: 'internal', url: 'https://b'})
})

// Case 2 with a role rule: hidden: () => true hides the field from every role, so it is no lock (the next tests).
test('2 Portable Text: a hidden field of a custom block object keeps the target value (BlockObjectDialog path ptBody.callout.secret -> key post.ptBody.callout.secret)', () => {
  const pt = {name: 'ptBody', type: 'richText', format: 'portableText', blocks: {of: [{name: 'callout', type: 'composite', fields: [{name: 'note', type: 'string'}, {name: 'secret', type: 'string'}]}]}} as unknown as Field
  const rules: Record<string, FieldConditions> = {'post.ptBody.callout.secret': {hidden: notAdmin}}
  const target = [{_key: 'c', _type: 'callout', note: 'a', secret: 'A'}]
  const out = keepLocked(pt, 'ptBody', [{_key: 'c', _type: 'callout', note: 'b', secret: 'B'}], target, {type: 'post', doc: {ptBody: target}, user: editor, rules}) as Record<string, unknown>[]
  assert.equal(out[0].secret, 'A')
})

test('Portable Text: an inline object\'s role-hidden field and an annotation\'s read-only field keep the target\'s values, by _key', () => {
  const pt = {name: 'ptBody', type: 'richText', format: 'portableText', blocks: {inline: [{name: 'chip', type: 'composite', fields: [{name: 'label', type: 'string'}, {name: 'secret', type: 'string'}]}], annotations: [{name: 'link', fields: [{name: 'href', type: 'url'}, {name: 'owner', type: 'string'}]}]}} as unknown as Field
  const rules: Record<string, FieldConditions> = {'post.ptBody.chip.secret': {hidden: ({currentUser}) => currentUser?.roles.some((r) => r.name === 'administrator') !== true}, 'post.ptBody.link.owner': {readOnly: () => true}}
  const text = (owner: string, href: string, secret: string, word: string) => ({_key: 't', _type: 'block', style: 'normal', markDefs: [{_key: 'm', _type: 'link', href, owner}], children: [{_key: 's', _type: 'span', text: word, marks: ['m']}, {_key: 'i', _type: 'chip', label: word, secret}]})
  const target = [text('Ann', 'https://a.example', 'A', 'old')]
  const pasted = [text('Bob', 'https://b.example', 'B', 'new')]
  assert.deepEqual(keepLocked(pt, 'ptBody', pasted, target, ctx(rules, {ptBody: target})), [text('Ann', 'https://b.example', 'A', 'new')])
  // An administrator: the role rule hides nothing, only the read-only owner stays.
  assert.deepEqual(keepLocked(pt, 'ptBody', pasted, target, {...ctx(rules, {ptBody: target}), user: admin}), [text('Ann', 'https://b.example', 'B', 'new')])
})

test('a code or image block, whose dialog edits it as one field (ptBody.code.code, ptBody.image.image): that field role-hidden keeps the whole block', () => {
  const rules: Record<string, FieldConditions> = {'post.ptBody.code.code': {hidden: notAdmin}, 'post.ptBody.image.image': {hidden: notAdmin}}
  const target = [{_key: 'c', _type: 'code', code: 'A', language: 'js', filename: 'a.js'}, {_key: 'i', _type: 'image', asset: {_ref: 'image-A'}, alt: 'A'}]
  const pasted = [{_key: 'c', _type: 'code', code: 'B', language: 'ts', filename: 'b.ts'}, {_key: 'i', _type: 'image', asset: {_ref: 'image-B'}, alt: 'B'}]
  assert.deepEqual(keepLocked(F('ptBody'), 'ptBody', pasted, target, ctx(rules, {ptBody: target})), target)
  assert.deepEqual(keepLocked(F('ptBody'), 'ptBody', pasted, target, {...ctx(rules, {ptBody: target}), user: admin}), pasted)
  // A paste that removes them: they stay, holding a locked editor.
  assert.deepEqual(keepLocked(F('ptBody'), 'ptBody', [], target, ctx(rules, {ptBody: target})), target)
})

test('probing another role never logs its callback\'s error, and a throw there still locks; the person\'s own error logs once', (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const doc = {seo: {metaTitle: 'A', metaDescription: 'D A'}}
  const copy = {metaTitle: 'B', metaDescription: 'D B'}
  const probe: FieldConditions['hidden'] = ({currentUser}) => {
    if (currentUser?.roles[0]?.name !== 'editor') throw new Error('probe only')
    return true
  }
  assert.deepEqual(keepLocked(seo, 'seo', copy, doc.seo, ctx({'post.seo.metaDescription': {hidden: probe}}, doc)), {metaTitle: 'B', metaDescription: 'D A'})
  assert.equal(errors.mock.callCount(), 0)
  const own: FieldConditions['hidden'] = () => {
    throw new Error('own role')
  }
  assert.deepEqual(keepLocked(seo, 'seo', copy, doc.seo, ctx({'post.seo.metaDescription': {hidden: own}}, doc)), copy)
  assert.equal(errors.mock.callCount(), 1)
})

test('a lock is what the rule does: hidden from this person and shown to another role on the same data; hidden from every role is data, and pastes as on main', () => {
  const doc = {stage: 'review', seo: {metaTitle: 'A', metaDescription: 'D A'}}
  const copy = {metaTitle: 'B', metaDescription: 'D B'}
  const kept = {metaTitle: 'B', metaDescription: 'D A'}
  const paste = (hidden: FieldConditions['hidden'], who = user as typeof user | null, d: Record<string, unknown> = doc) => keepLocked(seo, 'seo', copy, d.seo, {type: 'post', doc: d, after: {...d, seo: copy}, user: who, rules: {'post.seo.metaDescription': {hidden}}})
  // A role rule that also reads the data, and the honest mixed one: locked for a member, open for an administrator.
  const reads: FieldConditions['hidden'] = ({currentUser, document}) => !!document && !isAdmin(currentUser)
  const mixed: FieldConditions['hidden'] = ({currentUser, document}) => document.stage === 'review' && !isAdmin(currentUser)
  for (const rule of [notAdmin, reads, mixed]) {
    assert.deepEqual(paste(rule), kept)
    assert.deepEqual(paste(rule, admin), copy)
  }
  // Not in review, before or after the paste: the mixed rule hides nothing.
  assert.deepEqual(paste(mixed, user, {...doc, stage: 'draft'}), copy)
  // Hidden from every role on this data: no lock.
  assert.deepEqual(paste(true), copy)
  assert.deepEqual(paste(() => true), copy)
  assert.deepEqual(paste(({document}) => document.stage === 'review'), copy)
  // Shared sign-in (nobody signed in): nothing changes.
  assert.deepEqual(paste(notAdmin, null), copy)
  // The schema's visibleWhen is no lock either.
  const shown = {...seo, fields: [seo.fields![0], {...seo.fields![1], visibleWhen: {field: 'metaTitle', operator: 'eq', value: 'never'}}]} as Field
  assert.deepEqual(keepLocked(shown, 'seo', copy, doc.seo, ctx({}, doc)), copy)
})

test('a paste that itself makes the field role-hidden keeps the document\'s value', () => {
  // Paste document: the copy moves the stage to review, where members do not see the note.
  const fields = [{name: 'stage', type: 'string'}, {name: 'note', type: 'string'}] as unknown as Field[]
  const rules: Record<string, FieldConditions> = {'post.note': {hidden: ({currentUser, document}) => document.stage === 'review' && !isAdmin(currentUser)}}
  const doc = {stage: 'draft', note: 'A'}
  assert.deepEqual(pasteDocument(fields, {stage: 'review', note: 'B'}, {type: 'post', doc, user, rules}), {writes: [['stage', 'review']], named: []})
  assert.deepEqual(pasteDocument(fields, {stage: 'review', note: 'B'}, {type: 'post', doc, user: admin, rules}).writes, [['stage', 'review'], ['note', 'B']])
  // Paste field: the copied object turns private, where members do not see its url.
  const box = {name: 'box', type: 'composite', fields: [{name: 'kind', type: 'string'}, {name: 'url', type: 'url'}]} as unknown as Field
  const boxRules: Record<string, FieldConditions> = {'post.box.url': {hidden: ({currentUser, parent}) => (parent as {kind?: string} | null)?.kind === 'private' && !isAdmin(currentUser)}}
  const had = {box: {kind: 'public', url: 'https://a.example'}}
  const copy = {kind: 'private', url: 'https://b.example'}
  const c = (who: typeof user) => ({type: 'post', doc: had, after: {...had, box: copy}, user: who, rules: boxRules})
  assert.deepEqual(keepLocked(box, 'box', copy, had.box, c(user)), {kind: 'private', url: 'https://a.example'})
  assert.deepEqual(keepLocked(box, 'box', copy, had.box, c(admin)), copy)
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
