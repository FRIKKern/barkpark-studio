import {useEffect, useId, useMemo, useRef, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {isSingleton, relatedQuery, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {createDoc} from '../lib/edits'
import {focusFirstField} from '../lib/focus'
import {useT} from '../lib/i18n'
import {creationChoices, dropRelated, fieldPathOf, foldRelated, incomingFor, incomingIn, referenceKind, referencePreset, shownRelated, RELATED_MAX, type IncomingDecl, type IncomingType} from '../lib/incoming-refs'
import {useLive} from '../lib/live'
import {openAfter, type Pane} from '../lib/panes'
import {usePresences, type Presence} from '../lib/presence'
import {useCanWrite} from '../lib/session'
import {choicesFor, type Choice} from '../lib/templates'
import studio from '../studio.config'
import {MenuPopover} from './FocusScopes'
import {Add} from './icons'
import {usePaneNavigate} from './PaneLink'
import {AvatarStack} from './Presence'
import {DocPreview} from './Preview'
import {toast} from './Toasts'

// Sanity's incoming references input (defineIncomingReferenceDecoration): in a document's
// form, the documents that reference it, by declared type. A row is the referrer's own
// preview and opens it in the next pane; "Add item" creates a document of the type whose
// reference field already points here, and opens it. Declared beside `desk.views`
// (`desk.incoming`) or in the studio config; it is no field and holds no value: this
// component reads other documents and writes only the new one (lib/incoming-refs.ts).

/** Rows shown before "Show all": Sanity's list is ten rows high. */
const FIRST_ROWS = 10

type Props = {
  schema: Schema
  /** The form's field group ('' = all fields). */
  group: string
  /** The open document as the pane shows it. */
  doc: Doc
  panes: Pane[]
  index: number
  /** The Published perspective: the published referrers, nothing to add. */
  published: boolean
  /** An old revision is shown: the list as it is now, nothing to add. */
  revision: boolean
  /** A deleted or schedule-locked document: nothing to add. */
  locked: boolean
}

export function IncomingReferencesInputs({schema, group, ...rest}: Props) {
  const decls = useMemo(() => incomingIn(incomingFor(schema, studio.form?.incomingReferences?.[schema.name]), group), [schema, group])
  if (!decls.length) return null
  return (
    <div className="incoming-inputs">
      {decls.map((decl) => (
        <IncomingInput key={decl.name} decl={decl} {...rest} />
      ))}
    </div>
  )
}

function IncomingInput({decl, ...rest}: Omit<Props, 'schema' | 'group'> & {decl: IncomingDecl}) {
  const titleId = useId()
  return (
    <section className="incoming-field" aria-labelledby={titleId} data-testid={`incoming-${decl.name}`}>
      {/* Not a `.field`: it has no value, so none of a field's menus, marks or change bars. */}
      <div className="incoming-label" id={titleId}>{decl.title}</div>
      {decl.description && <p className="field-desc">{decl.description}</p>}
      {decl.types.map((type) => (
        <TypeList key={`${type.type}:${type.by}`} decl={decl} type={type} titled={decl.types.length > 1} {...rest} />
      ))}
    </section>
  )
}

function TypeList({decl, type, titled, doc, panes, index, published, revision, locked}: Omit<Props, 'schema' | 'group'> & {decl: IncomingDecl; type: IncomingType; titled: boolean}) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = usePaneNavigate()
  const {canWrite, createReason} = useCanWrite()
  const {data: schemas = []} = useQuery(schemasQuery)
  const id = doc._publishedId
  const refSchema = schemaOf(schemas, type.type)
  const kind = referenceKind(refSchema, type.by)
  const title = type.title ?? refSchema?.title ?? type.type
  // Nothing can reference a document Barkpark does not have yet (a new one before its first edit).
  const exists = !!doc._rev
  const related = useMemo(() => ({type: type.type, by: type.by, orderings: type.orderings}), [type.type, type.by, type.orderings])
  const query = relatedQuery(related, id, published)
  const {data, isPending, error, refetch, isRefetching} = useQuery({...query, enabled: exists && !!kind})
  // Every document of the type is heard, not only the rows here: one that starts pointing at this document joins.
  useLive([], kind ? [type.type] : [])
  useRelatedLive(query.queryKey, related, id, exists && !!kind && !published)
  // Documents "Add item" made here: listed at once, before any read has them.
  const [made, setMade] = useState<string[]>([])
  // What this browser holds of a row's document decides, unless it is marked stale (a draft discarded while no pane had
  // it open is only marked, lib/live.ts): then the row as the server just gave it does.
  const held = (docId: string) => (published || qc.getQueryState(['doc', docId])?.isInvalidated ? undefined : qc.getQueryData<Doc | null>(['doc', docId]))
  const open = (docId: string) => panes.some((p) => p.kind === 'doc' && p.id === docId)
  const mine = made.flatMap((docId) => qc.getQueryData<Doc | null>(['doc', docId]) ?? [])
  const rows = shownRelated([...mine.filter((m) => !m._rev), ...(data ?? [])], related, id, held, open)
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  // J07: who has a row's document open, as the lists show it.
  const people = usePresences()
  const here = useMemo(() => {
    const m = new Map<string, Presence[]>()
    for (const p of people) if (p.documentId) m.set(p.documentId, [...(m.get(p.documentId) ?? []), p])
    return m
  }, [people])
  const next = panes[index + 1]
  const listLabel = t('Incoming references of type {type}', {type: title})

  const choices = refSchema && !isSingleton(schemas, type.type) && refSchema.kind !== 'object' ? creationChoices(choicesFor(schemas, type.type), decl.creationAllowed) : []
  const why = published
    ? t('You are viewing the published version. Switch to the draft to add an item.')
    : revision
      ? t('You are viewing an earlier revision. Go back to the current version to add an item.')
      : locked
        ? t('This document cannot be changed now.')
        : !canWrite
          ? createReason
          : !exists
            ? t('This document does not exist yet. Edit it first, then add items that reference it.')
            : undefined
  const add = (choice: Choice) => {
    const preset = referencePreset(refSchema, type.by, id, choice.value)
    if (!preset) return
    const newId = crypto.randomUUID()
    setMade((m) => [...m, newId])
    // The new row is in view wherever the list's order puts it.
    if (rows.length >= FIRST_ROWS) setAll(true)
    // As a reference field's Create new (J22): the document exists at once, pointing here,
    // and opens in the next pane; over the chosen template's values (J18).
    createDoc(qc, type.type, newId, {local: choice.id === type.type ? {} : choice.value, asIs: preset}).catch((err) => toast({tone: 'critical', title: t('Could not create the document'), description: (err as Error).message}))
    void navigate({href: openAfter(panes, index, {kind: 'doc', id: newId, type: type.type})})
    focusFirstField(newId)
  }

  return (
    <div className="incoming-type" data-testid={`incoming-type-${type.type}`}>
      {titled && <div className="incoming-type-title">{title}</div>}
      {!refSchema ? (
        <p className="incoming-box" role="alert">{t('Schema type {type} not found', {type: type.type})}</p>
      ) : !kind ? (
        <p className="incoming-box" role="alert">{t('{field} is not a reference field of {type}.', {field: fieldPathOf(type.by), type: refSchema.title})}</p>
      ) : !exists ? (
        <p className="incoming-box muted">{t('No items')}</p>
      ) : isPending ? (
        <div className="incoming-box" aria-busy="true" aria-label={t('Loading documents…')} data-testid="incoming-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="preview skeleton">
              <span className="media" />
              <span className="text">
                <div className="t" />
                <div className="s" />
              </span>
            </div>
          ))}
        </div>
      ) : error && !data ? (
        <p className="incoming-box" role="alert">
          {t('Could not load the documents')}{' '}
          <button type="button" className="btn-text" disabled={isRefetching} onClick={() => void refetch()}>
            {t('Retry')}
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="incoming-box muted">{t('No items')}</p>
      ) : (
        <div className="incoming-box">
          <div role="list" aria-label={listLabel} className="incoming-rows">
            {shown.map((d) => (
              <div role="listitem" key={d._publishedId}>
                <DocPreview
                  doc={d}
                  href={openAfter(panes, index, {kind: 'doc', id: d._publishedId, type: d._type, ...(d._rev && {path: fieldPathOf(type.by)})})}
                  selected={next?.kind === 'doc' && next.id === d._publishedId}
                  active={index === panes.length - 2}
                  testId="incoming-item"
                  extra={here.has(d._publishedId) ? <AvatarStack people={here.get(d._publishedId)!} max={2} editing /> : undefined}
                />
              </div>
            ))}
          </div>
          {rows.length > FIRST_ROWS && (
            <button type="button" className="btn-text incoming-more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? t('Show fewer') : t('Show all {n}', {n: rows.length})}
            </button>
          )}
          {(data?.length ?? 0) >= RELATED_MAX && <p className="incoming-note">{t('The first {n} are listed.', {n: RELATED_MAX})}</p>}
        </div>
      )}
      {kind && choices.length > 0 && <AddItem choices={choices} disabled={!!why} reason={why} onPick={add} label={t('Add item')} />}
    </div>
  )
}

