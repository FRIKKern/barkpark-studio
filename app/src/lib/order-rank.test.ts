import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compareRanks, isRank, rankAtEnd, rankBetween, rankMove, rankedInOrder, spreadRanks} from './order-rank.ts'

// Sanity's own ranks (the `lexorank` package: middle, genNext, between), as an imported dataset holds them.
const SANITY = ['0|hzzzzz:', '0|i00007:', '0|i0000f:', '0|i0000n:']
const strictlyBetween = (lo: string, mid: string | null, hi: string) => assert.ok(mid && isRank(mid) && lo < mid && mid < hi, `${lo} < ${mid} < ${hi}`)

test('a rank between two neighbours sorts strictly between them, by plain string comparison', () => {
  strictlyBetween('0|hzzzzz:', rankBetween('0|hzzzzz:', '0|i00007:'), '0|i00007:')
  // No whole step left between them: more digits after the colon.
  strictlyBetween('0|i00007:', rankBetween('0|i00007:', '0|i00008:'), '0|i00008:')
  strictlyBetween('0|i00007:', rankBetween('0|i00007:', '0|i00007:i'), '0|i00007:i')
  strictlyBetween('0|i00007:zz', rankBetween('0|i00007:zz', '0|i00008:'), '0|i00008:')
  // Equal, out of order, another bucket or not a rank: nothing to give (the list is ranked anew).
  assert.equal(rankBetween('0|i00007:', '0|i00007:'), null)
  assert.equal(rankBetween('0|i00008:', '0|i00007:'), null)
  assert.equal(rankBetween('0|i00007:', '1|i00008:'), null)
  assert.equal(rankBetween('seven', '0|i00007:'), null)
})

test('before the first and after the last, as LexoRank steps; an empty list starts in the middle', () => {
  assert.equal(rankBetween(undefined, undefined), '0|hzzzzz:')
  assert.equal(rankBetween('0|hzzzzz:', undefined), '0|i00007:') // genNext
  assert.equal(rankBetween(undefined, '0|i00007:'), '0|hzzzzz:') // genPrev
  // Decimals are dropped for the whole step, and the result still sorts outside.
  assert.ok(rankBetween('0|i00007:zz', undefined)! > '0|i00007:zz')
  assert.ok(rankBetween(undefined, '0|i00007:zz')! < '0|i00007:zz')
  // At the ends of the rank space there is still room.
  strictlyBetween('0|zzzzzz:', rankBetween('0|zzzzzz:', undefined), '0|zzzzzz:~')
  strictlyBetween('0|000000:', rankBetween(undefined, '0|000003:'), '0|000003:')
  assert.equal(rankBetween(undefined, '0|000000:'), null)
  assert.equal(rankAtEnd(['0|i00007:', undefined, '0|hzzzzz:']), '0|i0000f:')
  assert.equal(rankAtEnd([]), '0|hzzzzz:')
})

test('200 inserts at one spot never collide or run out of room', () => {
  for (const side of ['after the first', 'before the last', 'at the start', 'at the end'] as const) {
    let [lo, hi] = ['0|hzzzzz:', '0|i00007:']
    const seen = new Set([lo, hi])
    for (let i = 0; i < 200; i++) {
      const mid = side === 'at the start' ? rankBetween(undefined, lo) : side === 'at the end' ? rankBetween(hi, undefined) : rankBetween(lo, hi)
      assert.ok(mid && isRank(mid) && !seen.has(mid), `${side} #${i}: ${mid}`)
      if (side === 'at the start') assert.ok(mid < lo), (lo = mid)
      else if (side === 'at the end') assert.ok(mid > hi), (hi = mid)
      else {
        strictlyBetween(lo, mid, hi)
        if (side === 'after the first') hi = mid
        else lo = mid
      }
      seen.add(mid)
    }
    assert.ok(Math.max(lo.length, hi.length) < 64, `${side}: ranks stay short (${Math.max(lo.length, hi.length)})`)
  }
})

test('a move in a ranked list writes one rank; Sanity\'s ranks stay in step with ours', () => {
  assert.ok(rankedInOrder(SANITY))
  // Row three above row one.
  const [w, ...rest] = rankMove(SANITY, 2, 0)
  assert.deepEqual(rest, [])
  assert.equal(w!.at, 2)
  assert.ok(w!.rank < SANITY[0]!)
  // Row one to between three and four; the list then sorts 2, 3, 1, 4.
  const [m] = rankMove(SANITY, 0, 2)
  const moved = SANITY.map((r, i) => (i === 0 ? m!.rank : r))
  assert.deepEqual([0, 1, 2, 3].sort((a, b) => compareRanks(moved[a], moved[b])), [1, 2, 0, 3])
  assert.deepEqual(rankMove(SANITY, 1, 1), [])
})

test('rows without a rank, or with the same one, are healed by the first move: every row ranked in the new order', () => {
  for (const ranks of [[undefined, undefined, undefined], ['0|hzzzzz:', undefined, null], ['0|hzzzzz:', '0|hzzzzz:', '0|i00007:'], ['b', 'a', 'c']]) {
    assert.ok(!rankedInOrder(ranks))
    const writes = rankMove(ranks, 2, 0)
    const after = ranks.map((r, i) => writes.find((x) => x.at === i)?.rank ?? r)
    assert.ok(rankedInOrder([after[2], after[0], after[1]]), JSON.stringify(after))
  }
  // Unranked rows sort last, as Barkpark's `order=orderRank:asc` puts them.
  assert.deepEqual(['', '0|i00007:', null, '0|hzzzzz:'].sort(compareRanks).slice(0, 2), ['0|hzzzzz:', '0|i00007:'])
  assert.equal(compareRanks(undefined, '0|hzzzzz:'), 1)
  const spread = spreadRanks(2000)
  assert.ok(rankedInOrder(spread) && new Set(spread).size === 2000)
})
