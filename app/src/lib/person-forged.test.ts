// task-4ffed14fbf52dc47: the rule believes only a person its one maker minted. Anything else
// handed in as the person (null, a look-alike, a copy, a clone, a string, an `any` from
// JSON.parse) answers as an unknown person does at every way into the rule: a role-ruled field
// locks. A minted person cannot be changed, and the maker is handed out once.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fieldLock, fieldState, giveMintBack, keptEditsWait, pasteSkips, pathReadOnly, roleHidden, takeMint, type FieldConditions, type Person} from './conditions.ts'
import type {Field, Schema} from './data.ts'
import {canvasAccess, freeformCanvas, paneFieldLock} from './form-lock.ts'
import {keepLocked, pasteDocument, pasteDocumentReading, pasteField, pasteFieldReading, type PasteContext} from './paste-locked.ts'
import {QueryClient} from '@tanstack/react-query'
import {meQueryOf} from './me-query.ts'
import {known, mint, nobody, unknown} from './persons.fixture.ts'

const post = {name: 'post', title: 'Post', fields: [{name: 'title', type: 'string'}, {name: 'secret', type: 'string'}, {name: 'body', type: 'richText'}]} as unknown as Schema
const [title, secret, body] = post.fields as [Field, Field, Field]
const doc = {title: 'T', secret: 'S', body: {blocks: []}}
// Sanity's way: nobody signed in (a shared studio) passes; a signed-in non-administrator does not.
const seen: unknown[] = []
const notAdmin = ({currentUser}: {currentUser: {roles: {name: string}[]} | null}) => (seen.push(currentUser), !!currentUser && !currentUser.roles.some((r) => r.name === 'administrator'))
const rules: Record<string, FieldConditions> = {'post.title': {readOnly: notAdmin}, 'post.body': {readOnly: notAdmin}, 'post.secret': {hidden: notAdmin}}
const open = {published: false, revision: false, gone: false, scheduled: false, canWrite: true}
const reads = {schemas: async () => [], roles: async () => null}

/** What every way into the rule answers for `p`. */
async function answers(p: Person) {
  const c: PasteContext = {type: 'post', doc, rules, user: p}
  return {
    fieldState: [title, secret, body].map((f) => fieldState('post', f, doc, p, rules)),
    pathReadOnly: ['title', 'secret', 'body'].map((path) => pathReadOnly('post', post.fields, doc, p, rules, path)),
    roleHidden: roleHidden('post', doc, p, rules, {path: 'secret', value: doc.secret}),
    fieldLock: [title, secret].map((f) => fieldLock('post', f, doc, p, rules)),
    pasteSkips: [...pasteSkips('post', post.fields, doc, p, rules).skip],
    keptEditsWait: keptEditsWait(p),
    canvasAccess: canvasAccess(p, {schema: post, doc, rules}),
    freeformCanvas: freeformCanvas(open, p, {schema: post, doc, rules}),
    paneFieldLock: ['title', 'secret'].map((path) => paneFieldLock(() => ({schema: post, doc, rules, canvas: 'editable'}), p, () => {}).readOnly(path)),
    pasteDocument: pasteDocument([title, secret], {title: 'P', secret: 'P'}, c),
    pasteField: [pasteField(title, 'title', 'P', 'T', c), keepLocked(secret, 'secret', 'P', 'S', c)],
    reading: [await pasteDocumentReading(reads, [title, secret], {title: 'P', secret: 'P'}, p, {type: 'post', doc, rules}), await pasteFieldReading(reads, title, 'title', 'P', 'T', p, {type: 'post', doc, rules})],
  }
}

test('a person the maker did not mint answers as unknown at every way into the rule', async () => {
  const admin = known('administrator')
  const asUnknown = await answers(unknown)
  // The controls: the rule tells them apart (an administrator has all; nobody passes Sanity's way).
  assert.notDeepEqual(await answers(admin), asUnknown)
  assert.notDeepEqual(await answers(nobody), asUnknown)
  assert.equal(asUnknown.fieldState[0]!.readOnly, true)
  const real = admin as unknown as object
  const forged: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['JSON.parse', JSON.parse('null')],
    ['an empty object', {}],
    ['a copy of an administrator', {...real}],
    ['a clone', structuredClone(real)],
    ['a JSON round trip', JSON.parse(JSON.stringify(real))],
    ['Object.create', Object.create(real)],
    ['setPrototypeOf', Object.setPrototypeOf({}, real)],
    ['a number', 1],
    ['a string', 'administrator'],
    ['the old marker', 'unknown'],
    ['a symbol named nobody', Symbol('nobody')],
  ]
  for (const [what, p] of forged) assert.deepEqual(await answers(p as Person), asUnknown, what)
})

