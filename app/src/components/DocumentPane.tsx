import {announce} from '../lib/announce'
import {GroupIcon} from './GroupIcon'
import {useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {NarrowContext} from '../lib/layout'
import {DialogBox, MenuPopover} from './FocusScopes'
import {useQueries, useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query'
import {usePublishedPerspective} from '../lib/perspective'
import {errorsOf, validate, worst, type Problem} from '../lib/validation'
import {advisoryProblems} from '../lib/findings'
import {docQuery, isSingleton, previewTitle, publishedQuery, refTypesOf, relatedQuery, schemaOf, schemasQuery, type DeskView, type Doc, type Schema} from '../lib/data'
import {DocPreview} from './Preview'
import {createDoc, discardDraft, draftNew, edit, flush, publish, reasonOf, undo, unpublish, useAdvisories, useSaveState} from '../lib/edits'
import {openAfter, panesPath, splitRight, withView, type Pane, withParams} from '../lib/panes'
import {reportFocus} from '../lib/presence'
import {useRevealed} from '../lib/reveal'
import {DeletedBanner, ReferenceBanner, useDeleted} from './PaneBanners'
import {SignInAgain} from './SignInAgain'
import {useTip} from './Tip'
import {useBoundElsewhere, useCanWrite, useStudioTokenRefused} from '../lib/session'
import {editorMode, viewOf, viewParam, type View} from '../lib/editor-mode'
import {PaneLink, usePaneNavigate} from './PaneLink'
import {UnknownFields} from './BrokenValues'
import {unknownFields} from '../lib/broken'
import {ChangesContext, DocContext, DocIdContext, DocTypeContext, EditPathContext, UrlPathContext, FieldView, LevelIcon, OpenObjectsContext, ProblemsContext, fieldClipboard} from './Fields'
import {ReviewChanges} from './ReviewChanges'
import {changedFields} from '../lib/changes'
import {DeleteDialog} from './DeleteDialog'
import {UnpublishDialog} from './UnpublishDialog'
import {DocHeaderMenu, DocShareMenu, Keys, openPreview, useAltName} from './DocHeaderMenu'
import {InspectDialog} from './InspectDialog'
import {ago, HistoryPanel, RevisionFooter} from './HistoryPanel'
import {CommentsContext, CommentsPanel} from './Comments'
import {commentsQuery, threadsOf} from '../lib/comments'
import {revisionQuery} from '../lib/history'
import {PortableDocEditor} from './PortableDocEditor'
import {PaperSidebar} from './PaperSidebar'
import {PAPER_TYPES} from '../lib/paper'
import {AvatarStack, PresenceHints, useDocPresence} from './Presence'
import {toast} from './Toasts'
import {intlTag, t as tt, translate, useLocale, useT, type Locale, type T} from '../lib/i18n'
import {BoundDatasetCard, ReadErrorCard, RefusedTokenCard} from './PaneError'
import {ChevronDown, CheckmarkCircle, PublishIcon, SyncIcon, UnpublishIcon, Close as CloseIcon, ReadOnlyIcon, CommentIcon, Ellipsis, ErrorOutline, SplitVertical, TagIcon, WarningOutline, Copy, Trash, Undo} from './icons'
import studio from '../studio.config'
import {useSchemaActions} from './SchemaActions'
import {LocationsBanner} from './LocationsBanner'
import {EditIcon, EyeOpenIcon, PreviewView} from './PreviewView'

type Props = {panes: Pane[]; index: number; split?: boolean; closeHref: string; header: ReactNode; closeIcon: ReactNode}

// Sanity's document views, as the reference configures them: the form, and the doc as
// JSON; plus Freeform where the type's editor mode offers it (FF3, lib/editor-mode.ts).

const NO_PROBLEMS: Problem[] = []
/** J44: fields drawn in the first frame; a longer form gets the rest right after. */
const FIRST_FIELDS = 40

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
  const {data: doc, isPending, error} = docQ
  // J16: an old revision (rev=… in the URL) shows in the form's place, read-only.
  const revQ = useQuery({...revisionQuery(pane.rev ?? ''), enabled: !!pane.rev})
  const revision = pane.rev ? revQ.data : undefined
  const reviewSchema = schemaOf(schemas, pane.type)
  const changedSet = new Set(
    !viewingPublished && !pane.rev && draftQ.data?._draft && publishedQ.data && reviewSchema ? changedFields(reviewSchema, publishedQ.data, draftQ.data).map((c) => c.field.name) : [],
  )
  const base = panesPath(panes)
  const navigate = usePaneNavigate()
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
  const own = doc && schemaForPane && !viewingPublished && !pristine ? validate(doc, schemaForPane, (id) => byId.get(id), t) : []
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
    if (group && p.group !== group) setGroup('')
    // A field inside collapsed objects: open each one on the way (Sanity does).
    p.path.split('.').slice(0, -1).forEach((_, i, parts) => openObjects.toggle(parts.slice(0, i + 1).join('.'), true))
    requestAnimationFrame(() => paneRoot.current?.querySelector<HTMLElement>(`[id="${CSS.escape(p.path)}"]`)?.focus())
  }
  // J40: the document's comment threads, for the field buttons and the inspector.
  const commentsQ = useQuery(commentsQuery(pane.id))
  const [commentField, setCommentField] = useState<string | undefined>()
  const openComments = useRef((_path?: string) => {})
  openComments.current = (path) => {
    setCommentField(path)
    if (pane.inspect !== 'comments') void navigate({href: withParams(panes, index, {inspect: 'comments', rev: undefined})})
  }
  const commentsApi = useMemo(
    () => ({docId: pane.id, docType: pane.type, threads: threadsOf(commentsQ.data ?? []), open: (path?: string) => openComments.current(path)}),
    [pane.id, pane.type, commentsQ.data],
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
      const el = paneRoot.current?.querySelector<HTMLElement>(`[id="${CSS.escape(want)}"]`)
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
    const at = location.pathname
    pathTimer.current = setTimeout(() => {
      // The panes moved meanwhile (a reference opened, a pane closed): that URL wins.
      if (location.pathname !== at) return
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
  const changes = useMemo(() => ({changed: changedSet, review: () => review.current()}), [changedKey])
  const problemsKey = JSON.stringify(problems)
  const steadyProblems = useMemo(() => problems, [problemsKey])
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

  return (
    <section
      ref={paneRoot}
      aria-label={doc && schema ? docTitle(doc, schema, t) : t('Document')}
      className="pane doc"
      data-testid="document-pane"
      data-pane={`doc:${pane.id}`}
      data-pane-index={index}
      onFocus={(e) => {
        // J07: the most specific path: an array item (data-presence-path) unless a
        // field inside it has its own, longer one.
        const target = e.target as HTMLElement
        const field = target.closest('.form-fields [id]')?.id
        const item = target.closest<HTMLElement>('[data-presence-path]')?.dataset.presencePath
        reportFocus(pane.id, (item && !(field?.startsWith(`${item}.`) || field?.startsWith(`${item}[`)) ? item : field) ?? null)
      }}
      onKeyDown={(e) => {
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
        // F7: the document's own undo (this editor's changes only, across fields and
        // across others' edits). The block canvas keeps its own.
        const mod = e.metaKey || e.ctrlKey
        const key = e.key.toLowerCase()
        if (mod && !e.altKey && (key === 'z' || key === 'y') && !viewingPublished && !(e.target as HTMLElement).closest('bp-paper-canvas')) {
          e.preventDefault()
          const field = undo(qc, pane.id, key === 'z' && !e.shiftKey)
          if (field) requestAnimationFrame(() => paneRoot.current?.querySelector<HTMLElement>(`[id="${CSS.escape(field)}"]`)?.focus())
        }
      }}
    >
      <header className="pane-header">
        <AvatarStack people={here} />
        <span className="title chips">
          {draftQ.data?._hasPublished === false ? (
            <span className="chip" data-off="" aria-disabled="true" title={t('Not published')}>
              <span className="dot published" />
              {t('Published')}
            </span>
          ) : (
            <TipChip
              tip={() => {
                const at = draftQ.data?._draft ? publishedQ.data?._updatedAt : draftQ.data?._updatedAt
                return at ? t('Published {date}', {date: longDate(at, locale)}) : t('Published')
              }}
              data-selected={viewingPublished ? '' : undefined}
              aria-pressed={viewingPublished}
              onClick={() => navigate({href: `${base}?perspective=published`})}
            >
              <span className="dot published" />
              {t('Published')}
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
            {t('Draft')}
          </TipChip>
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
          <DocHeaderMenu doc={doc} schema={schema} readOnly={viewingPublished || !canWrite} onInspect={() => setInspectOpen(true)} onHistory={() => navigate({href: withParams(panes, index, {inspect: 'history'})})} />
        )}
        {/* J42: a narrow window has no splits and no close: the back link goes back. */}
        {!narrow && (
          <>
            <button type="button" className="icon-btn" aria-label={t('Split pane right')} data-tip={t('Split pane right')} onClick={() => navigate({href: splitRight(panes, index)})}>
              <SplitVertical />
            </button>
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
        <div className="view-tabs" role="tablist" aria-label={t('Views')}>
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => navigate({href: withView(panes, index, viewParam(v.id, mode))})}>
              {v.icon}
              {v.title}
            </button>
          ))}
        </div>
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
        {doc && view === 'json' && <pre className="json-view">{JSON.stringify(doc, null, 2)}</pre>}
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
                  ? t('{name} has this document open. Freeform has no shared carets. Their saved changes appear when this canvas is idle. Avoid editing the same block at the same time.', {name: here[0]!.name})
                  : t('{n} others have this document open. Freeform has no shared carets. Their saved changes appear when this canvas is idle. Avoid editing the same block at the same time.', {n: here.length})}
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
            <div className="kind">{schema.title}</div>
            <h1>{docTitle(doc, schema, t)}</h1>
            {!revision && <LocationsBanner doc={doc} />}
            <GroupTabs schema={schema} value={group} onChange={setGroup} problems={problems} />
            {/* The published version is read-only: a disabled fieldset disables every control in it. */}
            <CommentsContext.Provider value={commentsApi}>
            <ChangesContext.Provider value={changes}>
            <DocIdContext.Provider value={doc._publishedId}>
            <DocTypeContext.Provider value={pane.type}>
            <DocContext.Provider value={revision ? ({...doc, ...revision.content} as Doc) : doc}>
            <UrlPathContext.Provider value={pane.path}>
            <EditPathContext.Provider value={onEdit}>
            <ProblemsContext.Provider value={revision ? NO_PROBLEMS : steadyProblems}>
            <OpenObjectsContext.Provider value={openObjects}>
            <fieldset className="form-fields" disabled={viewingPublished || !!revision || !canWrite} title={editReason}>
              {formFields.slice(0, revealed).map((f) => (
                <FieldView key={f.name} field={f} path={f.name} value={(revision ? revision.content : doc)[f.name]} openRef={openRef} onChange={onChangeOf(f.name)} />
              ))}
              {!revision && revealed >= formFields.length && (
                <UnknownFields doc={doc} names={unknownFields(schema, doc)} onRemove={(name) => onEdit(name, undefined)} />
              )}
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
        : doc && <DocFooter doc={doc} closeHref={closeHref} blocked={errors.length} single={single} onDuplicate={() => duplicate(doc)} askDelete={askDelete} />}
      </div>
      {inspecting && !viewingPublished && <ValidationPanel problems={problems} onPick={goTo} onClose={() => void toggleValidation()} />}
      {pane.inspect === 'comments' && (
        <CommentsPanel
          docId={pane.id}
          docType={pane.type}
          fieldTitle={(path) => path.split('.').map((part, i) => (i === 0 ? fieldLabels[part] ?? part : part)).join(' › ')}
          focusField={commentField}
          onGoToField={(path) => goTo({path, group: (schema?.fields.find((f) => f.name === path.split('.')[0]) as {group?: string} | undefined)?.group})}
          onClose={() => navigate({href: withParams(panes, index, {inspect: undefined})})}
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
      {inspectOpen && doc && schema && <InspectDialog doc={doc} title={docTitle(doc, schema, t)} onClose={() => setInspectOpen(false)} />}
    </section>
  )
}

/** Sanity's validation inspector: every problem, click one to go to its field. */
function ValidationPanel({problems, onPick, onClose}: {problems: Problem[]; onPick: (p: Problem) => void; onClose: () => void}) {
  const t = useT()
  return (
    <aside className="inspector" aria-label={t('Validation')}>
      <header>
        <h2>{t('Validation')}</h2>
        <button type="button" className="icon-btn" aria-label={t('Close validation')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {problems.length === 0 ? (
        <p className="muted">{t('No validation errors')}</p>
      ) : (
        <ul>
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
 * Sanity names a new untitled doc "New <Type>" in its own pane; anything else untitled is
 * "Untitled". `t`: the render's translate (English when not given).
 */
export const docTitle = (doc: Doc, schema: Schema, t: T = (en, vars) => translate('en', en, vars)) => {
  const title = previewTitle(doc, schema)
  if (title !== 'Untitled') return title
  // A singleton without a title field is named by its type, as Sanity's fixed
  // preview titles do ("Forside", "Nettstedsinnstillinger").
  if (schema.singleton) return schema.title
  return doc._hasPublished === false ? t('New {type}', {type: schema.title}) : t('Untitled')
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
function DocFooter({doc, closeHref, blocked, single, onDuplicate, askDelete}: {doc: Doc; closeHref: string; blocked: number; single: boolean; onDuplicate: () => void; askDelete: number}) {
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const {state, error} = useSaveState(doc._publishedId)
  const {canWrite, editReason, publishReason, createReason} = useCanWrite()
  const [publishing, setPublishing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  // Discard needs a draft to drop and a published version to fall back to.
  const canDiscard = !!doc._draft && doc._hasPublished !== false
  const set = (field: string, value: unknown) => edit(qc, doc, field, value)
  const actions = (studio.document?.actions?.(doc._type) ?? []).flatMap((action) => action({doc, set}) ?? [])
  const schemaActions = useSchemaActions(doc, () => setMenu(false), menu)
  const alt = useAltName()
  const reason = publishReason ?? (blocked ? t('There are validation errors that need to be fixed before this document can be published') : undefined)
  const publishTip = useTip(() =>
    reason ? null : doc._draft && !isPristine(doc, state) ? (
      <Keys keys={['Ctrl', alt, 'P']} />
    ) : doc._hasPublished !== false && doc._updatedAt ? (
      t('Published {ago}', {ago: ago(doc._updatedAt, locale)})
    ) : (
      t('No unpublished changes')
    ),
  )
  // J28: Sanity's Delete shortcut (Ctrl+Alt+D) asks here.
  useEffect(() => {
    if (askDelete && !single && canWrite) setDeleting(true)
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
      {/* "N sec. ago" differs between the server render and hydration: not an error. */}
      <span className="save-state" data-state={state} title={error} role="status" suppressHydrationWarning>
        {/* Sanity's marks: a check once saved, a turning arrow while saving. */}
        {saved ? <CheckmarkCircle /> : state === 'saving' ? <SyncIcon /> : null}
        {label}
      </span>
      {state === 'signedOut' && (
        <SignInAgain />
      )}
      <DocBadges doc={doc} />
      {/* Sanity's tooltip: the shortcut while there is something to publish, else when it was published. */}
      <span className="publish-tip" {...(reason ? {} : publishTip.anchor)}>
      <button
        className="publish"
        disabled={!canWrite || !doc._draft || isPristine(doc, state) || (state !== 'saved' && state !== 'saving') || publishing || blocked > 0}
        title={reason}
        aria-keyshortcuts="Control+Alt+P"
        onClick={async () => {
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
        <button type="button" className="icon-btn" aria-label={t('Document actions')} data-tip={t('Document actions')} aria-haspopup="menu" aria-expanded={menu} onPointerEnter={schemaActions.prefetch} onFocus={schemaActions.prefetch} onClick={() => setMenu((m) => !m)}>
          <Ellipsis />
        </button>
        {menu && (
          <MenuPopover className="popover menu up" onClose={() => setMenu(false)}>
            {!single && (
              <button type="button" role="menuitem" className="menu-item" autoFocus disabled={!canWrite} title={createReason} onClick={() => (setMenu(false), onDuplicate())}>
                <span className="menu-icon-text">
                  <Copy /> {t('Duplicate')}
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
              <button type="button" role="menuitem" className="menu-item danger" aria-keyshortcuts="Control+Alt+D" disabled={!canWrite} title={editReason} onClick={() => (setMenu(false), setDeleting(true))}>
                <span className="menu-icon-text">
                  <Trash /> {t('Delete')}
                </span>
                <Keys keys={['Ctrl', alt, 'D']} />
              </button>
            )}
          </MenuPopover>
        )}
      </div>}
      {deleting && <DeleteDialog doc={doc} closeHref={closeHref} onClose={() => setDeleting(false)} />}
      {schemaActions.dialog}
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

/** The Published perspective: read-only, and the way to take a document down. */
function PublishedFooter({doc, single}: {doc: Doc; single: boolean}) {
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const {canWrite, publishReason} = useCanWrite()
  const run = () =>
    unpublish(qc, doc).then(() => toast({tone: 'positive', title: named(qc, doc, tt('was unpublished. A draft has been created from the latest published revision.'))}))
  return (
    <footer className="doc-footer">
      <span className="save-state" role="status" suppressHydrationWarning>
        {t('Last published {ago}', {ago: ago(doc._updatedAt, locale)})}
      </span>
      <DocBadges doc={doc} />
      {/* B13: a singleton is never unpublished (it keeps Publish, Discard and Restore). */}
      {!single && (
        <button className="publish danger" disabled={!canWrite} title={publishReason} onClick={() => setConfirm(true)}>
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
