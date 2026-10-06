import {useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {NarrowContext} from '../lib/layout'
import {DialogBox, MenuPopover} from './FocusScopes'
import {useQueries, useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {usePublishedPerspective} from '../lib/perspective'
import {validate, type Problem} from '../lib/validation'
import {docQuery, previewTitle, publishedQuery, refTypesOf, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {createDoc, discardDraft, draftNew, edit, flush, publish, undo, unpublish, useSaveState} from '../lib/edits'
import {openAfter, panesPath, splitRight, withView, type Pane, withParams} from '../lib/panes'
import {reportFocus} from '../lib/presence'
import {useRevealed} from '../lib/reveal'
import {DeletedBanner, ReferenceBanner, useDeleted} from './PaneBanners'
import {SignInAgain} from './SignInAgain'
import {useCanWrite} from '../lib/session'
import {editorMode, viewOf, viewParam, type View} from '../lib/editor-mode'
import {PaneLink} from './PaneLink'
import {UnknownFields} from './BrokenValues'
import {unknownFields} from '../lib/broken'
import {ChangesContext, DocContext, DocIdContext, DocTypeContext, EditPathContext, FieldView, ProblemsContext} from './Fields'
import {ReviewChanges} from './ReviewChanges'
import {changedFields} from '../lib/changes'
import {DeleteDialog} from './DeleteDialog'
import {DocHeaderMenu, DocShareMenu} from './DocHeaderMenu'
import {InspectDialog} from './InspectDialog'
import {HistoryPanel, RevisionFooter} from './HistoryPanel'
import {revisionQuery} from '../lib/history'
import {PortableDocEditor} from './PortableDocEditor'
import {AvatarStack, PresenceHints, useDocPresence} from './Presence'
import {toast} from './Toasts'
import {ReadErrorCard} from './PaneError'
import {Close as CloseIcon, Ellipsis, ErrorOutline, SplitVertical} from './icons'

type Props = {panes: Pane[]; index: number; split?: boolean; closeHref: string; header: ReactNode; closeIcon: ReactNode}

// Sanity's document views, as the reference configures them: the form, and the doc as
// JSON; plus Freeform where the type's editor mode offers it (FF3, lib/editor-mode.ts).

const NO_PROBLEMS: Problem[] = []
/** J44: fields drawn in the first frame; a longer form gets the rest right after. */
const FIRST_FIELDS = 40

export function DocumentPane({panes, index, split, closeHref, header, closeIcon}: Props) {
  const pane = panes[index] as Extract<Pane, {kind: 'doc'}>
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
  const navigate = useNavigate()
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
  const problems = doc && schemaForPane && !viewingPublished ? validate(doc, schemaForPane, (id) => byId.get(id)) : []
  const [inspecting, setInspecting] = useState(false)
  const goTo = (p: Problem) => {
    if (group && p.group !== group) setGroup('')
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pane="doc:${pane.id}"] [id="${p.path}"]`)?.focus())
  }
  const schema = schemaOf(schemas, pane.type)
  // Decision 0004: a doc that carries a PortableDoc block list (its type has a layout)
  // also opens in Barkpark's block canvas. The doc says so; the schema read omits
  // `layout` (task-28082a4cf187403d). FF3 makes it the default per type.
  const {canWrite, editReason, signedOut} = useCanWrite()

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
    let frames = 90
    const tryFocus = () => {
      const el = document.querySelector<HTMLElement>(`[data-pane="doc:${CSS.escape(pane.id)}"] [id="${CSS.escape(want)}"]`)
      if (el) (el.focus({preventScroll: true}), el.scrollIntoView({block: 'center'}))
      else if (frames-- > 0) requestAnimationFrame(tryFocus)
    }
    requestAnimationFrame(tryFocus)
  }, [pane.path, pane.id, doc, schemaHere, group])
  const pathTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Only focus the author moved (a click or a key in the form), not the studio's own
  // focusing of a field on open.
  const userMoved = useRef(0)
  const keepPathInUrl = (id: string) => {
    if (Date.now() - userMoved.current > 1000) return
    if (!id || id === pane.path || !schemaHere?.fields.some((f) => f.name === id.split(/[.[]/)[0])) return
    clearTimeout(pathTimer.current)
    const at = location.pathname
    pathTimer.current = setTimeout(() => {
      // The panes moved meanwhile (a reference opened, a pane closed): that URL wins.
      if (location.pathname !== at) return
      opened.current = `${pane.id}|${id}` // ours, not a link to follow
      void navigate({href: withParams(panes, index, {path: id}), replace: true})
    }, 300)
  }
  const loggedOut = useSaveState(pane.id).state === 'signedOut' || signedOut
  const mode = editorMode(pane.type, schemaOf(schemas, pane.type))
  const freeform = mode !== 'none' && !viewingPublished && (mode === 'main' || Array.isArray(doc?.blocks))
  // Published is read in Classic: the canvas edits the draft.
  const view: View = viewOf(pane.view, mode) === 'freeform' && !freeform ? 'classic' : viewOf(pane.view, mode)
  const [canvasSeen, setCanvasSeen] = useState<string | null>(null)
  if (freeform && view === 'freeform' && canvasSeen !== pane.id) setCanvasSeen(pane.id)
  const views: {id: View; title: string}[] = [
    {id: 'classic', title: freeform ? 'Classic' : 'Editor'},
    ...(freeform ? [{id: 'freeform' as View, title: 'Freeform'}] : []),
    {id: 'json', title: 'JSON'},
  ]
  const next = panes[index + 1]
  const qc = useQueryClient()
  // An id nobody has written yet is a new doc (Sanity treats it the same way); one
  // whose history ends in a delete is a deleted doc (J32): a banner, not a new draft.
  const initialValues = schemaOf(schemas, pane.type)?.initialValues
  const deleted = useDeleted(pane.type, pane.id, draftQ.data === null && !viewingPublished)
  useEffect(() => {
    if (draftQ.data === null && initialValues && deleted === false) draftNew(qc, pane.type, pane.id, initialValues)
  }, [draftQ.data, initialValues, deleted, qc, pane.type, pane.id])
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
  const duplicate = (from: Doc) => {
    const id = crypto.randomUUID()
    const fields = Object.fromEntries(Object.entries(from).filter(([k]) => !k.startsWith('_')))
    const created = createDoc(qc, from._type, id, fields)
    navigate({href: panesPath([...panes.slice(0, index), {...pane, id, view: undefined}])})
    created.then(
      () => toast({title: 'The document was successfully duplicated'}),
      (err) => toast({tone: 'critical', title: 'Could not duplicate the document', description: (err as Error).message}),
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
      className="pane doc"
      data-testid="document-pane"
      data-pane={`doc:${pane.id}`}
      data-pane-index={index}
      onFocus={(e) => {
        const field = (e.target as HTMLElement).closest('.form-fields [id]')?.id
        reportFocus(pane.id, field ?? null)
      }}
      onKeyDown={(e) => {
        // Sanity's publish shortcut.
        if (e.ctrlKey && e.altKey && e.code === 'KeyP' && doc && !problems.length) (e.preventDefault(), void publish(qc, doc))
        if (e.ctrlKey && e.altKey && e.code === 'KeyI' && doc) (e.preventDefault(), setInspectOpen(true))
        // F7: the document's own undo (this editor's changes only, across fields and
        // across others' edits). The block canvas keeps its own.
        const mod = e.metaKey || e.ctrlKey
        const key = e.key.toLowerCase()
        if (mod && !e.altKey && (key === 'z' || key === 'y') && !viewingPublished && !(e.target as HTMLElement).closest('bp-paper-canvas')) {
          e.preventDefault()
          const field = undo(qc, pane.id, key === 'z' && !e.shiftKey)
          if (field) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pane="doc:${pane.id}"] [id="${field}"]`)?.focus())
        }
      }}
    >
      <header className="pane-header">
        <AvatarStack people={here} />
        <span className="title chips">
          {draftQ.data?._hasPublished === false ? (
            <span className="chip" data-off="" aria-disabled="true" title="Not published">
              <span className="dot published" />
              Published
            </span>
          ) : (
            <button type="button" className="chip" data-selected={viewingPublished ? '' : undefined} aria-pressed={viewingPublished} onClick={() => navigate({href: `${base}?perspective=published`})}>
              <span className="dot published" />
              Published
            </button>
          )}
          <button
            type="button"
            className="chip"
            data-active={!viewingPublished && draftQ.data?._draft ? '' : undefined}
            data-selected={!viewingPublished ? '' : undefined}
            aria-pressed={!viewingPublished}
            onClick={() => navigate({href: base})}
          >
            <span className="dot draft" />
            Draft
          </button>
        </span>
        {doc && <DocShareMenu doc={doc} />}
        {!viewingPublished && (
          <button
            type="button"
            className="icon-btn validation-btn"
            aria-label="Validation"
            aria-pressed={inspecting}
            data-problems={problems.length || undefined}
            onClick={() => setInspecting((v) => !v)}
          >
            <ErrorOutline />
          </button>
        )}
        {doc && schema && (
          <DocHeaderMenu doc={doc} schema={schema} readOnly={viewingPublished || !canWrite} onInspect={() => setInspectOpen(true)} onHistory={() => navigate({href: withParams(panes, index, {inspect: 'history'})})} />
        )}
        {/* J42: a narrow window has no splits and no close: the back link goes back. */}
        {!narrow && (
          <>
            <button type="button" className="icon-btn" aria-label="Split pane right" title="Split pane right" onClick={() => navigate({href: splitRight(panes, index)})}>
              <SplitVertical />
            </button>
            {split ? (
              // Like Sanity: closing one side of a split is a button, closing a pane a link.
              <button type="button" className="icon-btn" aria-label="Close split pane" data-testid="pane-close" onClick={() => navigate({href: closeHref})}>
                {closeIcon}
              </button>
            ) : (
              <PaneLink href={closeHref} className="icon-btn" aria-label="Close pane" data-testid="pane-close">
                {closeIcon}
              </PaneLink>
            )}
          </>
        )}
      </header>
      <div className="doc-title-bar">
        {header}
        <div className="view-tabs" role="tablist" aria-label="Views">
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => navigate({href: withView(panes, index, viewParam(v.id, mode))})}>
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
            Loading document…
          </div>
        )}
        {error &&
          !doc &&
          (/→ 403\b/.test(String(error)) ? (
            // J49: a doc this editor may not read.
            <div className="pane-banner" role="alert">
              <span>You don't have access to this document.</span>
            </div>
          ) : (
            <ReadErrorCard title="Could not load the document" error={error} failures={docQ.failureCount} retrying={docQ.fetchStatus !== 'idle'} onRetry={() => void docQ.refetch()} />
          ))}
        {deleted && !doc && <DeletedBanner type={pane.type} id={pane.id} />}
        <ReferenceBanner panes={panes} index={index} closeHref={closeHref} />
        {loggedOut && doc && (
          // J48: the session is gone — said where you are editing, with the way back.
          <div className="pane-banner" role="alert">
            <span>You've been logged out. Your edits are kept here and saved once you sign in again.</span>
            <SignInAgain />
          </div>
        )}
        {editReason && doc && (
          <div className="pane-banner" role="note">
            <span>{editReason}</span>
          </div>
        )}
        {!isPending && !doc && !error && viewingPublished && <p role="alert">Not published.</p>}
        {doc && view === 'json' && <pre className="json-view">{JSON.stringify(doc, null, 2)}</pre>}
        {/* Mounted once per doc and then only hidden: the canvas mis-places typing
            after it is mounted again in a page (task-f24549dea0618da2), and a remount costs a load. */}
        {freeform && (view === 'freeform' || canvasSeen === pane.id) && (
          <div hidden={view !== 'freeform'}>
            <PortableDocEditor type={pane.type} id={pane.id} />
          </div>
        )}
        {pane.rev && revQ.data === null && <p role="alert">This revision can't be found. Pick another entry in the history.</p>}
        {doc && schema && view === 'classic' && (!pane.rev || revision) && (
          <div
            className="doc-form"
            onBlur={() => flush(qc, pane.id)}
            onFocus={(e) => keepPathInUrl((e.target as HTMLElement).id)}
            onPointerDown={() => (userMoved.current = Date.now())}
            onKeyDown={() => (userMoved.current = Date.now())}
          >
            <div className="kind">{schema.title}</div>
            <h1>{docTitle(doc, schema)}</h1>
            <GroupTabs schema={schema} value={group} onChange={setGroup} problems={problems} />
            {/* The published version is read-only: a disabled fieldset disables every control in it. */}
            <ChangesContext.Provider value={changes}>
            <DocIdContext.Provider value={doc._publishedId}>
            <DocTypeContext.Provider value={pane.type}>
            <DocContext.Provider value={revision ? ({...doc, ...revision.content} as Doc) : doc}>
            <EditPathContext.Provider value={onEdit}>
            <ProblemsContext.Provider value={revision ? NO_PROBLEMS : steadyProblems}>
            <fieldset className="form-fields" disabled={viewingPublished || !!revision || !canWrite} title={editReason}>
              {formFields.slice(0, revealed).map((f) => (
                <FieldView key={f.name} field={f} path={f.name} value={(revision ? revision.content : doc)[f.name]} openRef={openRef} onChange={onChangeOf(f.name)} />
              ))}
              {!revision && revealed >= formFields.length && (
                <UnknownFields doc={doc} names={unknownFields(schema, doc)} onRemove={(name) => onEdit(name, undefined)} />
              )}
            </fieldset>
            </ProblemsContext.Provider>
            </EditPathContext.Provider>
            </DocContext.Provider>
            </DocTypeContext.Provider>
            </DocIdContext.Provider>
            </ChangesContext.Provider>
          </div>
        )}
      </div>
      {inspecting && !viewingPublished && <ValidationPanel problems={problems} onPick={goTo} onClose={() => setInspecting(false)} />}
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
      {pane.rev
        ? <RevisionFooter type={pane.type} revisionId={pane.rev} timestamp={revision?.timestamp} onRestored={() => navigate({href: withParams(panes, index, {rev: undefined})})} />
        : viewingPublished
        ? doc && <PublishedFooter doc={doc} />
        : doc && <DocFooter doc={doc} closeHref={closeHref} blocked={problems.length} onDuplicate={() => duplicate(doc)} />}
      {inspectOpen && doc && schema && <InspectDialog doc={doc} title={docTitle(doc, schema)} onClose={() => setInspectOpen(false)} />}
    </section>
  )
}

