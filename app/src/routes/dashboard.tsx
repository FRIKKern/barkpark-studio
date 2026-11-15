import {createFileRoute, notFound} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {Dashboard} from '../components/Dashboard'
import {dashboardEnabled} from '../lib/dashboard'
import {localeQuery, translate} from '../lib/i18n'
import studio from '../studio.config'
import {studioName} from '../lib/studio-name'

// The Dashboard tool (Sanity's @sanity/dashboard), when the studio config has a `dashboard`.
// A deployment that names its tools (VITE_STUDIO_TOOLS) without `dashboard` has none: no
// navbar entry, and this address is not found, as Presentation's is without a preview site.
export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({context, location}) => {
    if (!dashboardEnabled(studio)) throw notFound()
    return requireEditor(context.queryClient, location.href)
  },
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey)?.locale ?? 'en', 'Dashboard')} · ${studioName}`}]}),
  component: () => (
    <>
      <Navbar />
      <Dashboard />
    </>
  ),
})
