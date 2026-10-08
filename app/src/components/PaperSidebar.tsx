import {useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react'
import type {Doc} from '../lib/data'
import {checkLabel, labelEntries, slugFeedback, type WeightedTag} from '../lib/paper'
import {TextInput} from './Fields'
import {ChevronDown, ChevronRight, Close as CloseIcon} from './icons'

// D12: a paper's metadata beside the canvas, after Barkpark's LiveView Studio sidebar
// (paper_canvas.ex "t6"): Status (LiveView: Publish; renamed so it never shares a name
// with the Publish action), Slug, Description, Labels. Every edit is a doc-field
// edit through the pane's own save path; none touches a block.

export function PaperSidebar({doc, published, onEdit, onClose}: {doc: Doc; published: boolean; onEdit: (field: string, value: unknown) => void; onClose: () => void}) {
  const [slug, setSlug] = useState(doc._publishedId)
  const fb = slugFeedback(slug)
  const description = typeof doc.description === 'string' ? doc.description : ''
  const tags = Array.isArray(doc.tags) ? (doc.tags as (WeightedTag | string)[]) : []
  const labels = labelEntries(tags, doc.main_tag)
  const [add, setAdd] = useState({tag: '', strength: '', rationale: ''})
  const [addError, setAddError] = useState<string>()
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
    <aside ref={root} tabIndex={-1} className="inspector paper-sidebar" aria-label="Document metadata">
      <header>
        <h2>Document metadata</h2>
        <button type="button" className="icon-btn" aria-label="Close document metadata" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <Section title="Status">
        <dl className="paper-facts">
          <dt>Status</dt>
          <dd>{published ? (doc._draft ? 'Published, with unpublished changes' : 'Published') : 'Draft'}</dd>
          <dt>Visibility</dt>
          <dd>{published ? 'Public' : 'Draft'}</dd>
        </dl>
      </Section>
      <Section title="Slug">
        <input className="input" aria-label="Slug" aria-describedby="paper-slug-fb" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <p id="paper-slug-fb" className="paper-fb" data-tone={fb.tone}>
          {fb.message}
        </p>
        <p className="muted paper-note">The slug is this paper's id: checked as you type, not renamed here.</p>
      </Section>
      <Section title="Description">
        <label className="sr-only" htmlFor="description">
          Description
        </label>
        <TextInput id="description" value={description} rows={4} onChange={(v) => onEdit('description', v)} />
        {description.trim().length < 20 && (
          <p className="paper-fb" data-tone="warn">
            Publishing needs a description of at least 20 characters.
          </p>
        )}
      </Section>
      <Section title="Labels">
        {labels.length === 0 ? (
          <p className="muted">No labels yet.</p>
        ) : (
          <ul className="paper-tags">
            {labels.map((l) => (
              <li key={`${l.index}-${l.name}`} data-main={l.main || undefined} title={l.rationale ?? undefined}>
                <span className="paper-tag-name">
                  {l.main ? <strong>{l.name}</strong> : l.name}
                  {l.main && <span className="paper-tag-main">main</span>}
                  {l.strength !== null && (
                    <span className="paper-tag-strength" aria-label={`strength ${l.strength}`}>
                      {l.strength}
                    </span>
                  )}
                  <button type="button" className="icon-btn paper-tag-remove" aria-label={`Remove label ${l.name}`} onClick={() => onEdit('tags', tags.filter((_, i) => i !== l.index))}>
                    <CloseIcon />
                  </button>
                </span>
                {l.rationale && <span className="paper-tag-why">{l.rationale}</span>}
              </li>
            ))}
          </ul>
        )}
        <form className="paper-add" onSubmit={submit} aria-label="Add a label">
          <input className="input" aria-label="Tag name" placeholder="tag" value={add.tag} onChange={(e) => setAdd({...add, tag: e.target.value})} />
          <input className="input" aria-label="Tag strength, 1 to 100" placeholder="strength 1–100" inputMode="numeric" value={add.strength} onChange={(e) => setAdd({...add, strength: e.target.value})} />
          <input className="input" aria-label="Tag rationale" placeholder="why this tag fits (at least 20 characters)" value={add.rationale} onChange={(e) => setAdd({...add, rationale: e.target.value})} />
          {addError && (
            <p className="paper-fb" data-tone="danger" role="alert">
              {addError}
            </p>
          )}
          <button type="submit" className="btn">
            Add label
          </button>
        </form>
      </Section>
    </aside>
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
