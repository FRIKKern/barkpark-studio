import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'

import {COPIED, PACK_DIR, SOURCE_PATH, compare, rowsMoved, selfCheck, sha256, sourceNote, sourcePack} from './pack.mjs'

// A Barkpark checkout with a pack of two blocks, and a studio holding it as the sync writes it.
const put = (path, text) => (mkdirSync(dirname(path), {recursive: true}), writeFileSync(path, text))
function source(blocks = {paragraph: '{"type":"paragraph"}', heading: '{"type":"heading"}'}) {
  const checkout = mkdtempSync(join(tmpdir(), 'pack-source-'))
  const src = join(checkout, SOURCE_PATH)
  const files = {}
  for (const [type, text] of Object.entries(blocks)) {
    put(join(src, 'goldens/blocks', `${type}.golden.json`), text)
    files[`blocks/${type}.golden.json`] = sha256(text)
  }
  put(join(src, 'goldens/limits/deep.golden.json'), '{}') // in the stamp, not copied
  files['limits/deep.golden.json'] = sha256('{}')
  put(join(src, 'goldens/stamp.json'), JSON.stringify({files}, null, 2))
  put(join(src, 'conformance/conformance.mjs'), 'export const v = 1\n')
  put(join(src, 'conformance/conformance.d.mts'), 'export declare const v: number\n')
  return {checkout, src}
}
function studioFrom({src}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-studio-'))
  const {files, errors} = sourcePack(src)
  assert.deepEqual(errors, [])
  for (const f of Object.keys(files)) put(join(root, PACK_DIR, f), readFileSync(join(src, COPIED[f] ?? f)))
  put(join(root, PACK_DIR, 'SOURCE.md'), sourceNote('a'.repeat(40), files))
  return root
}
const edit = (path, text) => writeFileSync(path, text)

test('pack compare: the same pack is the same, and holds against itself', () => {
  const s = source()
  const root = studioFrom(s)
  assert.deepEqual(compare(root, s.src), [])
  assert.deepEqual(selfCheck(root), [])
})

test('pack compare: one file changed in Barkpark is named, and nothing else', () => {
  const s = source()
  const root = studioFrom(s)
  const stamp = JSON.parse(readFileSync(join(s.src, 'goldens/stamp.json'), 'utf8'))
  edit(join(s.src, 'goldens/blocks/heading.golden.json'), '{"type":"heading","level":2}')
  stamp.files['blocks/heading.golden.json'] = sha256('{"type":"heading","level":2}')
  edit(join(s.src, 'goldens/stamp.json'), JSON.stringify(stamp, null, 2))
  assert.deepEqual(compare(root, s.src), [`${PACK_DIR}/goldens/blocks/heading.golden.json: changed in Barkpark`, `${PACK_DIR}/goldens/stamp.json: changed in Barkpark`])
  edit(join(s.src, 'conformance/conformance.mjs'), 'export const v = 2\n')
  assert.match(compare(root, s.src).join('\n'), /conformance\.mjs: changed in Barkpark/)
})

test('pack compare: a block added in Barkpark is named', () => {
  const s = source({paragraph: '{"type":"paragraph"}'})
  const root = studioFrom(s)
  const more = source()
  assert.deepEqual(compare(root, more.src), [`${PACK_DIR}/goldens/blocks/heading.golden.json: added in Barkpark`, `${PACK_DIR}/goldens/stamp.json: changed in Barkpark`])
})

test('pack compare: a block removed in Barkpark is named', () => {
  const root = studioFrom(source())
  const fewer = source({paragraph: '{"type":"paragraph"}'})
  assert.deepEqual(compare(root, fewer.src), [`${PACK_DIR}/goldens/stamp.json: changed in Barkpark`, `${PACK_DIR}/goldens/blocks/heading.golden.json: removed in Barkpark`])
})

test('pack compare: a source that disagrees with its own stamp is refused, file by file', () => {
  const s = source()
  const root = studioFrom(s)
  edit(join(s.src, 'goldens/blocks/heading.golden.json'), '{"type":"heading","edited":true}')
  put(join(s.src, 'goldens/blocks/stray.golden.json'), '{}')
  rmSync(join(s.src, 'goldens/limits/deep.golden.json'))
  assert.deepEqual(compare(root, s.src), [
    'source goldens/blocks/heading.golden.json: differs from its stamp',
    'source goldens/limits/deep.golden.json: named in its stamp, absent',
    'source goldens/blocks/stray.golden.json: not in its stamp',
  ])
  assert.match(sourcePack(join(s.checkout, 'nowhere')).errors[0], /no stamp, not a PortableDoc pack/)
})

test('pack self-check: a hand edit, a stray file or a lost one in conformance/pack/ fails', () => {
  const root = studioFrom(source())
  edit(join(root, PACK_DIR, 'conformance.mjs'), 'export const v = 1 // tweaked\n')
  edit(join(root, PACK_DIR, 'goldens/blocks/heading.golden.json'), '{"type":"heading","tweaked":1}')
  put(join(root, PACK_DIR, 'goldens/blocks/mine.golden.json'), '{}')
  rmSync(join(root, PACK_DIR, 'goldens/blocks/paragraph.golden.json'))
  assert.deepEqual(selfCheck(root), [
    `${PACK_DIR}/goldens/blocks/paragraph.golden.json: named by the pack, absent`,
    `${PACK_DIR}/conformance.mjs: not as the sync wrote it`,
    `${PACK_DIR}/goldens/blocks/heading.golden.json: not as the sync wrote it`,
    `${PACK_DIR}/goldens/blocks/mine.golden.json: not named by the stamp or SOURCE.md`,
  ])
  edit(join(root, PACK_DIR, 'SOURCE.md'), '# hand written\n')
  assert.match(selfCheck(root).join('\n'), /SOURCE\.md: no source commit/)
})

test('rows moved: the report takes a new stamp only when no row the studio renders moved', () => {
  const report = (rows) => ({renderer: 'barkpark-studio', compare: 'dom', pack_stamp: 'x', rows})
  const before = report([{type: 'callout', status: 'fail', diff: ['a']}, {type: 'heading', status: 'pass'}, {type: 'chart', status: 'missing'}])
  assert.deepEqual(rowsMoved(before, report([...before.rows])), [])
  assert.deepEqual(rowsMoved(before, report([...before.rows, {type: 'map', status: 'missing'}])), [], 'a new type the studio does not render')
  assert.deepEqual(rowsMoved(before, report(before.rows.slice(0, 2))), [], 'an unrendered type gone')
  assert.deepEqual(rowsMoved(before, report([{type: 'callout', status: 'fail', diff: ['b']}, ...before.rows.slice(1)])), ['row callout: committed {"type":"callout","status":"fail","diff":["a"]}, now {"type":"callout","status":"fail","diff":["b"]}'])
  assert.equal(rowsMoved(before, report([before.rows[0], {type: 'heading', status: 'fail', diff: ['c']}, before.rows[2]])).length, 1, 'a pass that fails')
  assert.equal(rowsMoved(before, report([before.rows[0], before.rows[2]])).length, 1, 'a rendered type gone')
  assert.equal(rowsMoved(before, report([...before.rows.slice(0, 2), {type: 'chart', status: 'pass'}])).length, 1, 'a type now rendered')
  assert.equal(rowsMoved(before, {...report(before.rows), compare: 'text'}).length, 1)
})
