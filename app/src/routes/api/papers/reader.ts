import {createFileRoute} from '@tanstack/react-router'
import {scope} from '../../../server/barkpark'

// GET /api/papers/reader?slug= → {public: boolean}: whether an anonymous reader gets this
// paper at its scope's reader URL (/w/<ws>/p/<project>/papers/<slug>). D12's Visibility says
// "Public" only then, as LiveView's sidebar does (public_reader?, task-352b1074aba3f434):
// a published paper in a scope with no public reader is members only, and saying "Public"
// promised something nobody outside could see kept (403).
export const Route = createFileRoute('/api/papers/reader')({
  server: {
    handlers: {
      GET: async ({request}) => {
        const slug = new URL(request.url).searchParams.get('slug') ?? ''
        if (!slug) return new Response('slug required', {status: 400})
        const {workspace, project} = scope()
        // No credentials: what someone outside would get.
        const res = await fetch(`${process.env.BARKPARK_URL}/w/${encodeURIComponent(workspace)}/p/${encodeURIComponent(project)}/papers/${encodeURIComponent(slug)}`, {redirect: 'manual'}).catch(() => null)
        return Response.json({public: res?.status === 200})
      },
    },
  },
})
