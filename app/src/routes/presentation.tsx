import {createFileRoute, notFound} from '@tanstack/react-router'
import {loadPanes, requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {Presentation} from '../components/Presentation'
import {localeQuery, translate} from '../lib/i18n'
import {resumeLive} from '../lib/live'
import studio from '../studio.config'

// J58: Presentation, when the studio config names a preview site. `?preview=/path`
// is the site's page, like Sanity's; J61: `?pane=` the document panel's panes.
type Search = {preview?: string; pane?: string; perspective?: string}

export const Route = createFileRoute('/presentation')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.preview === 'string' && search.preview.startsWith('/') ? {preview: search.preview} : {}),
    ...(typeof search.pane === 'string' && search.pane ? {pane: search.pane} : {}),
    ...(search.perspective === 'published' ? {perspective: 'published'} : {}),
  }),
  beforeLoad: ({context, location}) => {
    if (!studio.presentation) throw notFound()
    return requireEditor(context.queryClient, location.href)
  },
  loaderDeps: ({search}) => ({pane: search.pane}),
  loader: ({context, deps}) => (deps.pane ? loadPanes(context.queryClient, deps.pane) : null),
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey)?.locale ?? 'en', 'Presentation')} · Barkpark Studio`}]}),
  component: PresentationRoute,
})

function PresentationRoute() {
  const data = Route.useLoaderData()
  resumeLive(data?.resume)
  return (
    <>
      <Navbar />
      <Presentation previewUrl={studio.presentation!.previewUrl} mainDocuments={studio.presentation!.mainDocuments} preview={Route.useSearch().preview} panes={data?.panes ?? null} />
    </>
  )
}