/** Sanity's validation inspector: every problem, click one to go to its field. */
function ValidationPanel({problems, onPick, onClose}: {problems: Problem[]; onPick: (p: Problem) => void; onClose: () => void}) {
  return (
    <aside className="inspector" aria-label="Validation">
      <header>
        <h2>Validation</h2>
        <button type="button" className="icon-btn" aria-label="Close validation" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {problems.length === 0 ? (
        <p className="muted">No validation errors</p>
      ) : (
        <ul>
          {problems.map((p) => (
            <li key={p.path}>
              <button type="button" className="problem" onClick={() => onPick(p)}>
                <ErrorOutline />
                <span>
                  <strong>{p.title}</strong>
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
 * tabs (roving tabindex), Enter/Space or a click selects. No groups, no tabs.
 */
function GroupTabs({schema, value, onChange, problems}: {schema: Schema; value: string; onChange: (g: string) => void; problems: Problem[]}) {
  if (!schema.groups?.length) return null
  const tabs = [{name: '', title: 'All fields'}, ...schema.groups]
  return (
    <div
      className="group-tabs"
      role="tablist"
      aria-label="Field groups"
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
          {g.title ?? g.name}
          {problems.some((p) => !g.name || p.group === g.name) && (
            <span className="error-icon" role="img" aria-label="has validation errors">
              <ErrorOutline />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Sanity names a new untitled doc "New <Type>" in its own pane; anything else untitled is "Untitled". */
export const docTitle = (doc: Doc, schema: Schema) => {
  const t = previewTitle(doc, schema)
  return t === 'Untitled' && doc._hasPublished === false ? `New ${schema.title}` : t
}

function DocFooter({doc, closeHref, blocked, onDuplicate}: {doc: Doc; closeHref: string; blocked: number; onDuplicate: () => void}) {
  const qc = useQueryClient()
  const {state, error} = useSaveState(doc._publishedId)
  const {canWrite, editReason, publishReason, createReason} = useCanWrite()
  const [publishing, setPublishing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  // Discard needs a draft to drop and a published version to fall back to.
  const canDiscard = !!doc._draft && doc._hasPublished !== false
  const label =
    {
      saving: 'Saving…',
      stalled: 'Saving is taking longer than usual…',
      offline: 'Offline — not saving. Your edits are kept here.',
      recovering: 'Back online — saving your edits…',
      error: 'Not saved — retrying',
      signedOut: "You've been logged out — not saving. Sign in to save your edits.",
      refused: `Not saved: ${error ?? 'Barkpark refused the change'}`,
    }[state as string] ?? (doc._draft ? 'Saved' : 'Published')
  return (
    <footer className="doc-footer">
      <span className="save-state" data-state={state} title={error} role="status">
        {label}
      </span>
      {state === 'signedOut' && (
        <SignInAgain />
      )}
      <button
        className="publish"
        disabled={!canWrite || !doc._draft || (state !== 'saved' && state !== 'saving') || publishing || blocked > 0}
        title={publishReason ?? (blocked ? `Fix ${blocked} validation ${blocked === 1 ? 'error' : 'errors'} before publishing` : undefined)}
        aria-keyshortcuts="Control+Alt+P"
        onClick={async () => {
          setPublishing(true)
          try {
            await publish(qc, doc)
          } finally {
            setPublishing(false)
          }
        }}
      >
        Publish
      </button>
      <div className="menu-wrap">
        <button type="button" className="icon-btn" aria-label="Document actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Ellipsis />
        </button>
        {menu && (
          <MenuPopover className="popover menu up" onClose={() => setMenu(false)}>
            <button type="button" role="menuitem" className="menu-item" autoFocus disabled={!canWrite} title={createReason} onClick={() => (setMenu(false), onDuplicate())}>
              Duplicate
            </button>
            <button type="button" role="menuitem" className="menu-item" disabled={!canDiscard || !canWrite} title={editReason} onClick={() => (setMenu(false), setDiscarding(true))}>
              Discard changes
            </button>
            <button type="button" role="menuitem" className="menu-item danger" disabled={!canWrite} title={editReason} onClick={() => (setMenu(false), setDeleting(true))}>
              Delete
            </button>
          </MenuPopover>
        )}
      </div>
      {deleting && <DeleteDialog doc={doc} closeHref={closeHref} onClose={() => setDeleting(false)} />}
      {discarding && (
        <ConfirmDialog
          title="Discard changes?"
          body="Are you sure you want to discard all changes since last published?"
          action="Discard changes"
          run={() => discardDraft(qc, doc)}
          onClose={() => setDiscarding(false)}
        />
      )}
    </footer>
  )
}

/** The Published perspective: read-only, and the way to take a document down. */
function PublishedFooter({doc}: {doc: Doc}) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const {canWrite, publishReason} = useCanWrite()
  return (
    <footer className="doc-footer">
      <span className="save-state" role="status">
        Published
      </span>
      <button className="publish danger" disabled={!canWrite} title={publishReason} onClick={() => setConfirm(true)}>
        Unpublish
      </button>
      {confirm && (
        <ConfirmDialog
          title="Unpublish document?"
          body="It will no longer be live. Its content stays as a draft you can publish again."
          action="Unpublish now"
          run={() => unpublish(qc, doc)}
          onClose={() => setConfirm(false)}
        />
      )}
    </footer>
  )
}

/** A Sanity-style confirm over the pane: Cancel (focused) or the red action. Failures show inline. */
function ConfirmDialog({title, body, action, run, onClose}: {title: string; body: string; action: string; run: () => Promise<unknown>; onClose: () => void}) {
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
            Cancel
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
