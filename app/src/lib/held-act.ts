// task-05dcdef359da08fc: the image and file inputs are drawn before their editors' chunk is
// here (components/ImageBox.tsx, FileBox.tsx). What a person does to one meanwhile is kept
// here, by field path, for the real input to do once it mounts: one act per box (the last
// press), and the control that had the focus, so the focus stays on it across the swap.
export type Act = 'upload' | 'select' | 'menu' | 'edit'

const acts = new Map<string, Act>()
const focus = new Map<string, Act>()

export const holdAct = (id: string, act: Act) => void acts.set(id, act)
export const noteFocus = (id: string, act: Act | null) => void (act ? focus.set(id, act) : focus.delete(id))

/** Once, as the real input mounts: what was pressed and what had the focus (each forgotten as read). */
export function takeHeld(id: string): {act?: Act; focused?: Act} {
  const held = {act: acts.get(id), focused: focus.get(id)}
  acts.delete(id)
  focus.delete(id)
  return held
}

/** The control for an act inside the box at `id` (each carries data-act), for the focus to go back to. */
export const actControl = (id: string, act: Act) => document.getElementById(id)?.querySelector<HTMLElement>(`[data-act="${act}"]`) ?? null

/** The focus handlers for a control drawn before its chunk. A blur because React took the box away
 *  for the real one (the node is gone once the commit ends) keeps the note; a blur by the person drops it. */
export const heldFocus = (id: string, act: Act) => ({
  onFocus: () => noteFocus(id, act),
  onBlur: (e: {currentTarget: Element}) => {
    const el = e.currentTarget
    queueMicrotask(() => el.isConnected && noteFocus(id, null))
  },
})
