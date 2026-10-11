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

let pending: Promise<unknown> | null = null
/**
 * J36: the document editors' inputs are live only once their chunk lands, which on a slow
 * link is after the page is marked interactive. Until `until` settles, a release waits:
 * releasing at the mark clicked the inert server-drawn Select, and the click was lost
 * (task-63978ba572421248).
 */
export function holdReleaseUntil(until: Promise<unknown>) {
  pending = until
}

/** The page is interactive: stop holding clicks and click what was held. Once per page load. */
export function releaseEarlyClicks() {
  if (pending) {
    const until = pending
    pending = null
    void until.then(releaseEarlyClicks)
    return
  }
  const w = window as {__earlyClicks?: HTMLElement[] | null}
  const held = w.__earlyClicks ?? []
  w.__earlyClicks = null
  for (const el of held) (el.isConnected ? el.click() : clickCounterpart(el))
}

/**
 * A held button React has drawn anew: its new self may still be on its way (the editors'
 * inputs commit a few frames after their chunk lands), so look again each frame for a second.
 */
function clickCounterpart(el: HTMLElement, frames = 60) {
  const now = counterpart(el)
  if (now) now.click()
  else if (frames > 0) requestAnimationFrame(() => clickCounterpart(el, frames - 1))
}

/**
 * J36: hydrating can draw a server-rendered part anew (the image field's options button
 * was replaced, and its held click went nowhere). The same button under the same id'd
 * ancestor: matched by its label, else its text.
 */
function counterpart(el: HTMLElement): HTMLElement | null {
  const label = el.getAttribute('aria-label')
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (!a.id) continue
    const now = document.getElementById(a.id)
    const buttons = now ? [...now.querySelectorAll<HTMLElement>('button,[role=button]')] : []
    return buttons.find((b) => (label ? b.getAttribute('aria-label') === label : b.textContent === el.textContent)) ?? null
  }
  return null
}
