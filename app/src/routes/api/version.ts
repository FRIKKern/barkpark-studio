import {createFileRoute} from '@tanstack/react-router'

// GET /api/version → the build this server runs (J53). Never cached: a redeploy must show.
export const Route = createFileRoute('/api/version')({
  server: {
    handlers: {
      GET: () => Response.json({build: __STUDIO_BUILD__}, {headers: {'cache-control': 'no-store'}}),
    },
  },
})
