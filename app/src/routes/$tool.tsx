import {createFileRoute, notFound} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import studio from '../studio.config'

// J65: a tool from the studio config, at `/name` like Sanity's.
const toolOf = (name: string) => studio.tools?.find((tool) => tool.name === name)

export const Route = createFileRoute('/$tool')({
  beforeLoad: ({context, location, params}) => {
    if (!toolOf(params.tool)) throw notFound()
    return requireEditor(context.queryClient, location.href)
  },
  head: ({params}) => ({meta: [{title: `${toolOf(params.tool)?.title ?? ''} · Barkpark Studio`}]}),
  component: ToolPage,
})

function ToolPage() {
  const Tool = toolOf(Route.useParams().tool)!.component
  return (
    <>
      <Navbar />
      <Tool />
    </>
  )
}
