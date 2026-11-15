import type {ComponentType} from 'react'
import type {Doc} from './data'
import type {Task} from './tasks'
import type {Schedule} from './schedule-read'

// The Dashboard tool (Sanity's @sanity/dashboard): what a studio config may say, and what
// each widget shows of what it read. Pure, so node's tests load it (dashboard.test.ts); the
// reads are lib/dashboard-data.ts, the page components/Dashboard.tsx.

/** Sanity's layout widths: one column, two, three, or the whole row. */
export type Width = 'small' | 'medium' | 'large' | 'full'
export type WidgetLayout = {width?: Width}

export const BUILT_IN = ['drafts', 'recent', 'tasks', 'scheduled', 'members', 'projectInfo'] as const
export type BuiltIn = (typeof BUILT_IN)[number]
/** One of the studio's own widgets, by name. */
export type BuiltInWidget = {type: BuiltIn; title?: string; limit?: number; layout?: WidgetLayout}
/** Sanity's document list widget (sanity-plugin-dashboard-widget-document-list): its options, `order` as GROQ's (`_createdAt desc`). */
export type DocumentListWidget = {type: 'documentList'; title?: string; types?: string[]; order?: string; limit?: number; createNew?: boolean; createButtonText?: string; layout?: WidgetLayout}
/** A widget of the studio's own making: Sanity's `{name, component, layout}`; `title` is its header. */
export type CustomWidget = {name: string; title?: string; component: ComponentType; layout?: WidgetLayout}
export type WidgetConfig = BuiltInWidget | DocumentListWidget | CustomWidget
export type DashboardConfig = {widgets?: WidgetConfig[]}

type ResolvedBuiltIn = {[K in BuiltIn]: {kind: K; title: string; limit: number}}[BuiltIn]
export type Resolved = {key: string; width: Width} & (
  | ResolvedBuiltIn
  | {kind: 'documentList'; title: string; types: string[] | null; order: string; limit: number; createNew: boolean; createButtonText?: string}
  | {kind: 'custom'; title?: string; component: ComponentType}
)

/** With no `widgets` in the config: what an editor opens the studio for. */
export const DEFAULT_WIDGETS: WidgetConfig[] = [{type: 'drafts'}, {type: 'recent'}, {type: 'tasks'}, {type: 'scheduled'}, {type: 'members'}]

const TITLES: Record<BuiltIn, string> = {drafts: 'Unpublished changes', recent: 'Recently edited', tasks: 'My tasks', scheduled: 'Scheduled', members: 'Members', projectInfo: 'Project info'}
const WIDTHS: Record<BuiltIn | 'documentList' | 'custom', Width> = {drafts: 'medium', recent: 'medium', tasks: 'small', scheduled: 'small', members: 'small', projectInfo: 'small', documentList: 'medium', custom: 'small'}
const LIMITS: Record<BuiltIn, number> = {drafts: 6, recent: 6, tasks: 6, scheduled: 5, members: 8, projectInfo: 1}
export const LIMIT_MAX = 25

const widthOf = (layout: unknown, kind: keyof typeof WIDTHS): Width => {
  const w = (layout as WidgetLayout | undefined)?.width
  return w === 'small' || w === 'medium' || w === 'large' || w === 'full' ? w : WIDTHS[kind]
}
const limitOf = (limit: unknown, otherwise: number) => (typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.min(LIMIT_MAX, Math.floor(limit))) : otherwise)
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

const ORDER_PART = /^([A-Za-z_][\w.]*)(?:[\s:]+(asc|desc))?$/i
/** A list's order as GROQ takes it (`_updatedAt desc, title asc`), from Sanity's spelling or Barkpark's (`_updatedAt:desc`); anything else is Sanity's default, last created. */
export function orderExpr(order: unknown): string {
  const parts = typeof order === 'string' ? order.split(',').map((p) => ORDER_PART.exec(p.trim())) : []
  if (!parts.length || parts.some((m) => !m)) return '_createdAt desc'
  return parts.map((m) => `${m![1]} ${(m![2] ?? 'asc').toLowerCase()}`).join(', ')
}

/**
 * The config's widgets as the page draws them: defaults filled in, limits within 1–25, an
 * entry the studio cannot draw (an unknown type, a custom one without a component) left
 * out, and a key each (two lists of posts are two widgets).
 */
