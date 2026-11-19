// task-4f9ffd240c94a270: every surface that shows or edits a field asks the one rule
// (conditions.ts fieldState). Read from the source, by the module each import resolves to
// (whatever its local name, path spelling or `.ts` suffix, `import * as`, a dynamic import):
// - the writers below the save (WRITERS) are imported only by the files ALLOWED names, each
//   with why; everything else reaches only the checked save;
// - a file that imports the checked save (edit, setByAction), draws a field or pastes into
//   one is a listed SURFACE, and says how it asks the rule;
// - nothing outside conditions.ts decides a field's hidden or read-only itself;
// - the pastes that take the workspace's roles (PASTES) are imported only by lib/paste-reads.ts,
//   which reads them from Barkpark: no menu hands a paste roles of its own.
import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join, normalize, relative} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [join(dir, n)] : []))
const tree = (): Record<string, string> => Object.fromEntries(files(SRC).map((f) => [relative(SRC, f), readFileSync(f, 'utf8')]))
/** The code without its comments (a comment may name a writer or an endpoint); `image/*` in a string is no comment. */
const code = (text: string) => text.replace(/(^|[\s{(;,])\/\*[\s\S]*?\*\//gm, '$1').replace(/^\s*\/\/.*$/gm, '')
/** The code on one line, as a formatter may lay it out any way: what a surface's `asks` are read against. */
const flat = (text: string) => code(text).replace(/\s+/g, ' ').replace(/([([{]) /g, '$1').replace(/ ([)\]}])/g, '$1').replace(/,([)\]}])/g, '$1')

