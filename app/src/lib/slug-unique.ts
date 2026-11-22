import {useEffect, useState} from 'react'
import {useQueries, type QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import type {Doc, Schema} from './data'
import type {Problem} from './validation'
import type {T} from './i18n'
import {bulkSlugAsks, slugInQueries, slugQueries, slugText, takenAmong, takenByOther} from './slug-shape'

// J28, Sanity's slug rule: a slug another document of the same type already has is an
// error ("Slug is already in use"), so a duplicate shows its copied slug as taken. Asked
// of Barkpark (drafts and published, `perspective=raw`) a moment after the typing stops.
// A query Barkpark refuses is "can't tell" (null), never "free": the form says nothing then,
// and a publish is held (task-eee5e04cf67a1b23).

const fetchTaken = createServerFn({method: 'GET'})
  .validator((d: {type: string; field: string; value: string; id: string; fresh?: boolean}) => d)
  .handler(async ({data}) => {
    const answers = await Promise.all(slugQueries(data.field, data.value).map((q) => bpFetch(`/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?${q}`, {}, undefined, {fresh: data.fresh})))
    if (answers.some((res) => !res.ok)) return null // can't tell: no mark in the form, and a publish is held
    const found = await Promise.all(answers.map(async (res) => ((await res.json()) as {result?: {documents?: {_publishedId?: string; _id: string}[]}}).result?.documents ?? []))
    return takenByOther(found.flat(), data.id)
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

/**
 * Before a publish, Sanity's way: the slug fields another document of this type has, asked
 * fresh. The form's answer is kept 10 s, and someone may have taken the slug since; a
 * publish inside that window made a duplicate. Each answer goes to the form too (the mark).
 * `unknown`: the fields Barkpark could not answer for (a refused query); a publish waits.
 */
export async function slugsTakenNow(qc: QueryClient, doc: Doc, schema: Schema | undefined): Promise<{taken: string[]; unknown: string[]}> {
  const fields = (schema?.fields ?? []).filter((f) => f.type === 'slug' && slugText(doc[f.name]))
  const answers = await Promise.all(
    fields.map(async (f) => {
      const value = slugText(doc[f.name])
      const yes = await fetchTaken({data: {type: doc._type, field: f.name, value, id: doc._publishedId, fresh: true}})
      qc.setQueryData(['slug-in-use', doc._type, f.name, value, doc._publishedId], yes)
      return [f.title ?? f.name, yes] as const
    }),
  )
  return {taken: answers.flatMap(([title, yes]) => (yes ? [title] : [])), unknown: answers.flatMap(([title, yes]) => (yes === null ? [title] : []))}
}

const fetchTakenAmong = createServerFn({method: 'POST'})
  .validator((d: {type: string; field: string; picked: {id: string; value: string}[]}) => d)
  .handler(async ({data}) => {
    const found: Record<string, unknown>[] = []
    // One after another: a few reads, never a burst.
    for (const q of slugInQueries(data.field, data.picked.map((p) => p.value))) {
      const res = await bpFetch(`/v1/data/query/${dataset()}/${encodeURIComponent(data.type)}?${q}`, {}, undefined, {fresh: true})
      if (!res.ok) return null // can't tell: never "none taken" (slugsTakenAmong rejects)
      found.push(...(((await res.json()) as {result?: {documents?: Record<string, unknown>[]}}).result?.documents ?? []))
    }
    return [...takenAmong(found as {_id: string}[], data.field, data.picked)]
  })

/** A bulk publish's check, every picked doc at once (bulkSlugAsks): doc id → the slug fields taken. Rejects when Barkpark can't tell. */
export async function slugsTakenAmong(qc: QueryClient, docs: Doc[], schemaOf: (type: string) => Schema | undefined): Promise<Map<string, string[]>> {
  const slugFields = (type: string) => (schemaOf(type)?.fields ?? []).filter((f) => f.type === 'slug')
  const out = new Map<string, string[]>()
  for (const ask of bulkSlugAsks(docs, (type) => slugFields(type).map((f) => f.name))) {
    const answer = await fetchTakenAmong({data: ask})
    if (!answer) throw new Error('slug query refused')
    const taken = new Set(answer)
    const title = slugFields(ask.type).find((f) => f.name === ask.field)?.title ?? ask.field
    for (const p of ask.picked) {
      qc.setQueryData(['slug-in-use', ask.type, ask.field, p.value, p.id], taken.has(p.id))
      if (taken.has(p.id)) out.set(p.id, [...(out.get(p.id) ?? []), title])
    }
  }
  return out
}
