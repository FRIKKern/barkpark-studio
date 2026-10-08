import {createFileRoute} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {localeQuery, translate} from '../lib/i18n'
import {MediaLibrary} from '../components/MediaLibrary'

// B08: the media library as its own tool, beside Structure and Vision.
export const Route = createFileRoute('/media')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey) ?? 'en', 'Media')} · Barkpark Studio`}]}),
  component: () => (
    <>
      <Navbar />
      <MediaLibrary />
    </>
  ),
})
