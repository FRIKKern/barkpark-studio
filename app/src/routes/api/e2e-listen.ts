import {createFileRoute} from '@tanstack/react-router'
import {e2eReadBlip} from '../../server/barkpark'
import {setWriteFault, type WriteFault} from '../../server/write-faults'
import {fakeWrites, setMembersFake} from '../../server/members-fake'
import {setAccessStub, stubCalls, type StubCommand} from '../../server/access-stub'
import {e2eListen, hubStats} from '../../server/listen'
import {presencePipes} from '../../server/presence-pipe'
import {openStreams} from '../../server/stream-registry'
import {uploadRelays} from '../../server/upload-relays'

// POST /api/e2e-listen {action: 'deaf' | 'cut' | 'flip' | 'read-blip' | 'write-fault' | 'access', ms?}: the e2e
// rig's levers on the listen hub, presence, reads and the access-request stand-in (server/access-stub.ts).
// Off unless the server runs with STUDIO_E2E_HOOKS=1. GET: what is open now (the tab-stream soak);
// GET ?access=1: the calls the stand-in answered. GET's `uploads`: uploads handled now and finished
// (server/upload-relays.ts).
// {action: 'members-fake', role, ms}: the Members screen on a fake roster (server/members-fake.ts;
// role null turns it off); answers how many writes reached it.
export const Route = createFileRoute('/api/e2e-listen')({
  server: {
    handlers: {
      GET: ({request}) =>
        process.env.STUDIO_E2E_HOOKS !== '1'
          ? new Response('not found', {status: 404})
          : new URL(request.url).searchParams.has('access')
            ? Response.json({calls: stubCalls()})
            : Response.json({streams: openStreams.size, presencePipes: presencePipes(), uploads: uploadRelays(), ...hubStats()}),
      POST: async ({request}) => {
        if (process.env.STUDIO_E2E_HOOKS !== '1') return new Response('not found', {status: 404})
        const body = (await request.json()) as {action: 'deaf' | 'cut' | 'flip' | 'read-blip' | 'write-fault' | 'access' | 'members-fake'; ms?: number; id?: string; kind?: WriteFault['kind'] | 'none'; count?: number; role?: string | null} & Partial<StubCommand>
        const {action, ms, id, kind, count, role} = body
        if (action === 'members-fake') {
          const writes = fakeWrites()
          if (role !== undefined) setMembersFake(role, ms)
          return Response.json({ok: true, writes})
        }
        if (action === 'access') setAccessStub(body as StubCommand)
        else if (action === 'read-blip') e2eReadBlip(ms ?? 0)
        else if (action === 'write-fault') setWriteFault(id!, kind && kind !== 'none' ? {kind, ms, count} : null)
        else e2eListen(action, ms)
        return Response.json({ok: true})
      },
    },
  },
})
