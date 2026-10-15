import {useEffect, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {currentScopeQuery, scopeOptionsQuery, switchedPath} from '../lib/scope-switch'
import type {Scope} from '../lib/scope'
import {DialogBox} from './FocusScopes'
import {ChevronDown} from './icons'
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

function ScopeDialog({brand, current, onClose}: {brand: Brand; current: Scope; onClose: () => void}) {
  const t = useT()
  const [pick, setPick] = useState(current)
  // Switching opens a fresh page, which takes a moment: say so on the button meanwhile.
  const [switching, setSwitching] = useState(false)
  // A dataset-bound token (Barkpark #22393) opens only its own dataset: the others show, greyed.
  const bound = useQuery(meQuery).data?.boundDataset ?? null
  const options = useQuery(scopeOptionsQuery(pick))
  const adminUrl = useQuery(barkparkInfoQuery).data?.adminUrl
  // A new workspace or project: its first project / dataset until one is picked.
  useEffect(() => {
    const o = options.data
    if (!o) return
    const {projects = [], datasets = []} = o
    if (projects.length && !projects.some((p) => p.slug === pick.project)) setPick((s) => ({...s, project: projects[0]!.slug}))
    else if (datasets.length && !datasets.some((d) => d.slug === pick.dataset)) setPick((s) => ({...s, dataset: datasets[0]!.slug}))
  }, [options.data])
  const same = pick.workspace === current.workspace && pick.project === current.project && pick.dataset === current.dataset
  const field = (label: string, key: keyof Scope, list?: {slug: string; name: string}[]) => (
    <label className="scope-field">
      <span>{label}</span>
      <select className="input" value={pick[key]} disabled={!list} onChange={(e) => setPick((s) => ({...s, [key]: e.target.value}))}>
        {(list ?? [{slug: pick[key], name: pick[key]}]).map((o) => (
          <option key={o.slug} value={o.slug} disabled={key === 'dataset' && !!bound && o.slug !== bound}>
            {o.name === o.slug ? o.slug : `${o.name} (${o.slug})`}
          </option>
        ))}
        {list && !list.some((o) => o.slug === pick[key]) && <option value={pick[key]}>{pick[key]}</option>}
      </select>
    </label>
  )
  return (
    <DialogBox className="popover scope-popover" aria-label={t('Switch workspace, project or dataset')} onClose={onClose}>
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
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (same) return
          setSwitching(true)
          // A fresh page in the new scope (nothing read in the old one shows there), with
          // the panes that exist there still open.
          void switchedPath(pick, location).then((href) => window.location.assign(href))
        }}
      >
        {field(t('Workspace'), 'workspace', options.data?.workspaces)}
        {field(t('Project'), 'project', options.data?.projects)}
        {field(t('Dataset'), 'dataset', options.data?.datasets)}
        {bound && <p className="scope-note">{t('This token can only open the dataset {dataset}.', {dataset: bound})}</p>}
        {options.isError && (
          <p className="field-error" role="alert">
            {t('Could not list where you can go.')}{' '}
            <button type="button" className="btn-text" onClick={() => void options.refetch()}>
              {t('Retry')}
            </button>
          </p>
        )}
        <div className="scope-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="publish" disabled={same || options.isFetching || switching} aria-busy={switching || undefined}>
            {switching ? t('Switching…') : t('Switch')}
          </button>
        </div>
      </form>
    </DialogBox>
  )
}
