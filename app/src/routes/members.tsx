import {createFileRoute} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {Members} from '../components/Members'
import {localeQuery, translate} from '../lib/i18n'
import {studioName} from '../lib/studio-name'

// J69 Members for admins: the workspace's seats and access requests, from the workspace menu
// and the Dashboard's Members widget. Anyone signed in reaches the page; what it lets them do
// is their seat's (components/Members.tsx), and Barkpark refuses the rest.
export const Route = createFileRoute('/members')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey)?.locale ?? 'en', 'Members')} · ${studioName}`}]}),
  component: () => (
    <>
      <Navbar />
      <Members />
    </>
  ),
})
