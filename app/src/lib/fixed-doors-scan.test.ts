// T4 (task-f4c80d82cc25b19b): every way the Studio makes or deletes a document asks the one
// rule, lib/fixed-documents.ts offers(), about a type with a fixed set of documents. Read from
// the source (source-tree.fixture.ts), comments left out, each file on one line:
// - a file that imports a writer that makes or deletes a document (WRITERS) is a listed DOOR,
//   whose guards are all in its code, or a listed PASS_ON, which only the doors reach;
// - a door's guard taken out (any one of them) is red;
// - nothing outside the rule decides on `fixedDocuments` by itself: a file that reads the list
//   hands it to offers() (or is only its type or its docs).
// The limit: a guard's words are checked, not that the button they stand in front of uses them.
import assert from 'node:assert/strict'
import {dirname, join, normalize} from 'node:path'
import {test} from 'node:test'
import {tree} from './source-tree.fixture.ts'

const flat = (text: string) => text.replace(/(^|[\s{(;,])\/\*[\s\S]*?\*\//gm, '$1').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ')

/** The writers that make a new document or delete one, by the module that defines them. */
const WRITERS: Record<string, string[]> = {
  'lib/edits': ['createDoc', 'draftNew', 'deleteDoc'],
  'lib/templates': ['startNew'],
  'lib/translations': ['createTranslation', 'deleteTranslated'],
  'lib/bulk-run': ['runBulkRow'],
}
/** Each door and the guards it asks before it makes or deletes, as written there. */
const DOORS: Record<string, string[]> = {
  'components/NewDocMenu.tsx': ['schemas.filter((s) => offersNew(s))'], // the navbar +
  'components/Structure.tsx': ['!isSingleton(schemas, type) && !isFixed(schemas, type) &&'], // a list's +
  'components/RefInput.tsx': ['!isSingleton(schemas, t) && !isFixed(schemas, t)'], // a reference's Create
  'components/IncomingReferencesInput.tsx': ['!isSingleton(schemas, type.type) && !isFixed(schemas, type.type)'], // incoming Add item
  'routes/intent.$.tsx': ['if (isFixed(schemas, choice.type)) return setFailed('], // an intent link
  'components/DocumentPane.tsx': [
    "const copyable = !single && offers(fixed, 'duplicate', doc._publishedId)", // the doc menu's Duplicate
    "const deletable = !single && offers(fixed, 'delete', doc._publishedId)", // its Delete, Ctrl+Alt+D
    '|| isFixed(schemas, pane.type)) return', // a new document's link (template=)
  ],
  'components/BulkBar.tsx': ['offers(schemaOf(schemas, d._type)?.fixedDocuments, action, d._publishedId)', "{offered('duplicate') &&", "{offered('delete') &&"], // bulk Duplicate / Delete
  'components/TranslationsMenu.tsx': ['const fixed = isFixed(schemas, doc._type)', 'if (fixed) return', '|| !!fixed}'], // Create new … translation
}
/** Importers of a writer that are no door: why only a door reaches them. */
const PASS_ON: Record<string, string> = {
  'lib/templates.ts': 'startNew: called by the + menus and the intent page, which ask first',
  'lib/translations.ts': 'createTranslation, deleteTranslated: called by TranslationsMenu and DeleteDialog',
  'lib/bulk-run.ts': 'runBulkRow: called by BulkDialog',
  'components/BulkDialog.tsx': "opened only with an action BulkBar offered",
  'components/DeleteDialog.tsx': "opened only by DocumentPane's deletable",
}
/** The rule itself, and the files that read the list only to hand it to offers() or to name it. */
const RULE = 'lib/fixed-documents.ts'
const NAMES_ONLY: Record<string, string> = {
  'server/schemas.ts': "the raw schema's type",
  'lib/schema-vocab.ts': "the key's words for the schema file",
}

type Tree = Record<string, string>
const importsOf = (file: string, text: string) =>
  [...flat(text).matchAll(/import \{([^}]*)\} from '(\.[^']+)'/g)].map((m) => ({
    from: normalize(join(dirname(file), m[2]!)).replace(/\.tsx?$/, ''),
    names: m[1]!.split(',').map((s) => s.trim().replace(/^type /, '').split(/ as /)[0]!),
  }))

/** What breaks the rule in `src`, as sentences (empty: it holds). */
function judge(src: Tree): string[] {
  const out: string[] = []
  for (const [file, text] of Object.entries(src)) {
    const writers = importsOf(file, text).flatMap(({from, names}) => names.filter((n) => WRITERS[from]?.includes(n)))
    if (writers.length && !DOORS[file] && !PASS_ON[file]) out.push(`${file} imports ${writers.join(', ')} and is no listed door`)
    if (/fixedDocuments/.test(flat(text)) && file !== RULE && !NAMES_ONLY[file] && !/\boffers\(/.test(flat(text))) out.push(`${file} reads fixedDocuments without offers()`)
    if (/!\s*!?\s*[\w?.]*(\([^()]*\))?[\w?.]*\.fixedDocuments\b/.test(flat(text))) out.push(`${file} decides on fixedDocuments itself`)
  }
  for (const [file, guards] of Object.entries(DOORS)) {
    const text = src[file]
    if (text === undefined) out.push(`${file} is gone: take it off DOORS`)
    else for (const g of guards) if (!flat(text).includes(g)) out.push(`${file} no longer asks: ${g}`)
  }
  for (const file of Object.keys(PASS_ON)) if (src[file] === undefined) out.push(`${file} is gone: take it off PASS_ON`)
  return out
}

const src = tree()

test('every door that makes or deletes a document asks lib/fixed-documents.ts', () => {
  assert.deepEqual(judge(src), [])
})

test('a door with any one guard taken out is red', () => {
  for (const [file, guards] of Object.entries(DOORS))
    for (const g of guards) {
      const text = flat(src[file]!)
      assert.ok(text.includes(g), `${file}: ${g}`)
      assert.deepEqual(judge({...src, [file]: text.replace(g, '')}), [`${file} no longer asks: ${g}`])
    }
})

test('a new importer of a writer, or a file that decides on the list itself, is red', () => {
  assert.deepEqual(judge({...src, 'components/Quick.tsx': "import {createDoc as make} from '../lib/edits'\nmake()"}), ['components/Quick.tsx imports createDoc and is no listed door'])
  assert.deepEqual(judge({...src, 'lib/menu.ts': "import {startNew} from './templates'"}), ['lib/menu.ts imports startNew and is no listed door'])
  assert.deepEqual(judge({...src, 'lib/x.ts': 'export const can = (s: {fixedDocuments?: string[]}) => !s.fixedDocuments'}), ['lib/x.ts reads fixedDocuments without offers()', 'lib/x.ts decides on fixedDocuments itself'])
  assert.deepEqual(judge({...src, 'lib/creatable.ts': src['lib/creatable.ts']!.replace("offers(fixedList(schema.fixedDocuments), 'create', '')", '!schema.fixedDocuments')}), ['lib/creatable.ts reads fixedDocuments without offers()', 'lib/creatable.ts decides on fixedDocuments itself'])
  assert.deepEqual(judge({...src, 'lib/data.ts': src['lib/data.ts']!.replace("!offers(schemaOf(schemas, type)?.fixedDocuments, 'create', '')", '!!schemaOf(schemas, type)?.fixedDocuments')}), ['lib/data.ts reads fixedDocuments without offers()', 'lib/data.ts decides on fixedDocuments itself'])
})
