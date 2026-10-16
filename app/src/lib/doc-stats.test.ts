import {test} from 'node:test'
import assert from 'node:assert/strict'
import {docStats} from './doc-stats.ts'

test("words and blocks, as LiveView's freeform footer counts them", () => {
  // note-01 as Barkpark projects it: its two field blocks, a heading and two paragraphs.
  const note = [
    {id: 'f1', type: 'field-string', fieldName: 'title', value: 'Fixture note 01'},
    {id: 'f2', type: 'field-string', fieldName: 'label', value: 'Idea'},
    {id: 'h', type: 'heading', level: 2, content: [{type: 'text', value: 'Freeform main'}]},
    {id: 'p1', type: 'paragraph', content: [{type: 'text', value: 'A note opens in the canvas; its title and label are field blocks.'}]},
    {id: 'p2', type: 'paragraph', content: [{type: 'text', value: 'See '}, {type: 'wikilink', children: [{type: 'text', value: 'the second note'}]}, {type: 'text', value: ' and '}, {type: 'link', children: [{type: 'text', value: 'an outside page'}]}, {type: 'text', value: '.'}]},
  ]
  // LiveView's 28: runs are joined with a space, so the closing "." counts as a word too.
  assert.deepEqual(docStats(note), {words: 28, blocks: 5})
  assert.deepEqual(docStats([{type: 'section', title: 'Two words', blocks: [{type: 'paragraph', text: 'three more here'}]}, {type: 'action', label: 'Go'}]), {words: 6, blocks: 2})
  assert.deepEqual(docStats(undefined), {words: 0, blocks: 0})
})
