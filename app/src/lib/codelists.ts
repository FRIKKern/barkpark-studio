import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch} from '../server/barkpark'

// B05: a codelist's codes, read from Barkpark (`GET /v1/codelists/<plugin>:<name>`,
// the latest issue, labels in the first language that has one). A flat list is roots
// without children; Thema is a ~9k-code tree, read once and searched here, as
// Barkpark's own Studio does.

export type Code = {value: string; label: string; children: Code[]}
export type Codelist = {codelistId: string; name: string; issue?: string; values: Code[]}

const fetchCodelist = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    // The id keeps its colon: Barkpark splits `<plugin>:<name>` on the first one.
    const res = await bpFetch(`/v1/codelists/${data.id.split(':').map(encodeURIComponent).join(':')}?lang=nob,eng`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Barkpark codelist ${data.id} → ${res.status}`)
    const {codelistId, name, issue, values} = (await res.json()) as Codelist
    return {codelistId: codelistId ?? data.id, name, issue, values}
  })

/** null: no codelist is registered under that id. */
export const codelistQuery = (id: string) =>
  queryOptions({queryKey: ['codelist', id], staleTime: Infinity, queryFn: async () => (await fetchCodelist({data: {id}})) as Codelist | null})

/** Every code with its ancestors, depth first in the list's own order. */
export function flatten(values: Code[], path: Code[] = []): {code: Code; path: Code[]}[] {
  return values.flatMap((code) => [{code, path}, ...flatten(code.children, [...path, code])])
}

/** At most `max` codes whose code or label contains `q` (any case), as Barkpark's Studio matches. */
export function search(all: {code: Code; path: Code[]}[], q: string, max = 200) {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const out: {code: Code; path: Code[]}[] = []
  for (const hit of all) {
    if (hit.code.value.toLowerCase().includes(needle) || hit.code.label.toLowerCase().includes(needle)) out.push(hit)
    if (out.length === max) break
  }
  return out
}
