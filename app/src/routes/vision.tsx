import {createFileRoute} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {localeQuery, translate} from '../lib/i18n'
import {Vision} from '../components/Vision'
import {visionDataset} from '../lib/vision'

export const Route = createFileRoute('/vision')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  loader: () => visionDataset(),
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey) ?? 'en', 'Vision')} · Barkpark Studio`}]}),
  component: () => (
    <>
      <Navbar />
      <Vision dataset={Route.useLoaderData()} />
    </>
  ),
})
