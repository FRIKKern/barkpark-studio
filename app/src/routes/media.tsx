import {createFileRoute} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {MediaLibrary} from '../components/MediaLibrary'

// B08: the media library as its own tool, beside Structure and Vision.
export const Route = createFileRoute('/media')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  head: () => ({meta: [{title: 'Media · Barkpark Studio'}]}),
  component: () => (
    <>
      <Navbar />
      <MediaLibrary />
    </>
  ),
})
