import {createFileRoute} from '@tanstack/react-router'
import {loadPanes, requireEditor, StructureView} from '../../lib/structure-route'

export const Route = createFileRoute('/structure/$')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  loader: ({context, params}) => loadPanes(context.queryClient, params._splat),
  component: () => <StructureView {...Route.useLoaderData()} />,
})
