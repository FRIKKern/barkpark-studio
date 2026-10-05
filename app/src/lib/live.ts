import {useEffect} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import type {Doc} from './data'

type Frame = {documentId: string; type: string; mutation: string; result: Doc | null}

/**
 * Keep open panes live: one EventSource for the docs and list types on screen.
 * Each frame carries the document as it now reads (draft over published), so it
 * goes straight into the cache; deletes and discards refetch instead.
 */
export function useLive(ids: string[], types: string[]) {
  const qc = useQueryClient()
  const key = `ids=${[...new Set(ids)].sort().join(',')}&types=${[...new Set(types)].sort().join(',')}`
  const empty = ids.length + types.length === 0
  useEffect(() => {
    if (empty) return
    const es = new EventSource(`/api/listen?${key}`)
    es.addEventListener('mutation', (e) => {
      const f = JSON.parse((e as MessageEvent).data) as Frame
      const id = f.documentId.replace(/^drafts\./, '')
      if (!f.result || f.mutation === 'delete') {
        void qc.invalidateQueries({queryKey: ['doc', id]})
        void qc.invalidateQueries({queryKey: ['list', f.type]})
        return
      }
      const doc = f.result
      qc.setQueryData(['doc', id], doc)
      qc.setQueryData(['list', f.type], (docs: Doc[] | undefined) => docs?.map((d) => (d._publishedId === id ? doc : d)))
    })
    return () => es.close()
  }, [key, empty, qc])
}
