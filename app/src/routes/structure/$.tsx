import {createFileRoute} from '@tanstack/react-router'
import {loadPanes, StructureView} from '../../lib/structure-route'

export const Route = createFileRoute('/structure/$')({
  loader: ({context, params}) => loadPanes(context.queryClient, params._splat),
  component: () => <StructureView {...Route.useLoaderData()} />,
})
