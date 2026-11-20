import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {register} from 'node:module'
import {QueryClient, onlineManager} from '@tanstack/react-query'
// G2 (task-a34b8c24295dd488): "$today" is resolved in one place, lib/today-start.ts, under
// edits.ts's draftNew and createDoc. These run edits.ts as the browser does, its server side
// stubbed (save-flow.hooks.mjs), against a Barkpark in memory that keeps each create it gets.
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})
const g = globalThis as Record<string, unknown>
const creates: Record<string, unknown>[] = []
g.saveFlowServer = {
  read: async () => null,
  fetch: async (_page: string, _url: string, init: {body: string}) => {
    const c = (JSON.parse(init.body).mutations as {create?: Record<string, unknown> & {_id: string}}[])[0]!.create!
    creates.push(c)
    const document = {...c, _id: `drafts.${c._id}`, _publishedId: c._id, _rev: 'r1', _updatedAt: new Date().toISOString(), _draft: true, _hasPublished: false}
    return {ok: true, status: 200, json: async () => ({transactionId: 'r1', results: [{id: c._id, operation: 'create', document}]})}
  },
}
const E = await import('./edits.ts')
const {zoneWait, startValues} = await import('./today-start.ts')
const {dateIn} = await import('./today.ts')
after(() => E.forgetEdits())

const tick = (ms = 0) => new Promise((go) => setTimeout(go, ms))
let n = 0
const newId = () => `today-${++n}`
/** A page whose root loader has read the workspace's locale (`undefined`: not read yet). */
function page(locale?: object) {
  const qc = new QueryClient()
  if (locale) qc.setQueryData(['locale'], locale)
  return qc
}
// A zone on another date than UTC's at this hour (Kiritimati UTC+14 from 10:00 UTC, Pago Pago
// UTC-11 before), so a test that got UTC instead of the workspace's zone goes red.
const ZONE = new Date().getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago'
const ZONED = {locale: 'nb-NO', timeZone: ZONE}
const held = (qc: QueryClient, id: string) => qc.getQueryData<Record<string, unknown>>(['doc', id])
/** Today in `zone`, read on both sides of the call (a run across midnight takes either). */
async function today(zone: string, run: () => Promise<unknown>) {
  const before = dateIn(new Date(), zone)
  const out = await run()
  return {out, days: [before, dateIn(new Date(), zone)]}
}
/** A draft's create, as its first edit sends it: the pending create with the edit on top. */
async function firstCreate(qc: QueryClient, id: string) {
  for (let i = 0; i < 100 && !held(qc, id); i++) await tick(5)
  assert.ok(held(qc, id), 'the draft opened')
  E.edit(qc, held(qc, id) as never, 'notat', 'x')
  E.flush(qc, id)
  await E.whenSaved(id)
  return creates.find((c) => c._id === id)!
}

test('draftNew: a new sak from initialValues $today holds today in the workspace zone, in the draft and in its create', async () => {
  const qc = page(ZONED)
  const id = newId()
  const {out, days} = await today(ZONE, async () => {
    E.draftNew(qc, 'sak', id, {schema: {publisert: '$today', tittel: 'Ny sak'}})
    return held(qc, id)
  })
  assert.ok(days.includes((out as {publisert: string}).publisert), 'the draft shows today')
  assert.ok(!days.includes(dateIn(new Date(), 'Etc/UTC')), `${ZONE} is not on UTC's date now`)
  const sent = await firstCreate(qc, id)
  assert.ok(days.includes(sent.publisert as string), `the create holds today, not ${sent.publisert}`)
  assert.equal(sent.tittel, 'Ny sak')
})

test("a reload before the first edit (template=…): a config template's $today is resolved too", async () => {
  // DocumentPane's reload effect: draftNew(qc, type, id, own ? {schema: choice.value} : {local: choice.value}).
  const qc = page(ZONED)
  const id = newId()
  const {days} = await today(ZONE, async () => E.draftNew(qc, 'sak', id, {local: {publisert: '$today', kategori: 'nyhet'}}))
  const sent = await firstCreate(qc, id)
  assert.ok(days.includes(sent.publisert as string))
  assert.equal(sent.kategori, 'nyhet')
})

test("a singleton's first open: its initialValues $today is resolved", async () => {
  // DocumentPane's singleton effect: draftNew(qc, type, type, {schema: initialValues}).
  const qc = page(ZONED)
  const id = `innstillinger-${++n}`
  const {days} = await today(ZONE, async () => E.draftNew(qc, id, id, {schema: {oppdatert: '$today'}}))
  assert.ok(days.includes(held(qc, id)!.oppdatert as string))
})

test('Duplicate keeps its copy as it is: a "$today" typed into a field stays text', async () => {
  const qc = page(ZONED)
  const id = newId()
  await E.createDoc(qc, 'sak', id, {asIs: {tittel: '$today', publisert: '2026-01-01'}})
  const sent = creates.find((c) => c._id === id)!
  assert.equal(sent.tittel, '$today')
  assert.equal(sent.publisert, '2026-01-01')
})

test("a reference field's Create: the typed search text stays as typed, even \"$today\"; the template's token is resolved", async () => {
  const qc = page(ZONED)
  const id = newId()
  const {days} = await today(ZONE, () => E.createDoc(qc, 'sak', id, {local: {publisert: '$today'}, asIs: {title: '$today'}}))
  const sent = creates.find((c) => c._id === id)!
  assert.equal(sent.title, '$today')
  assert.ok(days.includes(sent.publisert as string))
})

