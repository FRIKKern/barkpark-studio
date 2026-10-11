import {useState, type ReactNode} from 'react'
import {DialogBox} from './FocusScopes'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {historyQuery, restoreRevision, timeline, type HistoryEntry} from '../lib/history'
import {applyServer} from '../lib/edits'
import type {Doc} from '../lib/data'
import {ChevronDown, ChevronLeft, Close as CloseIcon, InfoOutline} from './icons'
import {toast} from './Toasts'
import {ago, intlTag, t as tt, useLocale, useT, type Locale} from '../lib/i18n'

// Sanity's History inspector (J16), beside the document: a timeline of what
// happened, who did it and when; picking an entry shows the document as it was
// then, read-only, at a deep URL (`rev=<id>`), with "Revert to revision" in the footer.

const BADGE: Record<string, string> = {Published: 'published', Unpublished: 'unpublished', 'Discarded draft': 'discarded', Deleted: 'discarded', Restored: 'edited', Edited: 'edited', 'Draft created': 'created'}

export {ago}
const initials = (name: string) => {
  if (name === 'API token') return '·'
  // First and last word, as the presence avatars (and Sanity's).
  const words = name.replace(/@.*/, '').split(/[.\s_-]+/).filter(Boolean)
  return [words[0], words.length > 1 ? words.at(-1) : undefined].filter((w): w is string => !!w).map((w) => w[0]!.toUpperCase()).join('')
}

export function HistoryPanel({type, id, selected, onPick, onClose, tab = 'history', onTab, review}: {
  type: string
  id: string
  selected?: string
  onPick: (entry: HistoryEntry | null) => void
  onClose: () => void
  /** History (the timeline) or Review changes (J15, `review`). */
  tab?: 'history' | 'review'
  onTab: (tab: 'history' | 'review') => void
  review: ReactNode
}) {
  const t = useT()
  const {data: revisions, error} = useQuery({...historyQuery(type, id), refetchInterval: 10_000})
  const entries = revisions ? timeline(revisions) : []
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  return (
    <aside className="inspector history" aria-label={t('History')}>
      <header>
        <div className="view-tabs" role="tablist" aria-label={t('Inspector')}>
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => onTab('history')}>
            {t('History')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'review'} onClick={() => onTab('review')}>
            {t('Review changes')}
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label={t('Close history')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {/* Sanity's note, above both tabs. */}
      <p className="history-note">
        <InfoOutline />
        <span>
          <DraftNote text={t('Showing the history for the {draft} version of this document.')} draft={t('Draft')} />
        </span>
      </p>
      <div role="tabpanel" aria-label={tab === 'review' ? t('Review changes') : t('History')}>
      {tab === 'review' ? review : <>
      {error && <p role="alert">{t('Could not load the history: {error}', {error: String(error)})}</p>}
      {/* A list of buttons, the shown revision aria-current: a listbox of options holding
          buttons is axe's nested-interactive (F13); Sanity's has that. */}
      <ul className="history-list" aria-label={t('Document revisions')}>
        {entries.flatMap((e, i) => {
          const open = expanded.has(e.revision.id)
          return [
            <Row key={e.revision.id} e={e} selected={selected ? e.revision.id === selected : i === 0} onPick={() => onPick(i === 0 ? null : e)}>
              {e.children && (
                // Sanity's: a publish holds the edits it published, collapsed until asked.
                <button
                  type="button"
                  className="history-expand"
                  aria-label={open ? t('Collapse') : t('Expand')}
                  title={open ? t('Collapse') : t('Expand')}
                  aria-expanded={open}
                  onClick={() => setExpanded((x) => (x.has(e.revision.id) ? new Set([...x].filter((y) => y !== e.revision.id)) : new Set([...x, e.revision.id])))}
                >
                  {open ? <ChevronDown /> : <ChevronLeft />}
                </button>
              )}
            </Row>,
            ...(open ? (e.children ?? []).map((c) => <Row key={c.revision.id} e={c} child selected={c.revision.id === selected} onPick={() => onPick(c)} />) : []),
          ]
        })}
      </ul>
      </>}
      </div>
    </aside>
  )
}

/** One timeline entry: avatar with what-happened badge, the label and when; the shown one aria-current. */
export function Row({e, selected, child, onPick, children}: {e: HistoryEntry; selected: boolean; child?: boolean; onPick: () => void; children?: ReactNode}) {
  const t = useT()
  const locale = useLocale()
  const when = ago(e.revision.timestamp, locale)
  return (
    <li data-current={selected ? '' : undefined} data-child={child || undefined}>
      <button type="button" onClick={onPick} aria-label={`${e.revision.author} ${t(e.label)} ${when}`} aria-current={selected ? 'true' : undefined}>
        <span className="avatar" title={e.revision.author}>
          {initials(e.revision.author)}
          <span className="badge" data-kind={BADGE[e.label] ?? 'edited'} />
        </span>
        <span className="history-text">
          <span>{t(e.label)}</span>
          <time dateTime={e.revision.timestamp} title={new Date(e.revision.timestamp).toLocaleString(intlTag(locale))}>
            {when}
          </time>
        </span>
      </button>
      {children}
    </li>
  )
}

/** Sanity's Review changes range date: "Oct 8, 2026, 2:20 PM" (in Norwegian "8. okt. 2026, 14:20"). */
export const rangeDate = (iso: string, locale: Locale = 'en') =>
  new Date(iso).toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})

/** Sanity's revision date: "Oct 6, 2026 @ 2:29:19 AM". */
export const revisionDate = (iso: string, locale: Locale = 'en') => {
  const d = new Date(iso)
  return `${d.toLocaleDateString(intlTag(locale), {month: 'short', day: 'numeric', year: 'numeric'})} @ ${d.toLocaleTimeString(intlTag(locale))}`
}

/** The history note with its bold version name, in the Studio's language. */
function DraftNote({text, draft}: {text: string; draft: string}) {
  const [before, after = ''] = text.split('{draft}')
  return (
    <>
      {before}
      <strong>{draft}</strong>
      {after}
    </>
  )
}

/**
 * Footer while an old revision is shown, after Sanity's: when it is from, and
 * "Revert to revision", which asks first and then writes it back as the draft.
 */
export function RevisionFooter({type, revisionId, timestamp, onRestored}: {type: string; revisionId: string; timestamp?: string; onRestored: () => void}) {
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const revert = async () => {
    setBusy(true)
    try {
      const doc = (await restoreRevision({data: {id: revisionId, type}})) as unknown as Doc
      applyServer(qc, doc)
      void qc.invalidateQueries({queryKey: ['history', doc._publishedId]})
      setAsking(false)
      onRestored()
    } catch (err) {
      toast({tone: 'critical', title: tt('Could not restore this revision'), description: (err as Error).message})
    } finally {
      setBusy(false)
    }
  }
  return (
    <footer className="doc-footer revision-footer">
      <span className="save-state" role="status">
        {t('Revision from')} <strong>{timestamp ? revisionDate(timestamp, locale) : '…'}</strong>
      </span>
      <div className="menu-wrap">
        <button className="publish caution" disabled={busy} aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
          {t('Revert to revision')}
        </button>
        {asking && (
          <DialogBox className="popover confirm up" aria-label={t('Restore this document?')} onClose={() => setAsking(false)}>
            <p>{t('Are you sure you want to restore this document?')}</p>
            <div className="confirm-actions">
              <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
                {t('Cancel')}
              </button>
              <button type="button" className="btn danger" disabled={busy} onClick={revert}>
                {t('Confirm')}
              </button>
            </div>
          </DialogBox>
        )}
      </div>
    </footer>
  )
}
