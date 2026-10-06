import {useEffect} from 'react'

/**
 * Marks the page interactive: `html[data-hydrated]` (e2e waits for it — a click or
 * key before hydration is lost or a full page load). Set by the page's own
 * component, not the root: route components load as split chunks and hydrate
 * after the root, so a root-level mark came before the navbar's Ctrl+K handler
 * existed (J19 flaked on it in CI). Cleared on unmount, so the next page sets its own.
 */
export function useHydratedMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = ''
    return () => void delete document.documentElement.dataset.hydrated
  }, [])
}
