// The files fixtures/seed.ndjson carries (`_sanityAsset`, as a Sanity import takes
// them) as Barkpark media of one dataset: each is found by its original name and size,
// else uploaded once. Answers toBarkpark's asset resolver: a seed value → its media
// document id (asset-<id>), the `_ref` of Barkpark's canonical file/image value.
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {basename} from 'node:path'
import {withRetry} from './retry.mjs'

const fixtures = new URL('../../fixtures/', import.meta.url)
const MIME = {txt: 'text/plain', png: 'image/png', pdf: 'application/pdf'}
const fileOf = (sanityAsset) => new URL(sanityAsset.replace(/^\w+@file:\/\/\.\//, ''), fixtures)

export async function seedAssets(docs, {base, dataset, token}) {
  const auth = {authorization: `Bearer ${token}`}
  const wanted = [...new Set(docs.flatMap((d) => Object.values(d).flatMap((v) => (v?._sanityAsset ? [v._sanityAsset] : []))))]
  const have = []
  for (let offset = 0; wanted.length; offset += 200) {
    const res = await withRetry(() => fetch(`${base}/v1/media/${dataset}?limit=200&offset=${offset}`, {headers: auth}), {label: `GET media ${dataset}`})
    if (!res.ok) throw new Error(`media list → ${res.status}`)
    const page = (await res.json()).result
    have.push(...page.assets)
    if (!page.hasMore) break
  }
  const refs = new Map()
  for (const path of wanted) {
    const bytes = readFileSync(fileOf(path))
    const name = basename(fileOf(path).pathname)
    let id = have.find((a) => a.asset?.fileInfo?.originalName === name && a.size === bytes.length)?.id
    if (!id) {
      const body = new FormData()
      body.append('file', new Blob([bytes], {type: MIME[name.split('.').pop()] ?? 'application/octet-stream'}), name)
      const res = await fetch(`${base}/v1/media/${dataset}/upload`, {method: 'POST', headers: auth, body})
      if (!res.ok) throw new Error(`upload ${name} → ${res.status} ${await res.text()}`)
      id = (await res.json()).result.id
    }
    refs.set(path, `asset-${id}`)
  }
  return (value) => {
    const ref = refs.get(value._sanityAsset)
    if (!ref) throw new Error(`no media for ${value._sanityAsset}`)
    return ref
  }
}

/**
 * A seed file value as the reference Sanity holds it once imported: a file asset's id
 * is `file-<sha1>-<ext>`, so a write through the API (the rig's resetDoc) can point at
 * it without an upload. Images carry their size in the id too; none is seeded.
 */
export function sanityAsset({_sanityAsset, ...rest}) {
  if (!_sanityAsset.startsWith('file@')) throw new Error(`only seeded files map: ${_sanityAsset}`)
  const file = fileOf(_sanityAsset)
  const sha1 = createHash('sha1').update(readFileSync(file)).digest('hex')
  return {...rest, asset: {_type: 'reference', _ref: `file-${sha1}-${file.pathname.split('.').pop()}`}}
}
