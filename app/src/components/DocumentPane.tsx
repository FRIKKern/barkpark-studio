import {announce} from '../lib/announce'
import {GroupIcon} from './GroupIcon'
import {useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {NarrowContext} from '../lib/layout'
import {AnchoredLayer, DialogBox, MenuPopover} from './FocusScopes'
import {useSlugInUse} from '../lib/slug-unique'
import {useQueries, useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query'
import {useInlineChanges, usePublishedPerspective} from '../lib/perspective'
import {errorsOf, validate, worst, type Problem} from '../lib/validation'
import {advisoryProblems} from '../lib/findings'
import {docQuery, isSingleton, previewTitle, publishedQuery, refTypesOf, relatedQuery, schemaOf, schemasQuery, type DeskView, type Doc, type Schema} from '../lib/data'
import {DocPreview} from './Preview'
import {createDoc, discardDraft, discardPending, draftNew, edit, flush, publish, reasonOf, recoverPending, restorePending, setKeepScope, undo, unpublish, useAdvisories, useSaveState, type Recovered} from '../lib/edits'
import {openAfter, panesPath, splitRight, withView, type Pane, withParams} from '../lib/panes'
import {reportFocus} from '../lib/presence'
import {useRevealed} from '../lib/reveal'
import {DeletedBanner, ReferenceBanner, useDeleted} from './PaneBanners'
import {SignInAgain} from './SignInAgain'
import {useTip} from './Tip'
import {meQuery, useBoundElsewhere, useCanWrite, useStudioTokenRefused} from '../lib/session'
import {currentScopeQuery} from '../lib/scope-switch'
import {editorMode, viewOf, viewParam, type View} from '../lib/editor-mode'
import {InPresentationContext, PaneLink, usePaneNavigate, useStructureNavigate} from './PaneLink'
import {UnknownFields} from './BrokenValues'
import {unknownFields} from '../lib/broken'
import {ChangesContext, DocContext, DocIdContext, DocTypeContext, EditPathContext, UrlPathContext, FieldView, Fieldset, inFieldsets, LevelIcon, OpenObjectsContext, ProblemsContext, fieldClipboard} from './Fields'
import {changedFields} from '../lib/changes'
import {DeleteDialog} from './DeleteDialog'
import {UnpublishDialog} from './UnpublishDialog'
import {setActiveDocument} from '../lib/tasks-ui'
import {DocHeaderMenu, DocShareMenu, Keys, openPreview, useAltName} from './DocHeaderMenu'
import {InspectDialog, storedValue} from './InspectDialog'
import {CompareVersions, useCompareVersions} from './CompareVersions'
import {ago, HistoryPanel, RevisionFooter} from './HistoryPanel'
import {CommentsContext, CommentsPanel} from './Comments'
import {commentsQuery, threadsOf} from '../lib/comments'
import {historyQuery, revisionQuery} from '../lib/history'
import {PortableDocEditor, ReviewChanges} from './DocEditors'
import {PaperSidebar} from './PaperSidebar'
import {PAPER_TYPES} from '../lib/paper'
import {ActorAvatar, AvatarStack, PresenceHints, useDocPresence} from './Presence'
import {toast} from './Toasts'
import {intlTag, t as tt, translate, useLocale, useT, type Locale, type T} from '../lib/i18n'
import {BoundDatasetCard, ReadErrorCard, RefusedTokenCard} from './PaneError'
import {cancelSchedule, schedulePublish, scheduleQuery, type Schedule} from '../lib/schedules'
import {ScheduleDialog} from './ScheduleDialog'
import {ChevronDown, CheckmarkCircle, Clock, LockIcon, PublishIcon, SyncIcon, UnpublishIcon, Close as CloseIcon, ReadOnlyIcon, CommentIcon, Ellipsis, ErrorOutline, SplitVertical, TagIcon, WarningOutline, Copy, Trash, Undo, Expand, Collapse} from './icons'
import {useFocusMode} from './FocusMode'
import studio from '../studio.config'
import {useSchemaActions} from './SchemaActions'
import {LocationsBanner} from './LocationsBanner'
import {IncomingReferences} from './IncomingReferences'

/** Sanity's inspector name for it, so a copied Sanity-style link opens the same panel. */
const INCOMING = 'sanity/structure/incoming-references'
import {EditIcon, EyeOpenIcon, PreviewView} from './PreviewView'

type Props = {panes: Pane[]; index: number; split?: boolean; closeHref: string; header: ReactNode; closeIcon: ReactNode}

// Sanity's document views, as the reference configures them: the form, and the doc as
// JSON; plus Freeform where the type's editor mode offers it (FF3, lib/editor-mode.ts).

const NO_PROBLEMS: Problem[] = []
/** J44: fields drawn in the first frame; a longer form gets the rest right after. */
const FIRST_FIELDS = 40
// A field by its path: the element itself, or, when that is a wrapper (an image's), the
// first thing in it that takes focus (its drop box), as Sanity focuses (J59).
const TAKES_FOCUS = 'input:not([type=hidden], [hidden]), textarea, select, button, [tabindex], [contenteditable], bp-paper-canvas'
const fieldEl = (root: HTMLElement | null, path: string) => {
  const el = root?.querySelector<HTMLElement>(`[id="${CSS.escape(path)}"]`)
  return el && !el.matches(TAKES_FOCUS) ? (el.querySelector<HTMLElement>(TAKES_FOCUS) ?? el) : el
}

export function DocumentPane({panes, index, split, closeHref, header, closeIcon}: Props) {
  const t = useT()
  const locale = useLocale()
  const pane = panes[index] as Extract<Pane, {kind: 'doc'}>
  // Split siblings share a document id; field focus belongs to this pane instance.
  const paneRoot = useRef<HTMLElement>(null)
  const {data: schemas = []} = useQuery(schemasQuery)
  // Sanity's two perspectives, in the URL: the draft you edit (default), or the
  // published version, read-only (?perspective=published).
  const viewingPublished = usePublishedPerspective()
  const narrow = useContext(NarrowContext)
  const draftQ = useQuery(docQuery(pane.type, pane.id))
  // The published version: for its perspective, and (J15) to see what the draft changed.
  const publishedQ = useQuery({...publishedQuery(pane.type, pane.id), enabled: viewingPublished || (!!draftQ.data?._draft && draftQ.data?._hasPublished !== false)})
  const docQ = viewingPublished ? publishedQ : draftQ
  const schedule = useSchedule(pane.id, pane.type, draftQ.data?._rev)
  // J40: Sanity's "Pause to edit": the schedule goes, the draft is editable again.
  const [pausing, setPausing] = useState(false)
  const pause = () => {
    if (!schedule) return
    setPausing(true)
    cancelSchedule({data: {scheduleId: schedule._id}})
      .then(() => qc.invalidateQueries({queryKey: ['schedule', pane.id]}))
      .catch((e: Error) => toast({tone: 'critical', title: tt('Could not delete the schedule'), description: e.message}))
      .finally(() => setPausing(false))
  }
  const {data: shown, isPending, error} = docQ
  // J04: the Published perspective of a document that has only a draft (unpublished, or
  // never published): Sanity keeps the form, empty and read-only, and its footer says what
  // happened. A stub with no fields stands in for the published version.
  const noPublished = viewingPublished && publishedQ.data === null && !!draftQ.data
  const stub = useMemo(() => ({_id: pane.id, _publishedId: pane.id, _type: pane.type, _draft: false, _rev: '', _updatedAt: ''}) as Doc, [pane.id, pane.type])
  const doc = noPublished ? stub : shown
  // J16: an old revision (rev=… in the URL) shows in the form's place, read-only.
  const revQ = useQuery({...revisionQuery(pane.rev ?? ''), enabled: !!pane.rev})
  const revision = pane.rev ? revQ.data : undefined
  const reviewSchema = schemaOf(schemas, pane.type)
  const changedSet = new Set(
    !viewingPublished && !pane.rev && draftQ.data?._draft && publishedQ.data && reviewSchema ? changedFields(reviewSchema, publishedQ.data, draftQ.data).map((c) => c.field.name) : [],
  )
  const base = panesPath(panes)
  const navigate = usePaneNavigate()
  const inPresentation = useContext(InPresentationContext)
  const toStructure = useStructureNavigate()
  // Field groups (Sanity's tabs): the schema's default group first; '' = all fields.
  const defaultGroup = schemaOf(schemas, pane.type)?.groups?.find((g) => g.default)?.name ?? ''
  const [chosenGroup, setGroup] = useState<string | null>(null)
  const group = chosenGroup ?? defaultGroup
  // J13: the schema's rules, checked as you type (the draft only; published is what it is).
  const schemaForPane = schemaOf(schemas, pane.type)
  // The docs this one's reference fields point at (cached already for their previews).
  const refFields = (schemaForPane?.fields ?? []).filter((f) => f.type === 'reference' && typeof doc?.[f.name] === 'string')
  const targets = useQueries({queries: refFields.map((f) => docQuery(refTypesOf(f), doc![f.name] as string))})
  const byId = new Map(refFields.map((f, i) => [doc![f.name] as string, targets[i].data]))
  // J18: a new doc nobody has typed in yet exists only here; Sanity checks nothing until the first edit.
  const pristine = isPristine(doc, useSaveState(pane.id).state)
  // D04: on a doc made here, fields stay quiet until someone types (its initial values or an
  // Expectation's prefill are the studio's writes, not an edit): no red Title on a doc you
  // just made. Publishing still checks everything (the errors below are unchanged).
  // Made here: not saved yet, or created a moment ago (an Expectation's prefill saves at once).
  const [made, setMade] = useState<{id: string; acted: boolean}>()
  const justMade = !!doc && (pristine || (doc._hasPublished === false && Date.now() - Date.parse(String(doc._createdAt ?? '')) < 15_000))
  if (justMade && made?.id !== pane.id) setMade({id: pane.id, acted: false})
  const quiet = made?.id === pane.id && !made.acted
  // After the keystroke lands: re-rendering the form inside its input event drops it.
  const acted = () => quiet && setTimeout(() => setMade((m) => (m?.id === pane.id ? {...m, acted: true} : m)))
  const checked = doc && schemaForPane && !viewingPublished && !pristine ? validate(doc, schemaForPane, (id) => byId.get(id), t) : []
  // J28: a slug another document of this type has (a duplicate's copied slug) is taken, as Sanity says.
  const slugTaken = useSlugInUse(doc, schemaForPane, !!doc && !!schemaForPane && !viewingPublished && !pristine, t)
  const own = slugTaken.length ? [...checked, ...slugTaken] : checked
  // Barkpark's check on the last save adds the rules ours doesn't run (#22406).
  const advisories = useAdvisories(pane.id)
  const extra = advisories.length && schemaForPane && !viewingPublished ? advisoryProblems(advisories, schemaForPane, own, t) : []
  // In the form's order, as Sanity lists them (a field's own problems stay in theirs).
  const order = (p: Problem) => (schemaForPane?.fields ?? []).findIndex((f) => f.name === p.path.split(/[.[]/)[0])
  const problems = extra.length ? [...own, ...extra].map((p, i) => [p, i] as const).sort(([a, i], [b, j]) => order(a) - order(b) || i - j).map(([p]) => p) : own
  // J13: only errors block publishing; warnings and infos are shown, never in the way.
  const errors = errorsOf(problems)
  const openObjects = useOpenObjects(pane.id)
  // Sanity's `inspect=…/validation`: the panel survives a reload and a copied link.
  const inspecting = pane.inspect === 'validation'
  const toggleValidation = () => navigate({href: withParams(panes, index, {inspect: inspecting ? undefined : 'validation', rev: undefined})})
  const goTo = (p: Pick<Problem, 'path' | 'group'>) => {
    // A field inside an array item: the item opens from the URL's path (J52, its dialog),
    // and the pane focuses the field once it is drawn, as a link to it does (Sanity's jump).
    if (p.path.includes('[_key==')) {
      opened.current = null
      return void navigate({href: withParams(panes, index, {path: p.path}), replace: true})
    }
    if (group && p.group !== group) setGroup('')
    // A field inside collapsed objects: open each one on the way (Sanity does).
    p.path.split('.').slice(0, -1).forEach((_, i, parts) => openObjects.toggle(parts.slice(0, i + 1).join('.'), true))
    requestAnimationFrame(() => fieldEl(paneRoot.current, p.path)?.focus())
  }
  // J40: the document's comment threads, for the field buttons and the inspector.
  const commentsQ = useQuery(commentsQuery(pane.id))
  const [commentField, setCommentField] = useState<string | undefined>()
  // The picked thread (an inline comment's): its span shows active in the body.
  const [commentThread, setCommentThread] = useState<string | undefined>()
  const openComments = useRef((_path?: string, _thread?: string) => {})
  openComments.current = (path, thread) => {
    setCommentField(path)
    setCommentThread(thread)
    if (pane.inspect !== 'comments') void navigate({href: withParams(panes, index, {inspect: 'comments', rev: undefined})})
  }
  const commentsApi = useMemo(
    () => ({docId: pane.id, docType: pane.type, threads: threadsOf(commentsQ.data ?? []), open: (path?: string, thread?: string) => openComments.current(path, thread), active: commentThread, select: setCommentThread}),
    [pane.id, pane.type, commentsQ.data, commentThread],
  )
  const schema = schemaOf(schemas, pane.type)
  const fieldLabels = useMemo(() => Object.fromEntries((schema?.fields ?? []).map((f) => [f.name, f.title ?? f.name])), [schema])
  // Decision 0004: a type with a layout also opens in Barkpark's block canvas (FF3,
  // lib/editor-mode.ts, from the schema's layout); an Expectation doc once it carries its block list.
  const {canWrite, editReason, signedOut} = useCanWrite()
  const boundElsewhere = useBoundElsewhere()
  const studioTokenRefused = useStudioTokenRefused()

  // J52: the focused field lives in the URL (Sanity's `path=`): a reload or a copied
  // link opens on it. Opening: focus the named field (showing all groups if it sits
  // in another). Editing: the URL follows focus, replaced (no history entries).
  const schemaHere = schemaOf(schemas, pane.type)
  const opened = useRef<string | null>(null)
  useEffect(() => {
    const want = pane.path
    if (!want || !doc || !schemaHere || opened.current === `${pane.id}|${want}`) return
    opened.current = `${pane.id}|${want}`
    const top = schemaHere.fields.find((f) => f.name === want.split(/[.[]/)[0])
    if (top?.group && group && top.group !== group) setGroup('')
    // A field inside collapsed objects opens them (J13/J14).
    want.split('[')[0]!.split('.').slice(0, -1).forEach((_, i, parts) => openObjects.toggle(parts.slice(0, i + 1).join('.'), true))
    let frames = 90
    const tryFocus = () => {
      const el = fieldEl(paneRoot.current, want)
      if (el) (el.focus({preventScroll: true}), el.scrollIntoView({block: 'center'}))
      else if (frames-- > 0) requestAnimationFrame(tryFocus)
    }
    requestAnimationFrame(tryFocus)
  }, [pane.path, pane.id, doc, schemaHere, group])
  // J07: in the body canvas the caret moves between blocks without a focus event;
  // the block it is in is this editor's presence (`body[_key=="p5"]`, Sanity's path).
  useEffect(() => {
    const on = () => {
      const node = getSelection()?.focusNode
      const el = node && (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))
      if (!el || !paneRoot.current?.contains(el)) return
      const block = el.closest('[data-bp-id]')
      const canvas = el.closest('.body-canvas')
      if (block && canvas?.id) reportFocus(pane.id, `${canvas.id}[_key=="${block.getAttribute('data-bp-id')}"]`)
    }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [pane.id])
  const pathTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Only focus the author moved (a click or a key in the form), not the studio's own
  // focusing of a field on open.
  const userMoved = useRef(0)
  const keepPathInUrl = (id: string) => {
    if (Date.now() - userMoved.current > 1000) return
    if (!id || id === pane.path || !schemaHere?.fields.some((f) => f.name === id.split(/[.[]/)[0])) return
    // An array item's "…" button (links[_key=="l1"]-menuButton) is not a field: written as the
    // path, it read as a link into the item and opened its dialog (J33).
    if (id.endsWith('-menuButton')) return
    clearTimeout(pathTimer.current)
    // The whole URL: in Presentation the panes and the perspective are its query (J63: a
    // Published click within these 300 ms was undone by a write built from the old URL).
    const at = location.pathname + location.search
    pathTimer.current = setTimeout(() => {
      // The URL moved meanwhile (a reference opened, a pane closed, Published): it wins.
      if (location.pathname + location.search !== at) return
      opened.current = `${pane.id}|${id}` // ours, not a link to follow
      void navigate({href: withParams(panes, index, {path: id}), replace: true})
    }, 300)
  }
  const saveState = useSaveState(pane.id).state
  const loggedOut = saveState === 'signedOut' || signedOut
  const publishingKey = useRef(false)
  const mode = editorMode(pane.type, schemaOf(schemas, pane.type))
  const freeform = mode !== 'none' && !viewingPublished && (mode === 'main' || Array.isArray(doc?.blocks))
  // Published is read in Classic: the canvas edits the draft.
  const view: View = viewOf(pane.view, mode) === 'freeform' && !freeform ? 'classic' : viewOf(pane.view, mode)
  const [canvasSeen, setCanvasSeen] = useState<string | null>(null)
  if (freeform && view === 'freeform' && canvasSeen !== pane.id) setCanvasSeen(pane.id)
  // Agency parity (demo): VITE_FORM_VIEW_TITLE names the form tab with Sanity's edit icon
  // ("Felt", as the Agency's default-document-node.ts does); VITE_HIDE_JSON_VIEW=1 drops
  // the JSON tab (Sanity has it as Inspect in the menu). Unset, both stay as before.
  const formTitle = import.meta.env.VITE_FORM_VIEW_TITLE as string | undefined
  const hideJson = import.meta.env.VITE_HIDE_JSON_VIEW === '1'
  // Opt-in: the reference post declares desk.preview too, and its tabs stay as Sanity's.
  const previewTemplate = import.meta.env.VITE_PREVIEW_VIEW === '1' ? schema?.preview : undefined
  const views: {id: View; title: string; icon?: ReactNode}[] = [
    formTitle && !freeform ? {id: 'classic', title: formTitle, icon: <EditIcon />} : {id: 'classic', title: freeform ? t('Classic') : t('Editor')},
    ...(freeform ? [{id: 'freeform' as View, title: t('Freeform')}] : []),
    ...(hideJson ? [] : [{id: 'json' as View, title: 'JSON'}]),
    // The schema's desk.preview as a view: the site in an iframe (Agency's "Forhåndsvisning").
    ...(previewTemplate ? [{id: 'preview' as View, title: 'Forhåndsvisning', icon: <EyeOpenIcon />}] : []),
    // B09: the schema's related-document views (desk.views), after the doc's own.
    ...(schema?.views ?? []).map((v) => ({id: `desk:${v.id}` as View, title: v.title})),
  ]
  const next = panes[index + 1]
  const qc = useQueryClient()
  // Creation actions seed their draft explicitly. A missing deep link must not
  // silently become a new document; keep the deleted-document recovery (J32).
  const deleted = useDeleted(pane.type, pane.id, draftQ.data === null && !viewingPublished)
  // B13: a singleton's one document (id = its type) that does not exist opens empty and
  // is created on its first edit, like a new doc; never "not found" nor "deleted" (it
  // can't be deleted here; History still restores an old version).
  const single = isSingleton(schemas, pane.type)
  useEffect(() => {
    if (single && pane.id === pane.type && draftQ.data === null && !viewingPublished) draftNew(qc, pane.type, pane.id, schemaOf(schemas, pane.type)?.initialValues ?? {})
  }, [single, pane.id, pane.type, draftQ.data, viewingPublished])
  // J44: the form's fields are memoized, so what they get must hold still while
  // typing: one steady onEdit (it reads the latest doc), one onChange per field
  // name, and context values that change only when their content does.
  const latestDoc = useRef(doc)
  latestDoc.current = doc
  const onEdit = useCallback((field: string, value: unknown) => latestDoc.current && edit(qc, latestDoc.current, field, value), [qc])
  const onChangeOf = useMemo(() => {
    const byName = new Map<string, (v: unknown) => void>()
    return (name: string) => byName.get(name) ?? byName.set(name, (v) => onEdit(name, v)).get(name)!
  }, [onEdit])
  // Closing the pane (or navigating it away) sends what is still waiting.
  useEffect(() => () => flush(qc, pane.id), [qc, pane.id])
  // B11 widen: edits this browser kept from a reload or crash (lib/pending-edits.ts), per
  // workspace, project, dataset and editor. Unchanged underneath: sent again; else asked.
  const scopeNow = useQuery(currentScopeQuery).data
  const me = useQuery(meQuery).data
  const keepScope = scopeNow && me ? [scopeNow.workspace, scopeNow.project, scopeNow.dataset, me.email ?? '-'].join('|') : null
  useEffect(() => setKeepScope(keepScope), [keepScope])
  const [recovered, setRecovered] = useState<Recovered | null>(null)
  const editable = !!draftQ.data && !viewingPublished
  useEffect(() => {
    setRecovered(null)
    // Judged against the schema as it is now (a field it dropped or retyped is not sent).
    if (!keepScope || !editable || !draftQ.data || !schema) return
    let live = true
    void recoverPending(qc, draftQ.data, schema).then((r) => {
      if (!live || !r) return
      if ('ask' in r) setRecovered(r.ask)
      else toast({title: tt('Unsaved changes from {date} were put back.', {date: longDate(new Date(r.replayed).toISOString(), locale)})})
    })
    return () => void (live = false)
  }, [keepScope, pane.id, editable, !!schema])
  // J28: Inspect (Ctrl+Alt+I) and Duplicate, which opens the copy in this pane.
  const [inspectOpen, setInspectOpen] = useState(false)
  const [askDelete, setAskDelete] = useState(0)
  const metaButton = useRef<HTMLButtonElement>(null)
  const duplicate = (from: Doc) => {
    const id = crypto.randomUUID()
    const fields = Object.fromEntries(Object.entries(from).filter(([k]) => !k.startsWith('_')))
    const created = createDoc(qc, from._type, id, fields)
    navigate({href: panesPath([...panes.slice(0, index), {...pane, id, view: undefined, path: undefined, rev: undefined}])})
    created.then(
      () => toast({title: tt('The document was successfully duplicated')}),
      (err) => toast({tone: 'critical', title: tt('Could not duplicate the document'), description: (err as Error).message}),
    )
  }
  // Keyed by `base`, the pane chain as a string: a new array each render, the same chain.
  const openRef = useCallback(
    (type: string, id: string, parentRefPath: string) => ({
      href: openAfter(panes, index, {kind: 'doc', id, type, parentRefPath}),
      selected: next?.kind === 'doc' && next.id === id && next.parentRefPath === parentRefPath,
      active: index === panes.length - 2,
    }),
    [base, index],
  )
  // Keyed by content: both are rebuilt on every render.
  const formFields = (schema?.fields ?? []).filter((f) => !group || f.group === group)
  const revealed = useRevealed(formFields.length, FIRST_FIELDS, `${pane.id}|${group}`)
  const changedKey = [...changedSet].join(',')
  const review = useRef(() => {})
  review.current = () => navigate({href: withParams(panes, index, {inspect: 'review'})})
  // J68: Sanity's "Inline changes" (sticky in the URL) and "Compare versions" (draft beside published).
  const inline = useInlineChanges()
  const compare = useCompareVersions(pane.type, pane.id)
  const comparable = !viewingPublished && !pane.rev && !!draftQ.data?._draft && !!publishedQ.data
  const changes = useMemo(() => ({changed: changedSet, review: () => review.current(), inline, published: publishedQ.data}), [changedKey, inline, publishedQ.data])
  const problemsKey = JSON.stringify(problems)
  const steadyProblems = useMemo(() => problems, [problemsKey])
  // A doc made a moment ago stays quiet, but a taken slug shows at once (Sanity flags a duplicate's).
  const quietProblems = useMemo(() => (slugTaken.length ? slugTaken : NO_PROBLEMS), [slugTaken.map((p) => p.path).join()])
  // Document-level fieldsets (Sanity's) group the form's fields as a composite's do.
  const fieldView = (f: (typeof formFields)[number], values: Record<string, unknown>) => (
    <FieldView key={f.name} field={f} path={f.name} value={values[f.name]} openRef={openRef} onChange={onChangeOf(f.name)} />
  )
  // The form's fields with what they read: the pane's form, and (J68) each side of Compare versions.
  // Sanity's document shortcuts (Ctrl+Alt+P publish, I inspect, O preview, D delete).
  const docShortcut = (e: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'code' | 'preventDefault'>) => {
    // Sanity's publish shortcut, also mid-edit (publish flushes first). Like its
    // button, a no-op with nothing to publish or while a publish is running.
    if (e.ctrlKey && e.altKey && e.code === 'KeyP' && doc && !errors.length) {
      e.preventDefault()
      if (!publishingKey.current && !pristine && (doc._draft || saveState !== 'saved')) {
        publishingKey.current = true
        void publishAndTell(qc, doc)
          .catch((err: Error) => toast({tone: 'critical', title: tt('Could not publish'), description: reasonOf(err.message) ?? err.message}))
          .finally(() => (publishingKey.current = false))
      }
    }
    if (e.ctrlKey && e.altKey && e.code === 'KeyI' && doc) (e.preventDefault(), setInspectOpen(true))
    if (e.ctrlKey && e.altKey && e.code === 'KeyO' && doc) {
      const url = studio.document?.productionUrl?.(doc)
      if (url) (e.preventDefault(), openPreview(url))
    }
    if (e.ctrlKey && e.altKey && e.code === 'KeyD' && doc && !viewingPublished) (e.preventDefault(), setAskDelete((n) => n + 1))
  }
  // Sanity moves focus into a document as it opens, so its shortcuts work at once. Ours
  // stays where it was (the list row clicked, or the page): the last document pane
  // takes them from there too, but never from inside another pane, a dialog or a menu.
  const shortcut = useRef(docShortcut)
  shortcut.current = docShortcut
  const lastDoc = panes.slice(index + 1).every((p) => p.kind !== 'doc')
  useEffect(() => {
    if (!lastDoc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey && e.altKey)) return
      if ((e.target as Element | null)?.closest?.('.pane.doc, [role=dialog], [role=menu], [role=listbox]')) return
      shortcut.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lastDoc])
  const formBody = (o: {shown: Doc; values: Record<string, unknown>; changes: typeof changes | null; problems: Problem[]; disabled: boolean; fields: typeof formFields; unknown: boolean}) => (
    <CommentsContext.Provider value={commentsApi}>
    <ChangesContext.Provider value={o.changes}>
    <DocIdContext.Provider value={o.shown._publishedId}>
    <DocTypeContext.Provider value={pane.type}>
    <DocContext.Provider value={o.shown}>
    <UrlPathContext.Provider value={pane.path}>
    <EditPathContext.Provider value={onEdit}>
    <ProblemsContext.Provider value={o.problems}>
    <OpenObjectsContext.Provider value={openObjects}>
    <fieldset className="form-fields" disabled={o.disabled} title={editReason}>
      {inFieldsets(o.fields, schema?.fieldsets).map((g) => ('set' in g ? <Fieldset key={`fs:${g.set.name}`} path={`fieldset:${g.set.name}`} fieldset={g.set}>{g.fields.map((f) => fieldView(f, o.values))}</Fieldset> : fieldView(g, o.values)))}
      {o.unknown && <UnknownFields doc={o.shown} names={unknownFields(schema!, o.shown)} onRemove={(name) => onEdit(name, undefined)} />}
    </fieldset>
    </OpenObjectsContext.Provider>
    </ProblemsContext.Provider>
    </EditPathContext.Provider>
    </UrlPathContext.Provider>
    </DocContext.Provider>
    </DocTypeContext.Provider>
    </DocIdContext.Provider>
    </ChangesContext.Provider>
    </CommentsContext.Provider>
  )
  // J47: validation is heard when an edit changes it, with what it blocks (the
  // count, then the first field and message). Opening a doc says nothing new.
  const problemCount = useRef<number | null>(null)
  const errorsKey = JSON.stringify(errors)
  useEffect(() => {
    if (!doc) return
    const was = problemCount.current
    problemCount.current = errors.length
    if (was === null) return
    if (errors.length) {
      if (errors.length !== was || was === 0)
        announce(
          `${errors.length === 1 ? tt('1 validation error') : tt('{n} validation errors', {n: errors.length})}. ${errors[0]!.title}: ${errors[0]!.message}. ${tt('Publishing is blocked.')}`,
        )
    } else if (was > 0) announce(tt('No validation errors'))
  }, [errorsKey, !!doc])

  // J07: the room sees this doc as where we are when it is the last pane, and the
  // field as soon as the caret enters one (inputs carry id = the field path).
  const here = useDocPresence(pane.id)
  const body = useRef<HTMLDivElement>(null)
  const isLast = index === panes.length - 1
  useEffect(() => {
    if (isLast) reportFocus(pane.id, null)
  }, [isLast, pane.id])
  // J66: the last pane's document is the Tasks sidebar's "Active Document".
  useEffect(() => {
    if (!isLast) return
    setActiveDocument({id: pane.id, type: pane.type})
    return () => setActiveDocument(null)
  }, [isLast, pane.id, pane.type])

  return (
    <section
      ref={paneRoot}
      aria-label={doc && schema ? docTitle(doc, schema, t) : t('Document')}
      className="pane doc"
      data-testid="document-pane"
      data-pane={`doc:${pane.id}`}
      data-pane-index={index}
      onInputCapture={acted}
      onPasteCapture={acted}
      onDropCapture={acted}
      onFocus={(e) => {
        // J07: the most specific path: an array item (data-presence-path) unless a
        // field inside it has its own, longer one.
        const target = e.target as HTMLElement
        const field = target.closest('.form-fields [id]')?.id
        const item = target.closest<HTMLElement>('[data-presence-path]')?.dataset.presencePath
        reportFocus(pane.id, (item && !(field?.startsWith(`${item}.`) || field?.startsWith(`${item}[`)) ? item : field) ?? null)
      }}
      onKeyDown={(e) => {
        docShortcut(e)
        // F7: the document's own undo (this editor's changes only, across fields and
        // across others' edits). The block canvas keeps its own.
        const mod = e.metaKey || e.ctrlKey
        const key = e.key.toLowerCase()
        if (mod && !e.altKey && (key === 'z' || key === 'y') && !viewingPublished && !(e.target as HTMLElement).closest('bp-paper-canvas')) {
          e.preventDefault()
          const field = undo(qc, pane.id, key === 'z' && !e.shiftKey)
          if (field) requestAnimationFrame(() => fieldEl(paneRoot.current, field)?.focus())
        }
      }}
    >
      <header className="pane-header">
        <AvatarStack people={here} />
        <span className="title chips">
          {draftQ.data?._hasPublished === false ? (
            <span className="chip" data-off="" aria-disabled="true" title={t('Not published')}>
              <span className="dot published" />
              <span className="chip-label">{t('Published')}</span>
            </span>
          ) : (
            <TipChip
              tip={() => {
                const at = draftQ.data?._draft ? publishedQ.data?._updatedAt : draftQ.data?._updatedAt
                return at ? t('Published {date}', {date: longDate(at, locale)}) : t('Published')
              }}
              data-selected={viewingPublished ? '' : undefined}
              data-tone="positive"
              aria-pressed={viewingPublished}
              onClick={() => navigate({href: `${base}?perspective=published`})}
            >
              <span className="dot published" />
              <span className="chip-label">{t('Published')}</span>
            </TipChip>
          )}
          <TipChip
            tip={() => (draftQ.data?._draft && draftQ.data._updatedAt ? t('Edited {date}', {date: longDate(draftQ.data._updatedAt, locale)}) : t('No unpublished edits'))}
            data-active={!viewingPublished && draftQ.data?._draft && !pristine ? '' : undefined}
            data-selected={!viewingPublished ? '' : undefined}
            aria-pressed={!viewingPublished}
            onClick={() => navigate({href: `${base}?perspective=drafts`})}
          >
            <span className="dot draft" />
            <span className="chip-label">{t('Draft')}</span>
          </TipChip>
          {/* J40: Sanity's scheduled version chip. */}
          {schedule && (
            <span className="chip" data-tone="scheduled" title={t('Scheduled to be published on {date}', {date: longDate(schedule.publishAt, locale)})}>
              <Clock />
              {t('Scheduled publish')}
              <LockIcon />
            </span>
          )}
        </span>
        {doc && !pristine && <DocShareMenu doc={doc} />}
        {/* Sanity shows it only when there is something to show (an info alone: a check). */}
        {!viewingPublished && (problems.length > 0 || inspecting) && (
          <button
            type="button"
            className="icon-btn validation-btn"
            aria-label={t('Validation')}
            data-tip={t('Validation')}
            aria-pressed={inspecting}
            data-problems={problems.length || undefined}
            data-level={worst(problems)}
            onClick={() => void toggleValidation()}
          >
            {worst(problems) === 'warning' ? <WarningOutline /> : worst(problems) === 'info' ? <CheckmarkCircle /> : <ErrorOutline />}
          </button>
        )}
        {/* D12: a paper's metadata (slug, description, weighted tags) beside the canvas. */}
        {doc && PAPER_TYPES.has(pane.type) && !viewingPublished && (
          <button
            ref={metaButton}
            type="button"
            className="icon-btn"
            aria-label={t('Document metadata')}
            title={t('Document metadata')}
            aria-pressed={pane.inspect === 'meta'}
            onClick={() => navigate({href: withParams(panes, index, {inspect: pane.inspect === 'meta' ? undefined : 'meta'})})}
          >
            <TagIcon />
          </button>
        )}
        {doc && (
          <button
            type="button"
            className="icon-btn comments-btn"
            aria-label={t('Comments')}
            data-tip={t('Comments')}
            title={t('Comments')}
            aria-pressed={pane.inspect === 'comments'}
            onClick={() => navigate({href: withParams(panes, index, {inspect: pane.inspect === 'comments' ? undefined : 'comments', rev: undefined})})}
          >
            <CommentIcon />
          </button>
        )}
        {doc && schema && (
          <DocHeaderMenu doc={doc} schema={schema} readOnly={viewingPublished || !canWrite} onInspect={() => setInspectOpen(true)} onHistory={() => navigate({href: withParams(panes, index, {inspect: 'history'})})} onIncoming={() => navigate({href: withParams(panes, index, {inspect: INCOMING, rev: undefined})})} onCompare={comparable ? compare.open : undefined} inline={inline} onInline={compare.toggleInline} />
        )}
        {/* Sanity's Presentation: the document opens in Structure, leaving the preview. */}
        {inPresentation && (
          <button type="button" className="icon-btn" aria-label={t('Open in Structure')} data-tip={t('Open in Structure')} onClick={() => toStructure(`/structure/${pane.type};${pane.id}`)}>
            <SplitVertical />
          </button>
        )}
        {/* Sanity's Presentation: no focus mode, and a close that goes back to the page's documents. */}
        {inPresentation && (
          <PaneLink href={closeHref} className="icon-btn" aria-label={t('Close pane')} data-tip={t('Close pane')} data-testid="pane-close">
            {closeIcon}
          </PaneLink>
        )}
        {/* J42: a narrow window has no splits and no close: the back link goes back. */}
        {narrow && !inPresentation && <FocusButton index={index} />}
        {!narrow && !inPresentation && (
          <>
            <button type="button" className="icon-btn" aria-label={t('Split pane right')} data-tip={t('Split pane right')} onClick={() => navigate({href: splitRight(panes, index)})}>
              <SplitVertical />
            </button>
            <FocusButton index={index} />
            {split ? (
              // Like Sanity: closing one side of a split is a button, closing a pane a link.
              <button type="button" className="icon-btn" aria-label={t('Close split pane')} data-tip={t('Close pane')} data-testid="pane-close" onClick={() => navigate({href: closeHref})}>
                {closeIcon}
              </button>
            ) : (
              <PaneLink href={closeHref} className="icon-btn" aria-label={t('Close pane')} data-tip={t('Close pane')} data-testid="pane-close">
                {closeIcon}
              </PaneLink>
            )}
          </>
        )}
      </header>
      {/* Sanity's document panel: a column (banners, title bar, form, footer) with the inspector beside it, under the pane header. */}
      <div className="doc-split">
      <div className="doc-column">
      {/* Sanity's banners sit right under the pane header, above the title bar and the scrolling form: always in view. */}
      <div className="pane-banners">
        <ReferenceBanner panes={panes} index={index} closeHref={closeHref} />
        {loggedOut && doc && (
          // J48: the session is gone — said where you are editing, with the way back.
          <div className="pane-banner" role="alert">
            <span>{t("You've been logged out. Your edits are kept here and saved once you sign in again.")}</span>
            <SignInAgain />
          </div>
        )}
        {recovered && doc && (
          <div className="pane-banner" role="alert" data-testid="kept-edits">
            <span>
              {recovered.fields.length > 0 && t('Unsaved changes from {date}, kept in this browser. The document has changed since.', {date: longDate(new Date(recovered.pending.at).toISOString(), locale)})}
              {recovered.gone?.length
                ? `${recovered.fields.length ? ' ' : ''}${t('Unsaved changes to {fields} from {date} cannot be put back: the schema has changed since.', {fields: recovered.gone.map((f) => fieldLabels[f.split(/[.[]/)[0]!] ?? f).join(', '), date: longDate(new Date(recovered.pending.at).toISOString(), locale)})}`
                : null}
            </span>
            <span className="pane-banner-actions">
              {recovered.fields.length > 0 && (
                <button type="button" className="btn-text" onClick={() => (restorePending(qc, doc, recovered), setRecovered(null))}>
                  {t('Restore')}
                </button>
              )}
              <button type="button" className="btn-text" onClick={() => (discardPending(recovered), setRecovered(null))}>
                {t('Discard')}
              </button>
            </span>
          </div>
        )}
        {/* J40: as Sanity's scheduled version, the draft is locked until its schedule is paused (cancelled). */}
        {schedule && doc && (
          <div className="pane-banner" data-tone="scheduled" role="note">
            <span className="pane-banner-text">
              <LockIcon />
              {t('Scheduled to be published on {date}', {date: longDate(schedule.publishAt, locale)})}
            </span>
            {canWrite && (
              <button type="button" className="btn pane-banner-primary" disabled={pausing} onClick={pause}>
                {t('Pause to edit')}
              </button>
            )}
          </div>
        )}
        {/* J49: Sanity's permission banner: no tint, the read-only icon, medium text. */}
        {editReason && doc && (
          <div className="pane-banner" data-tone="transparent" role="note">
            <ReadOnlyIcon />
            <span>{editReason}</span>
          </div>
        )}
      </div>
      <div className="doc-title-bar">
        {header}
        {/* Sanity shows the view tabs only when a document has more than one view, and none in Presentation. */}
        {views.length > 1 && !inPresentation && <div className="view-tabs" role="tablist" aria-label={t('Views')}>
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => navigate({href: withView(panes, index, viewParam(v.id, mode))})}>
              {v.icon}
              {v.title}
            </button>
          ))}
        </div>}
      </div>
      <div className="doc-main">
      <PresenceHints docId={pane.id} scroller={body} />
      <div className="pane-body" ref={body}>
        {/* J50: a read that fails is tried again by itself (the toast says "Trying to connect…"); after that, Retry. */}
        {isPending && !error && (
          <div className="pane-loading" aria-busy="true" data-testid="doc-loading">
            {t('Loading document…')}
          </div>
        )}
        {error &&
          !doc &&
          (boundElsewhere ? (
            <BoundDatasetCard {...boundElsewhere} />
          ) : studioTokenRefused ? (
            <RefusedTokenCard />
          ) : /→ 403\b/.test(String(error)) ? (
            // J49: a doc this editor may not read.
            <div className="pane-banner" role="alert">
              <span>{t("You don't have access to this document.")}</span>
            </div>
          ) : (
            <ReadErrorCard title={t('Could not load the document')} error={error} failures={docQ.failureCount} retrying={docQ.fetchStatus !== 'idle'} onRetry={() => void docQ.refetch()} />
          ))}
        {deleted && !doc && <DeletedBanner type={pane.type} id={pane.id} />}
        {doc === null && !error && !viewingPublished && !deleted && (
          <div className="pane-not-found">
            {/* J02: Sanity's title, its text with our known type. */}
            <h2>{t('The document was not found')}</h2>
            <p>
              <WithCode text={t('A document with the {id} identifier could not be found.')} code={pane.id} />
            </p>
            <PaneLink className="btn" href={closeHref}>
              {t('Go back')}
            </PaneLink>
          </div>
        )}
        {!isPending && !doc && !error && viewingPublished && <p role="alert">{t('Not published.')}</p>}
        {doc && view === 'json' && <pre className="json-view">{JSON.stringify(storedValue(doc), null, 2)}</pre>}
        {doc && view === 'preview' && previewTemplate && <PreviewView template={previewTemplate} doc={doc} id={pane.id} />}
        {doc && view.startsWith('desk:') && (() => {
          const v = schema?.views?.find((x) => `desk:${x.id}` === view)
          return v ? <RelatedView view={v} id={pane.id} hrefOf={(d) => openAfter(panes, index, {kind: 'doc', id: d._publishedId, type: d._type})} selected={next?.kind === 'doc' ? next.id : undefined} /> : null
        })()}
        {/* Mounted once per doc and then only hidden: the canvas mis-places typing
            after it is mounted again in a page (task-f24549dea0618da2), and a remount costs a load. */}
        {/* A doc still being created has no block list yet (D04): the canvas waits for it. */}
        {freeform && !!doc?._rev && (view === 'freeform' || canvasSeen === pane.id) && (
          <div hidden={view !== 'freeform'}>
            {/* D11: the canvas is not live co-editing (decision 0004, Known limit): say so
                when someone else has this doc open. */}
            {here.length > 0 && (
              <p className="pd-hint" role="note" data-testid="coediting-hint">
                {here.length === 1
                  ? t('{name} has this document open. You see where the others are typing. Their saved changes appear when this canvas is idle. Avoid editing the same block at the same time.', {name: here[0]!.name})
                  : t('{n} others have this document open. You see where the others are typing. Their saved changes appear when this canvas is idle. Avoid editing the same block at the same time.', {n: here.length})}
              </p>
            )}
            <PortableDocEditor
              type={pane.type}
              id={pane.id}
              labels={fieldLabels}
              openDoc={(docId, docType) => navigate({href: openAfter(panes, index, {kind: 'doc', id: docId, type: docType})})}
            />
          </div>
        )}
        {pane.rev && revQ.data === null && <p role="alert">{t("This revision can't be found. Pick another entry in the history.")}</p>}
        {doc && schema && view === 'classic' && (!pane.rev || revision) && (
          <div
            className="doc-form"
            onBlur={() => flush(qc, pane.id)}
            onFocus={(e) => keepPathInUrl((e.target as HTMLElement).id)}
            onPointerDown={() => (userMoved.current = Date.now())}
            onKeyDown={(e) => {
              userMoved.current = Date.now()
              copyPasteKey(e)
            }}
          >
            {/* The type's name above the title, unless it is the title (a singleton named by its type). */}
            {docTitle(doc, schema, t) !== schema.title && <div className="kind">{schema.title}</div>}
            <h1>{docTitle(doc, schema, t)}</h1>
            {!revision && <LocationsBanner doc={doc} />}
            <GroupTabs schema={schema} value={group} onChange={setGroup} problems={problems} />
            {/* The published version is read-only: a disabled fieldset disables every control in it. */}
            {formBody({
              shown: revision ? ({...doc, ...revision.content} as Doc) : doc,
              values: revision ? revision.content : doc,
              changes,
              problems: revision ? NO_PROBLEMS : quiet ? quietProblems : steadyProblems,
              disabled: viewingPublished || !!revision || !canWrite || !!schedule,
              fields: formFields.slice(0, revealed),
              unknown: !revision && revealed >= formFields.length,
            })}
          </div>
        )}
      </div>
      {pane.inspect === 'meta' && doc && PAPER_TYPES.has(pane.type) && !viewingPublished && (
        <PaperSidebar
          key={pane.id}
          doc={doc}
          published={!doc._draft || doc._hasPublished !== false}
          onEdit={onEdit}
          onClose={() => void navigate({href: withParams(panes, index, {inspect: undefined})}).then(() => metaButton.current?.focus())}
        />
      )}
      </div>
      {pane.rev
        ? <RevisionFooter type={pane.type} revisionId={pane.rev} timestamp={revision?.timestamp} onRestored={() => navigate({href: withParams(panes, index, {rev: undefined})})} />
        : viewingPublished
        ? doc && <PublishedFooter doc={doc} single={single} />
        : doc && <DocFooter doc={doc} closeHref={closeHref} blocked={errors.length} single={single} onDuplicate={() => duplicate(doc)} askDelete={askDelete} onReview={() => navigate({href: withParams(panes, index, {inspect: 'review', rev: undefined})})} />}
      </div>
      {inspecting && !viewingPublished && <ValidationPanel problems={problems} onPick={goTo} onClose={() => void toggleValidation()} />}
      {pane.inspect === INCOMING && <IncomingReferences id={pane.id} panes={panes} index={index} onClose={() => navigate({href: withParams(panes, index, {inspect: undefined})})} />}
      {pane.inspect === 'comments' && (
        <CommentsPanel
          docId={pane.id}
          docType={pane.type}
          fieldTitle={(path) => path.split('.').map((part, i) => (i === 0 ? fieldLabels[part] ?? part : part)).join(' › ')}
          focusField={commentField}
          active={commentThread}
          onSelect={setCommentThread}
          onGoToField={(path) => goTo({path, group: (schema?.fields.find((f) => f.name === path.split('.')[0]) as {group?: string} | undefined)?.group})}
          onClose={() => (setCommentThread(undefined), navigate({href: withParams(panes, index, {inspect: undefined})}))}
        />
      )}
      {(pane.inspect === 'history' || pane.inspect === 'review') && (
        <HistoryPanel
          type={pane.type}
          id={pane.id}
          tab={pane.inspect}
          onTab={(tab) => navigate({href: withParams(panes, index, {inspect: tab, rev: undefined})})}
          review={
            draftQ.data && reviewSchema && (
              <ReviewChanges
                schema={reviewSchema}
                draft={draftQ.data}
                published={publishedQ.data}
                onRevert={(changes) => changes.forEach((c) => onEdit(c.field.name, c.before))}
              />
            )
          }
          selected={pane.rev}
          onPick={(e) => navigate({href: withParams(panes, index, {rev: e?.revision.id})})}
          onClose={() => navigate({href: withParams(panes, index, {inspect: undefined, rev: undefined})})}
        />
      )}
      </div>
      {/* J68: one dialog per document, not one per split sibling. */}
      {compare.isOpen && comparable && !pane.sibling && doc && schema && publishedQ.data && (
        <CompareVersions
          onClose={compare.close}
          published={
            <>
              <LocationsBanner doc={publishedQ.data} />
              <GroupTabs schema={schema} value={group} onChange={setGroup} problems={NO_PROBLEMS} />
              {formBody({shown: publishedQ.data, values: publishedQ.data, changes: null, problems: NO_PROBLEMS, disabled: true, fields: formFields, unknown: false})}
            </>
          }
          draft={
            <>
              <LocationsBanner doc={doc} />
              <GroupTabs schema={schema} value={group} onChange={setGroup} problems={problems} />
              {formBody({shown: doc, values: doc, changes: {...changes, inline: true}, problems: quiet ? quietProblems : steadyProblems, disabled: !canWrite || !!schedule, fields: formFields, unknown: false})}
            </>
          }
        />
      )}
      {inspectOpen && doc && schema && <InspectDialog doc={doc} title={docTitle(doc, schema, t)} onClose={() => setInspectOpen(false)} />}
    </section>
  )
}

