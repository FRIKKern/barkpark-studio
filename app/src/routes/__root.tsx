import type {ReactNode} from 'react'
import {HeadContent, Outlet, Scripts, createRootRoute} from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {charSet: 'utf-8'},
      {name: 'viewport', content: 'width=device-width, initial-scale=1'},
      {title: 'Barkpark Studio'},
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
      <body style={{fontFamily: 'system-ui, sans-serif', margin: 24}}>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
