import {createFileRoute} from '@tanstack/react-router'
import {e2eReadBlip} from '../../server/barkpark'
import {e2eListen} from '../../server/listen'

// POST /api/e2e-listen {action: 'deaf' | 'cut' | 'flip' | 'read-blip', ms?}: the e2e rig's
// levers on the listen hub, presence and reads (live.spec, deploy-flip.spec). Off unless the
// server runs with STUDIO_E2E_HOOKS=1.
export const Route = createFileRoute('/api/e2e-listen')({
  server: {
    handlers: {
      POST: async ({request}) => {
        if (process.env.STUDIO_E2E_HOOKS !== '1') return new Response('not found', {status: 404})
        const {action, ms} = (await request.json()) as {action: 'deaf' | 'cut' | 'flip' | 'read-blip'; ms?: number}
        if (action === 'read-blip') e2eReadBlip(ms ?? 0)
        else e2eListen(action, ms)
        return Response.json({ok: true})
      },
    },
  },
})
