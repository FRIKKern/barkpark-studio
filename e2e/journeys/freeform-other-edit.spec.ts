import {expect, test} from '@playwright/test'
import {resetNative, target} from '../rig/targets'

// D22 (Freeform, ours only), after Barkdown's agent-edit row: an agent (another API
// client) adds a paragraph to a note that is open. The canvas shows it with who made
// it and an Undo; one click takes the paragraph out on the server too.
const ID = 'note-04'
const PAPER = 'paper-05'
const docUrl = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}/v1/data/doc/${process.env.BARKPARK_DATASET}/note/${ID}`
const auth = {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}
const server = async () => ((await (await fetch(`${docUrl}?perspective=drafts`, {headers: auth})).json()) as {result: {_rev: string; blocks: {id: string}[]}}).result
const agentAppends = async (text: string) => {
  const {_rev} = await server()
  const block = {id: `agent-${Date.now().toString(36)}`, type: 'paragraph', content: [{type: 'text', value: text}]}
  const res = await fetch(`${docUrl}/ops`, {method: 'POST', headers: {...auth, 'content-type': 'application/json'}, body: JSON.stringify({ops: [{op: 'append-block', block}], ifRev: _rev})})
  expect(res.ok, await res.text()).toBe(true)
}
test.afterEach(async ({}, info) => {
  if (target(info).name === 'studio') await Promise.all([resetNative(ID, 'note'), resetNative(PAPER, 'paper')])
})

test("@local D22: another writer's edit to an open doc is shown, and Undo takes it out in one click", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const seeded = (await server()).blocks.map((b) => b.id)
  await page.goto(t.docPath('note', ID))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  await expect(canvas).toContainText('Written by the author.', {timeout: 20_000})

  await agentAppends('Added by the agent.')
  await expect(canvas).toContainText('Added by the agent.', {timeout: 10_000})
  const row = page.locator('[data-other-edit]')
  await expect(row).toContainText(/Edited by \S+/)
  await page.screenshot({path: 'evidence/D22-edited-studio.png'})

  await row.getByRole('button', {name: 'Undo'}).click()
  await expect.poll(async () => (await server()).blocks.map((b) => b.id), {timeout: 10_000}).toEqual(seeded)
  await expect(canvas).not.toContainText('Added by the agent.')
  await expect(row).toHaveCount(0)
  await expect(page.locator('.pd-status')).toHaveText('Saved')
  await page.screenshot({path: 'evidence/D22-undone-studio.png'})
})

// The same on a paper: its ops route names the writer in history now (Barkpark #22345).
test("@local D22: on a paper too, the other writer is named, and Undo takes their block out", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no Freeform')
  const base = `${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/${process.env.BARKPARK_PROJECT || 'default'}`
  const read = async () => ((await (await fetch(`${base}/v1/data/doc/${process.env.BARKPARK_DATASET}/paper/${PAPER}?perspective=drafts`, {headers: auth})).json()) as {result: {rev: number; blocks: {id: string}[]}}).result
  const seeded = (await read()).blocks.map((b) => b.id)
  await page.goto(t.docPath('paper', PAPER))
  await t.settle(page)
  const canvas = page.locator('bp-paper-canvas')
  await expect(canvas).toContainText('before anyone else touched', {timeout: 20_000})

  const block = {id: `agent-${Date.now().toString(36)}`, type: 'paragraph', content: [{type: 'text', value: 'An agent added this.'}]}
  const res = await fetch(`${base}/v1/papers/${PAPER}/ops?dataset=${process.env.BARKPARK_DATASET}`, {method: 'POST', headers: {...auth, 'content-type': 'application/json'}, body: JSON.stringify({ops: [{op: 'append-block', block}], ifRev: (await read()).rev})})
  expect(res.ok, await res.text()).toBe(true)
  await expect(canvas).toContainText('An agent added this.', {timeout: 10_000})
  const row = page.locator('[data-other-edit]')
  await expect(row).toContainText(/Edited by \S+/)
  await row.getByRole('button', {name: 'Undo'}).click()
  await expect.poll(async () => (await read()).blocks.map((b) => b.id), {timeout: 10_000}).toEqual(seeded)
  await expect(canvas).not.toContainText('An agent added this.')
})
