import {useMemo, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {cachedDoc, schemaOf, schemasQuery, type Doc} from '../../lib/data'
import {mediaRefs, textRefs} from '../../lib/preview'
import {usePrimed} from '../../lib/prime'
import {ago, useLocale} from '../../lib/i18n'
import {useNow, useZone} from '../../lib/now'
import {DocPreview, RefsPrimed} from '../Preview'
import {AvatarStack, useDocPresence} from '../Presence'
import {RowList} from './Widget'

/**
 * Where a row leads: Sanity's edit intent, which opens the document in Structure in its
 * type's list (routes/intent.$.tsx), so the pane chain is the one the desk would build. A real
 * link: Cmd/Ctrl-click opens it in a new tab.
 */
export const editHref = (doc: {_publishedId: string; _type: string}) => `/intent/edit/id=${encodeURIComponent(doc._publishedId)};type=${encodeURIComponent(doc._type)}`

/**
 * A widget's documents as the studio previews them everywhere: title, subtitle, media, the
 * status dots, who is in the document now. `aside`: what the row says beside them (when it
 * was edited, when it publishes). The documents the previews read through (a post's author)
 * are read in one batch for the whole widget first (lib/prime.ts), never one read a row.
 */
export function DocRows({docs, label, aside}: {docs: Doc[]; label: string; aside?: (doc: Doc) => ReactNode}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const loaded = useMemo(() => cachedDoc(qc), [qc])
  const refIds = [
    ...new Set(
      docs.flatMap((d) => {
        const preview = schemaOf(schemas, d._type)?.listPreview
        return preview?.media || preview?.subtitle ? [...mediaRefs(preview.media, d, loaded), ...textRefs(preview.subtitle, d, loaded)] : []
      }),
    ),
  ].filter((id) => loaded(id) === undefined)
  const primedNow = usePrimed(refIds.map((id) => ({types: null, id})))
  const primedKey = refIds.filter(primedNow).join(' ')
  const refsPrimed = useMemo(() => {
    const ids = new Set(primedKey.split(' '))
    return (id: string) => ids.has(id) || loaded(id) !== undefined
  }, [primedKey, loaded])
  return (
    <RefsPrimed.Provider value={refsPrimed}>
      <RowList label={label}>
        {docs.map((d) => (
          <li key={d._publishedId} data-dash-row="">
            <DocRow doc={d} aside={aside?.(d)} />
          </li>
        ))}
      </RowList>
    </RefsPrimed.Provider>
  )
}

function DocRow({doc, aside}: {doc: Doc; aside?: ReactNode}) {
  const here = useDocPresence(doc._publishedId)
  return (
    <DocPreview
      doc={doc}
      href={editHref(doc)}
      selected={false}
      testId="dash-doc"
      extra={
        <>
          {here.length > 0 && <AvatarStack people={here} editing />}
          {aside}
        </>
      }
    />
  )
}

/** "3 min. ago", as list rows' status says it, kept current by the page's clock. */
export function Edited({at}: {at: string}) {
  const locale = useLocale()
  const now = useNow()
  const zone = useZone()
  return (
    <time className="dash-when" dateTime={at}>
      {ago(at, locale, now, zone)}
    </time>
  )
}
