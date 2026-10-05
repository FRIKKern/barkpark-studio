import {createContext, useContext} from 'react'
import {createServerFn} from '@tanstack/react-start'
import {getCookie} from '@tanstack/react-start/server'

// J25: a list's sort and view stick per type, per viewer (like Sanity's per-user
// setting). Kept in a cookie so the server renders the list the same way the
// browser will — no reorder or relayout after the page appears.
export type Sort = 'title' | 'updated' | 'created'
export type View = 'compact' | 'detailed'
export type ListPrefs = Record<string, {sort?: Sort; view?: View}>

export const DEFAULT_SORT: Sort = 'updated'
export const DEFAULT_VIEW: View = 'compact'
const COOKIE = 'bp_list'

export const fetchListPrefs = createServerFn({method: 'GET'}).handler(async () => {
  try {
    return JSON.parse(getCookie(COOKIE) ?? '{}') as Record<string, {sort?: string; view?: string}>
  } catch {
    return {}
  }
})

export function writeListPrefs(prefs: ListPrefs) {
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=31536000; samesite=lax`
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
