// How many uploads (routes/api/media/upload.ts) the studio server is handling now, and how
// many it has finished, whatever their end: relayed, cut off, or the asset a cancel left
// deleted (lib/upload-relay.ts). The e2e rig reads it (GET /api/e2e-listen, STUDIO_E2E_HOOKS)
// to know when a cancelled upload's work here is over (upload-cancel.spec).
let relaying = 0
let ended = 0

export const uploadRelays = () => ({relaying, ended})

export async function counted<T>(run: () => Promise<T>): Promise<T> {
  relaying++
  try {
    return await run()
  } finally {
    relaying--
    ended++
  }
}
