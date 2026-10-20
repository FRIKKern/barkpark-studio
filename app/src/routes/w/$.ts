import {createFileRoute} from '@tanstack/react-router'
import {bpFile} from '../../server/barkpark'
import {fileSafetyHeaders} from '../../lib/media-proxy'

// GET /w/<ws>/p/<project>/media/files/… → that Barkpark media file (D07). An image block
// in the canvas stores Barkpark's own file path as its src, so the same block shows in
// Barkpark's LiveView (same host, its session) and here (this proxy, our token).
export const Route = createFileRoute('/w/$')({
  server: {
    handlers: {
      GET: async ({params, request}) => {
        const path = `/w/${params._splat ?? ''}`
        if (!/^\/w\/[^/]+\/p\/[^/]+\/media\/files\//.test(path) || path.includes('..')) return new Response(null, {status: 404})
        const file = await bpFile(path)
        const type = file.headers.get('content-type') ?? 'application/octet-stream'
        return new Response(file.body, {
          status: file.status,
          // The same safety headers as /api/media (lib/media-proxy fileSafetyHeaders).
          headers: file.ok
            ? {'content-type': type, 'cache-control': 'private, max-age=31536000, immutable', vary: 'Sec-Fetch-Dest', ...fileSafetyHeaders(type, request.headers.get('sec-fetch-dest'))}
            : {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'},
        })
      },
    },
  },
})
