import {Suspense, use, useEffect, useState, type ComponentProps} from 'react'
import {useTasksView} from '../lib/tasks-ui'

// Panels that open only on a click (task-c93c87600d95b6da): the tasks sidebar, the
// diagnostics dialog and the search filters. Each is a chunk of its own, so the first
// page doesn't download or parse them. Hovering or focusing what opens one fetches it,
// and so does the first idle moment after the page settles. A loaded chunk draws at
// once: `use` reads a settled promise without suspending (as DocPane.tsx does), so the
// panel never waits on React's Suspense reveal throttle.
type Loaded<M> = Promise<M> & {status?: string; value?: M}
const once = <M,>(load: () => Promise<M>) => {
  let p: Loaded<M> | undefined
  return () => (p ??= load().then((m) => (Object.assign(p!, {status: 'fulfilled', value: m}), m)))
}
export const loadTasksPanel = once(() => import('./TasksPanel'))
export const loadDiagnostics = once(() => import('./Diagnostics'))
export const loadSearchFilters = once(() => import('./SearchFilters'))

type Filters = typeof import('./SearchFilters')
export function Diagnostics(props: ComponentProps<typeof import('./Diagnostics').Diagnostics>) {
  const {Diagnostics: D} = use(loadDiagnostics())
  return <D {...props} />
}
export function SearchFilters(props: ComponentProps<Filters['SearchFilters']>) {
  const {SearchFilters: F} = use(loadSearchFilters())
  return <F {...props} />
}
export function SearchOrdering(props: ComponentProps<Filters['SearchOrdering']>) {
  const {SearchOrdering: O} = use(loadSearchFilters())
  return <O {...props} />
}
function Tasks() {
  const {TasksPanel: P} = use(loadTasksPanel())
  return <P />
}

/** Fetch every panel when the browser is idle, a moment after the page is up. */
export function usePrefetchPanels() {
  useEffect(() => {
    const idle = (globalThis as {requestIdleCallback?: (f: () => void, o?: {timeout: number}) => number}).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200))
    const timer = setTimeout(() => idle(() => void Promise.all([loadTasksPanel(), loadDiagnostics(), loadSearchFilters()]).catch(() => {}), {timeout: 5_000}), 1_000)
    return () => clearTimeout(timer)
  }, [])
}

/** The tasks sidebar, mounted once it is opened (or a ?task= link asks for it). */
export function TasksPanel() {
  const open = useTasksView().kind !== 'closed'
  const [wanted, setWanted] = useState(false)
  useEffect(() => {
    if (open || new URL(location.href).searchParams.has('task')) setWanted(true)
  }, [open])
  if (!wanted) return null
  return (
    <Suspense fallback={null}>
      <Tasks />
    </Suspense>
  )
}
