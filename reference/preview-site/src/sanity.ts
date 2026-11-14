import {createClient} from '@sanity/client'
import {useEffect, useState} from 'react'
import {useQuery, type QueryResponseInitial} from '@sanity/react-loader'
import type {QueryParams} from '@sanity/client'
import {reportDocuments} from './barkpark'

declare const __STUDIO_URL__: string
declare const __DATASET__: string
declare const __API_HOST__: string

/** PREVIEW_SOURCE=sanity-on-barkpark: this same client, pointed at Barkpark's Sanity-compatible API. */
export const onBarkpark = !!__API_HOST__

// Token-less: in Presentation the Studio runs the queries and streams results here.
export const liveClient = createClient({
  projectId: 'ecu57yeh',
  dataset: __DATASET__,
  apiVersion: '2025-02-19',
  useCdn: false,
  ...(onBarkpark && {apiHost: __API_HOST__, useProjectHostname: false}),
  stega: {enabled: true, studioUrl: __STUDIO_URL__},
})

// On Barkpark there is no draft-mode cookie: the page is live inside a studio's frame.
export const draftMode = onBarkpark ? window.parent !== window : /(?:^|;\s*)preview-perspective=/.test(document.cookie)

// First paint comes from the server proxy; live mode takes over inside Presentation.
export function useLoad<T>(query: string, params: QueryParams = {}) {
  const key = query + JSON.stringify(params)
  const [initial, setInitial] = useState<{key: string; value: QueryResponseInitial<T>} | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/query', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({query, params})})
      .then((r) => r.json())
      .then((value) => {
        if (!live) return
        if (value.error) setError(value.error)
        else setInitial({key, value})
      })
    return () => void (live = false)
  }, [key])
  return {initial: initial?.key === key ? initial.value : null, error}
}

export function useLiveData<T>(query: string, params: QueryParams, initial?: QueryResponseInitial<T>): T | undefined {
  const {data, sourceMap} = useQuery<T>(query, params, {initial} as {initial: QueryResponseInitial<T>})
  // Barkpark Studio's "Documents on this page" (J61): what this page's query read.
  // In the order the page shows them: the source map's mappings follow the result.
  const at = (key: string) => (key.match(/\d+/g) ?? []).map(Number)
  const byPosition = Object.entries(sourceMap?.mappings ?? {}).sort(([a], [b]) => {
    const [x, y] = [at(a), at(b)]
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1)
    return 0
  })
  const order = [...new Set(byPosition.map(([, m]) => (m.source.type === 'documentValue' ? m.source.document : -1)))]
  const docs = order.flatMap((i) => (sourceMap?.documents[i] ? [{_id: sourceMap.documents[i]._id.replace(/^drafts\./, ''), _type: sourceMap.documents[i]._type!}] : []))
  const ids = docs.map((d) => d._id).join(',')
  useEffect(() => void (onBarkpark || reportDocuments(docs)), [ids])
  return data
}
