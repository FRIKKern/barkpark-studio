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
    let gone = false
    const mark = () => {
      if (gone) return
      document.documentElement.dataset.hydrated = ''
      releaseEarlyClicks()
    }
    if (markAfter) void markAfter.then(mark)
    else mark()
    return () => ((gone = true), void delete document.documentElement.dataset.hydrated)
  }, [])
}

let markAfter: Promise<unknown> | null = null
/**
 * A document page is interactive once its pane is live (components/DocPane.tsx), not when
 * its route mounts: the pane's chunk can land later, and until React hydrates it the form is
 * the server's inert HTML. At most MARK_WAIT_MS (a chunk that never comes), as before.
 */
export function holdMarkUntil(until: Promise<unknown>) {
  markAfter = Promise.race([until, new Promise((r) => setTimeout(r, MARK_WAIT_MS))])
}
const MARK_WAIT_MS = 15_000

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
  const at = performance.now()
  for (const el of held) clickWhenLive(el, at)
}

/**
 * A held button is clicked once React has it: the same element hydrated, or the one React
 * drew anew in its place. Looked for each frame for three seconds, then clicked as it is.
 * "The chunk landed, two frames later" was not enough: with slow Barkpark reads (a deploy),
 * the editors' Suspense boundary hydrated later than that, the click went to the inert
 * server-drawn Select and was lost (task-0d76ab147c56c3c9, J36 on CI 2026-10-14 23:52 UTC).
 */
function clickWhenLive(el: HTMLElement, since: number, frames = 180) {
  // Pressed somewhere else meanwhile: the held click is stale, and clicking it now would
  // take the focus from where the person went (J10: the title lost its keys to the body).
  if (lastPointerDown > since) return
  const now = el.isConnected ? el : counterpart(el)
  if (now && (isLive(now) || frames === 0)) return void now.click()
  if (frames > 0) requestAnimationFrame(() => clickWhenLive(el, since, frames - 1))
}

let lastPointerDown = 0
if (typeof window !== 'undefined') addEventListener('pointerdown', (e) => e.isTrusted && (lastPointerDown = performance.now()), true)

// React marks an element it has hydrated or rendered with its props (`__reactProps$<id>`).
const isLive = (el: HTMLElement) => Object.keys(el).some((k) => k.startsWith('__reactProps$'))

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
