import {createFileRoute} from '@tanstack/react-router'
import {cloudSignInStart} from '../../../server/auth'

// GET /auth/cloud/start → Barkpark Cloud's sign-in (lib/cloud-signin.ts). Off: back to /login.
export const Route = createFileRoute('/auth/cloud/start')({
  server: {
    handlers: {
      GET: ({request}) => {
        const location = cloudSignInStart(request.url, new URL(request.url).searchParams.get('redirect')) ?? '/login'
        return new Response(null, {status: 302, headers: {location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer'}})
      },
    },
  },
})
