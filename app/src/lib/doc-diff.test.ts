// J15: rich-text Review changes as Sanity's: only changed blocks, styles and marks kept.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {diffRuns, docDiff, runs, type DocBlock} from './doc-diff.ts'

const t = (value: string) => ({type: 'text', value})
const p = (id: string, ...content: object[]): DocBlock => ({id, type: 'paragraph', content: content as DocBlock['content']})
const h = (id: string, text: string): DocBlock => ({id, type: 'heading', level: 2, content: [t(text)]})
const show = (pieces: {text: string; change: string; marks: string[]}[]) => pieces.map((x) => `${x.change[0]}:${x.marks.join('+')}${x.marks.length ? ':' : ''}${x.text}`)

test('only the changed blocks, in their own style', () => {
  const before = [h('h1', 'Heading'), p('p1', t('Body paragraph.')), p('p2', t('Untouched.'))]
  const after = [h('h1', 'Heading'), p('p1', t('Body paragraph. Now edited.')), p('p2', t('Untouched.'))]
  const d = docDiff(before, after)
  assert.equal(d.length, 1)
  assert.equal(d[0]!.block.type, 'paragraph')
  assert.deepEqual(show(d[0]!.pieces), ['s:Body paragraph.', 'a: Now edited.'])
})

test('marks are kept on both sides of the diff', () => {
  const before = runs([t('A '), {type: 'strong', children: [t('bold')]}, t(' word')])
  const after = runs([t('A '), {type: 'strong', children: [t('bold')]}, t(' phrase')])
  assert.deepEqual(show(diffRuns(before, after)), ['s:A ', 's:strong:bold', 's: ', 'r:word', 'a:phrase'])
})

test('added and removed blocks, the removed one where it stood', () => {
  const before = [p('a', t('One.')), p('b', t('Two.')), p('c', t('Three.'))]
  const after = [p('a', t('One.')), p('c', t('Three.')), h('n', 'New')]
  assert.deepEqual(docDiff(before, after).map((c) => `${c.kind}:${c.block.id}`), ['removed:b', 'added:n'])
})

test('links keep their href', () => {
  const r = runs([{type: 'link', href: 'https://x.test', children: [t('a link')]}])
  assert.equal(r[0]!.href, 'https://x.test')
})
