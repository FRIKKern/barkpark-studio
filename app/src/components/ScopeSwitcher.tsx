import {useEffect, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useRouterState} from '@tanstack/react-router'
import {currentScopeQuery, scopeOptionsQuery} from '../lib/scope-switch'
import {scopedPath, type Scope} from '../lib/scope'
import {DialogBox} from './FocusScopes'
import {ChevronDown} from './icons'

// B02: switch workspace / project / dataset, like Barkpark's LiveView Studio. The choice
// goes into the URL (/w/<ws>/p/<project>/d/<dataset>/…) and opens as a fresh page, so
// nothing read in the old dataset can show in the new one. The tool you are in stays.

export function ScopeSwitcher() {
  const {data: current} = useQuery(currentScopeQuery)
  const [open, setOpen] = useState(false)
  if (!current) return null
  return (
    <div className="menu-wrap scope-switcher">
      <button
        type="button"
        className="scope-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Workspace ${current.workspace}, project ${current.project}, dataset ${current.dataset}. Switch`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="scope-ws">{current.workspace} /</span>
        <span className="scope-ds">{current.dataset}</span>
        <ChevronDown />
      </button>
      {open && <ScopeDialog current={current} onClose={() => setOpen(false)} />}
    </div>
  )
}

function ScopeDialog({current, onClose}: {current: Scope; onClose: () => void}) {
  const [pick, setPick] = useState(current)
  const options = useQuery(scopeOptionsQuery(pick))
  const tool = useRouterState({select: (s) => '/' + (s.location.pathname.split('/')[1] || 'structure')})
  // A new workspace or project: its first project / dataset until one is picked.
  useEffect(() => {
    const o = options.data
    if (!o) return
    if (o.projects.length && !o.projects.some((p) => p.slug === pick.project)) setPick((s) => ({...s, project: o.projects[0]!.slug}))
    else if (o.datasets.length && !o.datasets.some((d) => d.slug === pick.dataset)) setPick((s) => ({...s, dataset: o.datasets[0]!.slug}))
  }, [options.data])
  const same = pick.workspace === current.workspace && pick.project === current.project && pick.dataset === current.dataset
  const field = (label: string, key: keyof Scope, list?: {slug: string; name: string}[]) => (
    <label className="scope-field">
      <span>{label}</span>
      <select className="input" value={pick[key]} disabled={!list} onChange={(e) => setPick((s) => ({...s, [key]: e.target.value}))}>
        {(list ?? [{slug: pick[key], name: pick[key]}]).map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name === o.slug ? o.slug : `${o.name} (${o.slug})`}
          </option>
        ))}
        {list && !list.some((o) => o.slug === pick[key]) && <option value={pick[key]}>{pick[key]}</option>}
      </select>
    </label>
  )
  return (
    <DialogBox className="popover scope-popover" aria-label="Switch workspace, project or dataset" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!same) window.location.assign(scopedPath(pick, tool))
        }}
      >
        {field('Workspace', 'workspace', options.data?.workspaces)}
        {field('Project', 'project', options.data?.projects)}
        {field('Dataset', 'dataset', options.data?.datasets)}
        {options.isError && (
          <p className="field-error" role="alert">
            Could not list where you can go. <button type="button" className="btn-text" onClick={() => void options.refetch()}>Retry</button>
          </p>
        )}
        <div className="scope-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="publish" disabled={same || options.isFetching}>
            Switch
          </button>
        </div>
      </form>
    </DialogBox>
  )
}
