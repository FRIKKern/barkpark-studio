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

test('J15 widen: a word made bold is "formatted"; a callout tone and an image block show as property changes', () => {
  const t = (value: string) => ({type: 'text', value})
  const before = [{id: 'p', type: 'paragraph', content: [t('a bold word')]}, {id: 'c', type: 'callout', tone: 'info', content: [t('x')]}, {id: 'i', type: 'image', url: '/a.png', alt: 'A'}]
  const after = [{id: 'p', type: 'paragraph', content: [t('a '), {type: 'strong', children: [t('bold')]}, t(' word')]}, {id: 'c', type: 'callout', tone: 'warning', content: [t('x')]}, {id: 'i', type: 'image', url: '/b.png', alt: 'B'}]
  const [p, c, i] = docDiff(before, after)
  assert.deepEqual(p!.pieces.filter((x) => x.change !== 'same').map((x) => [x.text, x.change, x.marks.join()]), [['bold', 'formatted', 'strong']])
  assert.deepEqual(c!.attrs, [{name: 'tone', before: 'info', after: 'warning'}])
  assert.deepEqual(i!.attrs!.map((a) => a.name), ['alt', 'url'])
})

test('task-07a49820d19a94c3: an inline chip is in the diff, and a changed link or internal link says what it points to', () => {
  const t = (value: string) => ({type: 'text', value})
  const chip = (text: string, tone = 'positive') => ({type: 'chip', text, tone})
  const link = (href: string, words: string) => ({type: 'link', href, children: [t(words)]})
  const wiki = (docId: string, words: string) => ({type: 'wikilink', docId, children: [t(words)]})
  const before = [{id: 'p', type: 'paragraph', content: [t('A '), chip('Old'), t(' see '), link('https://a.test', 'here'), t(' and '), wiki('author-ada', 'Ada')]}]
  const after = [{id: 'p', type: 'paragraph', content: [t('A '), chip('Hot'), t(' see '), link('https://b.test', 'here'), t(' and '), wiki('author-grace', 'Ada'), t(' '), chip('New', 'neutral')]}]
  const [d] = docDiff(before, after)
  const changed = d!.pieces.filter((x) => x.change !== 'same')
  // The edited chip, the relinked words and the retargeted internal link: each "formatted", with what it was.
  const edited = changed.find((x) => x.object?.text === 'Hot')!
  assert.equal(edited.change, 'formatted')
  assert.equal(edited.was?.object?.text, 'Old')
  const relinked = changed.find((x) => x.href === 'https://b.test')!
  assert.deepEqual([relinked.change, relinked.text, relinked.was?.href], ['formatted', 'here', 'https://a.test'])
  const retargeted = changed.find((x) => x.ref === 'author-grace')!
  assert.deepEqual([retargeted.change, retargeted.was?.ref], ['formatted', 'author-ada'])
  // The added chip is drawn, not dropped.
  assert.deepEqual(changed.filter((x) => x.change === 'added' && x.object).map((x) => x.object!.text), ['New'])
  // A removed chip.
  const [r] = docDiff(after, before)
  assert.deepEqual(r!.pieces.filter((x) => x.change === 'removed' && x.object).map((x) => x.object!.text), ['New'])
})
