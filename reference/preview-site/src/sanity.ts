import {createClient} from '@sanity/client'
import {useEffect, useState} from 'react'
import {useQuery, type QueryResponseInitial} from '@sanity/react-loader'
import type {QueryParams} from '@sanity/client'

declare const __STUDIO_URL__: string
declare const __DATASET__: string

// Token-less: in Presentation the Studio runs the queries and streams results here.
export const liveClient = createClient({
  projectId: 'ecu57yeh',
  dataset: __DATASET__,
  apiVersion: '2025-02-19',
  useCdn: false,
  stega: {enabled: true, studioUrl: __STUDIO_URL__},
})

export const draftMode = /(?:^|;\s*)preview-perspective=/.test(document.cookie)

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

export function useLiveData<T>(query: string, params: QueryParams, initial: QueryResponseInitial<T>) {
  return useQuery<T>(query, params, {initial}).data
}
