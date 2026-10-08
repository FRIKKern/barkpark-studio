import {useSyncExternalStore} from 'react'
import type {HistoryAdapter} from '@sanity/visual-editing'

// A tiny pushState router. Presentation drives it through the history adapter:
// its URL bar navigates the page, and page links update its URL bar.
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
window.addEventListener('popstate', emit)

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  emit()
}

export function usePathname() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => location.pathname,
  )
}

export const historyAdapter: HistoryAdapter = {
  subscribe(onNavigate) {
    const l = () => onNavigate({type: 'push', url: location.pathname + location.search})
    listeners.add(l)
    l()
    return () => listeners.delete(l)
  },
  update(u) {
    if (u.type === 'push' || u.type === 'replace') navigate(u.url, u.type === 'replace')
    else if (u.type === 'pop') history.back()
  },
}

export function Link({to, children}: {to: string; children: React.ReactNode}) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
