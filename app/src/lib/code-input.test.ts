import {test} from 'node:test'
import assert from 'node:assert/strict'
import {changeBetween, CODE_LANGUAGES, codeDiffRows, codeLanguage, codeOf, codePreview, codeWrites, isCodeBlock, isCodeField, moveHighlights, toggleLine, withCodeChange} from './code-input.ts'

// The code field (Sanity's @sanity/code-input): its stored shape, languages, highlighted lines, preview and diff.

test('a code field is a composite named code; a block named code with other fields is not', () => {
  assert.equal(isCodeField({type: 'composite', namedType: 'code'}), true)
  assert.equal(isCodeField({type: 'composite'}), false)
  assert.equal(isCodeField({type: 'text', namedType: 'code'}), false)
  assert.equal(isCodeBlock('code'), true)
  assert.equal(isCodeBlock('code', [{name: 'language'}, {name: 'code'}]), true)
  assert.equal(isCodeBlock('code', [{name: 'promo'}]), false)
  assert.equal(isCodeBlock('callout'), false)
})

test('the language: stored, else options.language, else plain text; an unknown one colours as plain text', () => {
  assert.deepEqual(codeLanguage(undefined, {}).language, 'text')
  assert.equal(codeLanguage(undefined, {}).languages, CODE_LANGUAGES)
  assert.deepEqual(codeLanguage({}, {language: 'typescript'}), {language: 'typescript', mode: 'typescript', languages: CODE_LANGUAGES})
  assert.equal(codeLanguage({language: 'golang'}, {language: 'typescript'}).mode, 'golang')
  // Sanity's alias, stored or declared.
  assert.equal(codeLanguage({language: 'js'}, {}).mode, 'javascript')
  const own = {languageAlternatives: [{title: 'Javascript', value: 'js'}, {title: 'Rust', value: 'rust'}, {title: 'Zsh', value: 'zsh', mode: 'sh'}]}
  assert.deepEqual(codeLanguage({}, own).languages.map((l) => l.value), ['javascript', 'rust', 'zsh'])
  assert.equal(codeLanguage({language: 'zsh'}, own).mode, 'sh')
  // No mode for it: kept as stored, coloured as plain text, never a throw.
  assert.deepEqual([codeLanguage({language: 'rust'}, own).language, codeLanguage({language: 'rust'}, own).mode], ['rust', 'text'])
  assert.equal(codeLanguage({language: 'brainfuck'}, {}).mode, 'text')
})

test('a stored value reads as text and whole line numbers, whatever it holds', () => {
  assert.deepEqual(codeOf(undefined), {code: '', lines: []})
  assert.deepEqual(codeOf({_type: 'code', code: 'a\nb', highlightedLines: [2, 0, 1.5, 'x', 3]}), {code: 'a\nb', lines: [2, 3]})
  assert.deepEqual(codeOf('nope'), {code: '', lines: []})
})

test('a change writes its own subfield, Sanity-shaped: _type once, the language with the first code, empties unset', () => {
  // The first code typed into an empty field: the object's type, the picker's language, the code.
  assert.deepEqual(codeWrites(undefined, {code: 'x'}, {language: 'tsx'}), [['_type', 'code'], ['language', 'tsx'], ['code', 'x']])
  assert.deepEqual(codeWrites(undefined, {code: 'x'}, {}), [['_type', 'code'], ['language', 'text'], ['code', 'x']])
  // Afterwards the code alone, so another editor's language is never written over.
  assert.deepEqual(codeWrites({_type: 'code', language: 'php', code: 'x'}, {code: 'xy'}, {language: 'tsx'}), [['code', 'xy']])
  assert.deepEqual(codeWrites({_type: 'code', language: 'php', code: 'x'}, {code: ''}, {}), [['code', undefined]])
  assert.deepEqual(codeWrites({_type: 'code', code: 'x', language: 'php'}, {language: 'ruby'}, {}), [['language', 'ruby']])
  assert.deepEqual(codeWrites({_type: 'code'}, {filename: ''}, {}), [['filename', undefined]])
  assert.deepEqual(codeWrites({_type: 'code'}, {highlightedLines: [1, 3]}, {}), [['highlightedLines', [1, 3]]])
  // A block saved whole keeps every key it had (a Sanity import's own extras too).
  assert.deepEqual(withCodeChange({_type: 'code', _key: 'k', code: 'a', language: 'sh', extra: 1} as never, {code: ''}, {}), {_type: 'code', _key: 'k', language: 'sh', extra: 1})
  assert.deepEqual(withCodeChange({_key: 'k'}, {code: 'ls'}, {language: 'sh'}), {_key: 'k', _type: 'code', language: 'sh', code: 'ls'})
})

