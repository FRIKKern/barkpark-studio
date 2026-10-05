import {createFileRoute} from '@tanstack/react-router'
import {loadPanes, requireEditor, StructureView} from '../../lib/structure-route'

export const Route = createFileRoute('/structure/')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  loader: ({context}) => loadPanes(context.queryClient, undefined),
  component: () => <StructureView {...Route.useLoaderData()} />,
})