/** The writers below the save, by the module that defines them: they store a field unjudged. */
const WRITERS: Record<string, string[]> = {
  'lib/edits.ts': ['mutate', 'applyServer', 'reapply', 'createDoc', 'draftNew'],
  'lib/blocks.ts': ['applyBlockOps'],
  'lib/order-save.ts': ['saveRanks'],
  'lib/paper-masters.ts': ['insertMaster', 'pinMaster', 'detachMaster'],
}
/** The checked save: a file that imports it is a listed surface. */
const SAVES: Record<string, string[]> = {'lib/edits.ts': ['edit', 'setByAction']}
/** The pastes that are handed the roles read, or the roles (task-fcedb95f343c738b): only paste-reads.ts takes them, with Barkpark's. */
const PASTES: Record<string, string[]> = {'lib/paste-locked.ts': ['pasteDocument', 'pasteField', 'pasteDocumentReading', 'pasteFieldReading', 'keepLocked', 'holdsLocked']}
const PASTE_READS = 'lib/paste-reads.ts'
/** Barkpark's write endpoints, called straight: only where ALLOWED says. */
const ENDPOINTS = /\/v1\/data\/mutate\b|\/api\/mutate\b|\/ops\b|\}\/actions`/

/** Who may import a writer below the save (or call a write endpoint), and why. */
const ALLOWED: Record<string, string> = {
  'lib/edits.ts': 'the save itself',
  'lib/blocks.ts': 'defines applyBlockOps',
  'lib/order-save.ts': 'defines saveRanks',
  'routes/api/mutate.ts': 'the page-unload beacon’s route (edits.ts sends what edit() kept)',
  'lib/doc-actions.ts': 'a schema’s server actions: code, run by Barkpark',
  'components/PortableDocEditor.tsx': 'the canvas’s batch, behind docLocked and canvasLocked; a paper’s linked masters (insert, pin, detach), behind editable: the canvas’s field rule',
  'components/OrderableRows.tsx': 'a manual order’s rank, a field never in the form',
  'routeTree.gen.ts': 'the generated route list names the /api/mutate route',
  'components/DocumentPane.tsx': 'a new document’s initial values (draftNew, createDoc): code, the template’s',
  'lib/templates.ts': 'a new document from a template (draftNew, createDoc): the template’s initial values',
  'components/RefInput.tsx': 'a new document made from a reference field (createDoc): the template’s initial values',
  'components/IncomingReferencesInput.tsx': 'a new document made to refer here (createDoc): the template’s initial values',
  'components/HistoryPanel.tsx': 'Restore of a deleted document puts back the edits the delete lost (reapply): a document action',
  'components/PaneBanners.tsx': 'Restore of a deleted document (reapply): a document action',
  'lib/translations.ts': 'a new translation and its metadata document: document actions',
  'lib/bulk-run.ts': 'a list’s bulk actions (duplicate, delete): document actions',
  'lib/live.ts': 'the server’s own frames (applyServer): not this person’s edits',
  'lib/comments.ts': 'comments, their own documents',
  'lib/tasks.ts': 'tasks, their own documents',
  'lib/vision-shared.ts': 'shared Vision queries, their own documents',
}

/**
 * Each import of `file`: the module it resolves to (src-relative, or the package), the names, or
 * '*' for all, and whether it is a re-export (`export … from`).
 */
type Import = {to: string; names: string[] | '*'; locals: string[]; reexport: boolean}
function imports(file: string, text: string, src: Record<string, string>): Import[] {
  const resolve = (spec: string) => {
    if (!spec.startsWith('.')) return spec
    const p = normalize(join(dirname(file), spec))
    return [p, `${p}.ts`, `${p}.tsx`, join(p, 'index.ts'), join(p, 'index.tsx')].find((c) => c in src) ?? p
  }
  /** The names a clause takes (or '*'), and the local name each is bound to. */
  const named = (clause: string): {names: string[] | '*'; locals: string[]} => {
    const ns = /\*\s*as\s+([\w$]+)/.exec(clause)
    if (ns || /^\s*\*\s*$/.test(clause)) return {names: '*', locals: ns ? [ns[1]!] : []}
    const braces = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
    const pairs = braces.split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('type ')).map((x) => x.split(/\s+as\s+/).map((y) => y.trim()))
    const out = pairs.map(([name]) => name!)
    const locals = pairs.map(([name, local]) => local ?? name!)
    const def = /^\s*([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause.replace(/^\s*type\s/, ''))
    if (def) out.push('default'), locals.push(def[1]!)
    return {names: out, locals}
  }
  const c = code(text)
  const out: Import[] = []
  for (const m of c.matchAll(/\bimport\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) if (!m[1]) out.push({to: resolve(m[3]!), ...named(m[2]!), reexport: false})
  for (const m of c.matchAll(/\bexport\s+(type\s+)?(\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) if (!m[1]) out.push({to: resolve(m[3]!), ...named(m[2]!), reexport: true})
  for (const m of c.matchAll(/\bimport\(\s*(['"`])([^'"`$]+)\1\s*\)/g)) out.push({to: resolve(m[2]!), names: '*', locals: [], reexport: false})
  return out
}
/** Whether `file` passes on a writer it imported under `local` (export {local}, export const x = local, export default local). */
const passesOn = (c: string, local: string) =>
  new RegExp(`\\bexport\\s*\\{[^}]*\\b${local.replace('$', '\\$')}\\b[^}]*\\}(?!\\s*from)|\\bexport\\s+(const|let|var)\\s+[\\w$]+\\s*=\\s*${local.replace('$', '\\$')}\\b|\\bexport\\s+default\\s+${local.replace('$', '\\$')}\\b`).test(c)
const takes = (names: string[] | '*', of: string[]) => (names === '*' ? of : names.filter((n) => of.includes(n)))

/** The listed surfaces, what each is, the rule it follows, and how it asks: each pattern must be in the file. */
type Surface = {file: string; what: string; rule: 'the field rule' | 'code: document lock only'; asks: RegExp[]}
const SURFACES: Surface[] = [
  {file: 'components/Fields.tsx', what: 'the form, every field at any depth; Paste field; a richText field’s canvas; a clash card', rule: 'the field rule', asks: [/dependsOnDoc\(/, /fieldState\(type, props\.field, doc, user/, /<FieldBody \{\.\.\.props\} readOnly=\{props\.readOnly \|\| readOnly\} \/>/, /pasteFieldWith\(/, /<PortableDocEditor [^>]*editable=\{!readOnly\}/, /<FieldClashCard path=\{props\.path\} readOnly=\{!!props\.readOnly\} \/>/]},
  {file: 'components/DocumentPane.tsx', what: 'the group tabs; the Freeform canvas with or without a layout, its bound field blocks; the pane’s word to the save; kept edits put back', rule: 'the field rule', asks: [/fieldState\(schema\.name, f, doc, user/, /freeformCanvas\(lockState, \{schema, doc, user/, /editable=\{canvasMode === 'editable'\}/, /paneFieldLock\(/, /showDoc\(pane\.id, lockHolder, locked, fieldLock\)/, /<FieldView /, /notPutBack\(r\.refused/]},
  {file: 'components/DocumentPane.tsx', what: 'a document action’s set', rule: 'code: document lock only', asks: [/const set = \(field: string, value: unknown\) => setByAction\(qc, doc, field, value\) !== false/]},
  {file: 'components/DocHeaderMenu.tsx', what: 'Paste document', rule: 'the field rule', asks: [/pasteDocumentWith\(/]},
  {file: 'lib/paste-locked.ts', what: 'what Paste field and Paste document keep, at any depth', rule: 'the field rule', asks: [/fieldLock\(c\.type, sub, c\.doc, c\.user/, /pasteSkips\(c\.type, fields, c\.doc, c\.user/]},
  {file: 'components/ObjectArrayInput.tsx', what: 'an array item’s fields', rule: 'the field rule', asks: [/<FieldView /]},
  {file: 'components/BlockObjectDialog.tsx', what: 'a rich-text object’s dialog', rule: 'the field rule', asks: [/<FieldView /]},
  {file: 'components/ImageInput.tsx', what: 'an image’s own fields', rule: 'the field rule', asks: [/<FieldView /]},
  {file: 'components/CodeInput.tsx', what: 'a code field’s clash card', rule: 'the field rule', asks: [/<FieldClashCard path=\{`\$\{id\}\.code`\} readOnly=\{shut\} \/>/]},
  {file: 'components/PortableDocEditor.tsx', what: 'the canvas’s save', rule: 'the field rule', asks: [/canvasLocked\(id, field\)/]},
  {file: 'components/TranslationsMenu.tsx', what: 'the language field, set from the menu: judged at the save', rule: 'the field rule', asks: [/if \(edit\(qc, doc, config\.languageField, language\.id\) === false\) return/]},
  {file: 'lib/edits.ts', what: 'the save of every edit by hand; Keep mine; kept edits put back', rule: 'the field rule', asks: [/export const edit = gated\('hand', /, /if \(keep === 'mine'\) keepMine\(qc, id, field\)/, /const keepMine = gated\('keep-mine', /, /putBackKept\(id, verdict\.fields, /, /putBackKept\(doc\._publishedId, fields, /, /keepPlan\(docKeyOf\(id\)/]},
  {file: 'lib/edits.ts', what: 'a document action’s set', rule: 'code: document lock only', asks: [/export const setByAction = gated\('action', /]},
  {file: 'lib/presentation-overlay.ts', what: 'a change made on the Presentation page (no pane need show the doc)', rule: 'the field rule', asks: [/pathReadOnly\(/, /edit\(qc, doc, path, result\.next\) === false/]},
]

/** The rule's own parts: nowhere but conditions.ts. */
const COPIES = /\.(hidden|readOnly)\s*[!=]==?\s*(true|false)\b|\.visibleWhen\b|\bresolveConditional\(|\bisHidden\(|\bisReadOnly\(/
/** A save's result not read before the success is said: a bare save call, then a toast. */
const UNREAD = /^\s*(edit|setByAction|onEdit)\([^\n]*\)\s*;?\s*\n\s*toast\(/m

function judge(src: Record<string, string>, surfaces = SURFACES) {
  const problems: string[] = []
  const listed = new Set(surfaces.map((s) => s.file))
  for (const [file, text] of Object.entries(src)) {
    for (const {to, names, locals, reexport} of imports(file, text, src)) {
      const low = takes(names, WRITERS[to] ?? [])
      // A writer passed on (re-exported) by a file that does not define it would reach its importers unseen.
      if (low.length && file !== to && (reexport || locals.some((l) => passesOn(code(text), l)))) problems.push(`${file} passes on ${low.join(', ')} (below the save) from ${to}: only ${to} exports it`)
      if (low.length && !ALLOWED[file]) problems.push(`${file} imports ${low.join(', ')} (below the save) from ${to}: write through the save, or allow it in fieldrule-scan.test.ts with why`)
      const pastes = takes(names, PASTES[to] ?? [])
      if (pastes.length && file !== PASTE_READS && file !== to) problems.push(`${file} imports ${pastes.join(', ')} from ${to}: paste through ${PASTE_READS}, which reads the roles from Barkpark`)
      const saves = takes(names, SAVES[to] ?? [])
      if (saves.length && !listed.has(file)) problems.push(`${file} imports ${saves.join(', ')} (the save) and is no listed surface: list it in SURFACES with how it asks the rule`)
    }
    if (ENDPOINTS.test(code(text)) && !ALLOWED[file]) problems.push(`${file} calls a Barkpark write endpoint itself: write through the save`)
    const c = code(text)
    if (/<(FieldView|FieldBody|FieldInput|PortableDocEditor)\b/.test(c) && !listed.has(file)) problems.push(`${file} draws a field and is no listed surface`)
    if (/\bpaste(Field|Document)\(/.test(c) && !listed.has(file)) problems.push(`${file} pastes into a field and is no listed surface`)
    if (file !== 'components/Fields.tsx' && /<(FieldBody|FieldInput)\b/.test(c)) problems.push(`${file} draws a field input past FieldView, which asks the rule`)
    if (file !== 'lib/conditions.ts' && COPIES.test(c)) problems.push(`${file} decides a field's hidden or read-only itself: ask lib/conditions.ts`)
    if (UNREAD.test(c)) problems.push(`${file} says a save was made without reading its result`)
  }
  for (const {file, asks} of surfaces) {
    if (!(file in src)) problems.push(`${file} is listed and gone: take it off`)
    else for (const re of asks) if (!re.test(flat(src[file]!))) problems.push(`${file} no longer asks the rule: ${re}`)
  }
  for (const file of Object.keys(ALLOWED)) {
    if (!(file in src)) problems.push(`${file} is allowed and gone: take it off`)
    else if (!WRITERS[file] && !ENDPOINTS.test(code(src[file]!)) && !imports(file, src[file]!, src).some(({to, names}) => takes(names, WRITERS[to] ?? []).length)) problems.push(`${file} is allowed and writes below the save no more: take it off`)
  }
  return problems
}

test('every surface that shows or edits a field asks the one rule; the writers below the save are imported only where allowed', () => {
  assert.deepEqual(judge(tree()), [])
  // The save decides by the one function: edits.ts takes its gates from doc-lock, whose writeAllowed asks conditions.ts mayWrite.
  const all = tree()
  const from = (file: string, to: string) => imports(file, all[file]!, all).filter((i) => i.to === to).flatMap((i) => (i.names === '*' ? ['*'] : i.names))
  assert.deepEqual(from('lib/edits.ts', 'lib/doc-lock.ts').sort(), ['gated', 'putBackKept', 'writeAllowed'], 'edits.ts decides no write itself: only through gated, putBackKept and writeAllowed')
  assert.ok(from('lib/edits.ts', 'lib/pending-edits.ts').includes('keepPlan'), 'kept edits: what stays kept is keepPlan’s')
  assert.ok(from('lib/doc-lock.ts', 'lib/conditions.ts').includes('mayWrite'), 'doc-lock asks mayWrite')
  assert.match(all['lib/doc-lock.ts']!, /const answer = mayWrite\(by, \{docLocked: docLocked\(id\), fieldReadOnly: path !== undefined && fieldLocked\(id, path\)\}\)/)
  // The helpers the surfaces ask are built on fieldState, the one rule.
  const src = tree()
  assert.match(src['lib/form-lock.ts']!, /canvasFields\(schema\)\.map\(\(f\) => fieldState\(/)
  assert.match(src['lib/form-lock.ts']!, /pathReadOnly\(schema\.name, schema\.fields, doc, user, rules, path\)/)
  assert.match(src['lib/conditions.ts']!, /if \(fieldState\(type, f, doc, person, rules, \{path: at/)
  assert.match(src['lib/conditions.ts']!, /const readOnly = fieldState\(type, f, doc, currentUser, rules, at\)\.readOnly/)
})

const fails = (src: Record<string, string>, file: string, text: string, why: RegExp) => assert.match(judge({...src, [file]: text}).join('\n'), why, file)

test('a new writer fails whatever its spelling: a .ts suffix, import * as, a dynamic import, a direct mutate, an alias, a re-export, a copy of the rule', () => {
  const src = tree()
  fails(src, 'lib/quick-edit.ts', "import {edit} from './edits.ts'\nexport const q = edit\n", /lib\/quick-edit\.ts imports edit \(the save\) and is no listed surface/)
  fails(src, 'components/Quick.tsx', 'import * as E from "../lib/edits"\nexport const q = E\n', /components\/Quick\.tsx imports mutate, applyServer, reapply, createDoc, draftNew \(below the save\)/)
  fails(src, 'components/Later.tsx', "export const later = async () => (await import('../lib/edits')).mutate\n", /components\/Later\.tsx imports mutate, .* \(below the save\)/)
  fails(src, 'lib/stamp.ts', "import {mutate} from './edits'\nexport const stamp = () => mutate({data: {mutations: []}})\n", /lib\/stamp\.ts imports mutate \(below the save\)/)
  fails(src, 'lib/beacon.ts', "export const b = () => navigator.sendBeacon('/api/mutate', '')\n", /lib\/beacon\.ts calls a Barkpark write endpoint itself/)
  fails(src, 'components/Send.tsx', "import {applyBlockOps as send} from '../lib/blocks.ts'\nexport const s = send\n", /components\/Send\.tsx imports applyBlockOps \(below the save\)/)
  fails(src, 'lib/again.ts', "export {mutate as m} from './edits'\n", /lib\/again\.ts imports mutate \(below the save\)/)
  fails(src, 'components/Badge.tsx', 'export const editable = (f: {readOnly?: boolean}) => f.readOnly !== true\n', /Badge\.tsx decides a field's hidden or read-only itself/)
  fails(src, 'components/Peek.tsx', 'export const Peek = (p: never) => <FieldBody {...p} />\n', /Peek\.tsx draws a field input past FieldView/)
  fails(src, 'components/Lang.tsx', "import {edit} from '../lib/edits'\nconst go = () => {\n  edit(qc, doc, 'language', 'nb')\n  toast({title: 'Set'})\n}\n", /Lang\.tsx says a save was made without reading its result/)
  // A writer passed on through any file but its own, an allowed one too, and what imports it.
  const passed = {...src, 'lib/templates.ts': `${src['lib/templates.ts']}\nexport {mutate as templateMutate} from './edits'\n`, 'components/I.tsx': "import {templateMutate} from '../lib/templates'\nexport const i = templateMutate\n"}
  assert.match(judge(passed).join('\n'), /lib\/templates\.ts passes on mutate \(below the save\) from lib\/edits\.ts/)
  fails(src, 'lib/carry.ts', "import {mutate as m} from './edits'\nexport {m}\n", /lib\/carry\.ts passes on mutate/)
  fails(src, 'lib/carry2.ts', "import * as E from './edits'\nexport const m = E.mutate\n", /lib\/carry2\.ts passes on mutate, applyServer, reapply, createDoc, draftNew/)
  fails(src, 'lib/carry3.ts', "export * from './blocks'\n", /lib\/carry3\.ts passes on applyBlockOps/)
  // A paste menu that reads the roles itself (one that skips Barkpark, or another session's): only paste-reads.ts may.
  fails(src, 'components/MyPaste.tsx', "import {pasteDocumentReading} from '../lib/paste-locked'\nexport const p = (f: never, v: never, c: never) => pasteDocumentReading({schemas: async () => [], roles: async () => null}, f, v, c)\n", /MyPaste\.tsx imports pasteDocumentReading from lib\/paste-locked\.ts: paste through lib\/paste-reads\.ts/)
  fails(src, 'components/Later2.tsx', "export const p = async () => (await import('../lib/paste-locked.ts')).pasteField\n", /Later2\.tsx imports pasteDocument, pasteField, .* from lib\/paste-locked\.ts/)
  // A paper's linked masters (insert, pin, detach) write its body.
  fails(src, 'components/Masters.tsx', "import {pinMaster} from '../lib/paper-masters'\nexport const pin = pinMaster\n", /components\/Masters\.tsx imports pinMaster \(below the save\)/)
  // A listed surface that stops asking.
  fails(src, 'components/PortableDocEditor.tsx', src['components/PortableDocEditor.tsx']!.replace('canvasLocked(id, field)', 'false'), /PortableDocEditor\.tsx no longer asks the rule/)
  // Laid out another way, as a formatter might: nothing changes.
  const wrapped = src['lib/edits.ts']!.replace(/export const setByAction = gated\(\s*'action',\s*/, "export const setByAction = gated(\n    'action',\n\n    ")
  assert.notEqual(wrapped, src['lib/edits.ts'])
  assert.deepEqual(judge({...src, 'lib/edits.ts': wrapped}), [])
  // Keep mine sent past its gate: a listed surface that stops asking.
  fails(src, 'lib/edits.ts', src['lib/edits.ts']!.replace(/if \(keep === 'mine'\)\s*keepMine\(qc, id, field\)/, "if (keep === 'mine') settle(qc, id, field, 'mine')"), /lib\/edits\.ts no longer asks the rule: .*keepMine/)
  // A type-only import of a writer is no write.
  assert.deepEqual(judge({...src, 'lib/types-only.ts': "import type {mutate} from './edits'\nimport {type createDoc} from './edits'\nexport type M = typeof mutate\n"}), [])
})
