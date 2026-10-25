import {useEffect, type ReactNode} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import type {ScopeRef} from '../router'
import {HeadContent, Outlet, Scripts, createRootRouteWithContext} from '@tanstack/react-router'
import appCss from '../styles.css?url'
// Preloaded so text doesn't reflow (a layout shift) when the font arrives late.
import {IconTips} from '../components/Tip'
import {ToastHost} from '../components/Toasts'
import {SessionGate} from '../components/SessionGate'
import {useAnnouncer} from '../lib/announce'
import {THEME_BOOT} from '../lib/theme'
import {studioName} from '../lib/studio-name'
import {EARLY_CLICKS, releaseEarlyClicks} from '../lib/hydrated'
import {watchRequests} from '../lib/request-timings'
import {currentScopeQuery} from '../lib/scope-switch'
import {serverNowQuery} from '../lib/now'
import {LocaleProvider, localeQuery} from '../lib/i18n'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {withinBudget} from '../lib/ssr-budget'
import {meQuery} from '../lib/session'
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

export const Route = createRootRouteWithContext<{queryClient: QueryClient; scope: ScopeRef}>()({
  // The navbar's workspace / dataset label, in the server render: fetched in the
  // browser it arrived late and pushed the buttons after it 209 px (a layout shift, J21 F2).
  // B01: the workspace's language too, so the server render is already in it.
  // The server's render time too, for relative times that hydrate as rendered (lib/now.ts).
  // Nothing is returned: a fresh value on every navigation re-rendered the whole app (F2).
  // The locale is a Barkpark read: on the server it gets 1 s (lib/ssr-budget), else the page
  // renders in English and the browser asks again (task-f2bc22f7401aae9e).
  loader: async ({context}) =>
    void (await Promise.all([
      context.queryClient.ensureQueryData(currentScopeQuery),
      typeof window === 'undefined' ? withinBudget(context.queryClient, localeQuery, 1000, () => ({locale: 'en' as const, provisional: true as const})) : context.queryClient.ensureQueryData(localeQuery),
      context.queryClient.ensureQueryData(serverNowQuery),
    ])),
  head: () => ({
    meta: [
      {charSet: 'utf-8'},
      {name: 'viewport', content: 'width=device-width, initial-scale=1'},
      {title: studioName},
    ],
    links: [
      {rel: 'icon', href: 'data:,'},
      {rel: 'preload', href: interLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous'},
      {rel: 'stylesheet', href: appCss},
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
})

/** J47: the always-present polite region lib/announce.ts speaks through. */
function Announcer() {
  const text = useAnnouncer()
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
      {text}
    </div>
  )
}

function RootDocument({children}: {children: ReactNode}) {
  // A page that never marks itself hydrated (health, error screens) still gets its held clicks.
  useEffect(() => void setTimeout(releaseEarlyClicks, 1000), [])
  // Help > Diagnostics' request timings, kept from the start (the browser's buffer drops them).
  useEffect(watchRequests, [])
  const localeData = useQuery(localeQuery).data ?? {locale: 'en' as const}
  const locale = localeData.locale
  // The server render stood in for a late Barkpark (lib/ssr-budget): the browser asks now.
  const qc = useQueryClient()
  useEffect(() => {
    if (localeData.provisional) void qc.invalidateQueries({queryKey: localeQuery.queryKey})
    if (qc.getQueryData<{provisional?: boolean}>(meQuery.queryKey)?.provisional) void qc.invalidateQueries({queryKey: meQuery.queryKey})
  }, [])
  return (
    // data-theme is set by THEME_BOOT before hydration; React must not fight it.
    <html lang={locale === 'nb-NO' ? 'nb' : 'en'} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html: THEME_BOOT}} />
        <script dangerouslySetInnerHTML={{__html: EARLY_CLICKS}} />
        <HeadContent />
      </head>
      <body>
        <LocaleProvider data={localeData}>
          <SessionGate>{children}</SessionGate>
          <ToastHost />
          <IconTips />
          <Announcer />
        </LocaleProvider>
        <Scripts />
      </body>
    </html>
  )
}