/**
 * Keep a list current without reading it again: every change to a document this browser
 * holds (typed here, or a live frame, lib/live.ts) is folded into the rows. A read that was
 * on its way when a row joined or left is dropped and asked again: it began before the
 * change and would put the old rows back.
 */
function useRelatedLive(key: readonly unknown[], related: IncomingType, id: string, on: boolean) {
  const qc = useQueryClient()
  const again = useRef<ReturnType<typeof setTimeout>>(undefined)
  const keyText = JSON.stringify(key)
  useEffect(() => {
    if (!on) return
    const stop = qc.getQueryCache().subscribe((e) => {
      const [what, docId] = e.query.queryKey as [unknown, unknown]
      if (what !== 'doc' || typeof docId !== 'string') return
      if (e.type !== 'removed' && !(e.type === 'updated' && e.action.type === 'success')) return
      const rows = qc.getQueryData<Doc[]>(key)
      if (!rows) return
      const doc = e.type === 'removed' ? null : (e.query.state.data as Doc | null | undefined)
      const now = doc ? foldRelated(rows, doc, related, id) : doc === null ? dropRelated(rows, docId) : rows
      if (now === rows) return
      const moved = now.length !== rows.length
      if (moved && qc.isFetching({queryKey: key, exact: true})) {
        void qc.cancelQueries({queryKey: key, exact: true})
        clearTimeout(again.current)
        again.current = setTimeout(() => void qc.invalidateQueries({queryKey: key, exact: true}), 400)
      }
      qc.setQueryData(key, now)
    })
    return () => (stop(), clearTimeout(again.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keyText` is the key
  }, [qc, keyText, related, id, on])
}

/** "Add item": one way to start the type creates it; several ask which (J18's templates), as Create new does. */
function AddItem({choices, disabled, reason, onPick, label}: {choices: Choice[]; disabled: boolean; reason?: string; onPick: (choice: Choice) => void; label: string}) {
  const [open, setOpen] = useState(false)
  const many = choices.length > 1
  return (
    <div className="menu-wrap add-item-wrap">
      <button type="button" className="add-item" data-testid="incoming-add" disabled={disabled} title={reason} aria-haspopup={many ? 'menu' : undefined} aria-expanded={many ? open : undefined} onClick={() => (many ? setOpen((o) => !o) : onPick(choices[0]!))}>
        <Add /> {label}
      </button>
      {disabled && reason && <p className="incoming-note" role="note">{reason}</p>}
      {open && many && (
        <MenuPopover className="popover menu" onClose={() => setOpen(false)} aria-label={label}>
          {choices.map((c) => (
            <button key={c.id} type="button" role="menuitem" className="menu-item" onClick={() => (setOpen(false), onPick(c))}>
              {c.title}
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}
