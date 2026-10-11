#!/usr/bin/env node
// A lease on one of the CI datasets, so e2e runs from several PRs share a pool instead
// of a GitHub concurrency group per dataset: such a group keeps one pending job and
// cancels the one before it, so a third PR in flight cancelled the second's shards.
// Now a shard takes any free dataset of the pool (its own first) and waits in the job
// for one to free; nothing is cancelled. Leases live in Barkpark's `ci-locks` dataset as
// `lease-<dataset>` documents: `create` refuses one that exists (409), so taking is atomic;
// a lease past its `until` (a job killed before releasing) is taken over with a fenced
// delete (ifRevisionID). Only these non-production datasets are ever leased.
//
//   node scripts/ci-lease.mjs acquire <preferred dataset>   # prints the dataset; in Actions also sets BARKPARK_DATASET
//   node scripts/ci-lease.mjs release [dataset]             # frees it if this holder still holds it
// Env: BARKPARK_URL, BARKPARK_WORKSPACE, BARKPARK_PROJECT, BARKPARK_TOKEN; CI_LEASE_HOLDER (default: the run + shard, or this process).
import {appendFileSync} from 'node:fs'

export const POOL = ['ci', 'ci-2', 'ci-3', 'ci-4', 'ci-5', 'ci-b-1', 'ci-b-2', 'ci-b-3', 'ci-b-4', 'ci-b-5']
const LOCKS = 'ci-locks'
const TTL_MS = 15 * 60_000 // a shard's whole job, waiting aside, is well under this
const POLL_MS = 10_000

const env = (k) => process.env[k] ?? (k === 'BARKPARK_PROJECT' ? 'default' : fail(`missing env ${k}`))
const base = () => `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE')}/p/${env('BARKPARK_PROJECT')}/v1/data`
const headers = () => ({authorization: `Bearer ${env('BARKPARK_TOKEN')}`, 'content-type': 'application/json'})
const mutate = (mutation) => fetch(`${base()}/mutate/${LOCKS}`, {method: 'POST', headers: headers(), body: JSON.stringify({mutations: [mutation]})})
const read = async (dataset) => {
  const res = await fetch(`${base()}/doc/${LOCKS}/ciLease/drafts.lease-${dataset}`, {headers: headers()})
  return res.ok ? ((await res.json()).result) : null
}
function fail(message) {
  console.error(`ci-lease: ${message}`)
  process.exit(1)
}
export const holderOf = () =>
  process.env.CI_LEASE_HOLDER ?? (process.env.GITHUB_RUN_ID ? `run ${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT} ${process.env.GITHUB_JOB}` : `local ${process.pid}`)

/** Take one dataset of the pool, `prefer` first; wait (up to `waitMs`) while all are held. */
export async function acquire({prefer, holder = holderOf(), waitMs = 25 * 60_000}) {
  const order = [prefer, ...POOL.filter((d) => d !== prefer)].filter((d) => POOL.includes(d))
  const deadline = Date.now() + waitMs
  for (let round = 0; ; round++) {
    for (const dataset of order) {
      const res = await mutate({create: {_id: `lease-${dataset}`, _type: 'ciLease', holder, until: Date.now() + TTL_MS}})
      if (res.ok) return dataset
      if (res.status !== 409) fail(`lease ${dataset}: Barkpark answered ${res.status} ${(await res.text()).slice(0, 200)}`)
      // Held. A lease past its time belongs to a job that died: take it over, fenced on its rev.
      const lease = await read(dataset)
      if (lease && Number(lease.until) < Date.now()) {
        await mutate({delete: {id: `lease-${dataset}`, type: 'ciLease', ifRevisionID: lease._rev}})
        const again = await mutate({create: {_id: `lease-${dataset}`, _type: 'ciLease', holder, until: Date.now() + TTL_MS}})
        if (again.ok) return (console.error(`ci-lease: took over ${dataset} from a lapsed lease (${lease.holder})`), dataset)
      }
    }
    if (Date.now() > deadline) fail(`no CI dataset free after ${waitMs / 60_000} min`)
    if (round % 6 === 0) console.error(`ci-lease: all ${POOL.length} CI datasets are in use; waiting…`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

/** Free `dataset` if `holder` still holds it (a lapsed lease taken over by another job stays theirs). */
export async function release({dataset, holder = holderOf()}) {
  const lease = await read(dataset)
  if (!lease || lease.holder !== holder) return false
  const res = await mutate({delete: {id: `lease-${dataset}`, type: 'ciLease', ifRevisionID: lease._rev}})
  return res.ok
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [verb, dataset] = process.argv.slice(2)
  if (verb === 'acquire') {
    const got = await acquire({prefer: dataset ?? 'ci'})
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `BARKPARK_DATASET=${got}\nCI_LEASE_HOLDER=${holderOf()}\n`)
    console.log(got)
  } else if (verb === 'release') {
    const which = dataset ?? process.env.BARKPARK_DATASET
    if (which && POOL.includes(which)) console.log((await release({dataset: which})) ? `released ${which}` : `${which}: not ours to release`)
  } else fail('usage: ci-lease.mjs acquire <preferred dataset> | release [dataset]')
}
