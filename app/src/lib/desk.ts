// B12: the declared desk. A workspace with a `deskStructure` document gets its
// panes from Barkpark's resolved tree (GET /v1/structure/:dataset), the way a
// Sanity Studio gets them from its structure builder: nested lists, titled
// dividers, filtered and ordered type lists, pinned singletons and a
// parent-child tree. Without one, nothing here runs and the type list stays.
import {parseDocSegments, parsePanes, type Pane} from './panes.ts'
import type {Sort} from './list-prefs.ts'

/**
 * Barkpark's filter shape, as the query API reads it: {field: {op: value}}, plus an optional
 * `$or` group (Barkpark #23981): a list of such maps, the row matching any one, as Sanity's
 * `(!defined(x) || x == "")` desk filters.
 */
export type DeskFilter = {[field: string]: Record<string, unknown> | DeskFilter[]}
export type DeskNode = {
  id: string
  type: 'list' | 'divider' | 'document' | 'document_type_list'
  title?: string
  icon?: string
  /** The icon's SVG body, added by the server ('' for an unknown name; server/desk-icons.ts). */
  iconSvg?: string
  /** document, document_type_list: the schema type. */
  typeName?: string
  /** document: the pinned singleton's id. */
  docId?: string
  filter?: DeskFilter
  orderings?: {field: string; direction: 'asc' | 'desc'}[]
  /**
   * document_type_list: a parent-child tree over this reference field. `filter` (Barkpark's tree
   * filter) narrows every level, as it narrows the root through `filter`. `op: 'has'`: the
   * parents are an array of references (Barkpark's parentOp has), so a level reads `has`.
   */
  tree?: {parent: string; filter?: DeskFilter; op?: 'has'}
  /**
   * document_type_list (J18, Sanity's `.child((id) => S.documentList()…)`): a row opens the
   * `typeName` docs whose `field` points at it, and that list's "+" starts `template` with
   * `{[param]: the row's id}`.
   */
  child?: {typeName: string; title?: string; field: string; template?: {id: string; param: string}}
  /** A list with a `child`: its own pane's title ("Authors"), when not its row's ("Posts by author"). */
  listTitle?: string
  /**
   * A declared list's own pane title, when not its row's (Barkpark's `paneTitle`): Sanity's
   * `S.listItem().title('Med anmeldelser').child(S.documentTypeList('product').title('Produkter med anmeldelser'))`.
   */
  paneTitle?: string
  /**
   * document_type_list: the fields its "+" starts a document with (Barkpark's `initialValues`,
   * Sanity's initialValueTemplates): «Landingssider» → {pageType: 'landingPage'}.
   */
  initialValues?: Record<string, unknown>
  items?: DeskNode[]
}

/** The query API's filter operators (Barkpark's 400 lists them). A desk filter using another can't be listed yet. */
// referencedBy / notReferencedBy: barkpark#22134; notContains / nhas: barkpark#22106;
// neqOrMissing (GROQ's !=, a missing field counts as not equal): barkpark#23913.
// countEq…countLte (array length; no array counts 0): barkpark#22106, a has-tree's root.
const QUERY_OPS = new Set(['eq', 'neq', 'neqOrMissing', 'in', 'nin', 'has', 'nhas', 'hasStrong', 'contains', 'notContains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'is', 'referencedBy', 'notReferencedBy', 'countEq', 'countNeq', 'countGt', 'countGte', 'countLt', 'countLte'])

/**
 * The tree as this studio shows it. Plugin links and plugin lists are LiveView
 * pages (admin console, sheets): out of scope for this studio (JOURNEYS.md,
 * Barkpark-native track), so they go, and so do the dividers they leave
 * leading, trailing or doubled.
 */
/**
 * The desk the first pane shows (owner's call, B12): a declared desk is the whole desk,
 * exactly as declared; the studio config's own items (J18) show only when none is declared.
 */
export function rootDesk(declared: DeskNode | null | undefined, own: DeskNode | null): DeskNode | null {
  return declared ?? own
}

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

/** The title of the pane a desk node opens: its paneTitle, else its row title. */
export const paneTitleOf = (node: DeskNode | undefined) => node?.paneTitle || node?.title

/**
 * What a list's "+" puts on the new document: the node's initialValues, so a page made from
 * «Landingssider» is a landing page and shows in that list. A child list's "+" (J18) starts
 * its template instead.
 */
export function newDocPreset(node: DeskNode | undefined, childTemplate: boolean): Record<string, unknown> {
  if (childTemplate || !node?.initialValues || typeof node.initialValues !== 'object') return {}
  return node.initialValues
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
  return Object.entries(filter ?? {}).flatMap(([field, ops]) =>
    field === '$or' && Array.isArray(ops) ? ops.flatMap((branch) => unsupportedOps(branch)) : Array.isArray(ops) ? [field] : Object.keys(ops).filter((op) => !QUERY_OPS.has(op)),
  )
}

/** A desk list's filter as query parameters: ops pass through as Barkpark reads them, an `$or` group as filter[$or][i][field][op]. */
export function deskFilterParams(filter?: DeskFilter, prefix = 'filter'): string {
  return Object.entries(filter ?? {})
    .flatMap(([field, ops]) =>
      field === '$or' && Array.isArray(ops)
        ? ops.map((branch, i) => deskFilterParams(branch, `${prefix}[$or][${i}]`))
        : Array.isArray(ops)
          ? []
          : Object.entries(ops).map(([op, v]) => `&${prefix}[${encodeURIComponent(field)}][${encodeURIComponent(op)}]=${encodeURIComponent(String(v))}`),
    )
    .join('')
}

/** What a list pane reads: the node's filter, or one tree level's children. */
export function listFilter(node: DeskNode | undefined, treeParent?: string): DeskFilter | undefined {
  if (node?.child && treeParent) return {[node.child.field]: {eq: treeParent}}
  if (node?.tree && treeParent) return {...node.tree.filter, [node.tree.parent]: {[node.tree.op ?? 'eq']: treeParent}}
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
    // A child list (J18): the row's id opens the docs that point at it.
    const childOf = list?.node?.child && !list.treeParent ? list.node : undefined
    if (list && childOf) {
      list = {node: childOf, type: childOf.child!.typeName, treeParent: id}
      panes.push({kind: 'list', type: list.type, node: childOf.id, treeParent: id})
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
