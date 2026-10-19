import {useEffect, useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {ensureAnyDocs, ensureDocs} from './data'

/** Ids per batch read: twice as many in its query (each id and its draft), within its limit of 400. */
export const PRIME_BATCH = 100

/**
 * Rows that each show a document read them in batches first, and a row reads alone
 * (`enabled: primed(id)`) only once its batch is done. One read per row was the Releases
 * stall (task-5daa76356a9876bc): 500 rows, 500 reads at once on the studio's token, past
 * Barkpark's 300 a minute and 5 a second, and every other call waited out the 429s.
 *
 * `types` null: the type is not known (a task's target, a wikilink), read through
 * `anyDocQuery`'s cache. A failed batch still marks its ids, so its rows read alone; a doc
 * a batch did not find is cached as null, so its row shows it missing without a read.
 */
export function usePrimed(items: {types: string[] | null; id: string}[]): (id: string) => boolean {
  const qc = useQueryClient()
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())
  const key = items.map((x) => `${x.types?.join(',') ?? '*'}:${x.id}`).join(' ')
  useEffect(() => {
    const byTypes = new Map<string, string[]>()
    for (const {types, id} of items) {
      if (!id || done.has(id)) continue
      const k = types?.join(',') ?? '*'
      byTypes.set(k, [...new Set([...(byTypes.get(k) ?? []), id])])
    }
    if (!byTypes.size) return
    let live = true
    const batches = [...byTypes].flatMap(([k, ids]) => Array.from({length: Math.ceil(ids.length / PRIME_BATCH)}, (_, i) => [k, ids.slice(i * PRIME_BATCH, (i + 1) * PRIME_BATCH)] as const))
    void (async () => {
      for (const [k, ids] of batches) {
        await (k === '*' ? ensureAnyDocs(qc, ids) : ensureDocs(qc, k.split(','), ids)).catch(() => {})
        if (!live) return
        setDone((d) => new Set([...d, ...ids]))
      }
    })()
    return () => void (live = false)
  }, [key]) // the items, by identity
  return (id) => done.has(id)
}
