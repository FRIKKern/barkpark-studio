// Sanity's array insert menu (inputs.array.insert-menu.*): the member types to add, with a
// search box that narrows them as you type, filter tabs (groups) and a list or a grid of
// tiles. The schema says how, as Sanity's `options.insertMenu` on the array:
//   {filter: 'auto' | true | false, groups: [{name, title, of: [types]}], showIcons,
//    views: [{name: 'list'}, {name: 'grid', previewImageUrl: '/static/{type}.png'}]}
// Sanity's previewImageUrl is a function of the type name; a JSON schema can't hold one, so
// ours is a template where `{type}` is the type's name. Without options: a list, searchable
// past five types (Sanity's 'auto').

export type Choice = {value: string; title: string; icon?: {icon?: string; iconSvg?: string}}
export type MenuGroup = {name: string; title: string; of?: string[]}
export type MenuView = 'list' | 'grid'
export type MenuSetup = {filter: boolean; groups: MenuGroup[]; views: MenuView[]; showIcons: boolean; preview?: string}

/** The group every menu with groups starts on (Sanity's "All"). */
export const ALL_ITEMS = 'all-items'

type Raw = {filter?: unknown; groups?: unknown; views?: unknown; showIcons?: unknown}

/** The array field's `options.insertMenu`, read as Sanity reads it, for `n` member types. */
export function menuSetup(options: unknown, n: number, allTitle = 'All'): MenuSetup {
  const raw = (options && typeof options === 'object' && !Array.isArray(options) ? (options as {insertMenu?: Raw}).insertMenu : undefined) ?? {}
  const filter = raw.filter === true || raw.filter === false ? raw.filter : n > 5
  const listed = Array.isArray(raw.groups) ? (raw.groups as {name?: unknown; title?: unknown; of?: unknown}[]).filter((g) => g && typeof g.name === 'string') : []
  const groups = listed.length
    ? [{name: ALL_ITEMS, title: allTitle}, ...listed.map((g) => ({name: g.name as string, title: typeof g.title === 'string' ? g.title : startCase(g.name as string), of: Array.isArray(g.of) ? g.of.filter((x): x is string => typeof x === 'string') : []}))]
    : []
  const declared = Array.isArray(raw.views) ? (raw.views as {name?: unknown; previewImageUrl?: unknown}[]).filter((v) => v && (v.name === 'list' || v.name === 'grid')) : []
  const views = declared.length ? [...new Set(declared.map((v) => v.name as MenuView))] : (['list'] as MenuView[])
  const grid = declared.find((v) => v.name === 'grid')
  return {filter, groups, views, showIcons: raw.showIcons !== false, ...(typeof grid?.previewImageUrl === 'string' && grid.previewImageUrl ? {preview: grid.previewImageUrl} : {})}
}

/** Sanity's: a type passes when its title (else its name) holds the query, and it is in the chosen group. */
export function filterChoices(choices: Choice[], query: string, group?: MenuGroup): Choice[] {
  const q = query.trim().toLowerCase()
  return choices.filter((c) => (!group || group.name === ALL_ITEMS || !!group.of?.includes(c.value)) && (c.title ? c.title.toLowerCase() : c.value).includes(q))
}

/** A grid tile's picture: the template with the type's name in it. */
export const previewUrl = (template: string | undefined, type: string) => (template ? template.replaceAll('{type}', encodeURIComponent(type)) : undefined)

/**
 * Where an arrow key goes in a grid of `n` tiles, `cols` to a row: Left/Right step (wrapping
 * at the ends), Up/Down move a row and stay put at an edge, Home/End go to the ends. -1 (nothing
 * focused yet) starts at the first tile, or the last for Up and End.
 */
export function gridStep(at: number, key: string, n: number, cols: number): number {
  if (n <= 0) return -1
  const c = Math.max(1, cols)
  if (at < 0) return key === 'ArrowUp' || key === 'End' ? n - 1 : 0
  if (key === 'ArrowRight') return (at + 1) % n
  if (key === 'ArrowLeft') return (at - 1 + n) % n
  if (key === 'ArrowDown') return at + c < n ? at + c : at
  if (key === 'ArrowUp') return at - c >= 0 ? at - c : at
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return at
}

const startCase = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
