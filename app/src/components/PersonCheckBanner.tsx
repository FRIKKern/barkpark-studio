import {useEffect, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {keepKeyOf} from '../lib/edits'
import {useT} from '../lib/i18n'
import {combine, docKeyOfEntry, readDocPending} from '../lib/pending-edits'
import {personCheck, SLOW_CHECK_MS} from '../lib/person-check'
import {meQuery} from '../lib/session'

/**
 * task-4ffed14fbf52dc47: the studio could not learn who the person is (whoAmI failed, Barkpark
 * did not answer it, or not in time). Fields a role rule may lock stay locked and kept edits
 * wait meanwhile (DocumentPane): said here, with the kept edits named, and a retry. A retry
 * that answers unlocks what the person may edit, and DocumentPane puts the kept edits back.
 */
export function PersonCheckBanner({docId, dateOf}: {docId: string; dateOf: (at: number) => string}) {
  const t = useT()
  const qc = useQueryClient()
  const me = useQuery(meQuery)
  const unknown = !me.data || !!me.data.provisional || !!me.data.unchecked
  // Since when the person has been unknown (again from a retry), to say when it is late.
  const [since, setSince] = useState(() => Date.now())
  const [, wake] = useState(0)
  useEffect(() => {
    if (!unknown) return
    const left = since + SLOW_CHECK_MS - Date.now()
    const timer = left > 0 ? setTimeout(() => wake((n) => n + 1), left) : undefined
    return () => clearTimeout(timer)
  }, [unknown, since])
  const check = personCheck({data: me.data, isError: me.isError, isFetching: me.isFetching, waitedMs: Date.now() - since})
  // Said once the check failed, and through a retry until it answers (no flicker while it asks).
  const [retried, setRetried] = useState(false)
  useEffect(() => void (!unknown && setRetried(false)), [unknown])
  const shown = check === 'failed' || (retried && unknown)
  // Kept edits from an earlier page for this doc: named, so they are not left unsaid while they wait.
  const [keptAt, setKeptAt] = useState<number | null>(null)
  const own = keepKeyOf(docId)
  useEffect(() => {
    setKeptAt(null)
    const doc = own && docKeyOfEntry(own)
    if (!shown || !doc) return
    let live = true
    void readDocPending(doc).then((all) => live && setKeptAt(combine(all.filter(([k]) => k !== own).map(([, p]) => p))?.at ?? null))
    return () => void (live = false)
  }, [shown, own])
  if (!shown) return null
  return (
    <div className="pane-banner" role="alert" data-testid="person-check">
      <span>
        {t('Could not check who you are, so fields that depend on your role stay locked.')}
        {keptAt !== null && ` ${t('Unsaved changes from {date} are kept in this browser and put back once that is known.', {date: dateOf(keptAt)})}`}
      </span>
      <span className="pane-banner-actions">
        <button type="button" className="btn-text" disabled={me.isFetching} onClick={() => (setSince(Date.now()), setRetried(true), void qc.refetchQueries({queryKey: meQuery.queryKey}))}>
          {t('Retry')}
        </button>
      </span>
    </div>
  )
}
