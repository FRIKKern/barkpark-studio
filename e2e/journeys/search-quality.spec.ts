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
  'sq-ordtak': {title: 'Ordtak', excerpt: 'Ærlighet varer lengst.'},
  'sq-arsrapport': {title: 'Årsrapport for selskapet', excerpt: 'Tall og tekst.'},
  'sq-okonomi-exact': {title: 'Okonomi og kurs', excerpt: 'Skrevet uten ø.'},
}
const QUERIES = process.env.SQ_QUERIES ? JSON.parse(process.env.SQ_QUERIES) as string[] : ['kaffe', 'kaff', 'kafe', 'Ærlig', 'ærlig', 'aerlig', 'økonomi', 'okonomi', '2026', 'rapport 20', 'quick brown', '"quick brown"', 'Lovelace', 'sq-fox']

// Where ours still differs from Sanity, on purpose (task-9ec63e76, 2026-10-10 side by side):
// - Numbers: both prefix-match ("20" finds "2000…" and "Fixture post 20"). The lists differ
//   because the reference's dataset holds the 2,000 bulk items and ours does not.
// - Ties: equal-score docs come oldest first. Sanity's own order among them follows no
//   rule we could see: "fox" puts the older doc first, while "brown fox quick" and "quick dog" put
//   the newer one first, and "quick dog" ranks it over a doc that also matches "dog".
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
  // At once, not one by one: CI's budget (seeding was 7 s of this spec's 19).
  await Promise.all(Object.entries(DOCS).map(([id, d]) => t.draftOnly(id, 'post', {title: d.title, excerpt: d.excerpt, ...(d.author && {author: t.ref(d.author)})})))
})
test.afterAll(async ({}, info) => {
  const t = target(info)
  await Promise.all(Object.keys(DOCS).map((id) => t.deleteDoc(id, 'post')))
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

// Titles fold æøå (Barkpark #22703): "aerlig" finds "Ærlig" as on Sanity, and "okonomi" and
// "aarsrapport" find "Økonomi" and "Årsrapport" where Sanity finds nothing (more, never
// fewer); the title as typed ranks first. Body text matches as written, as on Sanity.
const FOLDS: [string, string[], string][] = [
  ['aerlig', ['Ærlig talt om økonomi'], 'Ordtak'],
  ['aerlighet', [], 'Ordtak'],
  ['okonomi', ['Okonomi og kurs', 'Ærlig talt om økonomi'], ''],
  ['aarsrapport', ['Årsrapport for selskapet'], ''],
]
// Ids, as Sanity's search reads them (2026-10-10 side by side): a dot stays in the word,
// so a draft-only doc is found by "drafts.sq-fox" and not by "sq-fox".
const IDS: [string, string[], string][] = [
  ['drafts.sq-fox', ['The quick brown fox', 'Fox brown quick'], ''],
  ['sq-fox', [], ''],
  // Any word, as Sanity (Barkpark's own default since #23174 is every word).
  ['fox dog', ['The quick brown fox', 'Fox brown quick'], ''],
]
// One search dialog for all of them (CI's budget: a page load each was 11 s).
test('a search folds æøå in titles, the exact spelling first, and matches ids as Sanity does', async ({page, context}, info) => {
  // Six searches in a row: on a loaded CI box one Barkpark search took 6.3 s (main's
  // ci-2, run 38328314136: the right results, but after the 15 s test budget). It
  // guards which docs come back, not how fast; speed is J38's F-numbers.
  test.setTimeout(45_000)
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
  // The ids' two docs tie, and a tie comes oldest first: seeded at once, either can be
  // older (main's ci-3, after #523), so for them only which docs come back counts.
  for (const [q, want, none, ordered] of [...FOLDS.map((c) => [...c, true] as const), ...IDS.map((c) => [...c, false] as const)]) {
    await page.getByRole('combobox').first().fill(q)
    // Every 100 ms, not the default backoff: a list that settles just after a 1 s check
    // waited out the next one (about 0.5 s a query).
    if (!want.length) await expect.poll(() => dialog(page).getByText('No results found').isVisible(), {message: q, timeout: 10_000, intervals: [100]}).toBe(true)
    else await expect.poll(async () => (await dialog(page).getByRole('option').allInnerTexts()).map((s) => s.split('\n')[0].trim()).filter((s) => want.includes(s)).sort((a, b) => (ordered ? 0 : a.localeCompare(b))), {message: q, timeout: 10_000, intervals: [100]}).toEqual(ordered ? want : [...want].sort((a, b) => a.localeCompare(b)))
    if (none) await expect(dialog(page).getByRole('option').filter({hasText: none}), q).toHaveCount(0)
  }
})