test("no workspace zone: $today is UTC, as on Barkpark, not the editor's zone", async () => {
  const was = process.env.TZ
  process.env.TZ = 'Pacific/Kiritimati'
  try {
    const at = new Date('2026-11-20T10:00:00Z')
    assert.equal(new Intl.DateTimeFormat('en-CA').format(at), '2026-11-21', 'the editor is on the 21st')
    let out: Record<string, unknown> | undefined
    startValues(page({locale: 'en'}), {queryKey: ['locale']}, {schema: {publisert: '$today'}}, (v) => (out = v), at)
    assert.equal(out?.publisert, '2026-11-20', 'at once, in UTC')
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
})

test("a zoned workspace waits for the real zone when the server render's locale was provisional", async () => {
  g.saveFlowLocale = async () => ({...ZONED})
  try {
    const qc = page({locale: 'en', provisional: true})
    const id = newId()
    const {days} = await today(ZONE, async () => {
      E.draftNew(qc, 'sak', id, {schema: {publisert: '$today'}})
      assert.equal(held(qc, id), undefined, 'not with a guessed zone')
      for (let i = 0; i < 100 && !held(qc, id); i++) await tick(5)
    })
    assert.ok(days.includes(held(qc, id)!.publisert as string))
  } finally {
    delete g.saveFlowLocale
  }
})

test("a failed locale read: the schema's token fields are left for Barkpark to fill in its zone; a desk's or template's read UTC", async () => {
  // fetchLocale's answer when Barkpark fails (i18n.tsx): the zone is not known.
  const qc = page({locale: 'en', zoneUnknown: true})
  const id = newId()
  const {days} = await today('Etc/UTC', async () => E.draftNew(qc, 'sak', id, {schema: {publisert: '$today', tittel: 'Ny sak'}, local: {frist: '$today'}}))
  assert.equal(held(qc, id)!.publisert, undefined, 'no guessed date on screen')
  const sent = await firstCreate(qc, id)
  assert.ok(!('publisert' in sent), 'Barkpark fills it from the same initial values')
  assert.equal(sent.tittel, 'Ny sak')
  assert.ok(days.includes(sent.frist as string), 'only the Studio has the desk value: UTC')
})

test('the wait is capped: a locale read that never answers still opens the new document, with the fallback', async () => {
  assert.equal(zoneWait.ms, 2000, 'about 2 s in the app')
  const was = zoneWait.ms
  zoneWait.ms = 40
  g.saveFlowLocale = () => new Promise(() => {})
  try {
    const qc = page({locale: 'en', provisional: true})
    const id = newId()
    const t0 = performance.now()
    E.draftNew(qc, 'sak', id, {schema: {publisert: '$today', tittel: 'Ny sak'}})
    for (let i = 0; i < 100 && !held(qc, id); i++) await tick(5)
    assert.ok(held(qc, id), 'opened')
    assert.ok(performance.now() - t0 < 400, 'at the cap, not after retries')
    assert.equal(held(qc, id)!.tittel, 'Ny sak')
    assert.equal(held(qc, id)!.publisert, undefined, 'left for Barkpark')
  } finally {
    zoneWait.ms = was
    delete g.saveFlowLocale
  }
})

test('offline: the new document still opens (fallback), no hang', async () => {
  const was = zoneWait.ms
  zoneWait.ms = 40
  onlineManager.setOnline(false)
  try {
    const qc = page()
    const id = newId()
    E.draftNew(qc, 'sak', id, {schema: {publisert: '$today', tittel: 'Ny sak'}})
    for (let i = 0; i < 100 && !held(qc, id); i++) await tick(5)
    assert.equal(held(qc, id)?.tittel, 'Ny sak')
  } finally {
    onlineManager.setOnline(true)
    zoneWait.ms = was
  }
})

// What cannot run here: DocumentPane (a React component) and the callers' files. Their calls are
// pinned by text, so a path that stops passing its values through draftNew/createDoc goes red.
const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('the one place, by text: draftNew and createDoc call startValues, the only writes of a new doc are there, and no caller resolves', () => {
  const edits = src('./edits.ts')
  assert.match(edits, /export function draftNew\(qc: QueryClient, type: string, id: string, start: Start\) \{\n {2}startValues\(qc, localeQuery, start, \(values\) => \{/)
  assert.match(edits, /export function createDoc\(qc: QueryClient, type: string, id: string, start: Start\): Promise<void> \{\n {2}return new Promise\(\(resolve, reject\) => startValues\(qc, localeQuery, start, \(values\) => void createNow\(/)
  assert.deepEqual(edits.match(/e\.pendingCreate = (?!undefined)\w+/g), ['e.pendingCreate = values', 'e.pendingCreate = fields'])
  assert.equal(edits.match(/createNow\(/g)?.length, 2, 'createNow: defined, and called by createDoc only')
  const pane = src('../components/DocumentPane.tsx')
  assert.match(pane, /if \(choice\) draftNew\(qcHere, pane\.type, pane\.id, choice\.id === pane\.type \? \{schema: choice\.value\} : \{local: choice\.value\}\)/, 'the template= reload')
  assert.match(pane, /draftNew\(qc, pane\.type, pane\.id, \{schema: schemaOf\(schemas, pane\.type\)\?\.initialValues \?\? \{\}\}\)/, "the singleton's first open")
  assert.match(pane, /createDoc\(qc, from\._type, id, \{asIs: fields\}\)/, 'Duplicate')
  assert.match(src('../components/RefInput.tsx'), /createDoc\(qc, refType, newId, \{local: [^\n]*, asIs: q \? \{\[titleField\]: q\} : \{\}\}\)/, "a reference's typed title is asIs")
  for (const file of ['./templates.ts', '../components/DocumentPane.tsx', '../components/RefInput.tsx', '../components/IncomingReferencesInput.tsx']) {
    assert.doesNotMatch(src(file), /resolveToday|startedWith|from '\.\/today'|lib\/today'/, file)
  }
})
