import {useEffect, useSyncExternalStore} from 'react'

// J45: System / Light / Dark, as in Sanity's user menu. The choice lives in this
// browser (localStorage); `data-theme` on <html> carries the resolved one, and
// styles.css keys its dark tokens off it.
export type Appearance = 'system' | 'light' | 'dark'
const KEY = 'barkpark-studio:appearance'

/**
 * Runs inline in <head>, before the stylesheet paints anything: a dark page never
 * flashes white on load. Kept as a string; it must not import anything.
 */
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem('${KEY}')||'system';var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`

const listeners = new Set<() => void>()
const read = (): Appearance => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}
const dark = () => matchMedia('(prefers-color-scheme: dark)')
const apply = (a: Appearance) => (document.documentElement.dataset.theme = a === 'dark' || (a === 'system' && dark().matches) ? 'dark' : 'light')

export function setAppearance(a: Appearance) {
  try {
    if (a === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, a)
  } catch {}
  apply(a)
  for (const l of listeners) l()
}

/** The chosen appearance; on System, follows the OS while the page is open. */
export function useAppearance(): Appearance {
  const a = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    read,
    () => 'system' as Appearance,
  )
  useEffect(() => {
    if (a !== 'system') return
    const mq = dark()
    const follow = () => apply('system')
    mq.addEventListener('change', follow)
    return () => mq.removeEventListener('change', follow)
  }, [a])
  return a
}
