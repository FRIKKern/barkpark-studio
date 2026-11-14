// J06: a Portable Text span's typing as Sanity's diffMatchPatch (node --test).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {applyPatches, parsePatch} from '@sanity/diff-match-patch'
import {mergeText} from './merge.ts'
import {DMP_LIMITS, settleDmp, spanPatch, splitDmp} from './pt-dmp.ts'

const SPAN = 'body[_key=="b1"].children[_key=="s1"].text'
/** What Barkpark does with a patch text: @sanity/diff-match-patch's apply, onto the text it holds. */
const server = (patch: string, held: string) => applyPatches(parsePatch(patch), held, {allowExceedingIndices: true})[0]

test('the patch counts UTF-8 bytes in its headers, as Sanity writes them (æøå, an emoji)', () => {
  const base = 'Pour slowly æøå 😀 end'
  const p = spanPatch(base, 'Pour slowly æøå 😀🎉 end from a height')!
  // The same text the deployed Barkpark took in the probe (PR body): 16 UTF-16 units in, byte 17.
  assert.equal(p.text, '@@ -17,11 +17,29 @@\n %C3%A5 %F0%9F%98%80\n+%F0%9F%8E%89\n  end\n+ from a height\n')
  assert.equal(p.hunks, 1)
  assert.equal(p.bytes, new TextEncoder().encode(p.text).length)
  // The other editor wrote before it landed: both stay.
  assert.equal(server(p.text, 'Pour gently slowly æøå 😀 end'), 'Pour gently slowly æøå 😀🎉 end from a height')
  // An emoji swapped for another (they share a surrogate half) still reads back whole.
  assert.equal(server(spanPatch('a😀b', 'a😁b')!.text, 'a😀b'), 'a😁b')
  assert.equal(spanPatch('same', 'same'), null)
  assert.equal(spanPatch(undefined, 'no base'), null)
})

test('one save: span texts with a base go as patches, the rest as sets', () => {
  const base = new Map<string, unknown>([[SPAN, 'Pour slowly'], ['title', 'Tea']])
  // Three keys batched before the flush: one patch, from what Barkpark had to the text now.
  const fields = new Map<string, unknown>([[SPAN, 'Pour slowly abc'], ['title', 'Tea notes'], ['body[_key=="b2"]', {_key: 'b2'}], ['body[_key=="b3"].children[_key=="s"].text', 'new span']])
  const {sets, dmp} = splitDmp(fields, base)
  assert.deepEqual(Object.keys(dmp), [SPAN])
  assert.equal(server(dmp[SPAN]!, 'Pour slowly'), 'Pour slowly abc')
  assert.deepEqual([...sets.keys()], ['title', 'body[_key=="b2"]', 'body[_key=="b3"].children[_key=="s"].text']) // no base: a set
  // A write that got no answer may have landed: a patch sent again would type it twice.
  assert.deepEqual(splitDmp(fields, base, (f) => f === SPAN).dmp, {})
  // Past Barkpark's limits (it would answer 422): a set.
  const long = 'x'.repeat(DMP_LIMITS.textUnits)
  assert.deepEqual(splitDmp(new Map([[SPAN, `${long}!`]]), new Map([[SPAN, long]])).dmp, {})
  const many = Array.from({length: 120}, (_, i) => `word${i} lorem ipsum dolor sit amet consectetur`)
  assert.deepEqual(splitDmp(new Map([[SPAN, many.map((w) => `X${w}`).join(' ')]]), new Map([[SPAN, many.join(' ')]])).dmp, {})
})

test('keys typed while a save is on its way, and the other editor in between: every word once', () => {
  const base = 'Pour slowly'
  const sent = 'Pour slowly from' // my flush
  const typed = 'Pour slowly from a height' // typed on while it was on its way
  const theirs = 'Pour gently slowly' // landed at Barkpark before my flush did
  const saved = server(spanPatch(base, sent)!.text, theirs)
  assert.equal(saved, 'Pour gently slowly from')
  const fix = settleDmp(base, sent, saved, typed)!
  assert.deepEqual(fix, {value: 'Pour gently slowly from a height', missing: false, ignored: false})
  // The next patch is measured from the answer, never from text Barkpark did not have; they
  // have typed again meanwhile.
  assert.equal(server(spanPatch(saved, fix.value)!.text, 'Pour gently and slowly from'), 'Pour gently and slowly from a height')
  // Nothing typed since, theirs in the answer: nothing left to send.
  assert.equal(settleDmp(base, sent, saved)!.value, saved)
  // The answer is what was sent (nobody else wrote), or the span is gone: nothing to do.
  assert.equal(settleDmp(base, sent, sent, typed), null)
  assert.equal(settleDmp(base, sent, undefined, typed), null)
})

test('a patch whose words did not land goes again as a set, no word dropped', () => {
  // They rewrote the text my hunk sat in: Barkpark skips the hunk and answers with theirs.
  const base = 'Steep it for three minutes at most.'
  const sent = 'Steep it for three long minutes at most.'
  const theirs = 'Boil.'
  assert.equal(server(spanPatch(base, sent)!.text, theirs), theirs)
  const fix = settleDmp(base, sent, theirs)!
  assert.equal(fix.missing, true)
  assert.match(fix.value, /^Boil\./)
  assert.match(fix.value, /long/)
  // A server that ignores the op (older than Barkpark #24688) answers with the text as it was.
  assert.deepEqual(settleDmp(base, sent, base, `${sent} Yes`), {value: `${sent} Yes`, missing: true, ignored: true})
})

test('a merge onto text whose letters moved the byte offsets does not throw', () => {
  // On main: "Failed to determine byte offset" (the patch's offset fell inside their emoji).
  assert.equal(mergeText('tea warm of a æøå', 'tea warm of a æøå x', 'æøå 😀  of a æøå'), 'æøå 😀  of a æøå x')
})
