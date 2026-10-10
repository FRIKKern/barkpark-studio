import {createFileRoute} from '@tanstack/react-router'
import {e2eListen} from '../../server/listen'

// POST /api/e2e-listen {action: 'deaf' | 'cut' | 'flip', ms?}: the e2e rig's levers on the
// listen hub (live.spec). Off unless the server runs with STUDIO_E2E_HOOKS=1.
export const Route = createFileRoute('/api/e2e-listen')({
  server: {
    handlers: {
      POST: async ({request}) => {
        if (process.env.STUDIO_E2E_HOOKS !== '1') return new Response('not found', {status: 404})
        const {action, ms} = (await request.json()) as {action: 'deaf' | 'cut' | 'flip'; ms?: number}
        e2eListen(action, ms)
        return Response.json({ok: true})
      },
    },
  },
})
