import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compareRanks, isRank, rankAfter, rankAtEnd, rankBatches, rankBetween, rankMove, rankMoveOf, rankedInOrder, sessionLost, spreadRanks} from './order-rank.ts'

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

test('rows without a rank, or out of order, are healed by the first move: every row ranked in the new order', () => {
  for (const ranks of [[undefined, undefined, undefined], ['0|hzzzzz:', undefined, null], ['0|i00007:', '0|hzzzzz:', '0|i0000f:'], ['b', 'a', 'c']]) {
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

test('a tie is undone where it is met: the tied rows and the moved one, never the whole list', () => {
  // Two editors dropped into one gap: rows 2 and 3 share a rank, in a list of six.
  const ranks = ['0|a00000:', '0|c00000:', '0|c00000:', '0|e00000:', '0|g00000:', '0|i00000:']
  const apply = (writes: {at: number; rank: string}[]) => ranks.map((r, i) => writes.find((w) => w.at === i)?.rank ?? r)
  // A move elsewhere in the list is still one write.
  assert.deepEqual(rankMove(ranks, 5, 3).map((w) => w.at), [5])
  assert.ok(rankMove(ranks, 5, 3)[0]!.rank > '0|c00000:' && rankMove(ranks, 5, 3)[0]!.rank < '0|e00000:')
  // Next to the tie, on its outside: one write.
  assert.deepEqual(rankMove(ranks, 5, 1).map((w) => w.at), [5])
  // Dropped between the tied rows: those two and the moved row, strictly between their neighbours; the other three keep theirs.
  const writes = rankMove(ranks, 5, 2)
  assert.deepEqual(writes.map((w) => w.at), [1, 5, 2])
  const after = apply(writes)
  assert.ok(rankedInOrder([after[0], after[1], after[5], after[2], after[3], after[4]]), JSON.stringify(after))
  // A whole list on one rank (ranks apart only by trailing zeros count as one).
  const same = ['0|c00000:', '0|c00000:0', '0|c00000:']
  const all = rankMove(same, 2, 1)
  const healed = same.map((r, i) => all.find((w) => w.at === i)?.rank ?? r)
  assert.ok(rankedInOrder([healed[0], healed[2], healed[1]]), JSON.stringify(healed))
})

test('a drop names its row: if another row sits at that index now, nothing is moved', () => {
  const rows = SANITY.map((rank, i) => ({id: `doc-${i}`, rank}))
  assert.deepEqual(rankMoveOf(rows, 'doc-2', 2, 0).map((w) => w.id), ['doc-2'])
  // Someone else's row arrived on top while the drag was on its way: index 2 is now doc-1.
  const shifted = [{id: 'new', rank: '0|a00000:'}, ...rows]
  assert.deepEqual(rankMoveOf(shifted, 'doc-2', 2, 0), [])
  assert.deepEqual(rankMoveOf(rows.slice(0, 2), 'doc-2', 2, 0), [])
})

test('a copy is ranked right after its source; a long list goes to Barkpark in parts', () => {
  const copy = rankAfter('0|i00007:', SANITY)
  strictlyBetween('0|i00007:', copy, '0|i0000f:')
  assert.equal(rankAfter('0|i0000n:', SANITY), '0|i0000v:')
  assert.equal(rankAfter(undefined, SANITY), null)
  // Others tied with the source: the copy goes after them all.
  strictlyBetween('0|i00007:', rankAfter('0|i00007:', ['0|i00007:', '0|i00007:0', '0|i0000f:']), '0|i0000f:')
  const parts = rankBatches(spreadRanks(2000))
  assert.deepEqual(parts.map((p) => p.length), [500, 500, 500, 500])
  assert.ok(parts.every((p) => p.length <= 1000))
  assert.deepEqual(rankBatches([1, 2, 3], 2), [[1, 2], [3]])
  assert.deepEqual(rankBatches([]), [])
  // A lost session is not a failed move (J48); a refused studio token and a 500 are.
  assert.ok(sessionLost('mutate 401: {"error":{"code":"session_lost","message":"You\'ve been logged out"}}'))
  assert.ok(!sessionLost('mutate 401: {"error":{"code":"token_refused"}}') && !sessionLost('mutate 500: {"error":{"code":"internal_error"}}'))
})
