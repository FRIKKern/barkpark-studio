import {useQuery} from '@tanstack/react-query'
import {schemaOf, schemasQuery} from '../lib/data'
import {openAfter, type Pane} from '../lib/panes'
import {useT} from '../lib/i18n'
import {PaneLink} from './PaneLink'
import {TypeIcon} from './Preview'

/**
 * A fixed type's listed ids that have no document yet (task-b3f4ccc4f9cfe129), as rows under
 * its list: opening one opens that page empty (DocumentPane), and its first edit creates it
 * with the listed id. `ids` is lib/fixed-documents.ts missingFixed()'s answer for a whole list.
 */
export function MissingFixedRows({type, ids, panes, index, selected}: {type: string; ids: string[]; panes: Pane[]; index: number; selected?: string}) {
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  const schema = schemaOf(schemas, type)
  if (!ids.length) return null
  return (
    <div role="list" aria-label={t('Not created yet')} className="rows-list">
      {ids.map((id) => (
        <div key={id} role="listitem" className="rows-item">
          <PaneLink href={openAfter(panes, index, {kind: 'doc', id, type})} className="preview" aria-current={selected === id && index === panes.length - 2} data-selected={selected === id ? '' : undefined} data-testid="pane-item-missing">
            <span className="media">
              <TypeIcon schema={schema} />
            </span>
            <span className="text">
              <div className="t">{id}</div>
              <div className="s">{t('Not created yet')}</div>
            </span>
          </PaneLink>
        </div>
      ))}
    </div>
  )
}
