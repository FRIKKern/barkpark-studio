// J06: a Portable Text span's typing as Sanity's diffMatchPatch (node --test).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {applyPatches, parsePatch} from '@sanity/diff-match-patch'
import {mergeText} from './merge.ts'
import {carriesPatch, DMP_LIMITS, DMP_SETTLE_MS, DMP_TTL_MS, landingUnsure, patchMayGo, settledAt, settleDmp, spanPatch, splitDmp} from './pt-dmp.ts'

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

test('a hunk that did not land goes again as a set; one that may have landed is never put in twice', () => {
  // They rewrote the text my hunk sat in: Barkpark skips the hunk and answers with theirs.
  const base = 'Steep it for three minutes at most.'
  const sent = 'Steep it for three long minutes at most.'
  assert.equal(server(spanPatch(base, sent)!.text, 'Boil.'), 'Boil.')
  // What it inserted is nowhere in the answer: it did not land.
  assert.deepEqual(settleDmp(base, sent, 'Boil.'), {value: 'Boil. long', missing: true, ignored: false})
  // The same letters are somewhere else in their text: the answer alone cannot say, and
  // without more the words are not put in again (a guess there typed words twice).
  const theirs = 'Boil for as long as it takes.'
  assert.equal(server(spanPatch(base, sent)!.text, theirs), theirs)
  assert.equal(landingUnsure(base, sent, theirs), true)
  assert.equal(settleDmp(base, sent, theirs)!.value, theirs)
  // The text just before the patch (read from the history) says it did not land.
  assert.deepEqual(settleDmp(base, sent, theirs, undefined, theirs), {value: `${theirs} long`, missing: true, ignored: false})
  // A server that ignores the op (older than Barkpark #24688) answers with the text as it was.
  assert.deepEqual(settleDmp(base, sent, base, `${sent} Yes`), {value: `${sent} Yes`, missing: true, ignored: true})
})

test('two editors each add a short word at one spot: the answer stands, nothing typed twice', () => {
  // Review 1251b: the first cut asked "are my words in the answer?" by taking the patch out
  // and putting it back, which fails beside the other editor's word, and typed mine again.
  const answer = server(spanPatch('Pour slowly', 'Pour slowly fr')!.text, 'Pour slowly a')
  assert.equal(answer, 'Pour slowly a fr')
  assert.equal(settleDmp('Pour slowly', 'Pour slowly fr', answer)!.value, answer)
  const base = 'Pour slowly one'
  const words = [' a', ' so', ' at', ' it', ' is', ' we', ' go', ' from', ' and', ' then', ' two', ' now', ' tea']
  for (const mine of words)
    for (const theirs of words) {
      if (mine === theirs) continue
      const saved = server(spanPatch(base, base + mine)!.text, base + theirs)
      for (const before of [undefined, base + theirs]) {
        const fix = settleDmp(base, base + mine, saved, undefined, before)
        assert.deepEqual([fix?.value, fix?.missing], [saved, false], `${mine} beside ${theirs}`)
      }
    }
  // Typing far from theirs needs no second look.
  assert.equal(landingUnsure('Pour slowly from a height', 'Pour slowly from a great height', 'Pour gently slowly from a great height'), false)
})

test('keystroke-sized edits at every caret distance: none of mine lost, none typed twice', () => {
  // The reviewer's fuzz, cut down. I type A-H, they type S-Z, the text is lower case.
  let seed = 5
  const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), (seed >>> 12) % n)
  const WORDS = ['tea', 'kettle', 'pour', 'slowly', 'blå', 'a', 'the', 'warm', 'cup', 'of', 'steep', 'øl', 'water', 'from', 'height', 'and', 'gently', 'it']
  const letters = (abc: string, n: number) => Array.from({length: n}, () => abc[rnd(abc.length)]).join('')
  const op = (text: string, at: number, abc: string, max: number) => {
    const k = rnd(10)
    if (k < 7) return text.slice(0, at) + (rnd(4) === 0 ? ' ' : '') + letters(abc, 1 + rnd(max)) + text.slice(at)
    const n = Math.min(at, 1 + rnd(k < 9 ? 2 : 5))
    return text.slice(0, at - n) + (k < 9 ? '' : letters(abc, 1 + rnd(max))) + text.slice(at)
  }
  const mine = (s: string) => (s.match(/[A-H]/g) ?? []).length
  let ran = 0
  for (let i = 0; i < 6000; i++) {
    const base = Array.from({length: 5 + rnd(10)}, () => WORDS[rnd(WORDS.length)]).join(' ')
    const at = rnd(base.length + 1)
    const gap = [0, 1 + rnd(4), 5 + rnd(8), 13 + rnd(30)][rnd(4)]!
    const theirAt = rnd(2) ? at + gap : at - gap
    if (theirAt < 0 || theirAt > base.length) continue
    const sent = op(base, at, 'ABCDEFGH', 4)
    const held = op(base, theirAt, 'STUVWXYZ', 8)
    const patch = spanPatch(base, sent)
    if (!patch || held === base) continue
    const saved = server(patch.text, held)
    const fix = settleDmp(base, sent, saved, undefined, landingUnsure(base, sent, saved) ? held : undefined)
    assert.equal(mine(fix ? fix.value : saved), mine(sent), JSON.stringify({base, sent, held, saved, fix}))
    ran++
  }
  assert.ok(ran > 3000)
})

test('a held patch is given up before the text goes again as a set', () => {
  assert.equal(carriesPatch([{patch: {id: 'a', set: {}, diffMatchPatch: {'body[_key=="b"].children[_key=="s"].text': '@@ -1 +1,2 @@\n a\n+b\n'}}}]), true)
  assert.equal(carriesPatch([{patch: {id: 'a', set: {title: 'x'}}}, {patch: {id: 'a', diffMatchPatch: {}}}]), false)
  // The studio's server holds a write for `held` ms (a 429's wait, a slow link); the browser
  // gave up `failed` ms after sending and sends the set at the later of its 2 s retry and
  // settledAt. Whatever the hold: the patch went on before its time was up, or not at all,
  // and the set never goes while the patch may still be forwarded.
  for (const held of [0, 300, 2_000, DMP_TTL_MS - 1, DMP_TTL_MS, 3_000, 4_000, 15_000])
    for (const failed of [50, 300, 1_900, 5_000]) {
      const setGoesAt = Math.max(failed + 2_000, settledAt(0))
      const forwarded = patchMayGo(0, held, false)
      assert.ok(!forwarded || held < DMP_TTL_MS, `held ${held}`)
      assert.ok(setGoesAt >= DMP_TTL_MS + 1_000, `the set waits out the patch (failed at ${failed})`)
    }
  assert.equal(patchMayGo(0, 10, true), false) // the page is gone: not forwarded at all
  assert.ok(DMP_SETTLE_MS - DMP_TTL_MS >= 1_000)
})

test('a merge onto text whose letters moved the byte offsets does not throw', () => {
  // On main: "Failed to determine byte offset" (the patch's offset fell inside their emoji).
  assert.equal(mergeText('tea warm of a æøå', 'tea warm of a æøå x', 'æøå 😀  of a æøå'), 'æøå 😀  of a æøå x')
})
