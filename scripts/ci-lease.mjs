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
import {isTransient} from './lib/retry.mjs'

// One run at a time for now: two at once (ten shards against one Barkpark) slowed every
// spec enough to push shards past CI's 60 s budget (2026-10-12, three PRs red at 16:09).
// The second pool is seeded and ready; CI_LEASE_POOL=wide turns it on once the shards
// have room (more shards, or a token of its own).
const FIRST = ['ci', 'ci-2', 'ci-3', 'ci-4', 'ci-5', 'ci-6']
const SECOND = ['ci-b-1', 'ci-b-2', 'ci-b-3', 'ci-b-4', 'ci-b-5']
export const POOL = process.env.CI_LEASE_POOL === 'wide' ? [...FIRST, ...SECOND] : FIRST
const LOCKS = 'ci-locks'
const TTL_MS = 15 * 60_000 // a shard's whole job, waiting aside, is well under this
const POLL_MS = 15_000

const env = (k) => process.env[k] ?? (k === 'BARKPARK_PROJECT' ? 'default' : fail(`missing env ${k}`))
const base = () => `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE')}/p/${env('BARKPARK_PROJECT')}/v1/data`
const headers = () => ({authorization: `Bearer ${env('BARKPARK_TOKEN')}`, 'content-type': 'application/json'})
// Every call shares the CI token's rate budget with the running shards: a 429 waits the
// Retry-After and asks again, never fails the job.
// A connection dropped before the answer (a Barkpark deploy flip: ECONNRESET freeing a dataset,
// 2026-10-16) is asked again when sending twice is harmless: a read, or a delete. A lease create
// is not: its lost answer and a second create would look like someone else's lease.
async function call(url, init) {
  for (let dropped = 0; ; ) {
    let res
    try {
      res = await fetch(url, {...init, headers: headers()})
    } catch (error) {
      if (dropped++ < 2 && isTransient({error}) && sameTwice(init)) continue
      throw error
    }
    if (res.status !== 429) return res
    const wait = Number(res.headers.get('retry-after')) || 2
    await new Promise((r) => setTimeout(r, (wait + Math.random()) * 1000))
  }
}
const sameTwice = (init = {}) => !init.method || init.method === 'GET' || (init.body && JSON.parse(init.body).mutations.every((m) => 'delete' in m))
const mutate = (mutation) => call(`${base()}/mutate/${LOCKS}`, {method: 'POST', body: JSON.stringify({mutations: [mutation]})})
const read = async (dataset) => {
  const res = await call(`${base()}/doc/${LOCKS}/ciLease/drafts.lease-${dataset}`)
  return res.ok ? ((await res.json()).result) : null
}
/** Every lease, in one read (waiting shards poll this, not a create per dataset). */
const leases = async () => {
  const res = await call(`${base()}/query/${LOCKS}/ciLease?perspective=raw&limit=100`)
  if (!res.ok) return null
  const docs = ((await res.json()).result?.documents ?? [])
  return new Map(docs.map((d) => [String(d._publishedId ?? d._id).replace(/^drafts\./, '').replace(/^lease-/, ''), d]))
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
    // One read for all; a create only where the dataset looks free (or its lease has lapsed).
    const held = await leases()
    for (const dataset of order) {
      const lease = held?.get(dataset)
      if (lease && Number(lease.until) >= Date.now()) continue
      if (lease) await mutate({delete: {id: `lease-${dataset}`, type: 'ciLease', ifRevisionID: lease._rev}}) // lapsed: a job that died
      const res = await mutate({create: {_id: `lease-${dataset}`, _type: 'ciLease', holder, until: Date.now() + TTL_MS}})
      if (res.ok) return (lease && console.error(`ci-lease: took over ${dataset} from a lapsed lease (${lease.holder})`), dataset)
      // Taken meanwhile: 409, or 422 "doc_id has already been taken" when two creates race.
      const body = await res.text()
      if (res.status !== 409 && !(res.status === 422 && body.includes('already been taken'))) fail(`lease ${dataset}: Barkpark answered ${res.status} ${body.slice(0, 200)}`)
    }
    if (Date.now() > deadline) fail(`no CI dataset free after ${waitMs / 60_000} min`)
    if (round % 6 === 0) console.error(`ci-lease: all ${POOL.length} CI datasets are in use; waiting…`)
    await new Promise((r) => setTimeout(r, POLL_MS * (0.75 + Math.random() / 2)))
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
