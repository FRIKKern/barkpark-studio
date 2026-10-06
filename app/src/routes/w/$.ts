import {createFileRoute} from '@tanstack/react-router'
import {bpFile} from '../../server/barkpark'

// GET /w/<ws>/p/<project>/media/files/… → that Barkpark media file (D07). An image block
// in the canvas stores Barkpark's own file path as its src, so the same block shows in
// Barkpark's LiveView (same host, its session) and here (this proxy, our token).
export const Route = createFileRoute('/w/$')({
  server: {
    handlers: {
      GET: async ({params}) => {
        const path = `/w/${params._splat ?? ''}`
        if (!/^\/w\/[^/]+\/p\/[^/]+\/media\/files\//.test(path) || path.includes('..')) return new Response(null, {status: 404})
        const file = await bpFile(path)
        return new Response(file.body, {
          status: file.status,
          headers: {'content-type': file.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable'},
        })
      },
    },
  },
})
