// task-05dcdef359da08fc: the image and file inputs are drawn before their editors' chunk is
// here (components/ImageBox.tsx, FileBox.tsx). A press on one of their buttons meanwhile is
// kept for the real input, one per box (the last press). Whether it is done is ONE decision on
// state recorded at two moments (afterSwap below): the press (its act, its button, its route),
// and the swap, read as React takes the box away (its layout cleanup, before the box leaves the
// page): which of the box's buttons has the focus, on which route. The press is done only if the
// focus is still on the very button pressed, on the route it was pressed on. Anything else (typed
// elsewhere, clicked elsewhere, another document, Safari not focusing a pressed button) drops it,
// unsaid. The focus goes over to the live box's same button either way. Nothing listens for what
// "anything else" could be.
export type Act = 'upload' | 'select' | 'menu' | 'edit'

export type Pressed = {act: Act; button: unknown; route: string}
export type Swap = {focused: {act: Act; el: unknown} | null; route: string}
// The real input mounts in the commit that takes the box away; a swap read and not taken by then
// is stale (a box gone with its page, a page come back to) and is never used.
const KEPT_MS = 1_000

/**
 * The decision, as the real input mounts on `route`, `ms` after the swap was read: the press to do
 * (if the person was still on it) and the button to focus (whatever had the focus in the box).
 */
export function afterSwap(pressed: Pressed | undefined, swap: Swap, route: string, ms: number): {act?: Act; focus?: Act} {
  if (swap.route !== route || ms >= KEPT_MS) return {}
  const stillOn = !!pressed && pressed.route === swap.route && swap.focused !== null && swap.focused.el === pressed.button
  return {act: stillOn ? pressed.act : undefined, focus: swap.focused?.act}
}

const here = () => location.pathname + location.search
const pressed = new Map<string, Pressed>()
const swapped = new Map<string, {pressed?: Pressed; swap: Swap; at: number}>()

/** A press on a box's button (field path `id`) before the chunk: the last one per box is kept. */
export const holdAct = (id: string, act: Act, button: unknown, route = here()) => void pressed.set(id, {act, button, route})

/** As React takes the box away: what has the focus in it, and where. */
export function settleBox(id: string, focused: Swap['focused'], route = here(), now = Date.now()) {
  swapped.set(id, {pressed: pressed.get(id), swap: {focused, route}, at: now})
  pressed.delete(id)
}

/** Once, as the real input mounts: the decision (forgotten as read). */
export function takeHeld(id: string, route = here(), now = Date.now()): {act?: Act; focus?: Act} {
  const s = swapped.get(id)
  swapped.delete(id)
  return s ? afterSwap(s.pressed, s.swap, route, now - s.at) : {}
}

/** What has the focus inside the box at `id`: its data-act button, read as the box is taken away. */
export function focusIn(id: string): Swap['focused'] {
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
