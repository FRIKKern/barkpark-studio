import {test} from 'node:test'
import assert from 'node:assert/strict'
import {outboundIds} from './relations.ts'

test('the documents a paper points at: references and document links, once each, not itself', () => {
  const doc = {
    _publishedId: 'paper-01',
    author: {_type: 'reference', _ref: 'author-ada'},
    body: {blocks: [{type: 'paragraph', content: [{type: 'wikilink', docId: 'note-02', children: []}, {type: 'link', href: 'https://x'}]}, {type: 'paragraph', content: [{type: 'wikilink', docId: 'paper-01'}]}]},
    related: [{_ref: 'drafts.note-02'}, {_ref: 'post-01'}],
  }
  assert.deepEqual(outboundIds(doc, 'paper-01'), ['author-ada', 'note-02', 'post-01'])
})
