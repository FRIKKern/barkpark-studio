import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target, type Target} from '../rig/targets'

// Search quality, both studios, on the same docs: which come back, in what order, and
// how fast, for title vs body matches, prefixes and typos, Norwegian letters, phrases,
// numbers and references by name. Results (titles in order, ms to the first one) go to
// the annotations (SQ_QUERIES='["…"]' asks others; SQ_ALL=1 keeps the fixture docs in the
// lists). Not a CI gate: evidence for J38's quality half. The æ check below is.
const DOCS: Record<string, {title: string; excerpt: string; author?: string}> = {
  'sq-aerlig': {title: 'Ærlig talt om økonomi', excerpt: 'En kort tekst om penger.'},
  'sq-kaffe-title': {title: 'Kaffe og kake', excerpt: 'Noe helt annet.'},
  'sq-kaffe-body': {title: 'Morgennotater', excerpt: 'Først kaffe, så arbeid.'},
  'sq-rapport': {title: 'Rapport 2026', excerpt: 'Årsrapport for selskapet.'},
  'sq-fox': {title: 'The quick brown fox', excerpt: 'It jumps over the dog.'},
  'sq-fox-rev': {title: 'Fox brown quick', excerpt: 'Words in another order.', author: 'author-ada'},
}
const QUERIES = process.env.SQ_QUERIES ? JSON.parse(process.env.SQ_QUERIES) as string[] : ['kaffe', 'kaff', 'kafe', 'Ærlig', 'ærlig', 'aerlig', 'økonomi', 'okonomi', '2026', 'rapport 20', 'quick brown', '"quick brown"', 'Lovelace', 'sq-fox']

const dialog = (page: Page) => page.getByRole('dialog', {name: 'Search'})
const STRUCTURE = new Set(['Post', 'Author', 'Category', 'Longform', 'Bulk', 'Posts by author', 'Content'])
const resultTitles = async (t: Target, page: Page) =>
  (t.name === 'sanity'
    ? await page.locator('a[data-ui="PreviewCard"] [data-testid="default-preview__header"]').allInnerTexts()
    : await dialog(page).getByRole('option').allInnerTexts()
  )
    .map((s) => s.split('\n')[0].trim())
    .filter((s) => s && !STRUCTURE.has(s) && (process.env.SQ_ALL || !/^Fixture|^Bulk|^Untitled/.test(s)))

test.beforeAll(async ({}, info) => {
  const t = target(info)
  for (const [id, d] of Object.entries(DOCS)) await t.draftOnly(id, 'post', {title: d.title, excerpt: d.excerpt, ...(d.author && {author: t.ref(d.author)})})
})
test.afterAll(async ({}, info) => {
  const t = target(info)
  for (const id of Object.keys(DOCS)) await t.deleteDoc(id, 'post')
})

test('@evidence search quality side by side', async ({page, context}, info) => {
  const t = target(info)
  test.setTimeout(300_000)
  await t.prepare(context)
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  await page.waitForTimeout(t.name === 'sanity' ? 4000 : 1500) // the new docs reach each index
  for (const q of QUERIES) {
    await page.keyboard.press('Escape')
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('combobox').first()).toBeFocused({timeout: 1000})
    }).toPass()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(q, {delay: 30})
    const typed = Date.now()
    // Settled: the list as it stands after 6 s; time: when it first looked like that.
    const seen: {at: number; key: string}[] = []
    for (let end = typed + 6000; Date.now() < end; await page.waitForTimeout(80)) {
      const key = JSON.stringify(await resultTitles(t, page))
      if (seen.at(-1)?.key !== key) seen.push({at: Date.now() - typed, key})
    }
    const final = seen.at(-1)!
    const titles = JSON.parse(final.key) as string[]
    const first = titles.length ? final.at : -1
    info.annotations.push({type: `q ${q}`, description: JSON.stringify({ms: first, titles: titles.slice(0, 8)})})
    await page.screenshot({path: `evidence/search-${t.name}-${q.replace(/\W+/g, '_')}.png`})
  }
})

// Sanity folds æ to "ae": "aerlig" finds "Ærlig". Barkpark's index doesn't fold, so ours
// asks it for the æ form too (lib/text-search.ts candidateQuery).
test('a search for "aerlig" finds "Ærlig", as on Sanity', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'the check runs on ours; Sanity is the evidence above')
  await t.prepare(context)
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('combobox').first()).toBeFocused({timeout: 1000})
  }).toPass()
  await page.keyboard.type('aerlig')
  await expect(dialog(page).getByRole('option').filter({hasText: 'Ærlig talt om økonomi'})).toBeVisible({timeout: 10_000})
})
