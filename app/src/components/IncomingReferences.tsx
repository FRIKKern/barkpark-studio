import {useQueries, useQuery} from '@tanstack/react-query'
import {backlinksQuery, docQuery, publishedQuery, referringTypes, schemasQuery, type Backlink, type Doc} from '../lib/data'
import {useLive} from '../lib/live'
import {refersTo} from '../lib/refers-to'
import {useT} from '../lib/i18n'
import {openAfter, type Pane} from '../lib/panes'
import {Close as CloseIcon} from './icons'
import {DocPreview} from './Preview'

// J17 widen, Sanity's "Incoming references" (the document menu, `inspect=…/incoming-references`):
// every document that points at this one, grouped by type, any time (not only when
// deleting). A row opens the referring doc in the next pane, at the field that refers.
// Kept current by live frames (lib/live.ts reads the backlinks again): the panel listens to
// every type that can refer to this one, so a doc that starts pointing here shows up too,
// not only docs already on screen. A row goes as soon as its doc, as the frames bring it,
// no longer points here: Barkpark's backlinks can keep a removed edge some seconds
// (task-3fd3c0c53d08a6bd), and the doc itself is the truth.

export function IncomingReferences({id, panes, index, onClose}: {id: string; panes: Pane[]; index: number; onClose: () => void}) {
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  const here = panes[index]
  useLive([], here?.kind === 'doc' ? referringTypes(schemas, here.type) : [])
  const {data: links, isPending, error, refetch} = useQuery({...backlinksQuery(id), refetchOnMount: 'always'})
  // One row per referring doc (a draft and its published version are one doc; several fields one row).
  const seen = new Set<string>()
  const rows = (links ?? []).map((l) => ({...l, from_doc_id: l.from_doc_id.replace(/^drafts\./, '')})).filter((l) => l.from_doc_id !== id && !seen.has(l.from_doc_id) && seen.add(l.from_doc_id))
  const docs = useQueries({queries: rows.map((r) => docQuery(r.type, r.from_doc_id))})
  // A draft that points away while its published version still points here still refers
  // (deleting this doc is still blocked by it): then the published version decides.
  const draftAway = rows.map((_, i) => {
    const doc = docs[i]?.data
    return !!doc && !!doc._draft && doc._hasPublished !== false && !refersTo(doc, id)
  })
  const published = useQueries({queries: rows.map((r, i) => ({...publishedQuery(r.type, r.from_doc_id), enabled: draftAway[i]}))})
  const pointing = rows.filter((r, i) => {
    const doc = docs[i]?.data
    if (doc === undefined || refersTo(doc, id)) return true
    if (!draftAway[i]) return false
    const pub = published[i]?.data
    return pub === undefined || refersTo(pub, id)
  })
  const types = [...new Set(pointing.map((r) => r.type))]
  const next = panes[index + 1]
  const title = (type: string) => schemas.find((s) => s.name === type)?.title ?? type
  return (
    <aside className="inspector incoming" aria-label={t('Incoming references')}>
      <header>
        <h2>{t('Incoming references')}</h2>
        <button type="button" className="icon-btn" aria-label={t('Close incoming references')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {isPending ? (
        <p className="muted incoming-card">{t('Loading…')}</p>
      ) : error ? (
        <p className="incoming-card" role="alert">
          {t('Could not load the incoming references.')}{' '}
          <button type="button" className="btn-text" onClick={() => void refetch()}>
            {t('Retry')}
          </button>
        </p>
      ) : pointing.length === 0 ? (
        <p className="incoming-card">{t('No incoming references found.')}</p>
      ) : (
        types.map((type) => (
          <section key={type} className="incoming-group" aria-label={title(type)}>
            <h3>{title(type)}</h3>
            <ul className="incoming-card">
              {pointing
                .filter((r) => r.type === type)
                .map((r) => (
                  <li key={r.from_doc_id}>
                    <Row link={r} href={openAfter(panes, index, {kind: 'doc', id: r.from_doc_id, type: r.type, path: r.via_field || undefined})} selected={next?.kind === 'doc' && next.id === r.from_doc_id} active={index === panes.length - 2} />
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </aside>
  )
}

/** One referring doc: its own preview once read, its backlink title until then (never a blank row). */
function Row({link, href, selected, active}: {link: Backlink; href: string; selected: boolean; active: boolean}) {
  const {data} = useQuery(docQuery(link.type, link.from_doc_id))
  const fallback = {_id: link.from_doc_id, _publishedId: link.from_doc_id, _type: link.type, title: link.title} as unknown as Doc
  return <DocPreview doc={data ?? fallback} href={href} selected={selected} active={active} />
}