test('a line number toggles its highlight, kept in line order', () => {
  assert.deepEqual(toggleLine([], 3), [3])
  assert.deepEqual(toggleLine([3], 1), [1, 3])
  assert.deepEqual(toggleLine([1, 3], 3), [1])
})

const moved = (lines: number[], before: string, after: string) => moveHighlights(lines, before, [changeBetween(before, after)!], after)
test('highlighted lines follow their content through an edit, and go with a deleted line', () => {
  const code = 'one\ntwo\nthree\nfour'
  // A line added above pushes the highlight down; one removed above pulls it up.
  assert.deepEqual(moved([3], code, 'zero\none\ntwo\nthree\nfour'), [4])
  assert.deepEqual(moved([3], code, 'two\nthree\nfour'), [2])
  // Typing in the line, or below it, leaves it.
  assert.deepEqual(moved([2, 3], code, 'one\ntwo!\nthree\nfour'), [2, 3])
  assert.deepEqual(moved([2, 3], code, 'one\ntwo\nthree\nfour\nfive'), [2, 3])
  // Enter at the start of the highlighted line takes the highlight along with the content.
  assert.deepEqual(moved([3], code, 'one\ntwo\n\nthree\nfour'), [4])
  // The highlighted line deleted whole: its highlight goes, the others close up.
  assert.deepEqual(moveHighlights([2, 4], code, [{from: 4, to: 8, insert: 0}], 'one\nthree\nfour'), [3])
  // Emptied but still a line: kept.
  assert.deepEqual(moved([2], code, 'one\n\nthree\nfour'), [2])
  // Two highlighted lines joined into one are one highlight.
  assert.deepEqual(moved([2, 3], code, 'one\ntwothree\nfour'), [2])
  // Everything replaced (select all, paste): nothing left to follow.
  assert.deepEqual(moved([1, 3], code, ''), [])
  // Two carets typing at once (changes given apart): the line between them stays.
  assert.deepEqual(moveHighlights([2], 'a\nb\nc', [{from: 0, to: 0, insert: 2}, {from: 4, to: 4, insert: 2}], 'x\na\nb\nx\nc'), [3])
  assert.deepEqual(moveHighlights([9], 'a', [{from: 0, to: 0, insert: 1}], 'xa'), [])
})

test('a code value previews as its first line, then filename and language', () => {
  assert.deepEqual(codePreview({code: '\n  const a = 1\nconst b = 2', language: 'typescript', filename: 'a.ts'}), {title: 'const a = 1', subtitle: 'a.ts · TypeScript'})
  assert.deepEqual(codePreview({language: 'golang'}), {title: 'Go', subtitle: ''})
  assert.deepEqual(codePreview({filename: 'x.rb', language: 'ruby'}), {title: 'x.rb', subtitle: 'Ruby'})
  assert.deepEqual(codePreview({code: 'x', language: 'rust'}), {title: 'x', subtitle: 'rust'})
  assert.deepEqual(codePreview(undefined), {title: '', subtitle: ''})
  assert.equal(codePreview({code: 'x'.repeat(200)}).title.length, 80)
})

test('a code diff is rows: removed and added lines with their numbers, unchanged ones folded', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n')
  const after = ['a', 'b', 'c', 'd', 'e', 'F', 'g', 'h', 'i'].join('\n')
  assert.deepEqual(codeDiffRows(before, after, 1), [
    {kind: 'skip', count: 4},
    {kind: 'same', text: 'e', was: 5, now: 5},
    {kind: 'removed', text: 'f', was: 6},
    {kind: 'added', text: 'F', now: 6},
    {kind: 'same', text: 'g', was: 7, now: 7},
    {kind: 'same', text: 'h', was: 8, now: 8},
    {kind: 'added', text: 'i', now: 9},
  ])
  assert.deepEqual(codeDiffRows('', 'x\ny'), [{kind: 'added', text: 'x', now: 1}, {kind: 'added', text: 'y', now: 2}])
  assert.deepEqual(codeDiffRows('x', ''), [{kind: 'removed', text: 'x', was: 1}])
  assert.deepEqual(codeDiffRows('same', 'same'), [{kind: 'skip', count: 1}])
  // Past the work limit: the middle as removed then added, never a hang.
  assert.deepEqual(codeDiffRows('a\nb', 'c\nd', 2, 1).map((r) => r.kind), ['removed', 'removed', 'added', 'added'])
})
