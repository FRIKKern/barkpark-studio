import type {QueryClient} from '@tanstack/react-query'
import type {ChannelInstance} from '@sanity/comlink'
import type {VisualEditingControllerMsg, VisualEditingNodeMsg} from '@sanity/presentation-comlink'
import {anyDocQuery, deskQuery, docQuery, previewTitle, schemaOf, schemasQuery, type Doc} from './data'
import type {DeskNode} from './desk'
import {edit, saveStateOf} from './edits'
import {t} from './i18n'
import {getPath, keyedPath} from './paths'
import {focusPane, publishedId, type Perspective} from './presentation-comlink'
import {applyArrayOp, arrayField, fits, holds, MUTATES_A_MINUTE, pageEdit, putBackIn, SNAPSHOTS_A_MINUTE, type PageEdit, type PageTally} from './presentation-mutate'
import {previewSchema, unionTypes} from './presentation-schema'
import {scheduleQuery} from './schedules'
import {meQuery} from './session'
import {iconBody} from '../components/DeskIcon'
import {toast} from '../components/Toasts'

/**
 * What Sanity's Presentation gives a page's overlays beyond click-to-edit (sanity's
 * PostMessageSchema, PostMessagePreviewSnapshots, PostMessageDocuments), on the
 * visual-editing channel lib/presentation-channels.ts opens:
 *
 *   page asks                        the studio answers
 *   schema, schema-union-types   ──▶ the Barkpark schema, Sanity-shaped (lib/presentation-schema.ts)
 *   preview-snapshots            ──▶ each page document's preview title (the overlay's label)
 *   features                     ──▶ optimistic: the editor may write
 *   snapshot-welcome,            ──▶ the editor's own copy of a document (the form's, unsaved
 *   fetch-snapshot                   values included), then every change to it as a snapshot event
 *   mutate (a drag, the menu)    ──▶ checked (lib/presentation-mutate.ts), then done again here
 *                                    as a form edit: edit() → /api/mutate, as this editor
 *
 * The page shows its change at once (its own optimistic state). When the studio does not
 * save it (refused, stale, a failed or slow write) the page is loaded again: it shows what
 * is saved, and a toast says so. A document is the page's to ask about or change only when a
 * query the studio ran for it read that document; a change to one the panel does not show
 * opens it there, so nothing changes unseen. What a page has spent (writes, reads, reloads)
 * is counted per preview origin, across the frames a put-back makes (`tally`).
 */

type Visual = ChannelInstance<VisualEditingControllerMsg, VisualEditingNodeMsg>
type PageDoc = {_id: string; _type: string}

/** A change to a document reaches the page this long after the last one (a key typed in the form is many). */
const TELL_AFTER = 150
/** A page's change not saved by then is put back. */
const SAVE_WAIT = 10_000
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
// Ours, not the document's (lib/data.ts): the page gets what Barkpark holds.
const OURS = new Set(['_publishedId', '_draft', '_hasPublished', '_publishedAt'])

export type OverlayHost = {
  visual: Visual
  qc: QueryClient
  perspective: () => Perspective
  /** The documents the page named (visual-editing/documents, loader/documents), of schema types. */
  pageDocs: () => PageDoc[]
  /** A query the studio ran for the page read this document (lib/presentation-comlink.ts readByPage). */
  read: (id: string) => boolean
  /** The document the panel shows, if any. */
  panelDoc: () => string | null
  /** This preview origin's tallies (lib/presentation-mutate.ts tallyOf): they outlive the frame. */
  tally: PageTally
  /** The page shows a change the studio did not save: load it again. */
  putBack: () => void
  /** Open a pane chain in the document panel (a new item, a document changed from the page). */
  open: (pane: string) => void
}

