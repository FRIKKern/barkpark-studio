import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {QueryClient} from '@tanstack/react-query'
// G2 (task-a34b8c24295dd488): "$today" is resolved in one place, lib/today-start.ts, which
// edits.ts's draftNew and createDoc call. The paths are traced in the source (edits.ts and the
// pane import the server and cannot load here); the resolver itself runs.
import {startValues} from './today-start.ts'

const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const edits = src('./edits.ts')
const pane = src('../components/DocumentPane.tsx')

/** The text of `function name(…) {…}` in `text`, to its closing brace at the line start. */
function body(text: string, name: string): string {
  const at = text.search(new RegExp(`function ${name}\\(`))
  assert.ok(at >= 0, `no function ${name}`)
  return text.slice(at, text.indexOf('\n}\n', at))
}

/** draftNew hands its values to startValues and stores only what comes back. */
function draftNewResolves() {
  const draftNew = body(edits, 'draftNew')
  assert.match(draftNew, /startValues\(qc, localeQuery, initial, \(values\) => \{/)
  assert.match(draftNew, /e\.pendingCreate = values\n/)
  assert.match(draftNew, /\.\.\.values\} as Doc\)/)
}

const day = (v: unknown) => (v as {publisert?: string} | undefined)?.publisert
const NOW = new Date('2026-11-20T23:30:00Z') // Oslo: the 21st; UTC: the 20th

function cache(locale?: object) {
  const qc = new QueryClient()
  if (locale) qc.setQueryData(['locale'], locale)
  return qc
}

/** startValues' answer, and whether it came at once (before any read). */
async function started(qc: QueryClient, queryFn: () => Promise<unknown>, value: unknown = {publisert: '$today'}, now = NOW) {
  let out: unknown
  let atOnce = false
  const done = new Promise<void>((resolve) => startValues(qc, {queryKey: ['locale'], queryFn}, value, (v) => ((out = v), resolve()), now))
  atOnce = out !== undefined
  await done
  return {out, atOnce}
}
const unread = () => Promise.reject(new Error('read when the zone was known'))

test('the one place: draftNew and createDoc put every new document through startValues', () => {
  draftNewResolves()
  const createDoc = body(edits, 'createDoc')
  assert.match(createDoc, /if \(asIs\) return createNow\(qc, type, id, fields\)\n/)
  assert.match(createDoc, /startValues\(qc, localeQuery, fields, \(values\) => void createNow\(qc, type, id, values\)/)
  // createNow is createDoc's own: its two calls are the only ones.
  assert.equal(edits.match(/createNow\(/g)?.length, 3)
  // A new document's values are stored in two places only: draftNew's (resolved) and createNow's.
  assert.deepEqual(edits.match(/e\.pendingCreate = (?!undefined)\w+/g), ['e.pendingCreate = values', 'e.pendingCreate = fields'])
  assert.match(body(edits, 'createNow'), /e\.pendingCreate = fields/)
  // No caller resolves the token on its own.
  for (const file of ['./templates.ts', '../components/DocumentPane.tsx', '../components/RefInput.tsx', '../components/IncomingReferencesInput.tsx']) {
    assert.doesNotMatch(src(file), /resolveToday|from '\.\/today'|lib\/today'/, file)
  }
})

test('a reload before the first edit (template=…) reopens the new doc through draftNew, $today resolved', async () => {
  assert.match(pane, /if \(!pane\.template \|\| draftQ\.data !== null \|\| !schemas\.length\) return\n\s+const choice = choiceById\([^\n]+\n\s+if \(choice\) draftNew\(qcHere, pane\.type, pane\.id, choice\.value\)/)
  draftNewResolves()
  assert.equal(day((await started(cache({locale: 'en', timeZone: 'Europe/Oslo'}), unread)).out), '2026-11-21')
})

test("a singleton's first open goes through draftNew, $today resolved", () => {
  assert.match(pane, /if \(single && pane\.id === pane\.type && draftQ\.data === null && !viewingPublished\) draftNew\(qc, pane\.type, pane\.id, schemaOf\(schemas, pane\.type\)\?\.initialValues \?\? \{\}\)/)
  draftNewResolves()
})

test('Duplicate keeps its copy as it is: a "$today" typed into a field stays text', () => {
  assert.match(body(pane, 'DocumentPane'), /createDoc\(qc, from\._type, id, fields, \{asIs: true\}\)/)
  assert.match(body(edits, 'createDoc'), /\{asIs = false\} = \{\}\): Promise<void> \{\n\s+if \(asIs\) return createNow/)
})

test("no workspace zone: $today is UTC, as on Barkpark, not the editor's zone", async () => {
  const was = process.env.TZ
  process.env.TZ = 'Pacific/Kiritimati'
  try {
    const at = new Date('2026-11-20T10:00:00Z')
    assert.equal(new Intl.DateTimeFormat('en-CA').format(at), '2026-11-21', 'the editor is on the 21st')
    const {out, atOnce} = await started(cache({locale: 'en'}), unread, {publisert: '$today'}, at)
    assert.equal(day(out), '2026-11-20')
    assert.ok(atOnce)
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
})

test("a zoned workspace waits for the real zone when the server render's locale was provisional", async () => {
  const {out, atOnce} = await started(cache({locale: 'en', provisional: true}), async () => ({locale: 'nb-NO', timeZone: 'Europe/Oslo'}))
  assert.equal(day(out), '2026-11-21')
  assert.equal(atOnce, false)
})

test('a failed locale read resolves $today in UTC, as Barkpark', async () => {
  assert.equal(day((await started(cache(), () => Promise.reject(new Error('Barkpark is down')))).out), '2026-11-20')
  assert.equal(day((await started(cache({locale: 'en', provisional: true}), () => Promise.reject(new Error('Barkpark is down')))).out), '2026-11-20')
  // The locale read's own fallback when Barkpark fails (i18n.tsx fetchLocale): no zone, so UTC.
  assert.equal(day((await started(cache(), async () => ({locale: 'en'}))).out), '2026-11-20')
})

test('no token: the values pass through at once, the same object, with no read', async () => {
  const value = {tittel: 'Ny sak', publisert: '2026-01-01'}
  const {out, atOnce} = await started(cache(), unread, value)
  assert.equal(out, value)
  assert.ok(atOnce)
})