test('a minted person cannot be changed: no role added, none renamed', async () => {
  const editor = known('editor')
  const before = await answers(editor)
  const roles = editor === nobody || editor === unknown ? [] : (editor as unknown as {roles: {name: string}[]}).roles
  assert.throws(() => roles.push({name: 'administrator'}))
  assert.throws(() => ((roles[0] as {name: string}).name = 'administrator'))
  assert.throws(() => Object.assign(editor as object, {roles: [{name: 'administrator', title: 'Administrator'}]}))
  assert.throws(() => Object.setPrototypeOf(editor as object, {}))
  assert.deepEqual(await answers(editor), before)
})

test('the markers and the person never leave the rule: a callback gets a copy, or null', async () => {
  seen.length = 0
  const admin = known('administrator')
  await answers(admin)
  await answers(nobody)
  assert.ok(seen.length > 0)
  for (const u of seen) assert.ok(u === null || (typeof u === 'object' && u !== admin && (u as {roles: unknown[]}).roles.length === 1), String(u))
  const symbols = (v: unknown): boolean => typeof v === 'symbol' || (!!v && typeof v === 'object' && Object.values(v).some(symbols))
  for (const p of [admin, nobody, unknown] as Person[]) assert.equal(symbols(await answers(p)), false)
})

test("an answer the session did not make gives unknown at every way in: a cache write by any key, a stand-in client", async () => {
  const me = {email: 'a@example.com', name: 'A', userId: 'u1', role: 'member', canWrite: true}
  const admin = {...me, role: 'admin'}
  const session = meQueryOf(async () => ({...me}))
  // lib/person-source.ts: the person from a client's who-am-I, believed only if the session made it.
  const personOf = (qc: {getQueryData: (key: readonly unknown[]) => unknown}) => {
    const answer = qc.getQueryData(session.query.queryKey)
    return mint(session.isMade(answer) ? (answer as typeof me) : undefined)
  }
  const page = new QueryClient()
  const g = globalThis as {window?: unknown}
  g.window = globalThis
  try {
    await page.fetchQuery(session.query)
  } finally {
    delete g.window
  }
  const asUnknown = await answers(unknown)
  assert.notDeepEqual(await answers(personOf(page)), asUnknown, "the session's own answer: a member, known")
  const forged: [string, () => Person][] = [
    // P6: the query found by its hash and its data set.
    ['the query set by hash', () => (page.getQueryCache().getAll().find((q) => q.queryHash === '["m' + 'e"]')!.setData(admin), personOf(page))],
    // P6b: a key computed to whoAmI's.
    ['setQueryData by a computed key', () => (page.setQueryData(['m' + 'e'], admin), personOf(page))],
    // P5 / P5b: a stand-in client handed over in the page's place (renamed, or through a namespace).
    ['a stand-in client', () => personOf({getQueryData: () => admin})],
    ['a stand-in client holding a copy of a real answer', () => personOf({getQueryData: () => ({...me})})],
  ]
  for (const [how, forge] of forged) assert.deepEqual(await answers(forge()), asUnknown, how)
})

test('the maker is handed out once, and one handed back makes nothing more: nothing it made is believed', () => {
  assert.throws(() => takeMint(), /taken/)
  giveMintBack(() => unknown)
  assert.throws(() => takeMint(), /taken/, 'a look-alike hands nothing back')
  // A module that took the maker first, made an administrator and a nobody, and gave it back (the
  // fixture's maker stands in for it), before lib/person-source.ts takes it.
  const forged: Person[] = [known('administrator'), nobody]
  giveMintBack(mint)
  assert.throws(() => mint(undefined), /handed back/)
  const real = takeMint()
  assert.throws(() => takeMint(), /taken/)
  const asUnknown = fieldState('post', title, doc, real(undefined), rules)
  for (const p of forged) assert.deepEqual(fieldState('post', title, doc, p, rules), asUnknown)
  const admin = real({email: 'a@example.com', name: 'A', userId: 'u1', role: 'admin', canWrite: true})
  assert.equal(fieldState('post', title, doc, admin, rules).readOnly, false)
})