export function overlayEditing({visual, qc, perspective, pageDocs, read, panelDoc, tally, putBack, open}: OverlayHost) {
  let stopped = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => (timers.delete(timer), stopped || run()), ms)
    timers.add(timer)
    return timer
  }
  const cancel = (timer?: ReturnType<typeof setTimeout>) => (clearTimeout(timer), timer && timers.delete(timer))
  const held = (id: string) => qc.getQueryData<Doc | null>(['doc', id]) ?? null
  const mayWrite = async () => {
    const me = await qc.ensureQueryData(meQuery).catch(() => null)
    return !!me && me.canWrite !== false && !('provisional' in me && me.provisional)
  }

  // ── The schema: the label's icon, the menu's title, which values are array items ──
  const icons = () => {
    const out: Record<string, string> = {}
    const walk = (n: DeskNode) => (n.typeName && n.icon && !out[n.typeName] && (out[n.typeName] = iconBody(n.icon, n.iconSvg)), n.items?.forEach(walk))
    const desk = qc.getQueryData(deskQuery.queryKey)
    if (desk) walk(desk)
    for (const s of qc.getQueryData(schemasQuery.queryKey) ?? []) if (!out[s.name] && (s.icon || s.iconSvg)) out[s.name] = iconBody(s.icon, s.iconSvg)
    return out
  }
  visual.on('visual-editing/schema', async () => ({schema: previewSchema(await qc.ensureQueryData(schemasQuery), icons()) as never}))
  visual.on('visual-editing/schema-union-types', async (data) => {
    const schemas = await qc.ensureQueryData(schemasQuery)
    const known = new Map(pageDocs().map((d) => [d._id, d._type]))
    return {types: unionTypes(data?.paths, (id) => (read(id) && known.has(id) && held(id)?._type === known.get(id) ? held(id)! : undefined), schemas) as never}
  })
  visual.on('visual-editing/features', async () => ({features: {optimistic: await mayWrite()}}))

  // ── Preview snapshots: the label on an overlay is its document's preview title ──
  let told = ''
  let previewsTimer: ReturnType<typeof setTimeout> | undefined
  const previews = () => {
    const schemas = qc.getQueryData(schemasQuery.queryKey) ?? []
    return pageDocs().flatMap((d) => {
      const doc = held(d._id)
      return doc && doc._type === d._type ? [{_id: d._id, title: previewTitle(doc, schemaOf(schemas, d._type), t)}] : []
    })
  }
  const tellPreviews = () => {
    cancel(previewsTimer)
    previewsTimer = later(() => {
      const snapshots = previews()
      const text = JSON.stringify(snapshots)
      if (text === told) return
      told = text
      visual.post('presentation/preview-snapshots', {snapshots})
    }, TELL_AFTER)
  }
  visual.on('visual-editing/preview-snapshots', () => {
    const snapshots = previews()
    told = JSON.stringify(snapshots)
    return {snapshots}
  })

  // ── Documents: the page's optimistic copy follows the editor's own ──
  // `rev` numbers what the page was told last, so its events chain on from its snapshot.
  const served = new Map<string, {type: string; rev: number; sent: Doc | null; timer?: ReturnType<typeof setTimeout>}>()
  const revOf = (id: string, n: number) => `studio-${id}-${n}`
  const shape = (doc: Doc | null, id: string) => doc && {...Object.fromEntries(Object.entries(doc).filter(([k]) => !OURS.has(k))), _id: `drafts.${id}`}
  const typeOf = async (id: string) => {
    const named = pageDocs().find((d) => d._id === id)?._type
    if (named) return named
    // Not named yet (the overlay asks before the page reports): a type the schema has, as a click opens.
    const type = (await qc.fetchQuery(anyDocQuery(id)).catch(() => null))?._type
    return type && schemaOf(await qc.ensureQueryData(schemasQuery), type) ? type : undefined
  }
  /** The page may draw a result it kept before the studio has run that query again (a page gone back to): a moment for it. */
  const readSoon = async (id: string) => {
    for (let tries = 0; tries < 15 && !stopped && !read(id); tries++) await new Promise((go) => later(() => go(null), 200))
    return !stopped && read(id)
  }
  visual.on('visual-editing/snapshot-welcome', () => ({event: {type: 'welcome'}}) as never)
  visual.on('visual-editing/fetch-snapshot', async (data) => {
    const asked = typeof data?.documentId === 'string' ? data.documentId : ''
    const id = publishedId(asked)
    // One copy a document: the draft's id carries what the editor sees, the published id nothing.
    // Only a document the page's own queries read, and reads of Barkpark within a minute's allowance.
    if (!asked.startsWith('drafts.') || !DOC_ID.test(id) || !(await readSoon(id))) return {snapshot: null} as never
    const fresh = Date.now() - (qc.getQueryState(['doc', id])?.dataUpdatedAt ?? 0) < 30_000
    if (!fresh && !fits(tally.snapshots, Date.now(), SNAPSHOTS_A_MINUTE)) return {snapshot: null} as never
    const type = await typeOf(id)
    const doc = type ? ((await qc.fetchQuery(docQuery(type, id)).catch(() => null)) ?? null) : null
    if (stopped || !type || !doc) return {snapshot: null} as never
    const now = served.get(id) ?? {type, rev: 0, sent: null}
    cancel(now.timer)
    Object.assign(now, {type, rev: now.rev + 1, sent: doc})
    served.set(id, now)
    return {snapshot: {...shape(doc, id), _rev: revOf(id, now.rev)}} as never
  })
  const tellDocument = (id: string) => {
    const now = served.get(id)
    if (!now) return
    cancel(now.timer)
    now.timer = later(() => {
      const doc = held(id)
      if (doc === now.sent) return
      const previousRev = revOf(id, now.rev)
      Object.assign(now, {rev: now.rev + 1, sent: doc})
      const rev = revOf(id, now.rev)
      // The whole document as one mendoza patch ([0, value]: "the value is"): the page's machine
      // takes it as the server's and lays what it has not sent yet over it.
      const event = {type: 'mutation', documentId: `drafts.${id}`, eventId: rev, transactionId: rev, previousRev, resultRev: rev, transition: doc ? 'update' : 'disappear', identity: 'studio', mutations: [], timestamp: new Date().toISOString(), visibility: 'transaction', effects: {apply: [0, shape(doc, id)], revert: []}}
      visual.post('presentation/snapshot-event', {event} as never)
    }, TELL_AFTER)
  }
  const unwatch = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const [kind, id] = event.query.queryKey as [string, string]
    if (kind !== 'doc') return
    tellDocument(id)
    if (pageDocs().some((d) => d._id === id)) tellPreviews()
  })

  // ── A change made on the page: checked, then made here as a form edit ──
  let putBackTimer: ReturnType<typeof setTimeout> | undefined
  const notSaved = (why: string) => {
    console.warn(`Presentation did not save a change made on the preview page: ${why}.`)
    // One put-back is on its way already: it covers this one too.
    if (stopped || putBackTimer) return
    const go = () => {
      toast({key: 'presentation-put-back', tone: 'caution', title: t('A change made on the page was not saved'), description: t('The page shows what is saved.')})
      putBack()
    }
    const wait = putBackIn(tally, Date.now())
    if (wait === 0) return go()
    // Too soon after the last one (lib/presentation-mutate.ts putBackIn): once, when the gap is over.
    putBackTimer = later(() => ((putBackTimer = undefined), putBackIn(tally, Date.now()) === 0 && go()), wait)
  }
  /**
   * The change, made on the studio's copy of the document as it is now: the form's own edit
   * (undo, the footer, the 412 rebase are the form's). False when it cannot be made.
   */
  const make = ({id, path, op}: PageEdit, type: string): boolean => {
    const doc = held(id)
    if (perspective() !== 'drafts' || !doc || doc._type !== type) return notSaved('the document is not open to edits'), false
    const field = arrayField(schemaOf(qc.getQueryData(schemasQuery.queryKey) ?? [], type), path, doc)
    if (!field) return notSaved('not an array of this document type a page may change'), false
    const result = applyArrayOp(getPath(doc, path), op, field)
    if ('refused' in result) return notSaved(result.refused), false
    if (!result.same) edit(qc, doc, path, result.next)
    return true
  }
  /**
   * The write is the form's from here: saved, or said (the footer) and the page put back.
   * Saved without the change in it (another editor's order landed first and the merge kept
   * theirs): made once more, onto theirs.
   */
  const followSave = (asked: PageEdit, type: string, until: number, again: boolean) => {
    const state = saveStateOf(asked.id)
    if ((state === 'saving' || state === 'recovering' || state === 'stalled') && Date.now() < until) return void later(() => followSave(asked, type, until, again), 200)
    if (state !== 'saved') return notSaved(`its save is ${state}; the document panel keeps it`)
    if (holds(getPath(held(asked.id), asked.path), asked.op)) return
    if (!again) return notSaved('another change to the array took its place')
    if (make(asked, type)) followSave(asked, type, Date.now() + SAVE_WAIT, false)
  }
  const onMutate = async (data: unknown) => {
    if (perspective() !== 'drafts') return notSaved('the published version is shown')
    if (!(await mayWrite())) return notSaved('this editor may not write')
    if (stopped) return
    if (!fits(tally.writes, Date.now(), MUTATES_A_MINUTE)) return notSaved(`more than ${MUTATES_A_MINUTE} changes in a minute`)
    const asked = pageEdit(data)
    if ('refused' in asked) return notSaved(asked.refused)
    const {id, path, op} = asked
    // A document the studio read for this page (its own queries' source maps, not the page's
    // word), which the page named and was given a copy of: no other can be meant.
    const type = pageDocs().find((d) => d._id === id)?._type
    if (!type || !read(id) || served.get(id)?.type !== type) return notSaved('not a document on this page')
    const schedule = await qc.fetchQuery(scheduleQuery(id, type)).catch(() => undefined)
    if (stopped) return
    if (!schedule || schedule.schedule?.status === 'scheduled') return notSaved('the document is scheduled, or its schedule could not be read')
    // After every wait: the document as the form holds it now, the perspective as it is now.
    if (!make(asked, type)) return
    // A new item opens in the panel; so does a document the panel is not showing, at the
    // array that changed: the editor sees every change a page makes, and Mod+Z there undoes it.
    if (op.kind === 'insert') open(focusPane({id, type, path: keyedPath(path, op.newKey)}))
    else if (panelDoc() !== id) open(focusPane({id, type, path}))
    followSave(asked, type, Date.now() + SAVE_WAIT, true)
  }
  visual.on('visual-editing/mutate', (data) => void onMutate(data))

  return {
    /** The page's documents changed: their labels. */
    documents: tellPreviews,
    stop: () => {
      stopped = true
      timers.forEach((timer) => clearTimeout(timer))
      unwatch()
    },
  }
}
