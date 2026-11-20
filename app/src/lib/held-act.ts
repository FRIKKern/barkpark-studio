// task-05dcdef359da08fc: the image and file inputs are drawn before their editors' chunk is
// here (components/ImageBox.tsx, FileBox.tsx). A press on one of their buttons meanwhile is
// kept for the real input, one per box (the last press). It is done as the chunk lands only if
// the person is still on it, read once, at the swap: as React takes the box away (its layout
// cleanup, before the box leaves the page) the focus is still on the button pressed, and the
// page is the one it was pressed on (the key: route and field path). The focus itself goes over
// to the live box's same button whether or not a press was held. Anything else since (typed
// elsewhere, clicked elsewhere, another document) and the press is dropped, unsaid: the person
// presses again on the live button. Safari does not focus a pressed button, so there a held
// press is always dropped. No list of what "anything else" could be is listened for.
export type Act = 'upload' | 'select' | 'menu' | 'edit'

type Held = {act: Act; button: unknown}
type Swap = {act?: Act; focus?: Act; at: number}
const held = new Map<string, Held>()
const swapped = new Map<string, Swap>()
// The real input mounts in the commit that takes the box away; what was read at the swap and not
// taken by then is stale (a box gone with its page, a page come back to) and is never used.
const KEPT_MS = 1_000

/** A box's key: the page it is on (route) and its field path. */
export const heldKey = (id: string, route = location.pathname + location.search) => `${route}|${id}`

/** A press on a box's button before the chunk: the last one per box is kept, with the button pressed. */
export const holdAct = (key: string, act: Act, button: unknown) => void held.set(key, {act, button})

/**
 * As React takes the box away: which of its buttons has the focus (its data-act), if any. The press
 * stays only if that is the very button pressed; the focus goes over to the live box either way, so a
 * keyboard user is not left on the page's body each time the chunk lands.
 */
export function settleBox(key: string, focused: {act: Act; el: unknown} | null, now = Date.now()) {
  const h = held.get(key)
  held.delete(key)
  const act = h && focused && focused.el === h.button ? h.act : undefined
  if (act || focused) swapped.set(key, {act, focus: focused?.act, at: now})
  else swapped.delete(key)
}

/** Once, as the real input mounts on this page: the press to do and the button to focus, if any (forgotten as read). */
export function takeHeld(key: string, now = Date.now()): {act?: Act; focus?: Act} {
  const s = swapped.get(key)
  swapped.delete(key)
  return s && now - s.at < KEPT_MS ? {act: s.act, focus: s.focus} : {}
}

/** What has the focus inside the box at `id`: its data-act button, read as the box is taken away. */
export function focusIn(id: string): {act: Act; el: Element} | null {
  const el = document.activeElement
  const act = el && document.getElementById(id)?.contains(el) ? (el.getAttribute('data-act') as Act | null) : null
  return el && act ? {act, el} : null
}

/** The control for an act inside the box at `id` (each carries data-act), for the focus to go to. */
export const actControl = (id: string, act: Act) => document.getElementById(id)?.querySelector<HTMLElement>(`[data-act="${act}"]`) ?? null

// The drop guard (DocEditors.tsx guardDrops) stands aside per box, once that box's real input is
// mounted: the field's box element (.file-input, or the image's .image-input frame) is marked here.
const live = new WeakSet<object>()
export const markLive = (box: Element | null | undefined) => void (box && live.add(box))
export const isLive = (box: Element | null | undefined) => !!box && live.has(box)
