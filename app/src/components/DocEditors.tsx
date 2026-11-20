import {Suspense, use, useEffect, type ComponentProps, type ComponentType, type ReactNode} from 'react'
import {holdReleaseUntil, releaseEarlyClicks} from '../lib/hydrated'
import {isLive} from '../lib/held-act'
import {FileBox} from './FileBox'
import {toast} from './Toasts'
import {t} from '../lib/i18n'
import {ImageBox, ImageFrame} from './ImageBox'

// Cold-load scout (2026-10-09, task-5242fdab0458e203): the image and file inputs, the
// Freeform canvas host and Review changes are only for a document pane, yet sat in every
// page's first chunk. They are one chunk now, fetched once the desk is idle (so opening
// the first document never waits on it) and, on the server, before any render.
type Mod = typeof import('./doc-editors')
let mod: Mod | undefined
// Marked fulfilled when it lands (React's thenable fields), so use() reads it at once.
let pending: (Promise<Mod> & {status?: string; value?: Mod}) | undefined
export const loadDocEditors = () => (pending ??= untilLoaded(() => import('./doc-editors')).then((m) => (Object.assign(pending!, {status: 'fulfilled', value: m}), (mod = m))))

// J20: offline before the chunk lands must not take the pane down (a rejected import
// here reached the pane's error card, and stayed cached until a reload). It never
// rejects: a failed fetch tries again once the browser is back online (or in a moment,
// if it never noticed going offline); the editors in it wait, the rest of the form types on.
// The browser keeps a failed module fetch failed, so a retry asks for the same file
// under a fresh URL (the one the error names).
export function untilLoaded<M>(attempt: () => Promise<M>): Promise<M> {
  return attempt().catch(
    (err: unknown) =>
      new Promise<M>((resolve) => {
        const url = /https?:\/\/[^\s'"]+/.exec(String((err as Error)?.message))?.[0]?.replace(/[?&]retry=\d+$/, '')
        const next = url ? () => import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`) as Promise<M> : attempt
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

/**
 * task-05dcdef359da08fc: a file dropped on an image or file input before its real input is mounted
 * (its server HTML, or the box drawn meanwhile) has no handler to take it, and the browser opened
 * the file in the tab, the document gone. Until the box under the drop is live (lib/held-act.ts
 * markLive, set as the real input mounts, which can be some frames after the chunk lands) it is
 * kept from the tab and refused, said with a toast for each refused drop. A live box is left to
 * its own handlers, read-only included.
 */
let guarding = false
function guardDrops() {
  if (guarding) return
  guarding = true
  const held = (e: DragEvent) => {
    if (e.defaultPrevented || ![...(e.dataTransfer?.types ?? [])].includes('Files')) return false
    const box = (e.target as Element | null)?.closest?.('.file-input, .image-input')
    return !!box && !isLive(box)
  }
  addEventListener('dragover', (e) => held(e) && e.preventDefault())
  addEventListener('drop', (e) => {
    if (!held(e)) return
    e.preventDefault()
    toast({tone: 'critical', title: t('The editor is still loading. Drop the file again in a moment.')})
  })
}

// A page that opens on a document (a /structure path with a doc in it, or Presentation)
// draws these inputs in its first frame: fetch the chunk as this module loads, alongside
// the rest of the page's code, not once hydration reaches them (task-63978ba572421248).
// Other pages keep the desk's idle prefetch. Clicks are held from now: React hydrates the
// server-drawn inputs after the page marks itself interactive, so holding only once they
// render let a held click go to the inert server button (see holdClicks).
export const onDocPage = () => /^(?:\/w\/[^/]+\/p\/[^/]+(?:\/d\/[^/]+)?)?\/(?:structure\/[^?#]*;|presentation)/.test(location.pathname)
if (!import.meta.env.SSR && onDocPage()) (holdClicks(), guardDrops())

/** Fetch the chunk when the browser is idle (the desk calls this once it has rendered). */
export function usePrefetchDocEditors() {
  useEffect(() => {
    if (mod) return
    const idle = (globalThis as {requestIdleCallback?: (f: () => void) => number}).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200))
    idle(() => void loadDocEditors())
  }, [])
}

// Loaded: renders at once. Not yet: suspends until it is (fallback: lazyOf's); use() on
// every render, never only on the first (React refuses a use() that comes and goes). The same
// Suspense boundary on the server and the client, so hydration keeps the server's HTML
// while the chunk is still on its way instead of failing over a different tree.
function From<K extends keyof Mod>({name, props}: {name: K; props: object}) {
  if (!mod && typeof window !== 'undefined') (holdClicks(), guardDrops())
  const C = use(loadDocEditors())[name] as ComponentType<object>
  return <C {...props} />
}
// task-05dcdef359da08fc: what the boundary draws while the chunk is still missing. React may put
// it in place of the server's HTML before the chunk lands (an update reaching the boundary, a
// context the form passes down); with nothing, the image and file inputs vanished from the form.
// They draw their own box instead (FileBox, ImageBox): the same markup the real input draws through
// it, so nothing moves, and what a person does to it meanwhile is kept (lib/held-act.ts).
const lazyOf =
  <K extends keyof Mod>(name: K, fallback: ReactNode | ((props: ComponentProps<Mod[K]>) => ReactNode) = null) =>
  (props: ComponentProps<Mod[K]>) => (
    <Suspense fallback={typeof fallback === 'function' ? fallback(props) : fallback}>
      <From name={name} props={props} />
    </Suspense>
  )

// The image's frame and its own fields (alt) sit outside the boundary: typing in them never waits on
// the chunk, and they are never swapped when it lands (ImageBox.tsx).
const ImageLive = lazyOf('ImageInput', (p) => <ImageBox id={p.id} field={p.field} value={p.value} readOnly={p.readOnly} />)
export const ImageInput = (props: ComponentProps<Mod['ImageInput']>) => (
  <ImageFrame {...props}>
    <ImageLive {...props} />
  </ImageFrame>
)
export const FileInput = lazyOf('FileInput', (p) => <FileBox id={p.id} field={p.field} value={p.value} readOnly={p.readOnly} />)
export const PortableDocEditor = lazyOf('PortableDocEditor')
export const ReviewChanges = lazyOf('ReviewChanges')
