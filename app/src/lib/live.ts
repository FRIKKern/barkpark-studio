import {useEffect} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import type {Doc} from './data'
import {applyServer} from './edits'

type Frame = {documentId: string; type: string; mutation: string; result: Doc | null}

/**
 * Keep open panes live: one EventSource for the docs and list types on screen.
 * Each frame carries the document as it now reads (draft over published), so it
 * goes into the cache (under any unsent local edits); deletes and discards refetch.
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
      applyServer(qc, f.result)
    })
    return () => es.close()
  }, [key, empty, qc])
}
