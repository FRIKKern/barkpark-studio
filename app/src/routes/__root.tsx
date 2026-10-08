import {useEffect, type ReactNode} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import type {ScopeRef} from '../router'
import {HeadContent, Outlet, Scripts, createRootRouteWithContext} from '@tanstack/react-router'
import appCss from '../styles.css?url'
import fleetCss from '../vendor/barkpark-fleet.css?url'
// Preloaded so text doesn't reflow (a layout shift) when the font arrives late.
import {IconTips} from '../components/Tip'
import {ToastHost} from '../components/Toasts'
import {useAnnouncer} from '../lib/announce'
import {THEME_BOOT} from '../lib/theme'
import {EARLY_CLICKS, releaseEarlyClicks} from '../lib/hydrated'
import {currentScopeQuery} from '../lib/scope-switch'
import {LocaleProvider, localeQuery} from '../lib/i18n'
import {useQuery} from '@tanstack/react-query'
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

export const Route = createRootRouteWithContext<{queryClient: QueryClient; scope: ScopeRef}>()({
  // The navbar's workspace / dataset label, in the server render: fetched in the
  // browser it arrived late and pushed the buttons after it 209 px (a layout shift, J21 F2).
  // B01: the workspace's language too, so the server render is already in it.
  // Nothing is returned: a fresh value on every navigation re-rendered the whole app (F2).
  loader: async ({context}) => void (await Promise.all([context.queryClient.ensureQueryData(currentScopeQuery), context.queryClient.ensureQueryData(localeQuery)])),
  head: () => ({
    meta: [
      {charSet: 'utf-8'},
      {name: 'viewport', content: 'width=device-width, initial-scale=1'},
      {title: 'Barkpark Studio'},
    ],
    links: [
      {rel: 'icon', href: 'data:,'},
      {rel: 'preload', href: interLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous'},
      {rel: 'stylesheet', href: appCss},
      {rel: 'stylesheet', href: fleetCss},
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
  const locale = useQuery(localeQuery).data ?? 'en'
  return (
    // data-theme is set by THEME_BOOT before hydration; React must not fight it.
    <html lang={locale === 'nb-NO' ? 'nb' : 'en'} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html: THEME_BOOT}} />
        <script dangerouslySetInnerHTML={{__html: EARLY_CLICKS}} />
        <HeadContent />
      </head>
      <body>
        <LocaleProvider locale={locale}>
          {children}
          <ToastHost />
          <IconTips />
          <Announcer />
        </LocaleProvider>
        <Scripts />
      </body>
    </html>
  )
}
