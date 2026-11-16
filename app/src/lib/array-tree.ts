// Two of Sanity's array tools as plain functions (components/ArrayTree.tsx and SortableRows draw them).
//
// 1. Long arrays fold (inputs.array.action.show-all-items): past `limit` items only the first
//    ones are drawn, with "Show all N items" under them. Sanity's defaults: 4 in a list, 8 in a
//    grid; a field's `options.collapseItemsAfter` (a whole number, or false for never) wins.
//
// 2. The nested item dialog's tree (tree-editing-dialog.sidebar.*): every item of the outermost
//    array, with the items of arrays inside it as children, searchable; picking one opens it.
//    Built once per item object: an edit makes a new object of the item it changes (and of the
//    items around it), so the other 299 of a 300-item array keep their nodes and their rows.
import {membersOf, memberFor} from './array-members.ts'
import type {Field} from './data.ts'

export const LIST_LIMIT = 4
export const GRID_LIMIT = 8

/** How many items a long array shows folded (Infinity: it never folds). */
export function itemLimit(options: unknown, grid = false): number {
  const own = options && typeof options === 'object' && !Array.isArray(options) ? (options as {collapseItemsAfter?: unknown}).collapseItemsAfter : undefined
  if (own === false) return Infinity
  if (typeof own === 'number' && Number.isInteger(own) && own > 0) return own
  return grid ? GRID_LIMIT : LIST_LIMIT
}

type Item = {_key?: unknown} & Record<string, unknown>
export type TreeNode = {key: string; path: string; position: number; title: string; children: TreeNode[]}
/** What the tree needs from the form: an item's title, as its row's preview reads. */
export type Titles = (item: Item, member: Field, named: boolean) => string
type Cache = WeakMap<object, {path: string; position: number; node: TreeNode}>

export const itemPath = (arrayPath: string, key: string) => `${arrayPath}[_key=="${key}"]`

/** The nodes of an array's items at `path`: each with its own arrays' items under it. */
export function treeOf(path: string, field: Pick<Field, 'of'>, value: unknown, title: Titles, cache: Cache = new WeakMap()): TreeNode[] {
  const members = membersOf(field)
  if (!Array.isArray(value) || !members.length || !members.some((m) => m.type === 'composite')) return []
  return value.flatMap((raw, i) => {
    if (!raw || typeof raw !== 'object' || typeof (raw as Item)._key !== 'string') return []
    const item = raw as Item
    const at = itemPath(path, item._key as string)
    const hit = cache.get(item)
    if (hit && hit.path === at && hit.position === i + 1) return [hit.node]
    const member = memberFor(members, item)
    if (!member || member.type !== 'composite') return []
    const node: TreeNode = {key: item._key as string, path: at, position: i + 1, title: title(item, member, members.length > 1), children: nested(at, member.fields ?? [], item, title, cache)}
    cache.set(item, {path: at, position: i + 1, node})
    return [node]
  })
}

/** The items of every array of objects in an item, through its plain objects, in field order. */
function nested(at: string, fields: Field[], value: Item, title: Titles, cache: Cache): TreeNode[] {
  return fields.flatMap((f) => {
    const v = value[f.name]
    if (f.type === 'arrayOf') return treeOf(`${at}.${f.name}`, f, v, title, cache)
    if (f.type === 'composite' && v && typeof v === 'object' && !Array.isArray(v)) return nested(`${at}.${f.name}`, f.fields ?? [], v as Item, title, cache)
    return []
  })
}

/** The nodes whose title holds the query, with the way down to them (Sanity's tree search). */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  return nodes.flatMap((n) => {
    const children = filterTree(n.children, q)
    return n.title.toLowerCase().includes(q) || children.length ? [{...n, children}] : []
  })
}

export type TreeRow = {node: TreeNode; depth: number; parent?: string}

/** The rows drawn, top to bottom: a node's children show while it is open. */
export function treeRows(nodes: TreeNode[], open: (path: string) => boolean, depth = 0, parent?: string, out: TreeRow[] = []): TreeRow[] {
  for (const node of nodes) {
    out.push({node, depth, parent})
    if (node.children.length && open(node.path)) treeRows(node.children, open, depth + 1, node.path, out)
  }
  return out
}

/** The items around one, outermost first: `a[_key=="1"].b[_key=="2"]` sits in `a[_key=="1"]`. */
export function itemsAbove(path: string): string[] {
  const out: string[] = []
  for (const m of path.matchAll(/\[_key=="[^"]*"\]/g)) out.push(path.slice(0, m.index + m[0].length))
  return out.slice(0, -1)
}
