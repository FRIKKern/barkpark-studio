import type {Schema} from '../lib/data'
import {collate, type T} from '../lib/i18n'
import {english} from '../lib/search-filters'

// The search's order and type labels, which the search box draws before its filters
// row (recent searches): out of SearchFilters.tsx, which is a chunk of its own (Panels.tsx).

export type SearchSort = 'best' | 'createdAsc' | 'createdDesc' | 'updatedAsc' | 'updatedDesc'
// Groups split by a divider, as Sanity's menu.
export const SORTS: [SearchSort, string][][] = [
  [['best', 'Best match']],
  [['createdAsc', 'Created: Oldest first'], ['createdDesc', 'Created: Newest first']],
  [['updatedAsc', 'Updated: Oldest first'], ['updatedDesc', 'Updated: Newest first']],
]
export const sortLabel = (s: SearchSort, t: T = english) => t(SORTS.flat().find(([k]) => k === s)![1])

/** Picked type titles, A–Z, cut to `chars` with "+N more" (Sanity's documentTypesTruncated). */
export function typesLabel(schemas: Schema[], types: string[], t: T = english, chars = 40) {
  if (!types.length) return t('All types')
  const titles = types.map((t) => schemas.find((s) => s.name === t)?.title ?? t).sort((a, b) => collate(a, b))
  const shown: string[] = []
  for (const t of titles) if (!shown.length || [...shown, t].join(', ').length <= chars) shown.push(t)
    else break
  const more = titles.length - shown.length
  return more ? t('{types} +{count} more', {types: shown.join(', '), count: more}) : shown.join(', ')
}
