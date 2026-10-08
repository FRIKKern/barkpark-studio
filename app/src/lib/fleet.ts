import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// D14: a paper's task (fleet) blocks show live previews. The canvas draws an empty
// hole for each ([data-bp-fleet-id] [data-bp-fleet-body]); Barkpark renders them as
// HTML (GET /v1/papers/:slug/fleet-blocks, #22095) and the host paints the holes, as
// Barkpark's LiveView hooks do. A task change anywhere reads them again (lib/live.ts).

export type FleetBlocks = Record<string, string>

const fetchFleetBlocks = createServerFn({method: 'GET'})
  .validator((d: {slug: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/papers/${encodeURIComponent(data.slug)}/fleet-blocks?dataset=${encodeURIComponent(dataset())}`)
    if (!res.ok) return {} // not a paper Barkpark knows, or none: nothing to paint
    return ((await res.json()) as {blocks?: FleetBlocks}).blocks ?? {}
  })

export const fleetQuery = (slug: string) => queryOptions({queryKey: ['fleet', slug], staleTime: 0, queryFn: async () => (await fetchFleetBlocks({data: {slug}})) as FleetBlocks})

/**
 * Paint every fleet hole in `root` from `blocks`. Each hole first gets a cancelable
 * `bp-fleet-paint` (a block that paints itself takes it); otherwise its HTML is set,
 * or Barkpark's empty text. Holes already showing that HTML are left alone.
 */
export function paintFleet(root: ParentNode, blocks: FleetBlocks, empty: string) {
  for (const hole of root.querySelectorAll<HTMLElement>('[data-bp-fleet-id] [data-bp-fleet-body]')) {
    const id = hole.closest<HTMLElement>('[data-bp-fleet-id]')!.dataset.bpFleetId!
    if (!(id in blocks) || hole.dataset.painted === blocks[id]) continue
    const html = blocks[id]!
    hole.dataset.painted = html
    const paint = new CustomEvent('bp-fleet-paint', {detail: {html, sourceBlock: undefined}, cancelable: true, bubbles: true})
    if (hole.dispatchEvent(paint)) hole.innerHTML = html || `<p class="bp-fleet-empty">${empty}</p>`
  }
}
