import {useEffect, useState} from 'react'
import {useQueries} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import type {Doc, Schema} from './data'
import type {Problem} from './validation'
import type {T} from './i18n'

// J28, Sanity's slug rule: a slug another document of the same type already has is an
// error ("Slug is already in use"), so a duplicate shows its copied slug as taken. Asked
// of Barkpark (drafts and published, `perspective=raw`) a moment after the typing stops.

const slugText = (v: unknown) => (typeof v === 'string' ? v : typeof (v as {current?: unknown})?.current === 'string' ? (v as {current: string}).current : '')

const fetchTaken = createServerFn({method: 'GET'})
  .validator((d: {type: string; field: string; value: string; id: string}) => d)
  .handler(async ({data}) => {
    const q = `perspective=raw&limit=5&filter[${encodeURIComponent(data.field)}][eq]=${encodeURIComponent(data.value)}`
    const res = await bpFetch(`/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?${q}`)
    if (!res.ok) return false // can't tell: say nothing rather than a false error
    const {result} = (await res.json()) as {result?: {documents?: {_publishedId?: string; _id: string}[]}}
    return (result?.documents ?? []).some((d) => (d._publishedId ?? d._id.replace(/^drafts\./, '')) !== data.id)
  })

/** The slug fields whose value another document of this type has, as errors. */
export function useSlugInUse(doc: Doc | null | undefined, schema: Schema | undefined, enabled: boolean, t: T): Problem[] {
  const fields = enabled && doc ? (schema?.fields ?? []).filter((f) => f.type === 'slug' && slugText(doc[f.name])) : []
  const now = fields.map((f) => slugText(doc![f.name])).join('\n')
  // Settled values only: no request per keystroke.
  const [settled, setSettled] = useState(now)
  useEffect(() => {
    const id = setTimeout(() => setSettled(now), 400)
    return () => clearTimeout(id)
  }, [now])
  const values = settled.split('\n')
  const taken = useQueries({
    queries: fields.map((f, i) => ({
      queryKey: ['slug-in-use', doc!._type, f.name, values[i] ?? '', doc!._publishedId],
      queryFn: () => fetchTaken({data: {type: doc!._type, field: f.name, value: values[i] ?? '', id: doc!._publishedId}}),
      enabled: !!values[i] && values[i] === slugText(doc![f.name]),
      staleTime: 10_000,
    })),
  })
  return fields.flatMap((f, i) =>
    taken[i]?.data && values[i] === slugText(doc![f.name])
      ? [{path: f.name, title: f.title ?? f.name, message: t('Slug is already in use'), level: 'error' as const, group: (f as {group?: string}).group}]
      : [],
  )
}
