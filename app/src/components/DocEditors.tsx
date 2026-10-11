import {Suspense, use, useEffect, type ComponentProps, type ComponentType} from 'react'
import {holdReleaseUntil, releaseEarlyClicks} from '../lib/hydrated'

// Cold-load scout (2026-10-09, task-5242fdab0458e203): the image and file inputs, the
// Freeform canvas host and Review changes are only for a document pane, yet sat in every
// page's first chunk. They are one chunk now, fetched once the desk is idle (so opening
// the first document never waits on it) and, on the server, before any render.
type Mod = typeof import('./doc-editors')
let mod: Mod | undefined
// Marked fulfilled when it lands (React's thenable fields), so use() reads it at once.
let pending: (Promise<Mod> & {status?: string; value?: Mod}) | undefined
export const loadDocEditors = () => (pending ??= untilLoaded().then((m) => (Object.assign(pending!, {status: 'fulfilled', value: m}), (mod = m))))

// J20: offline before the chunk lands must not take the pane down (a rejected import
// here reached the pane's error card, and stayed cached until a reload). It never
// rejects: a failed fetch tries again once the browser is back online (or in a moment,
// if it never noticed going offline); the editors in it wait, the rest of the form types on.
// The browser keeps a failed module fetch failed, so a retry asks for the same file
// under a fresh URL (the one the error names).
function untilLoaded(attempt: () => Promise<Mod> = () => import('./doc-editors')): Promise<Mod> {
  return attempt().catch(
    (err: unknown) =>
      new Promise<Mod>((resolve) => {
        const url = /https?:\/\/[^\s'"]+/.exec(String((err as Error)?.message))?.[0]?.replace(/[?&]retry=\d+$/, '')
        const next = url ? () => import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`) as Promise<Mod> : attempt
        const again = () => resolve(untilLoaded(next))
        if (navigator.onLine) setTimeout(again, RETRY_MS)
        else addEventListener('online', again, {once: true})
      }),
  )
}
const RETRY_MS = 1_000
if (import.meta.env.SSR) void loadDocEditors()

/**
 * J36: inputs from this chunk that the server rendered stay inert until it lands and React
 * hydrates them, after the page is marked interactive: a click on them was lost (the empty
 * image field's Select, right after a reload). Clicks are held meanwhile, as before the page
 * hydrated (lib/hydrated.ts), and made once the inputs are live (at most HOLD_MS).
 */
let holding = false
function holdClicks() {
  if (holding) return
  holding = true
  const w = window as {__earlyClicks?: HTMLElement[] | null}
  w.__earlyClicks ??= []
  const live = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  const until = Promise.race([loadDocEditors().then(live), new Promise((r) => setTimeout(r, HOLD_MS))])
  // The page's own mark (lib/hydrated.ts) may come first: it waits for this too.
  holdReleaseUntil(until)
  void until.then(releaseEarlyClicks)
}
const HOLD_MS = 3_000

// A page that opens on a document (a /structure path with a doc in it, or Presentation)
// draws these inputs in its first frame: fetch the chunk as this module loads, alongside
// the rest of the page's code, not once hydration reaches them (task-63978ba572421248).
// Other pages keep the desk's idle prefetch. Clicks are held from now: React hydrates the
// server-drawn inputs after the page marks itself interactive, so holding only once they
// render let a held click go to the inert server button (see holdClicks).
if (!import.meta.env.SSR && /^(?:\/w\/[^/]+\/p\/[^/]+(?:\/d\/[^/]+)?)?\/(?:structure\/[^?#]*;|presentation)/.test(location.pathname)) holdClicks()

/** Fetch the chunk when the browser is idle (the desk calls this once it has rendered). */
export function usePrefetchDocEditors() {
  useEffect(() => {
    if (mod) return
    const idle = (globalThis as {requestIdleCallback?: (f: () => void) => number}).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200))
    idle(() => void loadDocEditors())
  }, [])
}

// Loaded: renders at once. Not yet: suspends until it is (fallback: nothing); use() on
// every render, never only on the first (React refuses a use() that comes and goes). The same
// Suspense boundary on the server and the client, so hydration keeps the server's HTML
// while the chunk is still on its way instead of failing over a different tree.
function From<K extends keyof Mod>({name, props}: {name: K; props: object}) {
  if (!mod && typeof window !== 'undefined') holdClicks()
  const C = use(loadDocEditors())[name] as ComponentType<object>
  return <C {...props} />
}
const lazyOf =
  <K extends keyof Mod>(name: K) =>
  (props: ComponentProps<Mod[K]>) => (
    <Suspense fallback={null}>
      <From name={name} props={props} />
    </Suspense>
  )

export const ImageInput = lazyOf('ImageInput')
export const FileInput = lazyOf('FileInput')
export const PortableDocEditor = lazyOf('PortableDocEditor')
export const ReviewChanges = lazyOf('ReviewChanges')
