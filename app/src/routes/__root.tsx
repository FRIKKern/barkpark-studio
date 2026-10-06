import type {ReactNode} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {HeadContent, Outlet, Scripts, createRootRouteWithContext} from '@tanstack/react-router'
import appCss from '../styles.css?url'
// Preloaded so text doesn't reflow (a layout shift) when the font arrives late.
import {ToastHost} from '../components/Toasts'
import {THEME_BOOT} from '../lib/theme'
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

export const Route = createRootRouteWithContext<{queryClient: QueryClient}>()({
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
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
})

function RootDocument({children}: {children: ReactNode}) {
  return (
    // data-theme is set by THEME_BOOT before hydration; React must not fight it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html: THEME_BOOT}} />
        <HeadContent />
      </head>
      <body>
        {children}
        <ToastHost />
        <Scripts />
      </body>
    </html>
  )
}
