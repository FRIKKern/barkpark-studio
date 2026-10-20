import {createFileRoute} from '@tanstack/react-router'
import {e2eReadBlip} from '../../server/barkpark'
import {setWriteFault, type WriteFault} from '../../server/write-faults'
import {e2eListen, hubStats} from '../../server/listen'
import {presencePipes} from '../../server/presence-pipe'
import {openStreams} from '../../server/stream-registry'

// POST /api/e2e-listen {action: 'deaf' | 'cut' | 'flip' | 'read-blip' | 'write-fault', ms?}: the e2e rig's
// levers on the listen hub, presence and reads (live.spec, deploy-flip.spec). Off unless the
// server runs with STUDIO_E2E_HOOKS=1. GET: what is open now (the tab-stream soak).
export const Route = createFileRoute('/api/e2e-listen')({
  server: {
    handlers: {
      GET: () =>
        process.env.STUDIO_E2E_HOOKS === '1' ? Response.json({streams: openStreams.size, presencePipes: presencePipes(), ...hubStats()}) : new Response('not found', {status: 404}),
      POST: async ({request}) => {
        if (process.env.STUDIO_E2E_HOOKS !== '1') return new Response('not found', {status: 404})
        const {action, ms, id, kind, count} = (await request.json()) as {action: 'deaf' | 'cut' | 'flip' | 'read-blip' | 'write-fault'; ms?: number; id?: string; kind?: WriteFault['kind'] | 'none'; count?: number}
        if (action === 'read-blip') e2eReadBlip(ms ?? 0)
        else if (action === 'write-fault') setWriteFault(id!, kind && kind !== 'none' ? {kind, ms, count} : null)
        else e2eListen(action, ms)
        return Response.json({ok: true})
      },
    },
  },
})
