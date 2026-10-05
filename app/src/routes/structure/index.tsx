import {createFileRoute} from '@tanstack/react-router'
import {loadPanes, StructureView} from '../../lib/structure-route'

export const Route = createFileRoute('/structure/')({
  loader: ({context}) => loadPanes(context.queryClient, undefined),
  component: () => <StructureView {...Route.useLoaderData()} />,
})
