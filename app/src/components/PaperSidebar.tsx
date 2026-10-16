import {useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react'
import {useQueries, useQuery} from '@tanstack/react-query'
import {anyDocQuery, backlinksQuery, previewTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {currentScopeQuery, scopeOptionsQuery} from '../lib/scope-switch'
import {outboundIds} from '../lib/relations'
import {checkLabel, labelEntries, slugFeedback, type WeightedTag} from '../lib/paper'
import {TextInput} from './Fields'
import {ChevronDown, ChevronRight, Close as CloseIcon, Reset} from './icons'
import {useT} from '../lib/i18n'

// D12: a paper's metadata beside the canvas, after Barkpark's LiveView Studio sidebar
// (paper_canvas.ex "t6"): Status (LiveView: Publish; renamed so it never shares a name
// with the Publish action), Slug, Context (dataset, workspace), Description, Labels,
// Relations (what it references, what uses it). Every edit is a doc-field edit through
// the pane's own save path; none touches a block.

export function PaperSidebar({doc, published, onEdit, onClose}: {doc: Doc; published: boolean; onEdit: (field: string, value: unknown) => void; onClose: () => void}) {
  const t = useT()
  const [slug, setSlug] = useState(doc._publishedId)
  const fb = slugFeedback(slug)
  const description = typeof doc.description === 'string' ? doc.description : ''
  const tags = Array.isArray(doc.tags) ? (doc.tags as (WeightedTag | string)[]) : []
  const labels = labelEntries(tags, doc.main_tag)
  const [add, setAdd] = useState({tag: '', strength: '', rationale: ''})
  const [addError, setAddError] = useState<string>()
  // Public only when an anonymous reader gets it (LiveView's rule); else members only.
  const reader = useQuery({queryKey: ['paper-reader', doc._publishedId], enabled: published, queryFn: () => fetch(`/api/papers/reader?slug=${encodeURIComponent(doc._publishedId)}`).then((r) => (r.ok ? (r.json() as Promise<{public: boolean}>) : {public: false}))})
  // Opened: focus moves into it (LiveView does the same); closing hands it back to the opener.
  const root = useRef<HTMLElement>(null)
  useEffect(() => root.current?.focus({preventScroll: true}), [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = checkLabel(add.tag, add.strength, add.rationale)
    if ('error' in r) return setAddError(r.error)
    setAddError(undefined)
    setAdd({tag: '', strength: '', rationale: ''})
    onEdit('tags', [...tags, r.entry])
  }
  return (
    <aside ref={root} tabIndex={-1} className="inspector paper-sidebar" aria-label={t('Document metadata')}>
      <header>
        <h2>{t('Document metadata')}</h2>
        <button type="button" className="icon-btn" aria-label={t('Close document metadata')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <Section title={t('Status')}>
        <dl className="paper-facts">
          <dt>{t('Status')}</dt>
          <dd>{published ? (doc._draft ? t('Published, with unpublished changes') : t('Published')) : t('Draft')}</dd>
          <dt>{t('Visibility')}</dt>
          <dd>{!published ? t('Draft') : reader.data?.public ? t('Public') : reader.data ? t('Members only') : '…'}</dd>
        </dl>
        {published && reader.data && !reader.data.public && <p className="muted paper-note">{t('This workspace has no public page for papers, so only members and share-link holders can read it.')}</p>}
      </Section>
      <Section title={t('Slug')}>
        <input className="input" aria-label={t('Slug')} aria-describedby="paper-slug-fb" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <p id="paper-slug-fb" className="paper-fb" data-tone={fb.tone}>
          {t(fb.message)}
        </p>
        <p className="muted paper-note">{t("The slug is this paper's id: checked as you type, not renamed here.")}</p>
      </Section>
      <Context />
      <Section title={t('Description')}>
        <label className="sr-only" htmlFor="description">
          {t('Description')}
        </label>
        <TextInput id="description" value={description} rows={4} onChange={(v) => onEdit('description', v)} />
        {description.trim().length < 20 && (
          <p className="paper-fb" data-tone="warn">
            {t('Publishing needs a description of at least 20 characters.')}
          </p>
        )}
      </Section>
      <Section title={t('Labels')}>
        {labels.length === 0 ? (
          <p className="muted">{t('No labels yet.')}</p>
        ) : (
          <ul className="paper-tags">
            {labels.map((l) => (
              <li key={`${l.index}-${l.name}`} data-main={l.main || undefined} title={l.rationale ?? undefined}>
                <span className="paper-tag-name">
                  {l.main ? <strong>{l.name}</strong> : l.name}
                  {l.main && <span className="paper-tag-main">{t('main')}</span>}
                  {l.strength !== null && (
                    <span className="paper-tag-strength" aria-label={t('strength {n}', {n: l.strength})}>
                      {l.strength}
                    </span>
                  )}
                  <button type="button" className="icon-btn paper-tag-remove" aria-label={t('Remove label {name}', {name: l.name})} onClick={() => onEdit('tags', tags.filter((_, i) => i !== l.index))}>
                    <CloseIcon />
                  </button>
                </span>
                {l.rationale && <span className="paper-tag-why">{l.rationale}</span>}
              </li>
            ))}
          </ul>
        )}
        <form className="paper-add" onSubmit={submit} aria-label={t('Add a label')}>
          <input className="input" aria-label={t('Tag name')} placeholder={t('tag')} value={add.tag} onChange={(e) => setAdd({...add, tag: e.target.value})} />
          <input className="input" aria-label={t('Tag strength, 1 to 100')} placeholder={t('strength 1–100')} inputMode="numeric" value={add.strength} onChange={(e) => setAdd({...add, strength: e.target.value})} />
          <input className="input" aria-label={t('Tag rationale')} placeholder={t('why this tag fits (at least 20 characters)')} value={add.rationale} onChange={(e) => setAdd({...add, rationale: e.target.value})} />
          {addError && (
            <p className="paper-fb" data-tone="danger" role="alert">
              {t(addError)}
            </p>
          )}
          <button type="submit" className="btn">
            {t('Add label')}
          </button>
        </form>
      </Section>
      <Relations doc={doc} />
    </aside>
  )
}

/** LiveView's Context: the dataset and workspace this paper lives in. */
function Context() {
  const t = useT()
  const {data: scope} = useQuery(currentScopeQuery)
  const options = useQuery({...scopeOptionsQuery(scope ?? {workspace: '', project: ''}), enabled: !!scope}).data
  if (!scope) return null
  const workspace = options?.workspaces?.find((w) => w.slug === scope.workspace)?.name ?? scope.workspace
  return (
    <Section title={t('Context')}>
      <dl className="paper-facts">
        <dt>{t('Dataset')}</dt>
        <dd>{scope.dataset}</dd>
        <dt>{t('Workspace')}</dt>
        <dd>{workspace}</dd>
      </dl>
    </Section>
  )
}

/**
 * LiveView's Relations, folded into one section: the documents this paper references
 * (its fields and blocks) and the ones that use it (Barkpark's backlinks), each by title,
 * never an id; the refresh reads the backlinks again.
 */
function Relations({doc}: {doc: Doc}) {
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  const out = outboundIds(doc as Record<string, unknown>, doc._publishedId)
  const outDocs = useQueries({queries: out.map((id) => anyDocQuery(id))})
  const inbound = useQuery(backlinksQuery(doc._publishedId))
  const seen = new Set<string>()
  const usedBy = (inbound.data ?? []).map((b) => ({...b, from_doc_id: b.from_doc_id.replace(/^drafts\./, '')})).filter((b) => b.from_doc_id !== doc._publishedId && !seen.has(b.from_doc_id) && seen.add(b.from_doc_id))
  const references = out.map((id, i) => ({id, doc: outDocs[i]?.data})).filter((r) => r.doc !== null)
  const name = (d: Doc | null | undefined, id: string) => (d ? previewTitle(d, schemaOf(schemas, d._type), t) : id)
  return (
    <Section title={t('Relations')}>
      <div className="paper-rel-head">
        <button type="button" className="icon-btn" aria-label={t('Refresh inbound references')} title={t('Refresh inbound references')} onClick={() => void inbound.refetch()}>
          <Reset />
        </button>
      </div>
      {references.length === 0 && usedBy.length === 0 ? (
        <p className="muted">{t('No relations.')}</p>
      ) : (
        <>
          {references.length > 0 && (
            <section className="paper-rel-group">
              <h4>{t('References ({n})', {n: references.length})}</h4>
              <ul className="paper-rels">
                {references.map((r) => (
                  <li key={r.id} title={r.id}>
                    {name(r.doc, r.id)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {usedBy.length > 0 && (
            <section className="paper-rel-group">
              <h4>{t('Used by')}</h4>
              <ul className="paper-rels">
                {usedBy.map((b) => (
                  <li key={b.from_doc_id} title={b.from_doc_id}>
                    {b.title || b.from_doc_id}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Section>
  )
}

/** A collapsible section, open by default (LiveView: each section collapses on its own). */
function Section({title, children}: {title: string; children: ReactNode}) {
  const [open, setOpen] = useState(true)
  return (
    <section className="paper-section">
      <h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown /> : <ChevronRight />}
          {title}
        </button>
      </h3>
      {open && <div className="paper-section-body">{children}</div>}
    </section>
  )
}
