// B12: the declared desk. A workspace with a `deskStructure` document gets its
// panes from Barkpark's resolved tree (GET /v1/structure/:dataset), the way a
// Sanity Studio gets them from its structure builder: nested lists, titled
// dividers, filtered and ordered type lists, pinned singletons and a
// parent-child tree. Without one, nothing here runs and the type list stays.
import {parseDocSegments, parsePanes, type Pane} from './panes.ts'
import type {Sort} from './list-prefs.ts'

/** Barkpark's filter shape, as the query API reads it: {field: {op: value}}. */
export type DeskFilter = Record<string, Record<string, unknown>>
export type DeskNode = {
  id: string
  type: 'list' | 'divider' | 'document' | 'document_type_list'
  title?: string
  icon?: string
  /** document, document_type_list: the schema type. */
  typeName?: string
  /** document: the pinned singleton's id. */
  docId?: string
  filter?: DeskFilter
  orderings?: {field: string; direction: 'asc' | 'desc'}[]
  /** document_type_list: a parent-child tree over this reference field. */
  tree?: {parent: string}
  items?: DeskNode[]
}

/** The query API's filter operators (Barkpark's 400 lists them). A desk filter using another can't be listed yet. */
// referencedBy / notReferencedBy: barkpark#22134; notContains / nhas: barkpark#22106.
const QUERY_OPS = new Set(['eq', 'neq', 'in', 'nin', 'has', 'nhas', 'hasStrong', 'contains', 'notContains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'is', 'referencedBy', 'notReferencedBy'])

/**
 * The tree as this studio shows it. Plugin links and plugin lists are LiveView
 * pages (admin console, sheets): out of scope for this studio (JOURNEYS.md,
 * Barkpark-native track), so they go, and so do the dividers they leave
 * leading, trailing or doubled.
 */
export function normalizeDesk(raw: unknown): DeskNode {
  const node = raw as DeskNode & {items?: unknown[]}
  const kept = (node.items ?? [])
    .map((i) => i as DeskNode)
    .filter((i) => i.type === 'list' || i.type === 'divider' || i.type === 'document' || i.type === 'document_type_list')
    .map((i) => (i.type === 'list' ? normalizeDesk(i) : i))
    // A list left empty (Barkpark's Plugins tier, once its plugin rows go) is dropped too.
    .filter((i) => i.type !== 'list' || (i.items?.length ?? 0) > 0)
  const items: DeskNode[] = []
  for (const i of kept) {
    if (i.type === 'divider' && (items.length === 0 || items[items.length - 1].type === 'divider')) continue
    items.push(i)
  }
  while (items.length && items[items.length - 1].type === 'divider') items.pop()
  return {...node, items}
}

/** Every desk node by id (ids are unique in Barkpark's tree). */
export function deskIndex(root: DeskNode): Map<string, DeskNode> {
  const out = new Map<string, DeskNode>()
  const walk = (n: DeskNode) => {
    out.set(n.id, n)
    for (const i of n.items ?? []) walk(i)
  }
  walk(root)
  return out
}

/** A desk filter's operators the query API does not have (the list can't be read until it does). */
export function unsupportedOps(filter: DeskFilter | undefined): string[] {
  return Object.values(filter ?? {}).flatMap((ops) => Object.keys(ops).filter((op) => !QUERY_OPS.has(op)))
}

/** What a list pane reads: the node's filter, or one tree level's children. */
export function listFilter(node: DeskNode | undefined, treeParent?: string): DeskFilter | undefined {
  if (node?.tree && treeParent) return {[node.tree.parent]: {eq: treeParent}}
  return node?.filter
}

/** The node's first ordering as a list sort, when the list menu has the same one. */
export function deskSort(node: DeskNode | undefined): Sort | undefined {
  const o = node?.orderings?.[0]
  if (!o) return undefined
  if (node!.orderings!.length === 1) {
    if (o.field === 'title' && o.direction === 'asc') return 'title'
    if (o.field === '_updatedAt' && o.direction === 'desc') return 'updated'
    if (o.field === '_createdAt' && o.direction === 'desc') return 'created'
  }
  // J55: any other declared order opens as is (Sanity's defaultOrdering), e.g. "year:desc".
  return node!.orderings!.map((x) => `${x.field}:${x.direction}`).join(',') as Sort
}

/**
 * A /structure URL read against the desk. Segment by segment: a desk list opens
 * a menu, a type list a list, a singleton its doc; in a tree, an id opens that
 * category's children, and the category's own id again opens the category
 * (Sanity's buildCategoryTree: the parent row on top, its children below).
 * Docs follow as in parsePanes. A first segment that is no desk node (a type
 * name from search or an old link) reads as before, so those links keep working.
 */
export function parseDeskPanes(splat: string | undefined, root: DeskNode): Pane[] {
  const segs = (splat ?? '').split(';').filter(Boolean)
  const panes: Pane[] = [{kind: 'types'}]
  if (!segs.length) return panes
  const idOf = (seg: string) => decodeURIComponent(seg.split('|')[0].split(',')[0])
  if (!root.items?.some((i) => i.id === idOf(segs[0]) && i.type !== 'divider')) return parsePanes(splat)
  let menu: DeskNode | undefined = root
  let list: {node?: DeskNode; type: string; treeParent?: string} | undefined
  for (let i = 0; i < segs.length; i++) {
    const id = idOf(segs[i])
    if (menu) {
      const child: DeskNode | undefined = menu.items?.find((n) => n.id === id && n.type !== 'divider')
      if (!child) break
      if (child.type === 'list') {
        panes.push({kind: 'menu', node: child.id})
        menu = child
        continue
      }
      menu = undefined
      if (child.type === 'document') {
        // The segment names the desk node; the doc (and any split sibling of it) is the singleton.
        const type = child.typeName ?? ''
        const group = segs[i].split('|').length
        const docs = parseDocSegments(segs.slice(i), type)
        panes.push(...docs.map((d, k) => (k < group ? {...d, id: d.id === child.id ? child.docId ?? d.id : d.id, node: k === 0 ? child.id : undefined} : d)))
        break
      }
      list = {node: child, type: child.typeName ?? ''}
      panes.push({kind: 'list', type: list.type, node: child.id})
      continue
    }
    const treeNode = list?.node?.tree ? list.node : undefined
    if (list && treeNode && id !== list.treeParent) {
      list = {...list, treeParent: id}
      panes.push({kind: 'list', type: list.type, node: treeNode.id, treeParent: id})
      continue
    }
    panes.push(...parseDocSegments(segs.slice(i), list?.type ?? ''))
    break
  }
  return panes
}
