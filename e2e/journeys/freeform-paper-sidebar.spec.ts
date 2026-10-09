import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {target, closeAndSettle} from '../rig/targets'

// D12 (Freeform side track, ours only): paper-01's metadata sidebar, after Barkpark's
// LiveView Studio. Open it from the pane header (URL keeps it, focus moves in); slug
// format feedback; the description and the weighted tags (strongest first, main tag
// marked; add with the publish wall's rules, remove) save as doc fields and never touch
// a block; a publish the wall refuses says which rule broke; on a phone it covers the
// doc; Close hands focus back. Stills in e2e/evidence/D12-*.
const ID = 'paper-01'
const SEED = JSON.parse(readFileSync(new URL('../../fixtures/barkpark-only.ndjson', import.meta.url), 'utf8').split('\n').find((l) => l.includes(`"${ID}"`))!) as Record<string, unknown>
type Tag = {tag: string; strength: number; rationale: string}
test.afterEach(async ({page}, info) => {
  await closeAndSettle(page)
  const t = target(info)
  if (t.name === 'studio') await t.restore(ID, {description: SEED.description, tags: SEED.tags, main_tag: SEED.main_tag}, 'paper')
})

test('@local D12: paper sidebar — slug, description, weighted tags; the wall says why', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-only: Sanity has no papers')
  test.setTimeout(60_000)
  const value = (field: string) => t.docValue(ID, field, 'paper')
  const blocks = JSON.stringify(await value('blocks'))
  await page.goto(t.docPath('paper', ID))
  await t.settle(page)
  await page.getByRole('button', {name: 'Document metadata'}).click()
  const side = page.getByRole('complementary', {name: 'Document metadata'})
  await expect(side).toBeFocused()
  expect(page.url()).toContain(`;${ID},inspect=meta`)
  await expect(side.locator('.paper-facts')).toContainText('Public')

  // Slug: checked as typed, not saved.
  const slug = side.getByLabel('Slug')
  await slug.fill('Paper 01')
  await expect(side.locator('#paper-slug-fb')).toHaveText('Lowercase only — no capitals')
  await slug.fill('paper-01')
  await expect(side.locator('#paper-slug-fb')).toHaveText('Looks good')

  // Labels: strongest first, the main tag marked.
  const names = side.locator('.paper-tags li .paper-tag-name')
  await expect(names).toHaveText([/^studio\s*main\s*85/, /^portabledoc\s*60/])
  // Remove one; add it back stronger: refused with the wall's words, then accepted.
  await side.getByRole('button', {name: 'Remove label portabledoc'}).click()
  await expect(names).toHaveText([/^studio\s*main\s*85/])
  await side.getByLabel('Tag name').fill('portabledoc')
  await side.getByLabel('Tag strength, 1 to 100').fill('90')
  await side.getByLabel('Tag rationale').fill('too short')
  await side.getByLabel('Tag rationale').press('Enter')
  await expect(side.getByRole('alert')).toHaveText(/at least 20 characters/)
  await side.getByLabel('Tag rationale').fill('the body is one PortableDoc block list')
  await side.getByLabel('Tag rationale').press('Enter')
  await expect(names).toHaveText([/^portabledoc\s*90/, /^studio\s*main\s*85/])
  await expect.poll(async () => ((await value('tags')) as Tag[]).map((x) => `${x.tag}:${x.strength}`), {timeout: 10_000}).toEqual(['studio:85', 'portabledoc:90'])

  // Description: saved as typed; too short for the wall, which says so on Publish.
  const description = side.getByRole('textbox', {name: 'Description'})
  await description.fill('Too short.')
  await expect(side.getByText('Publishing needs a description of at least 20 characters.')).toBeVisible()
  await expect.poll(() => value('description'), {timeout: 10_000}).toBe('Too short.')
  expect(JSON.stringify(await value('blocks')), 'no sidebar edit touches a block').toBe(blocks)
  await page.screenshot({path: 'evidence/D12-1-sidebar-studio.png'})
  await page.locator('button.publish').click()
  await expect(page.locator('.toast')).toContainText('A description must be non-trivial (at least 20 characters).')
  await page.screenshot({path: 'evidence/D12-2-wall-studio.png'})

  // Phone: the sidebar covers the doc; Close gives focus back to the header button.
  await page.setViewportSize({width: 390, height: 844})
  await expect.poll(async () => (await side.boundingBox())?.width).toBeGreaterThan(380)
  await page.screenshot({path: 'evidence/D12-3-phone-studio.png'})
  await side.getByRole('button', {name: 'Close document metadata'}).click()
  await expect(side).toBeHidden()
  await expect(page.getByRole('button', {name: 'Document metadata'})).toBeFocused()
})
