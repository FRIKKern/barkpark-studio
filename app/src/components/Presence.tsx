import {useEffect, useRef, useState, type RefObject} from 'react'
import {MenuPopover} from './FocusScopes'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {docQuery, previewTitle, schemaOf, schemasQuery} from '../lib/data'
import {usePresences, type Presence} from '../lib/presence'
import {Users} from './icons'

// J07: other editors, where Sanity shows them — on the field they are in, on the
// list row and pane of the doc they have open, and in the navbar's "who's online".

const initials = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export function Avatar({p}: {p: Presence}) {
  return (
    <span className="p-avatar" style={{background: p.color}} title={p.name} aria-label={p.name} role="img">
      {initials(p.name)}
    </span>
  )
}

export function AvatarStack({people, max = 3}: {people: Presence[]; max?: number}) {
  if (!people.length) return null
  return (
    <span className="p-avatars" data-testid="presence">
      {people.slice(0, max).map((p) => (
        <Avatar key={p.sessionId} p={p} />
      ))}
      {people.length > max && <span className="p-avatar more">+{people.length - max}</span>}
    </span>
  )
}

/** Everyone with this doc open. */
export const useDocPresence = (id: string) => usePresences().filter((p) => p.documentId === id)

/** Everyone whose caret is in this field of this doc. */
export function FieldPresence({docId, path}: {docId: string; path: string}) {
  const here = usePresences().filter((p) => p.documentId === docId && p.field === path)
  return <AvatarStack people={here} />
}

/**
 * Sanity's above/below hints: someone is in a field scrolled out of view in this
 * pane; a pill at the top or bottom edge says who, and scrolls to them.
 */
export function PresenceHints({docId, scroller}: {docId: string; scroller: RefObject<HTMLElement | null>}) {
  const people = usePresences().filter((p) => p.documentId === docId && p.field)
  const [, tick] = useState(0)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const on = () => tick((n) => n + 1)
    el.addEventListener('scroll', on, {passive: true})
    return () => el.removeEventListener('scroll', on)
  }, [scroller])
  const box = scroller.current?.getBoundingClientRect()
  if (!box) return null
  const where = (p: Presence) => {
    const r = scroller.current!.querySelector(`[id="${CSS.escape(p.field!)}"]`)?.getBoundingClientRect()
    return !r ? null : r.bottom < box.top ? 'above' : r.top > box.bottom ? 'below' : null
  }
  const above = people.filter((p) => where(p) === 'above')
  const below = people.filter((p) => where(p) === 'below')
  const go = (p: Presence) => scroller.current?.querySelector(`[id="${CSS.escape(p.field!)}"]`)?.scrollIntoView({block: 'center', behavior: 'smooth'})
  return (
    <>
      {above.length > 0 && (
        <button type="button" className="presence-hint above" onClick={() => go(above[0]!)}>
          ↑ <AvatarStack people={above} />
        </button>
      )}
      {below.length > 0 && (
        <button type="button" className="presence-hint below" onClick={() => go(below[0]!)}>
          ↓ <AvatarStack people={below} />
        </button>
      )}
    </>
  )
}

/** Navbar: who else is in the studio; pick one to open the doc they are on. */
export function WhoIsOnline() {
  const people = usePresences()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="menu-wrap" ref={ref} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" className="icon-btn who" aria-label="Who's online" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Users />
        {people.length > 0 && <span className="count">{people.length}</span>}
      </button>
      {open && (
        <MenuPopover className="popover menu who-menu" onClose={() => setOpen(false)}>
          {people.length === 0 ? (
            <p className="menu-empty">No one else is here</p>
          ) : (
            people.map((p) => <OnlineRow key={p.sessionId} p={p} onDone={() => setOpen(false)} />)
          )}
        </MenuPopover>
      )}
    </div>
  )
}

function OnlineRow({p, onDone}: {p: Presence; onDone: () => void}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  // The room names a doc by id only; any type may hold it.
  const {data: doc} = useQuery({...docQuery(schemas.map((s) => s.name), p.documentId ?? ''), enabled: !!p.documentId && schemas.length > 0})
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item who-row"
      disabled={!p.documentId}
      onClick={async () => {
        const d = doc ?? (await qc.fetchQuery(docQuery(schemas.map((s) => s.name), p.documentId!)))
        onDone()
        if (d) await navigate({href: `/structure/${d._type};${d._publishedId}`})
      }}
    >
      <Avatar p={p} />
      <span className="who-name">{p.name}</span>
      <span className="who-doc">{p.documentId ? (doc ? previewTitle(doc, schemaOf(schemas, doc._type)) : '…') : 'Not in a document'}</span>
    </button>
  )
}