export function resolveWidgets(config: DashboardConfig | undefined): Resolved[] {
  const widgets = Array.isArray(config?.widgets) ? config.widgets : DEFAULT_WIDGETS
  const seen = new Map<string, number>()
  const keyed = (base: string) => {
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base}-${n + 1}` : base
  }
  return widgets.flatMap((w): Resolved[] => {
    if (!w || typeof w !== 'object') return []
    if ('component' in w) {
      const name = text(w.name)
      return name && typeof w.component === 'function' ? [{kind: 'custom', key: keyed(`custom-${name}`), title: text(w.title), component: w.component, width: widthOf(w.layout, 'custom')}] : []
    }
    if (w.type === 'documentList') {
      const types = Array.isArray(w.types) ? w.types.filter((x): x is string => typeof x === 'string' && !!x) : null
      const order = orderExpr(w.order)
      return [
        {
          kind: 'documentList',
          key: keyed(`list-${types?.join('+') || 'all'}`),
          // Sanity's default title is for its default order.
          title: text(w.title) ?? (order === '_updatedAt desc' ? 'Last edited' : 'Last created'),
          types: types?.length ? types : null,
          order,
          limit: limitOf(w.limit, 10),
          // Sanity's: on unless turned off, and only a list of one type has a button.
          createNew: w.createNew !== false && types?.length === 1,
          createButtonText: text(w.createButtonText),
          width: widthOf(w.layout, 'documentList'),
        },
      ]
    }
    if (!BUILT_IN.includes(w.type)) return []
    return [{kind: w.type, key: keyed(w.type), title: text(w.title) ?? TITLES[w.type], limit: limitOf(w.limit, LIMITS[w.type]), width: widthOf(w.layout, w.type)}]
  })
}

/**
 * The Dashboard tool is on when the studio config has a `dashboard`, and a deployment that
 * names its tools (VITE_STUDIO_TOOLS → `navbarTools`) names `dashboard` among them. Off, it
 * has no navbar entry and `/dashboard` is not found.
 */
export const dashboardEnabled = (config: {dashboard?: DashboardConfig; navbarTools?: string[]}) => !!config.dashboard && (!config.navbarTools || config.navbarTools.includes('dashboard'))

// --- Document rows -------------------------------------------------------------------------

/** A document as Barkpark's GROQ read gives it (the raw perspective): a draft's id starts `drafts.`. */
export type RawDoc = {_id: string; _type: string; _updatedAt: string} & Record<string, unknown>
const publishedId = (id: string) => id.replace(/^drafts\./, '')

/** A published version's times, by id: when it last changed, and when the document was created. */
export type PublishedTimes = Record<string, {_updatedAt: string; _createdAt?: string}>

/**
 * Rows from a raw read, in its order: one per document, the draft in front of its published
 * version (as lists show it), each marked as lists mark theirs (`_draft`, `_publishedId`,
 * `_hasPublished`, `_publishedAt`). `published`: the published versions of the drafts, by id
 * (the second read); a published version in `raw` itself counts too.
 *
 * A draft of a published document is a row of its own in Barkpark, created when the editing
 * began: its `_createdAt` is that moment, not the document's. A row says the document's, and
 * a list of the last created (`order`) is put in that order here, or every document someone
 * starts editing would be its newest.
 */
export function docRows(raw: RawDoc[], published: PublishedTimes, limit: number, order?: string): Doc[] {
  const live = new Map(Object.entries(published))
  for (const d of raw) if (!d._id.startsWith('drafts.')) live.set(d._id, {_updatedAt: d._updatedAt, _createdAt: typeof d._createdAt === 'string' ? d._createdAt : undefined})
  const rows = new Map<string, Doc>()
  for (const d of raw) {
    const id = publishedId(d._id)
    const draft = d._id !== id
    const had = rows.get(id)
    if (had && (had._draft || !draft)) continue
    const pub = live.get(id)
    // A draft met after its published version takes the row where that one stood.
    rows.set(id, {...d, _rev: String(d._rev ?? ''), _publishedId: id, _draft: draft, _hasPublished: !draft || !!pub, _publishedAt: pub?._updatedAt, ...(draft && pub?._createdAt ? {_createdAt: pub._createdAt} : {})} as Doc)
  }
  const all = [...rows.values()]
  if (order === '_createdAt desc') all.sort((a, b) => String(b._createdAt ?? '').localeCompare(String(a._createdAt ?? '')))
  return all.slice(0, limit)
}

/** The ids of the drafts among `raw` whose published version it does not hold: what the second read asks for. */
export const draftsToCheck = (raw: RawDoc[]): string[] => {
  const held = new Set(raw.filter((d) => !d._id.startsWith('drafts.')).map((d) => d._id))
  return [...new Set(raw.filter((d) => d._id.startsWith('drafts.')).map((d) => publishedId(d._id)))].filter((id) => !held.has(id))
}

export type RowsKind = {only: 'drafts' | 'all'; types: string[] | null; order: string; limit: number}

/**
 * A live frame's document (as editors now see it) put into a widget's rows without a read:
 * the new rows, the same rows when the frame is not this widget's, or null when only a read
 * can tell (a list in an order of its own, a row gone from a full list, a draft whose
 * published version is unknown). Typing in a document is frames by the dozen: none may cost
 * a read.
 */
export function withFrame(rows: Doc[], doc: Doc, kind: RowsKind): Doc[] | null {
  if (kind.types && !kind.types.includes(doc._type)) return rows
  const at = rows.findIndex((r) => r._publishedId === doc._publishedId)
  const was = at < 0 ? undefined : rows[at]
  if (was && was._updatedAt > doc._updatedAt) return rows
  if (kind.only === 'drafts' && !doc._draft) {
    // Published (or the draft is gone): no longer an unpublished change. A full list has more to show.
    if (!was) return rows
    return rows.length >= kind.limit ? null : rows.filter((r) => r !== was)
  }
  // Last created: a published document older than every row of a full list changes nothing here.
  // (A draft's own `_createdAt` is when its editing began, docRows: it cannot tell.)
  const last = rows.at(-1)?._createdAt
  if (!was && !doc._draft && kind.order === '_createdAt desc' && rows.length >= kind.limit && typeof last === 'string' && typeof doc._createdAt === 'string' && doc._createdAt <= last) return rows
  const hasPublished = !doc._draft || (doc._hasPublished ?? was?._hasPublished)
  if (hasPublished === undefined) return null
  const row = {...doc, _hasPublished: hasPublished, _publishedAt: doc._draft ? (doc._publishedAt ?? was?._publishedAt) : doc._updatedAt} as Doc
  if (kind.order === '_updatedAt desc') return [row, ...rows.filter((r) => r !== was)].slice(0, kind.limit)
  // Another order: a row in the list is redrawn where it stands when its order cannot have
  // changed (last created); anything else is read again.
  if (was && kind.order === '_createdAt desc') return rows.map((r) => (r === was ? ({...row, _createdAt: was._createdAt} as Doc) : r))
  return null
}

/** A document deleted, or a draft discarded: the rows as they are when it is not among them, else null (read again). */
export const withoutFrame = (rows: Doc[], id: string): Doc[] | null => (rows.some((r) => r._publishedId === publishedId(id)) ? null : rows)

// --- Tasks, schedules, members -------------------------------------------------------------

/**
 * The open tasks assigned to `me`, the soonest deadline first, then the newest. With no `me`
 * (shared sign-in: everyone works as one identity) every open task. A task still being
 * written (`state: 'draft'`) or done is never one.
 */
export function openTasks(tasks: Task[], me: string | null | undefined, limit: number): {rows: Task[]; total: number} {
  const mine = tasks
    .filter((x) => (x.state as string) === 'open' && (!me || x.assignee === me))
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || b.createdAt.localeCompare(a.createdAt))
  return {rows: mine.slice(0, limit), total: mine.length}
}

/** A task's deadline against today (`yyyy-mm-dd`, the editor's own day). */
export const dueState = (dueAt: string | null | undefined, today: string): 'none' | 'overdue' | 'today' | 'later' => (!dueAt ? 'none' : dueAt < today ? 'overdue' : dueAt === today ? 'today' : 'later')

/** The schedules still to run, the soonest first. */
export function upcoming(schedules: Schedule[], limit: number): {rows: Schedule[]; total: number} {
  const pending = schedules.filter((s) => s.status === 'scheduled').sort((a, b) => a.publishAt.localeCompare(b.publishAt))
  return {rows: pending.slice(0, limit), total: pending.length}
}

export type MemberRow = {email: string; name: string; online: boolean; you: boolean}
/**
 * The workspace's people: who is online first (their presence in the studio right now, and
 * you), then by name. `online`: the presence names in the room (lower-cased emails).
 */
export function memberRows(people: string[], names: Record<string, string>, online: Iterable<string>, me: string | null | undefined, limit: number): {rows: MemberRow[]; total: number; onlineCount: number} {
  const here = new Set([...online].map((n) => n.trim().toLowerCase()))
  const self = me?.trim().toLowerCase()
  const all = people.map((email) => {
    const key = email.trim().toLowerCase()
    return {email, name: names[email]?.trim() || email.replace(/@.*/, ''), online: here.has(key) || key === self, you: key === self}
  })
  all.sort((a, b) => Number(b.you) - Number(a.you) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  return {rows: all.slice(0, limit), total: all.length, onlineCount: all.filter((m) => m.online).length}
}

/** The members read was refused for this token (a read-only studio token cannot list members): the pickers' empty state, not an error. */
export const membersRefused = (error: unknown) => /\((401|403)\)/.test(error instanceof Error ? error.message : String(error ?? ''))
