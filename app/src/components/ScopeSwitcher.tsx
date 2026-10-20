import {useEffect, useRef, useState, type CSSProperties} from 'react'
import {useQuery} from '@tanstack/react-query'
import {currentScopeQuery, placesQuery, switchedPath, type Place} from '../lib/scope-switch'
import type {Scope} from '../lib/scope'
import {DialogBox} from './FocusScopes'
import {Check, ChevronDown} from './icons'
import {useT} from '../lib/i18n'
import {meQuery} from '../lib/session'
import {barkparkInfoQuery} from '../lib/diagnostics'
import {GroupIcon} from './GroupIcon'

// B02: switch workspace / project / dataset, like Barkpark's LiveView Studio. The choice
// goes into the URL (/w/<ws>/p/<project>/d/<dataset>/…) and opens as a fresh page, so
// nothing read in the old dataset can show in the new one. The tool you are in stays, and
// in the structure so do the open panes that exist there (lib/scope-switch.ts switchedPath).

/** The studio's name and logo initials (the config's title, Sanity's workspace title). */
type Brand = {name: string; initials: string}

// The studio's name is the switcher's button, as Sanity's workspace menu: the name with
// a chevron opens a card headed by the logo, "workspace / dataset" and the name, with the
// workspace, project and dataset to switch to below.
export function ScopeSwitcher({brand}: {brand: Brand}) {
  const t = useT()
  const {data: current} = useQuery(currentScopeQuery)
  const [open, setOpen] = useState(false)
  // A click outside the card closes it, as Sanity's workspace menu.
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (!current) return <span className="brand-name">{brand.name}</span>
  return (
    <div className="menu-wrap scope-switcher" ref={wrap}>
      <button
        type="button"
        className="scope-button brand-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('Workspace {workspace}, project {project}, dataset {dataset}. Switch', {workspace: current.workspace, project: current.project, dataset: current.dataset})}
        title={`${current.workspace} / ${current.dataset}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="brand-name">{brand.name}</span>
        <ChevronDown />
      </button>
      {open && <ScopeDialog brand={brand} current={current} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** A place's two-letter mark, as Sanity's workspace icon: the initials of its words. */
const initials = (name: string) => (name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?')
/** A steady colour per place, as Sanity colours each workspace's icon. */
const HUES = [230, 270, 0, 160, 30, 200, 320, 100]
const hue = (slug: string) => HUES[[...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]!

function ScopeDialog({brand, current, onClose}: {brand: Brand; current: Scope; onClose: () => void}) {
  const t = useT()
  // Switching opens a fresh page, which takes a moment: the row says so meanwhile.
  const [switching, setSwitching] = useState<string | null>(null)
  // A dataset-bound token (Barkpark #22393) opens only its own dataset: the others show, greyed.
  const bound = useQuery(meQuery).data?.boundDataset ?? null
  const places = useQuery(placesQuery)
  // The current row in view when the list opens (it scrolls past 40% of the window).
  const list = useRef<HTMLDivElement>(null)
  // void: Chrome's scrollIntoView now returns a Promise, which React took for the effect's
  // cleanup and called on close ("destroy is not a function": the studio's error screen).
  useEffect(() => void list.current?.querySelector('[aria-current]')?.scrollIntoView({block: 'center'}), [!!places.data])
  const adminUrl = useQuery(barkparkInfoQuery).data?.adminUrl
  const key = (p: Scope) => `${p.workspace}/${p.project}/${p.dataset}`
  const here = key(current)
  // Where you are first, then the rest of its workspace and project, then the others.
  const groups = new Map<string, Place[]>()
  for (const p of places.data ?? []) {
    const g = `${p.workspace.slug}/${p.project.slug}`
    groups.set(g, [...(groups.get(g) ?? []), p])
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => Number(b === `${current.workspace}/${current.project}`) - Number(a === `${current.workspace}/${current.project}`))
  const go = (p: Place) => {
    const to = {workspace: p.workspace.slug, project: p.project.slug, dataset: p.dataset.slug}
    if (key(to) === here) return onClose()
    setSwitching(key(to))
    // A fresh page in the new scope (nothing read in the old one shows there), with
    // the panes that exist there still open.
    void switchedPath(to, location).then((href) => window.location.assign(href))
  }
  return (
    <DialogBox className="popover scope-popover" aria-label={t('Switch workspace, project or dataset')} onClose={onClose}>
      <div className="scope-head">
        <div className="scope-card">
          <span className="logo scope-card-logo" aria-hidden="true">{brand.initials}</span>
          <span className="scope-card-text">
            <span className="scope-card-where">{current.workspace} / {current.dataset}</span>
            <span className="scope-card-name">{brand.name}</span>
          </span>
        </div>
        {/* J69: Sanity's Manage project; ours is Barkpark's admin page (members & roles). */}
        {adminUrl && (
          <a className="btn btn-ghost manage-project" href={adminUrl} target="_blank" rel="noreferrer">
            <GroupIcon name="cog" /> {t('Manage project')}
          </a>
        )}
      </div>
      {/* Sanity's workspace list: one row a place, the current one checked, one click to go. */}
      <div className="scope-places" ref={list}>
        {ordered.map(([g, rows]) => (
          <section key={g} aria-label={`${rows[0]!.workspace.name} / ${rows[0]!.project.name}`}>
            <h2 className="scope-places-head">
              {rows[0]!.workspace.name} / {rows[0]!.project.name}
            </h2>
            <ul className="scope-list">
              {rows.map((p) => {
                const k = key({workspace: p.workspace.slug, project: p.project.slug, dataset: p.dataset.slug})
                const off = !!bound && p.dataset.slug !== bound
                return (
                  <li key={k}>
                    <button type="button" className="scope-place" aria-current={k === here || undefined} disabled={off || (!!switching && switching !== k)} aria-busy={switching === k || undefined} onClick={() => go(p)}>
                      <span className="scope-place-icon" aria-hidden="true" style={{'--place-hue': hue(k)} as CSSProperties}>
                        {initials(p.dataset.name)}
                      </span>
                      <span className="scope-place-text">
                        <span className="scope-place-title">{p.dataset.name}</span>
                        <span className="scope-place-sub">{switching === k ? t('Switching…') : `${p.workspace.slug} / ${p.dataset.slug}`}</span>
                      </span>
                      {k === here && <Check />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        {places.isPending && <p className="scope-note">{t('Loading…')}</p>}
        {bound && <p className="scope-note">{t('This token can only open the dataset {dataset}.', {dataset: bound})}</p>}
        {places.isError && (
          <p className="field-error" role="alert">
            {t('Could not list where you can go.')}{' '}
            <button type="button" className="btn-text" onClick={() => void places.refetch()}>
              {t('Retry')}
            </button>
          </p>
        )}
      </div>
    </DialogBox>
  )
}
