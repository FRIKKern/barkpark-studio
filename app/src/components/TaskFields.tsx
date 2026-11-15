import {useEffect, useState, type ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useRouter} from '@tanstack/react-router'
import {showTasks, type TaskTarget} from '../lib/tasks-ui'
import {peopleNamesQuery, peopleQuery} from '../lib/people'
import {anyDocQuery, previewTitle, schemaOf, schemasQuery, searchAllDocs, type Doc} from '../lib/data'
import {useT} from '../lib/i18n'
import {MenuPopover} from './FocusScopes'
import {ActorAvatar, PersonName} from './Presence'
import {Status} from './Preview'
import {Close, DocumentIcon, UserIcon} from './icons'

// J66: the parts the Tasks sidebar's views share (TasksPanel.tsx the lists and a task,
// TaskCreate.tsx the create form): the header, the target and the assignee fields.

export function Header({children}: {children: ReactNode}) {
  const t = useT()
  return (
    <header className="tasks-head">
      {children}
      <button type="button" className="icon-btn" aria-label={t('Close sidebar')} data-tip={t('Close sidebar')} onClick={() => showTasks({kind: 'closed'})}>
        <Close />
      </button>
    </header>
  )
}

export function TargetTitle({id, primed = true}: {id: string; primed?: boolean}) {
  const t = useT()
  const {data: doc} = useQuery({...anyDocQuery(id), enabled: primed})
  const {data: schemas = []} = useQuery(schemasQuery)
  return (
    <>
      <span>{doc ? previewTitle(doc, schemaOf(schemas, doc._type), t) : '…'}</span>
      {/* Sanity's picked target shows its publish state, as a list row does. */}
      {doc && <Status doc={doc} />}
    </>
  )
}

/** The task's target: its title, a way to open it, and (editable) to remove or pick one. */
export function TargetField({target, onChange, open}: {target: TaskTarget | null; onChange?: (next: TaskTarget | null) => void; open?: boolean}) {
  const t = useT()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Doc[]>([])
  const {data: schemas = []} = useQuery(schemasQuery)
  useEffect(() => {
    if (!q.trim()) return setHits([])
    let live = true
    void searchAllDocs(q).then((d) => live && setHits(d.slice(0, 8)))
    return () => void (live = false)
  }, [q])
  if (target)
    return (
      <div className="task-target">
        <DocumentIcon />
        <TargetTitle id={target.id} />
        {open && (
          <button
            type="button"
            className="btn-text"
            onClick={() =>
              void router.navigate({
                href: `/structure/${target.type};${target.id}`,
              })
            }
          >
            {t('Open')}
          </button>
        )}
        {onChange && (
          <button type="button" className="icon-btn" aria-label={t('Remove target content')} data-tip={t('Remove target content')} onClick={() => onChange(null)}>
            <Close />
          </button>
        )}
      </div>
    )
  if (!onChange) return null
  return (
    <div className="task-target-search task-field-icon">
      <DocumentIcon />
      <input className="input" placeholder={t('Select target document')} aria-label={t('Target')} value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="task-target-hits">
          {hits.map((d) => (
            <li key={d._id}>
              <button type="button" onClick={() => (onChange({id: d._publishedId, type: d._type}), setQ(''))}>
                {previewTitle(d, schemaOf(schemas, d._type), t)} <span className="muted">{schemaOf(schemas, d._type)?.title ?? d._type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// The deadline's hint, Sanity's: the stored format itself (not words, so not translated).
export const DATE_HINT = 'yyyy-mm-dd'

/**
 * Assign to, as Sanity's: a field that opens a searchable list of the workspace's people
 * (avatar and name; "No assignee" first). The picked one shows as avatar and name.
 */
export function AssigneeField({value, onChange, id}: {value: string | null; onChange: (email: string | null) => void; id: string}) {
  const t = useT()
  const {data: people = []} = useQuery(peopleQuery)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const all = [...new Set([...people, ...(value ? [value] : [])])]
  const {data: known} = useQuery(peopleNamesQuery)
  const shown = q.trim() ? all.filter((p) => `${p} ${known?.[p] ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : all
  const pick = (email: string | null) => (onChange(email), setOpen(false), setQ(''))
  return (
    <div className="menu-wrap task-assignee-field">
      <button id={id} type="button" className="input task-field-btn" aria-haspopup="menu" aria-expanded={open} data-empty={!value || undefined} onClick={() => setOpen((o) => !o)}>
        {value ? <ActorAvatar actor={value} /> : <UserIcon />}
        <span>{value ? <PersonName who={value} /> : t('Select assignee')}</span>
      </button>
      {open && (
        <MenuPopover className="popover menu task-assignee-menu" aria-label={t('Assign to')} onClose={() => (setOpen(false), setQ(''))}>
          <span className="task-field-icon">
            <UserIcon />
            <input className="input" data-autofocus placeholder={t('Select assignee')} aria-label={t('Search people')} value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
          <button type="button" role="menuitem" className="menu-item task-person" onClick={() => pick(null)}>
            <span className="task-person-none">
              <UserIcon />
            </span>
            {t('No assignee')}
          </button>
          {shown.map((p) => (
            <button key={p} type="button" role="menuitem" className="menu-item task-person" aria-current={p === value || undefined} title={p} onClick={() => pick(p)}>
              <ActorAvatar actor={p} />
              <PersonName who={p} />
            </button>
          ))}
          {!shown.length && <p className="muted task-person-empty">{t('No users found')}</p>}
        </MenuPopover>
      )}
    </div>
  )
}
