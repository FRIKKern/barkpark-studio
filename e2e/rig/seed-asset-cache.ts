// The seed's files as Barkpark media, looked up once per worker (c1df slice 2). resetDoc used to
// page through the dataset's whole media list on every reset to find them by name and size;
// their ids don't change in a run unless a test deletes one. Every media delete in the e2e
// specs goes through deleteAsset (scripts/e2e-resets.test.mjs fails on any other), which takes
// the id out of the cache, so the next reset looks it up (and uploads it) again.
import {seedAssets} from '../../scripts/lib/seed-assets.mjs'

type Seeded = {_sanityAsset: string}
type Where = {base: string; dataset: string; token: string}
const known = new Map<string, string>() // a seed file (`_sanityAsset`) → its media ref, `asset-<id>`

// The files seedAssets looks up: a field's, and each in an array (as scripts/lib/seed-assets.mjs reads them).
const filesOf = (docs: unknown[]): string[] =>
  [...new Set(docs.flatMap((d) => Object.values(d as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof (x as Seeded | null)?._sanityAsset === 'string' ? [(x as Seeded)._sanityAsset] : [])))))]

/** seedAssets' resolver, from the cache when it holds every file the docs carry. */
export async function seedRefs(docs: unknown[], at: Where): Promise<(value: Seeded) => string> {
  const files = filesOf(docs)
  if (files.some((f) => !known.has(f))) {
    const resolve = await seedAssets(docs, at)
    for (const f of files) known.set(f, resolve({_sanityAsset: f}))
  }
  return (value) => known.get(value._sanityAsset) ?? fail(`no media for ${value._sanityAsset}`)
}

/** Delete a media asset, and forget it if it is a seed file's: the next reset looks it up again. */
export async function deleteAsset(id: string, at: Where): Promise<Response> {
  const res = await fetch(`${at.base}/v1/media/${at.dataset}/${id}`, {method: 'DELETE', headers: {authorization: `Bearer ${at.token}`}})
  for (const [f, ref] of known) if (ref === `asset-${id}`) known.delete(f)
  return res
}

const fail = (m: string): never => {
  throw new Error(m)
}
