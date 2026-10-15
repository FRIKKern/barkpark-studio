// Review changes for an array (J15 widen), as Sanity's array diff: each item marked
// added, removed or moved; unchanged ones kept. Items are matched by `_key` (objects
// and references) or by value (strings, numbers). Pure: array-diff.test.ts.

export type ItemChange<T> = {item: T; kind: 'added' | 'removed' | 'moved' | 'kept'}

const keysOf = <T,>(items: T[]) => {
  const seen = new Map<string, number>()
  return items.map((x) => {
    const own = x && typeof x === 'object' && typeof (x as {_key?: unknown})._key === 'string' ? `k:${(x as unknown as {_key: string})._key}` : `v:${JSON.stringify(x)}`
    const n = seen.get(own) ?? 0
    seen.set(own, n + 1)
    return n ? `${own}#${n}` : own
  })
}

/** The after list in order (added, moved or kept), then what was removed. */
export function arrayDiff<T>(before: T[], after: T[]): ItemChange<T>[] {
  const b = keysOf(before)
  const a = keysOf(after)
  const inB = new Set(b)
  const inA = new Set(a)
  // Kept items that keep their relative order: the longest common subsequence of the
  // keys both lists hold. Any other kept item moved.
  const kb = b.filter((k) => inA.has(k))
  const ka = a.filter((k) => inB.has(k))
  const lcs: number[][] = Array.from({length: kb.length + 1}, () => Array(ka.length + 1).fill(0))
  for (let i = kb.length - 1; i >= 0; i--)
    for (let j = ka.length - 1; j >= 0; j--) lcs[i]![j] = kb[i] === ka[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const stay = new Set<string>()
  for (let i = 0, j = 0; i < kb.length && j < ka.length; )
    if (kb[i] === ka[j]) (stay.add(kb[i]!), i++, j++)
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++
    else j++
  return [
    ...after.map((item, i): ItemChange<T> => ({item, kind: !inB.has(a[i]!) ? 'added' : stay.has(a[i]!) ? 'kept' : 'moved'})),
    ...before.flatMap((item, i): ItemChange<T>[] => (inA.has(b[i]!) ? [] : [{item, kind: 'removed'}])),
  ]
}
