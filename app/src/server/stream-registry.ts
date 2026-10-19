import '@tanstack/react-start/server-only'

/** The open tab streams (routes/api/stream.ts), by id: what each listens to can change. */
export type OpenStream = {token: string; listen: (ids: string[], types: string[], since?: number) => void}
export const openStreams = new Map<string, OpenStream>()
