import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {accessView, answerInvitation, askForAccess, withdrawRequest} from '../server/access-requests'

// task-cc6a6d85be054b17: the request-access screen's server functions. Barkpark is called
// on the server, as the signed-in person (server/access-requests.ts); the browser sends
// only the note or an id, never a workspace or a token.

const readAccess = createServerFn({method: 'GET'}).handler(() => accessView())

export const askAccess = createServerFn({method: 'POST'})
  .validator((d: {note?: string}) => ({note: typeof d?.note === 'string' ? d.note : undefined}))
  .handler(({data}) => askForAccess(data.note))

export const withdrawAccess = createServerFn({method: 'POST'})
  .validator((d: {id: string}) => ({id: String(d?.id ?? '')}))
  .handler(({data}) => withdrawRequest(data.id))

export const answerInvite = createServerFn({method: 'POST'})
  .validator((d: {id: string; accept: boolean}) => ({id: String(d?.id ?? ''), accept: d?.accept === true}))
  .handler(({data}) => answerInvitation(data.id, data.accept))

/** This person's requests and invitations for the page's workspace (a scope switch reloads the page). */
export const accessQuery = queryOptions({queryKey: ['access'], queryFn: () => readAccess(), staleTime: 5_000, refetchOnWindowFocus: true})
