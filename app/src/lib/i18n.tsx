import {createContext, useContext, type ReactNode} from 'react'
import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch} from '../server/barkpark'
import {NB} from '../i18n/nb'

// B01: the Studio speaks the workspace's language, chosen in Barkpark (workspace
// settings `locale`, read at GET /v1/workspace/locale: "en" or "nb-NO"). English
// strings stay in the code as the keys: `t('Publish')`, `t('Edited {ago}', {ago})`;
// i18n/nb holds their Norwegian, from Sanity's nb-NO pack and Barkpark's own Studio
// where those say the same thing. A string without a translation shows in English.

export type Locale = 'en' | 'nb-NO'
export type Vars = Record<string, string | number>
export type T = (en: string, vars?: Vars) => string

const fetchLocale = createServerFn({method: 'GET'}).handler(async (): Promise<Locale> => {
  // A lane's dev server can force one (evidence runs): the workspace setting is shared.
  const forced = process.env.STUDIO_LOCALE
  if (forced === 'en' || forced === 'nb-NO') return forced
  try {
    const res = await bpFetch('/v1/workspace/locale', {}, undefined, {retry: false})
    const locale = res.ok ? ((await res.json()) as {locale?: string}).locale : undefined
    return locale === 'nb-NO' ? 'nb-NO' : 'en'
  } catch {
    return 'en'
  }
})

/** The workspace's locale; a scope switch reloads the page, so it is read once. */
export const localeQuery = queryOptions({queryKey: ['locale'], queryFn: () => fetchLocale(), staleTime: Infinity})

export function translate(locale: Locale, en: string, vars?: Vars): string {
  const s = locale === 'nb-NO' ? (NB[en] ?? en) : en
  return vars ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : s
}

const LocaleContext = createContext<Locale>('en')

/** Rendering: the server render knows the request's locale through this, not a global. */
export function LocaleProvider({locale, children}: {locale: Locale; children: ReactNode}) {
  browserLocale = typeof window === 'undefined' ? browserLocale : locale
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export const useLocale = () => useContext(LocaleContext)

// One translate function per locale, the same object every render: a fresh one each
// time broke every memo and hook dependency it reached (F2 pane open +15 ms).
const translators: Record<Locale, T> = {en: (en, vars) => translate('en', en, vars), 'nb-NO': (en, vars) => translate('nb-NO', en, vars)}

/** The translate function for this render (stable for a locale). */
export function useT(): T {
  return translators[useContext(LocaleContext)]
}

// Code outside a render (toasts, confirm texts built in handlers) runs in the browser
// only: it reads the locale the provider last rendered with.
let browserLocale: Locale = 'en'
export const t: T = (en, vars) => translate(browserLocale, en, vars)

/** BCP-47 tag for Intl: dates and relative times in the Studio's language. */
export const intlTag = (locale: Locale) => (locale === 'nb-NO' ? 'nb-NO' : 'en-US')

/**
 * "just now", "29 sec. ago", "12 min. ago", "3 hr. ago", "2 days ago" (Sanity's short
 * relative times, which are Intl's) and in Norwegian "akkurat nå", "for 12 min siden".
 */
export function ago(iso: string, locale: Locale = browserLocale, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 10) return translate(locale, 'just now')
  const rtf = new Intl.RelativeTimeFormat(intlTag(locale), {style: 'short', numeric: 'always'})
  if (s < 60) return rtf.format(-Math.floor(s), 'second')
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute')
  if (s < 86_400) return rtf.format(-Math.floor(s / 3600), 'hour')
  return rtf.format(-Math.floor(s / 86_400), 'day')
}
