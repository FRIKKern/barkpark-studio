import {useEffect, useMemo, useState, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {usePublishedPerspective} from '../lib/perspective'
import {validate, type Problem} from '../lib/validation'
import {docQuery, previewTitle, publishedQuery, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {discardDraft, draftNew, edit, flush, publish, unpublish, useSaveState} from '../lib/edits'
import {openAfter, panesPath, type Pane} from '../lib/panes'
import {PaneLink} from './PaneLink'
import {DocContext, FieldView, ProblemsContext} from './Fields'
import {DeleteDialog} from './DeleteDialog'
import {Close as CloseIcon, Ellipsis, ErrorOutline} from './icons'

type Props = {panes: Pane[]; index: number; closeHref: string; header: ReactNode; closeIcon: ReactNode}

export function DocumentPane({panes, index, closeHref, header, closeIcon}: Props) {
  const pane = panes[index] as Extract<Pane, {kind: 'doc'}>
  const {data: schemas = []} = useQuery(schemasQuery)
  // Sanity's two perspectives, in the URL: the draft you edit (default), or the
  // published version, read-only (?perspective=published).
  const viewingPublished = usePublishedPerspective()
  const draftQ = useQuery(docQuery(pane.type, pane.id))
  const publishedQ = useQuery({...publishedQuery(pane.type, pane.id), enabled: viewingPublished})
  const {data: doc, isPending, error} = viewingPublished ? publishedQ : draftQ
  const base = panesPath(panes)
  const navigate = useNavigate()
  // Field groups (Sanity's tabs): the schema's default group first; '' = all fields.
  const defaultGroup = schemaOf(schemas, pane.type)?.groups?.find((g) => g.default)?.name ?? ''
  const [chosenGroup, setGroup] = useState<string | null>(null)
  const group = chosenGroup ?? defaultGroup
  // J13: the schema's rules, checked as you type (the draft only; published is what it is).
  const schemaForPane = schemaOf(schemas, pane.type)
  const problems = useMemo(() => (doc && schemaForPane && !viewingPublished ? validate(doc, schemaForPane) : []), [doc, schemaForPane, viewingPublished])
  const [inspecting, setInspecting] = useState(false)
  const goTo = (p: Problem) => {
    if (group && p.group !== group) setGroup('')
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pane="doc:${pane.id}"] [id="${p.path}"]`)?.focus())
  }
  const schema = schemaOf(schemas, pane.type)
  const next = panes[index + 1]
  const qc = useQueryClient()
  // An id nobody has written yet is a new doc (Sanity treats it the same way).
  const initialValues = schemaOf(schemas, pane.type)?.initialValues
  useEffect(() => {
    if (draftQ.data === null && initialValues) draftNew(qc, pane.type, pane.id, initialValues)
  }, [draftQ.data, initialValues, qc, pane.type, pane.id])
  const onEdit = (field: string, value: unknown) => doc && edit(qc, doc, field, value)
  // Closing the pane (or navigating it away) sends what is still waiting.
  useEffect(() => () => flush(qc, pane.id), [qc, pane.id])
  const openRef = (type: string, id: string, parentRefPath: string) => ({
    href: openAfter(panes, index, {kind: 'doc', id, type, parentRefPath}),
    selected: next?.kind === 'doc' && next.id === id && next.parentRefPath === parentRefPath,
    active: index === panes.length - 2,
  })

  return (
    <section
      className="pane doc"
      data-testid="document-pane"
      data-pane={`doc:${pane.id}`}
      data-pane-index={index}
      onKeyDown={(e) => {
        // Sanity's publish shortcut.
        if (e.ctrlKey && e.altKey && e.code === 'KeyP' && doc && !problems.length) (e.preventDefault(), void publish(qc, doc))
      }}
    >
      <header className="pane-header">
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
        <PaneLink href={closeHref} className="icon-btn" aria-label="Close pane" data-testid="pane-close">
          {closeIcon}
        </PaneLink>
      </header>
      <div className="doc-title-bar">{header}</div>
      <div className="doc-main">
      <div className="pane-body">
        {error && <p role="alert">Could not load {pane.id}: {String(error)}</p>}
        {!isPending && !doc && !error && viewingPublished && <p role="alert">Not published.</p>}
        {doc && schema && (
          <div className="doc-form" onBlur={() => flush(qc, pane.id)}>
            <div className="kind">{schema.title}</div>
            <h1>{docTitle(doc, schema)}</h1>
            <GroupTabs schema={schema} value={group} onChange={setGroup} problems={problems} />
            {/* The published version is read-only: a disabled fieldset disables every control in it. */}
            <DocContext.Provider value={doc}>
            <ProblemsContext.Provider value={problems}>
            <fieldset className="form-fields" disabled={viewingPublished}>
              {schema.fields.filter((f) => !group || f.group === group).map((f) => (
                <FieldView key={f.name} field={f} path={f.name} value={doc[f.name]} openRef={openRef} onChange={(v) => onEdit(f.name, v)} />
              ))}
            </fieldset>
            </ProblemsContext.Provider>
            </DocContext.Provider>
          </div>
        )}
      </div>
      {inspecting && !viewingPublished && <ValidationPanel problems={problems} onPick={goTo} onClose={() => setInspecting(false)} />}
      </div>
      {viewingPublished
        ? doc && <PublishedFooter doc={doc} />
        : doc && <DocFooter doc={doc} closeHref={closeHref} blocked={problems.length} />}
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

function DocFooter({doc, closeHref, blocked}: {doc: Doc; closeHref: string; blocked: number}) {
  const qc = useQueryClient()
  const {state, error} = useSaveState(doc._publishedId)
  const [publishing, setPublishing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  // Discard needs a draft to drop and a published version to fall back to.
  const canDiscard = !!doc._draft && doc._hasPublished !== false
  const label = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved — retrying' : doc._draft ? 'Saved' : 'Published'
  return (
    <footer className="doc-footer">
      <span className="save-state" data-state={state} title={error} role="status">
        {label}
      </span>
      <button
        className="publish"
        disabled={!doc._draft || state === 'error' || publishing || blocked > 0}
        title={blocked ? `Fix ${blocked} validation ${blocked === 1 ? 'error' : 'errors'} before publishing` : undefined}
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
          <div className="popover menu up" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
            <button type="button" role="menuitem" className="menu-item" autoFocus disabled={!canDiscard} onClick={() => (setMenu(false), setDiscarding(true))}>
              Discard changes
            </button>
            <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(false), setDeleting(true))}>
              Delete
            </button>
          </div>
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
  return (
    <footer className="doc-footer">
      <span className="save-state" role="status">
        Published
      </span>
      <button className="publish danger" onClick={() => setConfirm(true)}>
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
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
      </div>
    </div>
  )
}

export type {Doc, Schema}
