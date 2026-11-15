import {useQuery} from '@tanstack/react-query'
import {schemaOf, schemasQuery} from '../../lib/data'
import type {Resolved, RowsKind} from '../../lib/dashboard'
import {rowsQuery} from '../../lib/dashboard-data'
import {useCanWrite} from '../../lib/session'
import {useT} from '../../lib/i18n'
import {Add} from '../icons'
import {PaneLink} from '../PaneLink'
import {DocRows, Edited} from './DocRows'
import {WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton} from './Widget'

type ListWidget = Extract<Resolved, {kind: 'drafts' | 'recent' | 'documentList'}>

/**
 * The three widgets that list documents: Unpublished changes (every draft, newest first),
 * Recently edited (the newest edits across the desk's types) and Sanity's document list
 * from the config (its types, order, limit and "Create new"). One read each for any number
 * of types (lib/dashboard-data.ts); then the page's live frames keep the rows.
 */
export function DocListWidget({widget}: {widget: ListWidget}) {
  const t = useT()
  const {data: schemas} = useQuery(schemasQuery)
  // No `types` of its own: every document type of the desk, which the server names (a 64-type
  // model's names in each request's address is what a search once outgrew, lib/data.ts).
  const kind: RowsKind = {only: widget.kind === 'drafts' ? 'drafts' : 'all', types: widget.kind === 'documentList' ? widget.types : null, order: widget.kind === 'documentList' ? widget.order : '_updatedAt desc', limit: widget.limit}
  const q = useQuery(rowsQuery(kind))
  const {canWrite, createReason} = useCanWrite()
  const title = t(widget.title)
  const createType = widget.kind === 'documentList' && widget.createNew ? widget.types?.[0] : undefined
  const typeTitle = createType ? (schemaOf(schemas ?? [], createType)?.title ?? createType) : ''
  const createText = widget.kind === 'documentList' && widget.createButtonText ? widget.createButtonText : t('Create new {type}', {type: typeTitle})
  return (
    <WidgetFrame
      title={title}
      width={widget.width}
      rows={widget.limit}
      testId={`dash-${widget.key}`}
      // No one's name is on a draft: Barkpark's documents do not say who edited them last.
      note={widget.kind === 'drafts' ? t("Everyone's drafts, newest first.") : undefined}
      onRefresh={() => void q.refetch()}
      refreshing={q.isFetching && !q.isPending}
      footer={
        createType &&
        (canWrite ? (
          <PaneLink className="btn dash-create" href={`/intent/create/type=${encodeURIComponent(createType)}`}>
            <Add /> {createText}
          </PaneLink>
        ) : (
          // A read-only seat: the button stays, off, and says why.
          <button type="button" className="btn dash-create" disabled title={createReason}>
            <Add /> {createText}
          </button>
        ))
      }
    >
      {q.isError ? (
        <WidgetError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : !q.data ? (
        <WidgetSkeleton rows={widget.limit} />
      ) : !q.data.length ? (
        widget.kind === 'drafts' ? (
          <WidgetEmpty title={t('No unpublished changes')} hint={t('Every document is published as it stands.')} />
        ) : (
          <WidgetEmpty title={t('No documents yet')} hint={t('Documents show up here as they are created and edited.')} />
        )
      ) : (
        <DocRows docs={q.data} label={title} aside={kind.order === '_updatedAt desc' ? (d) => <Edited at={d._updatedAt} /> : undefined} />
      )}
    </WidgetFrame>
  )
}
