import '@tanstack/react-start/server-only'
import type {IncomingMessage, ServerResponse} from 'node:http'

/**
 * Aborts when the browser behind `request` goes away. `request.signal` alone does not do
 * that in the production server: `vite preview` puts a compression middleware in front
 * (@polka/compression) that holds back every `res.on` listener until the response starts,
 * and srvx hears the client leave through `res.once('close')`. A request that is still
 * working before its first byte (an upload going on to Barkpark) was never told. With
 * `Accept-Encoding: gzip` only, so every browser and not curl; the dev server has no such
 * middleware. The client's socket closing says it too, and is heard directly.
 * Not reported upstream yet (Vite / TanStack srvx): the owner's call, with the repro in
 * task-d87a15eb71d9ca6d. Drop this once request.signal aborts on its own in preview.
 */
export function clientGone(request: Request): AbortSignal {
  const node = (request as {runtime?: {node?: {req?: IncomingMessage; res?: ServerResponse}}}).runtime?.node
  const socket = node?.req?.socket
  if (!socket || !node?.res) return request.signal
  const gone = new AbortController()
  const res = node.res
  const onClose = () => res.writableEnded || gone.abort()
  socket.once('close', onClose)
  res.once('finish', () => socket.off('close', onClose))
  request.signal.addEventListener('abort', () => gone.abort(), {once: true})
  return gone.signal
}
