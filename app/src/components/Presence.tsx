import {useEffect, useRef, useState, type RefObject} from 'react'
import {MenuPopover} from './FocusScopes'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {docQuery, previewTitle, schemaOf, schemasQuery} from '../lib/data'
import {usePresences, type Presence} from '../lib/presence'
import {USER_HUES, userHue} from '../lib/user-colors'
import {Users} from './icons'
import {useT} from '../lib/i18n'
import {initialsOf, usePersonName} from '../lib/person'

// J07: other editors, where Sanity shows them — on the field they are in, on the
// list row and pane of the doc they have open, and in the navbar's "who's online".

export function Avatar({p}: {p: Presence}) {
  // An editor named by email reads as their name (lib/person.ts), first and last initials.
  const name = usePersonName(p.name) ?? p.name
  return (
    <span className="p-avatar" style={{background: p.color}} title={name} aria-label={name} role="img">
      {initialsOf(name)}
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

/**
 * Who acted last on a doc, beside the footer's "Last published" / "Edited" as Sanity's:
 * their avatar, name on hover, in their author colour (the hue their changes are tinted
 * with). Its 700 shade: white initials on 500 (or a presence colour) fail F13's contrast
 * at this size (axe on J01, 2026-10-11).
 */
export function ActorAvatar({actor}: {actor: string}) {
  return <Avatar p={{sessionId: actor, name: actor, color: USER_HUES[userHue(actor)][700], documentId: null, field: null}} />
}

/** A person's name as the studio shows it everywhere (lib/person.ts): Barkpark's name, else the email's local part. */
export function PersonName({who, fallback = ''}: {who: string | null | undefined; fallback?: string}) {
  return <>{usePersonName(who) ?? fallback}</>
}

/** Everyone with this doc open. */
export const useDocPresence = (id: string) => usePresences().filter((p) => p.documentId === id)

/** A focus path is at `path` or inside it (`links[_key=="l1"].title` is inside `links`). */
export const within = (field: string | null, path: string) => !!field && (field === path || field.startsWith(`${path}[`) || field.startsWith(`${path}.`))

/** Everyone whose caret is in this field (or an item inside it) of this doc. */
export function FieldPresence({docId, path}: {docId: string; path: string}) {
  const here = usePresences().filter((p) => p.documentId === docId && within(p.field, path))
  return <AvatarStack people={here} />
}

/**
 * Sanity's block presence in the body (J07): whoever has their caret in a block
 * (`body[_key=="p5"]`) shows at that block's right edge. Drawn over the canvas,
 * not in it (the canvas owns its DOM); re-measured on resize and while shown.
 */
export function BlockPresence({docId, field}: {docId: string; field: string}) {
  const prefix = `${field}[_key=="`
  const people = usePresences().filter((p) => p.documentId === docId && p.field?.startsWith(prefix))
  const ref = useRef<HTMLSpanElement>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const box = ref.current?.closest('.body-canvas')
    if (!people.length || !box) return
    tick((n) => n + 1)
    const ro = new ResizeObserver(() => tick((n) => n + 1))
    ro.observe(box)
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => (ro.disconnect(), clearInterval(t))
  }, [people.length])
  const box = ref.current?.closest('.body-canvas')
  const byBlock = new Map<string, Presence[]>()
  for (const p of people) {
    const key = p.field!.slice(prefix.length).split('"]')[0]!
    byBlock.set(key, [...(byBlock.get(key) ?? []), p])
  }
  return (
    <span ref={ref} className="block-presence-root">
      {box &&
        [...byBlock].map(([key, ps]) => {
          const el = box.querySelector(`[data-bp-id="${CSS.escape(key)}"]`)
          if (!el) return null
          const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top
          return (
            <span key={key} className="block-presence" style={{top}}>
              <AvatarStack people={ps} />
            </span>
          )
        })}
    </span>
  )
}

/** The element a focus path is shown on: the field, or an array item row (J07). */
export const placeOf = (root: ParentNode, field: string): Element | null =>
  root.querySelector(`[id="${CSS.escape(field)}"]`) ??
  root.querySelector(`[data-presence-path="${CSS.escape(field)}"]`) ??
  // A block in the body (`body[_key=="p5"]`) has no element of its own here: its field has.
  (field.includes('[') ? placeOf(root, field.slice(0, field.indexOf('['))) : null)

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
    const r = placeOf(scroller.current!, p.field!)?.getBoundingClientRect()
    return !r ? null : r.bottom < box.top ? 'above' : r.top > box.bottom ? 'below' : null
  }
  const above = people.filter((p) => where(p) === 'above')
  const below = people.filter((p) => where(p) === 'below')
  const go = (p: Presence) => (scroller.current && placeOf(scroller.current, p.field!))?.scrollIntoView({block: 'center', behavior: 'smooth'})
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

/** Navbar: who else is in the studio; pick one to open the doc and field they are on. */
export function WhoIsOnline() {
  const t = useT()
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
      <button type="button" className="icon-btn who" aria-label={t("Who's online")} data-tip={t('Who is here')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Users />
        {people.length > 0 && <span className="count">{people.length}</span>}
      </button>
      {open && (
        <MenuPopover className="popover menu who-menu" onClose={() => setOpen(false)}>
          {people.length === 0 ? (
            <p className="menu-empty">{t('No one else is here')}</p>
          ) : (
            people.map((p) => <OnlineRow key={p.sessionId} p={p} onDone={() => setOpen(false)} />)
          )}
        </MenuPopover>
      )}
    </div>
  )
}

function OnlineRow({p, onDone}: {p: Presence; onDone: () => void}) {
  const t = useT()
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
        // Sanity's: to their document and the field they are in (J52's `path=`, which focuses it).
        if (d) await navigate({href: `/structure/${d._type};${d._publishedId}${p.field ? `,path=${encodeURIComponent(p.field)}` : ''}`})
      }}
    >
      <Avatar p={p} />
      <span className="who-name">{p.name}</span>
      <span className="who-doc">{p.documentId ? (doc ? previewTitle(doc, schemaOf(schemas, doc._type), t) : '…') : t('Not in a document')}</span>
    </button>
  )
}
