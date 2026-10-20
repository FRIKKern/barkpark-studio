import {relativeTime} from './relative-time'
import {createContext, useContext, type ReactNode} from 'react'
import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {workspaceLocale} from '../server/barkpark'

// B01: the Studio speaks the workspace's language, chosen in Barkpark (workspace
// settings `locale`, read at GET /v1/workspace/locale: "en" or "nb-NO"). English
// strings stay in the code as the keys: `t('Publish')`, `t('Edited {ago}', {ago})`;
// i18n/nb holds their Norwegian, from Sanity's nb-NO pack and Barkpark's own Studio
// where those say the same thing. A string without a translation shows in English.

export type Locale = 'en' | 'nb-NO'
export type Vars = Record<string, string | number>
export type T = (en: string, vars?: Vars) => string

/**
 * The workspace's locale and, for one other than English, its strings, and the Freeform
 * canvas's own (`canvas`: Barkpark's map as JSON, stamped as the canvas's data-strings).
 */
export type LocaleData = {locale: Locale; strings?: Record<string, string>; canvas?: string}

// The canvas's chrome words come from Barkpark (GET /v1/i18n/paper_canvas, #22439: the
// map its LiveView stamps), read on the server and kept a while per locale; a failed
// read keeps the last one, or none (the canvas then speaks English).
const CANVAS_TTL_MS = 10 * 60_000
const PROBE = 'Add a block below' // a canvas string every non-English map translates
const canvasCache: Partial<Record<Locale, {at: number; json?: string}>> = {}
async function canvasStrings(locale: Locale): Promise<string | undefined> {
  const held = canvasCache[locale]
  if (held && Date.now() - held.at < CANVAS_TTL_MS) return held.json
  try {
    const res = await fetch(`${process.env.BARKPARK_URL}/v1/i18n/paper_canvas?locale=${locale}`, {signal: AbortSignal.timeout(3000)})
    const body = res.ok ? ((await res.json()) as {locale?: string; strings?: Record<string, string>}) : undefined
    // An unknown locale falls back to English with a 200: only a map in this locale counts.
    const ours = body?.locale === locale && body.strings && body.strings[PROBE] !== PROBE ? body.strings : undefined
    const json = ours ? JSON.stringify(ours) : held?.json
    canvasCache[locale] = {at: Date.now(), json}
    return json
  } catch {
    return held?.json
  }
}

// The strings come with the locale, so a server render carries them in its payload and
// hydration has them; an English workspace downloads none (the dictionary is not in
// the client bundle: it is imported here, server side only).
const fetchLocale = createServerFn({method: 'GET'}).handler(async (): Promise<LocaleData> => {
  const pick = async (locale: Locale): Promise<LocaleData> => (locale === 'nb-NO' ? {locale, strings: (await import('../i18n/nb')).NB, canvas: await canvasStrings(locale)} : {locale})
  // A lane's dev server can force one (evidence runs): the workspace setting is shared.
  const forced = process.env.STUDIO_LOCALE
  if (forced === 'en' || forced === 'nb-NO') return pick(forced)
  try {
    // The studio's own token: the sign-in screen is in the workspace's language too.
    const locale = await workspaceLocale()
    return pick(locale === 'nb-NO' ? 'nb-NO' : 'en')
  } catch {
    return {locale: 'en'}
  }
})

// One dictionary per locale, filled from the locale read (static per locale, so one
// module-level map is safe across server renders).
const dictionaries: Partial<Record<Locale, Record<string, string>>> = {}
const register = (d: LocaleData | undefined) => void (d?.strings && (dictionaries[d.locale] ??= d.strings))

/** The workspace's locale; a scope switch reloads the page, so it is read once. */
export const localeQuery = queryOptions({
  queryKey: ['locale'],
  queryFn: async () => {
    const d = await fetchLocale()
    register(d)
    return d
  },
  staleTime: Infinity,
})

// A key may carry a context before \u0004 (gettext's msgctxt), where Sanity's one English text
// has two Norwegian ones: the context is looked up, never shown.
export function translate(locale: Locale, en: string, vars?: Vars): string {
  const shown = en.slice(en.indexOf('\u0004') + 1)
  const s = locale === 'en' ? shown : (dictionaries[locale]?.[en] ?? shown)
  return vars ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : s
}

const LocaleContext = createContext<Locale>('en')
const CanvasStringsContext = createContext<string | undefined>(undefined)

/** Rendering: the server render knows the request's locale through this, not a global. */
export function LocaleProvider({data, children}: {data: LocaleData; children: ReactNode}) {
  register(data) // a hydrating page: its strings came in the server's payload
  const locale = data.locale
  browserLocale = typeof window === 'undefined' ? browserLocale : locale
  return (
    <LocaleContext.Provider value={locale}>
      <CanvasStringsContext.Provider value={data.canvas}>{children}</CanvasStringsContext.Provider>
    </LocaleContext.Provider>
  )
}

/** The Freeform canvas's own words for this locale, as its `data-strings` (none: English). */
export const useCanvasStrings = () => useContext(CanvasStringsContext)

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

// One collator per locale (a list sorts every row through it).
const collators: Partial<Record<Locale, Intl.Collator>> = {}
/**
 * Compare two strings as the workspace's language orders them: in nb-NO … Z < Æ < Ø < Å
 * (a bare localeCompare used the browser's or the server's own, so Å sorted with A).
 * A render passes its locale (the server render has no browser one).
 */
export const collate = (a: string, b: string, locale: Locale = browserLocale) => (collators[locale] ??= new Intl.Collator(intlTag(locale))).compare(a, b)

/**
 * "just now", "29 sec. ago", "12 min. ago", "3 hr. ago", "yesterday", "2 days ago", "last week",
 * "2 wk. ago", then "Sep 5" (Sanity's, lib/relative-time.ts); in Norwegian "akkurat nå",
 * "for 12 min siden", "i går", "forrige uke", "5. sep.". A date reads `zone`'s calendar: pass useZone()
 * (lib/now.ts), the same on the server and while the page hydrates.
 */
export function ago(iso: string, locale: Locale = browserLocale, now = Date.now(), zone = 'UTC'): string {
  return relativeTime(iso, intlTag(locale), now, zone) ?? translate(locale, 'just now')
}