/** Sanity's validation inspector: every problem, click one to go to its field. */
function ValidationPanel({problems, onPick, onClose}: {problems: Problem[]; onPick: (p: Problem) => void; onClose: () => void}) {
  const t = useT()
  return (
    <aside className="inspector validation" aria-label={t('Validation')}>
      <header>
        <h2>{t('Validation')}</h2>
        <button type="button" className="icon-btn" aria-label={t('Close validation')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {problems.length === 0 ? (
        <p className="muted">{t('No validation errors')}</p>
      ) : (
        <ul className="problems">
          {problems.map((p) => (
            <li key={`${p.path} ${p.message}`}>
              <button type="button" className="problem" data-level={p.level} onClick={() => onPick(p)}>
                <LevelIcon level={p.level} label="" />
                <span>
                  <strong>
                    {p.parents?.map((parent) => (
                      <span key={parent} className="problem-parent">
                        {parent} <span className="problem-slash">/</span>{' '}
                      </span>
                    ))}
                    {p.title}
                  </strong>
                  <span>{p.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/**
 * Sanity's field-group tabs: "All fields" + one per group. Arrow keys move between
 * tabs (roving tabindex), Enter/Space or a click selects. No groups, no tabs. In a
 * pane under 360 px (Presentation's panel) they are a select instead, as Sanity's
 * (its ElementQuery: `data-eq-max~='0'` shows the Select); CSS picks which.
 */
function GroupTabs({schema, value, onChange, problems}: {schema: Schema; value: string; onChange: (g: string) => void; problems: Problem[]}) {
  const t = useT()
  if (!schema.groups?.length) return null
  const tabs = [{name: '', title: t('All fields')}, ...schema.groups]
  return (
    <div className="group-tabs-root">
      <span className="select-box group-select">
        <select className="input" aria-label={t('Field groups')} value={value} onChange={(e) => onChange(e.target.value)}>
          {tabs.map((g) => (
            <option key={g.name} value={g.name}>
              {g.title ?? g.name}
            </option>
          ))}
        </select>
        <ChevronDown />
      </span>
      <div
        className="group-tabs"
        role="tablist"
        aria-label={t('Field groups')}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
          const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')]
          const i = btns.indexOf(document.activeElement as HTMLButtonElement)
          btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length]?.focus()
          e.preventDefault()
        }}
      >
        {tabs.map((g) => (
          <button
            key={g.name}
            type="button"
            role="tab"
            id={`group-tab-${g.name || 'all-fields'}`}
            aria-selected={value === g.name}
            tabIndex={value === g.name ? 0 : -1}
            onClick={() => onChange(g.name)}
          >
            {/* A group's `icon` (a Sanity icon name) before its title, as Sanity's tabs. */}
            <GroupIcon name={(g as {icon?: unknown}).icon} />
            {g.title ?? g.name}
            {/* The most serious level in the group, like Sanity's tab icons. */}
            {(() => {
              const level = worst(problems.filter((p) => !g.name || p.group === g.name))
              return level && <LevelIcon level={level} label={level === 'error' ? t('has validation errors') : level === 'warning' ? t('has validation warnings') : t('has validation info')} />
            })()}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Sanity names a new untitled doc "New <Type>" in its own pane until it exists (its first
 * edit saves a draft); anything else untitled, a draft too, is "Untitled". `t`: the
 * render's translate (English when not given).
 */
export const docTitle = (doc: Doc, schema: Schema, t: T = (en, vars) => translate('en', en, vars)) => {
  const title = previewTitle(doc, schema)
  if (title !== 'Untitled') return title
  // A singleton without a title field is named by its type, as Sanity's fixed
  // preview titles do ("Forside", "Nettstedsinnstillinger").
  if (schema.singleton) return schema.title
  return !doc._rev ? t('New {type}', {type: schema.title}) : t('Untitled')
}

/** A translated sentence with one `{id}` set as code. */
function WithCode({text, code}: {text: string; code: string}) {
  const [before, after = ''] = text.split('{id}')
  return (
    <>
      {before}
      <code>{code}</code>
      {after}
    </>
  )
}

/** `single` (B13): a singleton keeps Publish, Discard changes and (in History) Restore only. */
function DocFooter({doc, closeHref, blocked, single, onDuplicate, askDelete, onReview}: {doc: Doc; closeHref: string; blocked: number; single: boolean; onDuplicate: () => void; askDelete: number; onReview: () => void}) {
  const actionsButton = useRef<HTMLButtonElement>(null)
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const {state, error} = useSaveState(doc._publishedId)
  const {canWrite, canPublish, editReason, publishReason, createReason, deletePublishedReason} = useCanWrite()
  // A Contributor deletes a draft only: deleting a published document unpublishes it.
  const deleteReason = doc._hasPublished !== false && !canPublish ? deletePublishedReason : editReason
  const canDelete = canWrite && !(doc._hasPublished !== false && !canPublish)
  const [publishing, setPublishing] = useState(false)
  const [menu, setMenu] = useState(false)
  const closeMenu = useCallback(() => setMenu(false), [])
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [unscheduling, setUnscheduling] = useState(false)
  const [publishingNow, setPublishingNow] = useState(false)
  const scheduleQ = useQuery(scheduleQuery(doc._publishedId, doc._type))
  const schedule = scheduleQ.data?.schedule ?? null
  // Discard needs a draft to drop and a published version to fall back to.
  const canDiscard = !!doc._draft && doc._hasPublished !== false
  const set = (field: string, value: unknown) => edit(qc, doc, field, value)
  const actions = (studio.document?.actions?.(doc._type) ?? []).flatMap((action) => action({doc, set}) ?? [])
  const schemaActions = useSchemaActions(doc, () => setMenu(false), menu)
  const alt = useAltName()
  // J13: blocked by errors, Sanity's tooltip says why (a role's limit stays the button's title,
  // as on the studio's other buttons).
  const publishTip = useTip(() =>
    publishReason ? null : blocked ? <span className="tip-text">{t('There are validation errors that need to be fixed before this document can be published')}</span> : doc._draft && !isPristine(doc, state) ? (
      <Keys keys={['Ctrl', alt, 'P']} />
    ) : doc._hasPublished !== false && doc._updatedAt ? (
      t('Published {ago}', {ago: ago(doc._updatedAt, locale)})
    ) : (
      t('No unpublished changes')
    ),
  )
  // J28: Sanity's Delete shortcut (Ctrl+Alt+D) asks here.
  useEffect(() => {
    if (askDelete && !single && canDelete) setDeleting(true)
  }, [askDelete])
  // J04: Sanity says "Saved" for about 3 s after a save, then "Edited N ago" (a
  // draft opened later says "Edited" at once). The 30 s tick keeps "ago" current.
  const [justSaved, setJustSaved] = useState(false)
  const [, tick] = useState(0)
  const was = useRef(state)
  useEffect(() => {
    const before = was.current
    was.current = state
    if (state !== 'saved' || before === 'saved') return
    setJustSaved(true)
    const timer = setTimeout(() => setJustSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [state])
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  const saved = state !== 'refused' && !(state in STATE_LABELS) && !isPristine(doc, state) && !!doc._draft && (justSaved || !doc._updatedAt)
  // "Last published …" / "Edited …": Sanity puts who did it beside the words.
  const actor = useLastActor(doc, state !== 'refused' && !(state in STATE_LABELS) && !isPristine(doc, state) && !saved)
  const label =
    state === 'refused'
      ? t('Not saved: {reason}', {reason: error ?? t('Barkpark refused the change')})
      : state in STATE_LABELS
        ? t(STATE_LABELS[state]!)
        : isPristine(doc, state)
          ? ''
          : !doc._draft
            ? t('Last published {ago}', {ago: ago(doc._updatedAt, locale)})
            : saved
              ? t('Saved')
              : t('Edited {ago}', {ago: ago(doc._updatedAt, locale)})
  return (
    <footer className="doc-footer">
      {/* Sanity's status is a button: it opens History on Review changes (the keyboard reaches it too). */}
      <button type="button" className="save-state-btn" aria-label={label || undefined} onClick={onReview} disabled={!label}>
        {/* "N sec. ago" differs between the server render and hydration: not an error. */}
        <span className="save-state" data-state={state} title={error} role="status" suppressHydrationWarning>
          {/* Sanity's marks: a check once saved, a turning arrow while saving. */}
          {saved ? <CheckmarkCircle /> : state === 'saving' ? <SyncIcon /> : actor ? <ActorAvatar actor={actor} /> : null}
          <span className="save-state-text">{label}</span>
        </span>
      </button>
      {state === 'signedOut' && (
        <SignInAgain />
      )}
      <DocBadges doc={doc} />
      {/* Sanity's tooltip: the shortcut while there is something to publish, else when it was published. */}
      <span className="publish-tip" {...(publishReason ? {} : publishTip.anchor)}>
      <button
        className="publish"
        disabled={!canPublish || !doc._draft || isPristine(doc, state) || (state !== 'saved' && state !== 'saving') || publishing || blocked > 0}
        title={publishReason}
        aria-keyshortcuts="Control+Alt+P"
        onClick={async (e) => {
          // The button disables itself now, which drops keyboard focus on the page; it
          // goes to "…" beside it instead, in the same footer.
          if (document.activeElement === e.currentTarget) actionsButton.current?.focus()
          setPublishing(true)
          try {
            await publishAndTell(qc, doc)
          } catch (e) {
            // D12: a refusal (a paper's publish wall, say) says why, never silently.
            toast({tone: 'critical', title: tt('Could not publish'), description: reasonOf((e as Error).message) ?? (e as Error).message})
          } finally {
            setPublishing(false)
          }
        }}
      >
        <PublishIcon />
        {publishing ? t('Publishing…') : t('Publish')}
      </button>
      {publishTip.tip}
      </span>
      {(!single || canDiscard || actions.length > 0) && <div className="menu-wrap">
        <button ref={actionsButton} type="button" className="icon-btn" aria-label={t('Document actions')} data-tip={t('Document actions')} aria-haspopup="menu" aria-expanded={menu} onPointerEnter={schemaActions.prefetch} onFocus={schemaActions.prefetch} onClick={() => setMenu((m) => !m)}>
          <Ellipsis />
        </button>
        {menu && (
          <AnchoredLayer anchor={actionsButton} className="doc-menu-layer" onClose={closeMenu}>
          <MenuPopover className="popover menu up" onClose={closeMenu}>
            {!single && (
              <button type="button" role="menuitem" className="menu-item" autoFocus disabled={!canWrite} title={createReason} onClick={() => (setMenu(false), onDuplicate())}>
                <span className="menu-icon-text">
                  <Copy /> {t('Duplicate')}
                </span>
              </button>
            )}
            {/* J40: Sanity's Schedule publish (a draft to publish, a Barkpark that schedules), or Delete schedule once set. */}
            {!single && scheduleQ.data?.supported && !schedule && doc._draft && (
              <button type="button" role="menuitem" className="menu-item" disabled={!canWrite || !!publishReason || blocked > 0} title={publishReason ?? (blocked > 0 ? t('Cannot schedule draft due to validation issues in the current draft.') : undefined)} onClick={() => (setMenu(false), setScheduling(true))}>
                <span className="menu-icon-text">
                  <Clock /> {t('Schedule publish')}
                </span>
              </button>
            )}
            {/* J40: Sanity's "Publish now" on a scheduled draft: published at once, the schedule dropped. */}
            {schedule && (
              <button type="button" role="menuitem" className="menu-item" disabled={!canPublish} title={publishReason} onClick={() => (setMenu(false), setPublishingNow(true))}>
                <span className="menu-icon-text">
                  <PublishIcon /> {t('Publish now')}
                </span>
              </button>
            )}
            {schedule && (
              <button type="button" role="menuitem" className="menu-item danger" disabled={!canWrite} title={editReason} onClick={() => (setMenu(false), setUnscheduling(true))}>
                <span className="menu-icon-text">
                  <Trash /> {t('Delete schedule')}
                </span>
              </button>
            )}
            {/* Sanity offers Discard only when there is a draft to discard. */}
            {canDiscard && (
              <button type="button" role="menuitem" className="menu-item danger" autoFocus={single} disabled={!canWrite} title={editReason} onClick={() => (setMenu(false), setDiscarding(true))}>
                <span className="menu-icon-text">
                  <Undo /> {t('Discard changes')}
                </span>
              </button>
            )}
            {/* J65: the studio config's actions, after Sanity's built-in ones and before Delete. */}
            {actions.map((action) => (
              <button key={action.label} type="button" role="menuitem" className="menu-item" disabled={!canWrite || action.disabled} title={editReason} onClick={() => (setMenu(false), action.onHandle())}>
                {action.label}
              </button>
            ))}
            {/* B10: the schema's own actions (a plugin's), as LiveView lists them last. */}
            {schemaActions.items}
            {!single && (
              <button type="button" role="menuitem" className="menu-item danger" aria-keyshortcuts="Control+Alt+D" disabled={!canDelete} title={deleteReason} onClick={() => (setMenu(false), setDeleting(true))}>
                <span className="menu-icon-text">
                  <Trash /> {t('Delete')}
                </span>
                <Keys keys={['Ctrl', alt, 'D']} />
              </button>
            )}
          </MenuPopover>
          </AnchoredLayer>
        )}
      </div>}
      {deleting && <DeleteDialog doc={doc} closeHref={closeHref} onClose={() => setDeleting(false)} />}
      {schemaActions.dialog}
      {scheduling && (
        <ScheduleDialog
          run={async (publishAt) => {
            await schedulePublish({data: {id: doc._publishedId, type: doc._type, publishAt}})
            toast({tone: 'positive', title: tt('Scheduled draft successfully')})
            await qc.invalidateQueries({queryKey: ['schedule', doc._publishedId]})
          }}
          onClose={() => setScheduling(false)}
        />
      )}
      {publishingNow && schedule && (
        <ConfirmDialog
          title={t('Publish draft now')}
          body={t('Are you sure you want to publish this scheduled draft immediately?')}
          action={t('Yes, run now')}
          run={async () => {
            // The schedule goes first (a refusal says why, and nothing is published), then the
            // draft is published; a failed publish puts the schedule back at its time.
            await cancelSchedule({data: {scheduleId: schedule._id}})
            try {
              await publish(qc, doc)
            } catch (e) {
              if (new Date(schedule.publishAt).getTime() > Date.now())
                await schedulePublish({data: {id: doc._publishedId, type: doc._type, publishAt: schedule.publishAt}}).catch(() => {})
              throw e
            } finally {
              await qc.invalidateQueries({queryKey: ['schedule', doc._publishedId]})
            }
            toast({tone: 'positive', title: tt('The scheduled draft document {title} has been published.', {title: previewTitle(doc, schemaOf(qc.getQueryData<Schema[]>(schemasQuery.queryKey) ?? [], doc._type), tt)})})
          }}
          onClose={() => setPublishingNow(false)}
        />
      )}
      {unscheduling && schedule && (
        <ConfirmDialog
          title={t('Delete scheduled draft')}
          body={t('Delete this scheduled draft? Your draft is already up to date.')}
          action={t('Yes, delete schedule')}
          run={() =>
            cancelSchedule({data: {scheduleId: schedule._id}}).then(() => {
              toast({tone: 'positive', title: tt('The scheduled draft document {title} has been deleted.', {title: previewTitle(doc, schemaOf(qc.getQueryData<Schema[]>(schemasQuery.queryKey) ?? [], doc._type), tt)})})
              return qc.invalidateQueries({queryKey: ['schedule', doc._publishedId]})
            })
          }
          onClose={() => setUnscheduling(false)}
        />
      )}
      {discarding && (
        <ConfirmDialog
          title={t('Discard changes?')}
          body={t('Are you sure you want to discard all changes since last published?')}
          action={t('Discard changes')}
          run={() => discardDraft(qc, doc).then(() => toast({title: tt('All changes has now been discarded. The discarded draft can still be recovered from history')}))}
          onClose={() => setDiscarding(false)}
        />
      )}
    </footer>
  )
}

// J04: Sanity's toast after each lifecycle action, the document's name in bold.
const named = (qc: QueryClient, doc: Doc, rest: string) => (
  <>
    <strong>{previewTitle(doc, schemaOf(qc.getQueryData<Schema[]>(schemasQuery.queryKey) ?? [], doc._type), tt)}</strong> {rest}
  </>
)
/** Publish, then say so (the footer button and Ctrl+Alt+P). */
async function publishAndTell(qc: QueryClient, doc: Doc) {
  await publish(qc, doc)
  toast({tone: 'positive', title: named(qc, qc.getQueryData<Doc>(['doc', doc._publishedId]) ?? doc, tt('was published'))})
}

/** J65: the studio config's badges, beside the save state, Sanity's colors. */
/**
 * J40: the document's pending scheduled publish, if any. Read again when the draft
 * changes (the scheduled publish lands as a new revision) and while one waits, so the
 * chip goes once Barkpark has published it.
 */
function useSchedule(id: string, type: string, rev: string | undefined): Schedule | null {
  const qc = useQueryClient()
  const {data} = useQuery({...scheduleQuery(id, type), refetchInterval: (q) => (q.state.data?.schedule ? 30_000 : false)})
  useEffect(() => void qc.invalidateQueries({queryKey: ['schedule', id]}), [rev])
  return data?.schedule ?? null
}

function DocBadges({doc}: {doc: Doc}) {
  const badges = (studio.document?.badges?.(doc._type) ?? []).flatMap((badge) => badge(doc) ?? [])
  if (!badges.length) return null
  return (
    <span className="doc-badges">
      {badges.map((b) => (
        <span key={b.label} className="doc-badge" data-color={b.color ?? 'default'} title={b.title}>
          {b.label}
        </span>
      ))}
    </span>
  )
}

/** Who wrote what the footer dates: the last publish, or the draft's last edit (none for a service token). */
function useLastActor(doc: Doc, enabled: boolean) {
  const {data} = useQuery({...historyQuery(doc._type, doc._publishedId), enabled})
  return enabled ? data?.find((r) => (doc._draft ? r.status === 'draft' : r.action === 'publish'))?.actor : undefined
}

/** The Published perspective: read-only, and the way to take a document down. */
function PublishedFooter({doc, single}: {doc: Doc; single: boolean}) {
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const {canPublish, unpublishReason} = useCanWrite()
  // J04: no published version (the pane's stub): Sanity's "Unpublished just now", from the
  // history, when an unpublish was the last publish-or-unpublish; else nothing.
  const none = !doc._rev
  const actor = useLastActor(doc, !none)
  const {data: revisions} = useQuery({...historyQuery(doc._type, doc._publishedId), enabled: none})
  const last = none ? revisions?.find((r) => r.action === 'publish' || r.action === 'unpublish') : undefined
  const gone = last?.action === 'unpublish' ? last : undefined
  const run = () =>
    unpublish(qc, doc).then(() => toast({tone: 'positive', title: named(qc, doc, tt('was unpublished. A draft has been created from the latest published revision.'))}))
  return (
    <footer className="doc-footer">
      <span className="save-state" role="status" suppressHydrationWarning>
        {none ? gone?.actor && <ActorAvatar actor={gone.actor} /> : actor && <ActorAvatar actor={actor} />}
        <span className="save-state-text">{none ? gone && t('Unpublished {ago}', {ago: ago(gone.timestamp, locale)}) : t('Last published {ago}', {ago: ago(doc._updatedAt, locale)})}</span>
      </span>
      <DocBadges doc={doc} />
      {/* B13: a singleton is never unpublished (it keeps Publish, Discard and Restore). */}
      {!single && (
        <button className="publish danger" disabled={!canPublish || none} title={unpublishReason} onClick={() => setConfirm(true)}>
          <UnpublishIcon />
          {t('Unpublish')}
        </button>
      )}
      {/* B07: who refers to it is listed before it goes. */}
      {confirm && <UnpublishDialog docs={[doc]} run={run} onClose={() => setConfirm(false)} />}
    </footer>
  )
}

/** A Sanity-style confirm over the pane: Cancel (focused) or the red action. Failures show inline. */
export function ConfirmDialog({title, body, action, run, onClose}: {title: string; body: string; action: string; run: () => Promise<unknown>; onClose: () => void}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog" aria-modal="true" aria-label={title} onClose={onClose}>
        <header>
          <h2>{title}</h2>
        </header>
        <div className="dialog-body">
          <p>{body}</p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" autoFocus onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                await run()
                onClose()
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {action}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}

export type {Doc, Schema}

// J14: which collapsible objects are open while the doc stays open (switching group
// tabs keeps them). Like Sanity's, opening the doc again starts from the schema's defaults.
function useOpenObjects(docId: string) {
  const [version, bump] = useState(0)
  const byDoc = useRef<{id: string; open: Map<string, boolean>}>({id: docId, open: new Map()})
  if (byDoc.current.id !== docId) byDoc.current = {id: docId, open: new Map()}
  const state = byDoc.current.open
  return useMemo(
    () => ({
      isOpen: (path: string, byDefault: boolean) => state.get(path) ?? byDefault,
      toggle: (path: string, value: boolean) => {
        if (state.get(path) === value) return
        state.set(path, value)
        bump((n) => n + 1)
      },
    }),
    [state, version],
  )
}

/** A new doc that is still only in this tab: created on its first edit (J18). */
const isPristine = (doc: Doc | null | undefined, state: string) => !!doc && doc._rev === '' && doc._hasPublished === false && state === 'saved'

/** "Oct 8, 2026, 12:16 PM", as Sanity's header chips date a version (in Norwegian "8. okt. 2026, 12:16"). */
const longDate = (iso: string, locale: Locale) => new Date(iso).toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})

/** The footer's save states that are only words. */
const STATE_LABELS: Record<string, string> = {
  saving: 'Saving…',
  stalled: 'Saving is taking longer than usual…',
  offline: 'Offline — not saving. Your edits are kept here.',
  recovering: 'Back online — saving your edits…',
  error: 'Not saved — retrying',
  signedOut: "You've been logged out — not saving. Sign in to save your edits.",
}

/** A header chip (Published / Draft) with Sanity's dated tooltip (J56). */
function TipChip({tip: content, children, ...rest}: {tip: () => string} & React.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>) {
  const {anchor, tip} = useTip(content)
  return (
    <button type="button" className="chip" {...rest} {...anchor}>
      {children}
      {tip}
    </button>
  )
}

/**
 * J29, Sanity's form hotkeys: Cmd/Ctrl+C or V on focus that isn't a native control (an
 * array row, an object or image's buttons) copies or pastes that field or item. Inputs,
 * switches and selects keep the browser's own behaviour, and so does a text selection.
 */
function copyPasteKey(e: React.KeyboardEvent) {
  const key = e.key.toLowerCase()
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (key !== 'c' && key !== 'v')) return
  const target = e.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return
  if (key === 'c' && getSelection()?.toString()) return
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    const entry = fieldClipboard.get(el)
    if (!entry || (key === 'v' && !entry.paste)) continue
    e.preventDefault()
    e.stopPropagation()
    return key === 'c' ? entry.copy() : entry.paste!()
  }
}

/** B09: the docs a desk view relates to this one (Barkpark's view bar), each opening to the right. */
function RelatedView({view, id, hrefOf, selected}: {view: DeskView; id: string; hrefOf: (d: Doc) => string; selected?: string}) {
  const t = useT()
  const {data: docs, isPending, error, refetch} = useQuery(relatedQuery(view, id))
  if (isPending) return <div className="pane-loading" aria-busy="true">{t('Loading documents…')}</div>
  if (error) return <ReadErrorCard title={t('Could not load the documents')} error={error} failures={1} retrying={false} onRetry={() => void refetch()} />
  if (!docs?.length) return <p className="muted related-empty">{t('No documents yet')}</p>
  return (
    <div className="related-list" role="list" aria-label={view.title}>
      {docs.map((d) => (
        <div role="listitem" key={d._publishedId}>
          <DocPreview doc={d} href={hrefOf(d)} selected={selected === d._publishedId} testId="related-item" />
        </div>
      ))}
    </div>
  )
}

/** J26: Sanity's "Enter focus mode (hide navigation)", and the way out. */
function FocusButton({index}: {index: number}) {
  const t = useT()
  const {focused, toggle} = useFocusMode()
  const on = focused === index
  return (
    <button type="button" className="icon-btn" data-testid="focus-pane-button" aria-label={t(on ? 'Exit focus mode (show navigation)' : 'Enter focus mode (hide navigation)')} data-tip={t(on ? 'Exit focus mode' : 'Enter focus mode')} aria-pressed={on} onClick={() => toggle(index)}>
      {on ? <Collapse /> : <Expand />}
    </button>
  )
}
