import type {ReactNode} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {HeadContent, Outlet, Scripts, createRootRouteWithContext} from '@tanstack/react-router'
import interCss from '@fontsource-variable/inter/index.css?url'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{queryClient: QueryClient}>()({
  head: () => ({
    meta: [
      {charSet: 'utf-8'},
      {name: 'viewport', content: 'width=device-width, initial-scale=1'},
      {title: 'Barkpark Studio'},
    ],
    links: [
      {rel: 'icon', href: 'data:,'},
      {rel: 'stylesheet', href: interCss},
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
