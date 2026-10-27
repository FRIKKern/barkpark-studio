import {createFileRoute} from '@tanstack/react-router'
import {loadPanes, requireEditor, StructureView} from '../../lib/structure-route'

export const Route = createFileRoute('/structure/')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  loader: ({context, location}) => loadPanes(context.queryClient, undefined, (location.search as {perspective?: string}).perspective === 'published'),
  component: () => <StructureView {...Route.useLoaderData()} />,
})
