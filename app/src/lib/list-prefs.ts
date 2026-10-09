import {createContext, useContext} from 'react'
import {createServerFn} from '@tanstack/react-start'
import {getCookie} from '@tanstack/react-start/server'
import {getPref, putPref} from './prefs'

// J25: a list's sort and view stick per type, per editor (like Sanity's per-user
// setting): kept on Barkpark per editor (lib/prefs), so another browser opens the
// lists the same way, and mirrored in a cookie so the server renders the list the
// way the browser will, and as the stand-in when Barkpark can't keep them.
// J55: or one of the type's own orderings, as Barkpark's order expression ("publishedAt:desc,title:asc").
export type Sort = 'title' | 'updated' | 'created' | `${string}:${'asc' | 'desc'}`
export type View = 'compact' | 'detailed'
export type ListPrefs = Record<string, {sort?: Sort; view?: View}>

export const DEFAULT_SORT: Sort = 'updated'
export const DEFAULT_VIEW: View = 'compact'
const COOKIE = 'bp_list'

const LIST_PREF = 'studio.lists'

export const fetchListPrefs = createServerFn({method: 'GET'}).handler(async () => {
  const stored = (await getPref({data: LIST_PREF}).catch(() => null)) as unknown
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) return stored as Record<string, {sort?: string; view?: string}>
  try {
    return JSON.parse(getCookie(COOKIE) ?? '{}') as Record<string, {sort?: string; view?: string}>
  } catch {
    return {}
  }
})

export function writeListPrefs(prefs: ListPrefs) {
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=31536000; samesite=lax`
  void putPref({data: {key: LIST_PREF, value: prefs}}).catch(() => {})
}

export function readListPrefsCookie(): ListPrefs {
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  try {
    return raw ? JSON.parse(decodeURIComponent(raw)) : {}
  } catch {
    return {}
  }
}

export const ListPrefsContext = createContext<{prefs: ListPrefs; set: (type: string, p: {sort?: Sort; view?: View}) => void}>({
  prefs: {},
  set: () => {},
})
export const useListPrefs = (type: string) => {
  const {prefs, set} = useContext(ListPrefsContext)
  return {sort: prefs[type]?.sort ?? DEFAULT_SORT, view: prefs[type]?.view ?? DEFAULT_VIEW, set: (p: {sort?: Sort; view?: View}) => set(type, p)}
}
