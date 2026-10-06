import {QueryClient} from '@tanstack/react-query'
import {createRouter} from '@tanstack/react-router'
import {setupRouterSsrQueryIntegration} from '@tanstack/react-router-ssr-query'
import {routeTree} from './routeTree.gen'
import {StudioError} from './components/PaneError'

export function getRouter() {
  const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnWindowFocus: false}}})
  const router = createRouter({routeTree, context: {queryClient}, scrollRestoration: true, defaultPreload: 'intent', defaultErrorComponent: StudioError})
  setupRouterSsrQueryIntegration({router, queryClient})
  return router
}
