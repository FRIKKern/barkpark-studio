import {useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {docQuery, type Doc} from '../lib/data'
import {historyQuery, restoreRevision} from '../lib/history'
import {applyServer} from '../lib/edits'
import {openAfter, type Pane} from '../lib/panes'
import {toast} from './Toasts'

// J32, Sanity's document banners for what someone else did to what you have open:
//  - the doc was deleted: "This document has been deleted." + Restore most recent revision;
//  - the reference this pane was opened from now points elsewhere ("has changed" +
//    Reload reference) or nowhere ("has been removed" + Close reference).
// Edits by others to the open doc need no banner: they arrive live (J05).

/**
 * Is this missing doc one that was deleted (its history ends in a delete), rather
 * than a new id? `undefined` while that is being found out. Barkpark keeps a doc's
 * history after a delete, so this holds after a reload too.
 */
export function useDeleted(type: string, id: string, missing: boolean): boolean | undefined {
  const {data: revisions, isError} = useQuery({...historyQuery(type, id), enabled: missing, staleTime: 0})
  if (!missing) return false
  if (isError) return false
  return revisions ? revisions[0]?.action === 'delete' : undefined
}

export function DeletedBanner({type, id}: {type: string; id: string}) {
  const qc = useQueryClient()
  const {data: revisions} = useQuery(historyQuery(type, id))
  const [busy, setBusy] = useState(false)
  // The newest snapshot that is the doc itself, not the delete.
  const last = revisions?.find((r) => r.action !== 'delete')
  const restore = async () => {
    if (!last) return
    setBusy(true)
    try {
      applyServer(qc, (await restoreRevision({data: {id: last.id, type}})) as unknown as Doc)
      await qc.invalidateQueries({queryKey: ['history', id]})
      await qc.invalidateQueries({queryKey: ['list', type]})
    } catch (e) {
      toast({tone: 'critical', title: 'Could not restore the document', description: (e as Error).message})
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pane-banner" role="alert">
      <span>This document has been deleted.</span>
      {last && (
        <button type="button" className="btn" disabled={busy} onClick={restore}>
          {busy ? 'Restoring…' : 'Restore most recent revision'}
        </button>
      )}
    </div>
  )
}

/** The doc id a reference value points at: Barkpark's plain id, or Sanity-shaped {_ref}. */
const refId = (v: unknown): string | undefined => (typeof v === 'string' ? v : v && typeof v === 'object' ? ((v as {_ref?: string})._ref ?? undefined) : undefined)

/** The value at a pane's parentRefPath ("author", "seo.image", "links[_key==\"l2\"].target"). */
export function valueAtRefPath(doc: unknown, path: string): unknown {
  let cur = doc
  for (const step of path.split('.')) {
    const m = step.match(/^([^[]+)(?:\[_key=="([^"]+)"\])?$/)
    if (!m || !cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[m[1]!]
    if (m[2] !== undefined) cur = Array.isArray(cur) ? cur.find((x) => (x as {_key?: string})?._key === m[2]) : undefined
  }
  return cur
}

/** In a pane opened from a reference: the parent's reference no longer leads here. */
export function ReferenceBanner({panes, index, closeHref}: {panes: Pane[]; index: number; closeHref: string}) {
  const navigate = useNavigate()
  const pane = panes[index] as Extract<Pane, {kind: 'doc'}>
  const parent = panes[index - 1]
  const parentDoc = parent?.kind === 'doc' ? parent : undefined
  const {data: doc} = useQuery({...docQuery(parentDoc?.type ?? '', parentDoc?.id ?? ''), enabled: !!parentDoc && !!pane.parentRefPath})
  if (!parentDoc || !pane.parentRefPath || !doc) return null
  const now = refId(valueAtRefPath(doc, pane.parentRefPath))
  if (now === pane.id) return null
  if (!now)
    return (
      <div className="pane-banner" role="alert">
        <span>This reference has been removed since you opened it.</span>
        <button type="button" className="btn" onClick={() => navigate({href: closeHref})}>
          Close reference
        </button>
      </div>
    )
  return (
    <div className="pane-banner" role="alert">
      <span>This reference has changed since you opened it.</span>
      <button
        type="button"
        className="btn"
        onClick={() => navigate({href: openAfter(panes.slice(0, index), index - 1, {kind: 'doc', id: now, type: pane.type, parentRefPath: pane.parentRefPath})})}
      >
        Reload reference
      </button>
    </div>
  )
}
