import {useSyncExternalStore} from 'react'

// Sanity-style toasts, bottom right: a title, a line of detail, gone after a few
// seconds. `toast()` works from anywhere; <ToastHost/> sits once in the root layout.

type Toast = {id: number; title: string; description?: string; tone: 'critical' | 'caution' | 'positive' | 'default'}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let next = 1

export function toast(t: Omit<Toast, 'id' | 'tone'> & {tone?: Toast['tone']}, ms = 4000) {
  const id = next++
  toasts = [...toasts, {tone: 'default', ...t, id}]
  emit()
  setTimeout(() => ((toasts = toasts.filter((x) => x.id !== id)), emit()), ms)
}

const stuck = new Map<string, number>()
/** A toast that stays until taken down with `null` ("Trying to connect…"). */
export function stickyToast(key: string, t: (Omit<Toast, 'id' | 'tone'> & {tone?: Toast['tone']}) | null) {
  const old = stuck.get(key)
  if (old) toasts = toasts.filter((x) => x.id !== old)
  stuck.delete(key)
  if (t) {
    const id = next++
    stuck.set(key, id)
    toasts = [...toasts, {tone: 'default', ...t, id}]
  }
  emit()
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
    () => toasts,
  )
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone} role={t.tone === 'critical' ? 'alert' : 'status'}>
          <strong>{t.title}</strong>
          {t.description && <span>{t.description}</span>}
        </div>
      ))}
    </div>
  )
}
