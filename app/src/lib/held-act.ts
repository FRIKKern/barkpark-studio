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

// Every lookup starts from the box's own element (a ref its component holds), never from the page by
// id: two panes can show the same field path (ids repeat across panes), and neither may reach the
// other's box. A box's container is the element that stays put while React swaps the box: the image's
// frame (.image-input), or the file box's parent (its field).
export function boxOf(el: Element | null | undefined): Element | null {
  const own = el?.closest('.file-input, .image-input')
  return own?.classList.contains('file-input') ? own.parentElement : (own ?? null)
}

const pressed = new WeakMap<object, Pressed>()
const swapped = new WeakMap<object, {pressed?: Pressed; swap: Swap; at: number}>()

/** A press on a box's button before the chunk: the last one per box (its container) is kept. */
export const holdAct = (box: object, act: Act, button: unknown, route = here()) => void pressed.set(box, {act, button, route})

/** As React takes the box away: what has the focus in it, and where. */
export function settleBox(box: object, focused: Swap['focused'], route = here(), now = Date.now()) {
  swapped.set(box, {pressed: pressed.get(box), swap: {focused, route}, at: now})
  pressed.delete(box)
}

/** Once, as the real input mounts in the same container: the decision (forgotten as read). */
export function takeHeld(box: object, route = here(), now = Date.now()): {act?: Act; focus?: Act} {
  const s = swapped.get(box)
  swapped.delete(box)
  return s ? afterSwap(s.pressed, s.swap, route, now - s.at) : {}
}

/** What has the focus in this box: its data-act button, read as the box is taken away. */
export function focusIn(box: Element): Swap['focused'] {
  const el = document.activeElement
  const act = el && boxOf(el) === box ? (el.getAttribute('data-act') as Act | null) : null
  return el && act ? {act, el} : null
}

/** The box's own control for an act (each carries data-act), for the focus to go to. */
export const actControl = (box: Element, act: Act) => [...box.querySelectorAll<HTMLElement>(`[data-act="${act}"]`)].find((b) => boxOf(b) === box) ?? null

// The drop guard (DocEditors.tsx guardDrops) stands aside per box once its real input is mounted:
// the box's own .file-input (or the image's .image-input frame) is marked here, from the input's own chooser.
const live = new WeakSet<object>()
export const markLive = (box: Element | null | undefined) => void (box && live.add(box))
export const isLive = (box: Element | null | undefined) => !!box && live.has(box)
