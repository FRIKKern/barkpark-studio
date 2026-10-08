import {QueryClient} from '@tanstack/react-query'
import {createRouter} from '@tanstack/react-router'
import {setupRouterSsrQueryIntegration} from '@tanstack/react-router-ssr-query'
import {routeTree} from './routeTree.gen'
import {StudioError} from './components/PaneError'
import {parseScope, scopedPath, type Scope} from './lib/scope'

/** B02: the workspace / project / dataset this page is in (undefined: the studio's default). */
export type ScopeRef = {current?: Scope}

export function getRouter() {
  const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnWindowFocus: false}}})
  // B02: a URL may name its scope in front of the studio path (/w/<ws>/p/<project>/d/<dataset>/…,
  // lib/scope.ts). The router reads the studio path behind it and writes it back in front of
  // every URL it builds, so routes and links stay as they are. One router per page (and per
  // SSR request), so one scope each; switching scope is a new page load.
  const scope: ScopeRef = {}
  const router = createRouter({
    routeTree,
    context: {queryClient, scope},
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultErrorComponent: StudioError,
    rewrite: {
      input: ({url}) => {
        const {scope: named, rest} = parseScope(url.pathname)
        if (!named) return undefined
        scope.current = named
        url.pathname = rest
        return url
      },
      output: ({url}) => {
        if (!scope.current || parseScope(url.pathname).scope) return undefined
        url.pathname = scopedPath(scope.current, url.pathname)
        return url
      },
    },
  })
  setupRouterSsrQueryIntegration({router, queryClient})
  return router
}
