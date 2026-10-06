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
    releaseEarlyClicks()
    return () => void delete document.documentElement.dataset.hydrated
  }, [])
}

/**
 * J51, inline in <head>: on a slow network the server-rendered page shows a while
 * before its code runs. Links work meanwhile (full page loads); a button would do
 * nothing, so its click is held (window.__earlyClicks) until releaseEarlyClicks().
 */
export const EARLY_CLICKS = `window.__earlyClicks=[];document.addEventListener('click',function(e){var q=window.__earlyClicks;if(!q)return;var b=e.target.closest&&e.target.closest('button,[role=button]');if(!b)return;e.preventDefault();e.stopPropagation();q.indexOf(b)<0&&q.push(b)},true)`

/** The page is interactive: stop holding clicks and click what was held. Once per page load. */
export function releaseEarlyClicks() {
  const w = window as {__earlyClicks?: HTMLElement[] | null}
  const held = w.__earlyClicks ?? []
  w.__earlyClicks = null
  for (const el of held) if (el.isConnected) el.click()
}
