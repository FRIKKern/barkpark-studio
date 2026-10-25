import {createFileRoute} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {localeQuery, translate} from '../lib/i18n'
import {Releases} from '../components/Releases'
import {studioName} from '../lib/studio-name'

// Sanity's Releases tool, its Scheduled drafts view (task-ad9c942d7d48c887).
export const Route = createFileRoute('/releases')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey)?.locale ?? 'en', 'Releases')} · ${studioName}`}]}),
  component: () => (
    <>
      <Navbar />
      <Releases />
    </>
  ),
})
