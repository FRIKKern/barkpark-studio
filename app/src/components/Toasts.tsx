import {useSyncExternalStore, type CSSProperties, type ReactNode} from 'react'
import {Close} from './icons'
import {useT} from '../lib/i18n'

// Sanity-style toasts, bottom right: a title, a line of detail, gone after a few
// seconds. `toast()` works from anywhere; <ToastHost/> sits once in the root layout.

/** A title may carry markup (Sanity bolds the document's name: "<b>Post</b> was published"). */
type Toast = {id: number; title: ReactNode; description?: string; tone: 'critical' | 'caution' | 'positive' | 'default'; key?: string; ms?: number}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let next = 1

const timers = new Map<number, ReturnType<typeof setTimeout>>()
const drop = (id: number) => {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts = toasts.filter((x) => x.id !== id)
  emit()
}

/** `key`: Sanity's toast id; showing it again replaces the one on screen (never two alike). */
export function toast(t: Omit<Toast, 'id' | 'tone'> & {tone?: Toast['tone']}, ms = 4000) {
  const same = t.key ? toasts.find((x) => x.key === t.key) : undefined
  if (same) drop(same.id)
  const id = next++
  toasts = [...toasts, {tone: 'default', ...t, id, ms}]
  emit()
  timers.set(id, setTimeout(() => drop(id), ms))
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
  const t = useT()
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
    () => toasts,
  )
  return (
    <div className="toasts" aria-live="polite">
      {list.map((x) => (
        <div key={x.id} className="toast" data-tone={x.tone} data-timed={x.ms ? '' : undefined} style={x.ms ? ({'--toast-ms': `${x.ms}ms`} as CSSProperties) : undefined} role={x.tone === 'critical' ? 'alert' : 'status'}>
          {typeof x.title === 'string' ? <strong>{x.title}</strong> : <span className="toast-title">{x.title}</span>}
          {x.description && <span>{x.description}</span>}
          {/* Sanity's toasts are closable. */}
          <button type="button" className="icon-btn toast-close" aria-label={t('Close')} onClick={() => drop(x.id)}>
            <Close />
          </button>
        </div>
      ))}
    </div>
  )
}
