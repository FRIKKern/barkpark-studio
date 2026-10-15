import {expect, test} from '@playwright/test'
import {bpBase, bpDataset, bpMutate, signInIfAsked, target} from '../rig/targets'

// J49, Sanity's Viewer comments: a read-only editor (studio-editor-d, dev sign-in) adds a
// comment, resolves and re-opens it, while the form stays locked; deleting stays an
// editor's. Barkpark lets a read seat write studioComment when its schema opts in
// (readerWrites, barkpark #22790; fixtures/barkpark-schema/studioComment.json).
const auth = () => ({authorization: `Bearer ${process.env.BARKPARK_TOKEN}`})

test('@local J49: a viewer comments, resolves and re-opens; the form stays locked', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity' || process.env.STUDIO_DEV_LOGIN !== '1', 'ours, with dev sign-in (the read-only editor d)')
  const schemas = (await (await fetch(`${bpBase()}/v1/schemas/${bpDataset()}`, {headers: auth()})).json()) as {schemas: {name: string; readerWrites?: {create?: boolean}}[]}
  test.skip(!schemas.schemas.find((s) => s.name === 'studioComment')?.readerWrites?.create, "this dataset's comment schema doesn't let viewers comment (push the fixtures' schemas)")
  const text = `J49 viewer ${Date.now().toString(36)}`
  try {
    await t.prepare(context)
    await page.goto(t.docPath('post', 'post-05'))
    await signInIfAsked(page, 'studio-editor-d@example.com')
    await t.settle(page)
    await expect(t.field(page, 'title')).toBeDisabled()
    const field = page.locator('.field:has([id="title"])')
    await field.hover()
    await field.getByRole('button', {name: 'Add comment'}).click()
    await page.getByRole('textbox', {name: 'Add comment to Title'}).fill(text)
    await page.keyboard.press('Enter')
    const panel = page.getByRole('complementary', {name: 'Comments'})
    await expect(panel.locator('.comment-item', {hasText: text}).locator('.comment-meta strong')).toHaveText('studio-editor-d')
    await panel.getByRole('button', {name: 'Mark comment as resolved'}).click()
    await expect(panel.getByText('No open comments yet')).toBeVisible()
    await panel.getByRole('button', {name: 'Open', exact: true}).click()
    await page.getByRole('menuitemradio', {name: 'Resolved comments'}).click()
    await panel.getByRole('button', {name: 'Re-open'}).click()
    await expect(panel.getByText('No resolved comments yet')).toBeVisible()
    await panel.getByRole('button', {name: 'Resolved', exact: true}).click()
    await page.getByRole('menuitemradio', {name: 'Open comments'}).click()
    // Deleting stays an editor's (Barkpark refuses a read seat's delete).
    await panel.getByRole('button', {name: 'Open comment actions menu'}).first().click()
    await expect(page.getByRole('menuitem', {name: 'Delete comment'})).toBeDisabled()
    await expect(t.field(page, 'title')).toBeDisabled()
  } finally {
    const found = await fetch(`${bpBase()}/v1/data/query/${bpDataset()}/studioComment?perspective=drafts&filter[message]=${encodeURIComponent(text)}`, {headers: auth()})
    const ids = found.ok ? ((await found.json()) as {result: {documents: {_publishedId: string}[]}}).result.documents.map((d) => d._publishedId) : []
    if (ids.length) await bpMutate(ids.map((id) => ({delete: {id, type: 'studioComment'}})))
  }
})
