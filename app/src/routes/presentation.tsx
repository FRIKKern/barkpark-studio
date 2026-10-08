import {createFileRoute, notFound} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {Presentation} from '../components/Presentation'
import {localeQuery, translate} from '../lib/i18n'
import studio from '../studio.config'

// J58: Presentation, when the studio config names a preview site. `?preview=/path`
// opens that page, like Sanity's.
export const Route = createFileRoute('/presentation')({
  validateSearch: (search: Record<string, unknown>): {preview?: string} => (typeof search.preview === 'string' && search.preview.startsWith('/') ? {preview: search.preview} : {}),
  beforeLoad: ({context, location}) => {
    if (!studio.presentation) throw notFound()
    return requireEditor(context.queryClient, location.href)
  },
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey)?.locale ?? 'en', 'Presentation')} · Barkpark Studio`}]}),
  component: () => (
    <>
      <Navbar />
      <Presentation previewUrl={studio.presentation!.previewUrl} initialPath={Route.useSearch().preview} />
    </>
  ),
})
