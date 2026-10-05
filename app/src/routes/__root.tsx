import {useEffect, type ReactNode} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {HeadContent, Outlet, Scripts, createRootRouteWithContext} from '@tanstack/react-router'
import appCss from '../styles.css?url'
// Preloaded so text doesn't reflow (a layout shift) when the font arrives late.
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
  // Marks the page interactive (e2e waits for it: a click before hydration is a full page load).
  useEffect(() => void (document.documentElement.dataset.hydrated = ''), [])
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
