import {createFileRoute} from '@tanstack/react-router'
import {cloudSignInFinish} from '../../../server/auth'

// GET /auth/cloud/callback?ticket&state ← Barkpark Cloud (lib/cloud-signin.ts). Signed in:
// on to where the editor was going; refused: /login, saying why (?cloud_error=).
export const Route = createFileRoute('/auth/cloud/callback')({
  server: {
    handlers: {
      GET: async ({request}) => {
        const q = new URL(request.url).searchParams
        const done = await cloudSignInFinish(q.get('ticket'), q.get('state')).catch(() => ({ok: false as const, error: 'unavailable' as const}))
        const location = done.ok ? done.redirect : `/login?cloud_error=${done.error}`
        return new Response(null, {status: 302, headers: {location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer'}})
      },
    },
  },
})
