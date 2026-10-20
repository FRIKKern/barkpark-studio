import AxeBuilder from '@axe-core/playwright'
import {expect, test, type Page} from '@playwright/test'
import {seededCount, signInIfAsked, target, closeAndSettle} from '../rig/targets'

// F13, axe (WCAG 2.1 A + AA) on the J01–J04 screens, both studios: the list,
// an open post, the post with a draft, and the Discard changes confirm. Ours must
// have zero violations; Sanity's count is recorded next to it. Evidence run; the
// CI check is the fast test below.
const ID = 'post-16'
const TITLE = 'Fixture post 16'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const scan = async (page: Page) => {
  const {violations} = await new AxeBuilder({page}).withTags(TAGS).analyze()
  return violations.map((v) => ({id: v.id, impact: v.impact, nodes: v.nodes.length, where: v.nodes.slice(0, 3).map((n) => n.target.join(' '))}))
}

test.afterEach(async ({page}, info) => (await closeAndSettle(page), target(info).restore(ID, {title: TITLE})))

test('@evidence F13: axe on the J01–J04 screens', async ({page}, info) => {
  const t = target(info)
  const record = (screen: string, v: Awaited<ReturnType<typeof scan>>) => {
    info.annotations.push({type: `${screen}: ${v.length} violations`, description: JSON.stringify(v)})
    return v
  }
  await t.prepare(page.context())
  await page.goto('/structure/post')
  await signInIfAsked(page)
  await t.settle(page)
  await expect(t.listItem(page, ID)).toBeVisible()
  const all = [record('J01 list', await scan(page))]

  await t.listItem(page, ID).click()
  await expect(t.field(page, 'title')).toHaveValue(TITLE)
  all.push(record('J02 open post', await scan(page)))

  await t.field(page, 'title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' a11y')
  await expect.poll(() => t.versions(ID), {timeout: 10_000}).toMatchObject({draft: `${TITLE} a11y`})
  all.push(record('J03 draft', await scan(page)))

  await (t.name === 'sanity' ? page.locator('[data-testid="action-menu-button"]').last() : page.getByRole('button', {name: 'Document actions'}).last()).click()
  if (t.name === 'sanity') await page.waitForTimeout(400)
  await page.getByRole('menuitem', {name: /Discard changes/}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  all.push(record('J04 discard confirm', await scan(page)))

  if (t.name === 'studio') expect(all.flat(), 'axe violations on our J01–J04 screens').toEqual([])
})

test('@local J47: the list, a list search and validation are announced', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Sanity announces none of these; the check runs on ours')
  await t.prepare(page.context())
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  const heard = page.getByTestId('announcer')
  // The announcer sits inside the page: the page itself never scrolls, as Sanity's.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(await page.evaluate(() => innerHeight))
  await page.locator('a[href="/structure/post"]').click()
  await expect(heard).toHaveText(`Post, ${await seededCount(t, 'post')} documents`)
  await expect(page.getByRole('region', {name: 'Post'})).toBeVisible()
  await page.getByRole('combobox', {name: 'Search list'}).fill('zzzz')
  await expect(heard).toHaveText('No results found')
  await page.getByRole('combobox', {name: 'Search list'}).fill('')
  await t.listItem(page, ID).click()
  await expect(page.getByRole('region', {name: TITLE})).toBeVisible()
  try {
    await t.field(page, 'title').fill('')
    await expect(heard).toHaveText('1 validation error. Title: Required. Publishing is blocked.')
  } finally {
    await t.restore(ID, {title: TITLE})
  }
})

test('@local forced colors: fields keep a box, the checkbox its state, focus a ring', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Sanity loses its field boxes and radio dots in forced colors; the check runs on ours')
  await page.emulateMedia({forcedColors: 'active'})
  await t.prepare(page.context())
  await page.goto(t.docPath('fieldTypes', 'field-types-01'))
  await signInIfAsked(page)
  await t.settle(page)
  const style = (sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
  // Box-shadow edges and fills are dropped in forced colors: an outline, or our own system colours.
  expect(await style('[id="title"]', 'outline-style')).toBe('solid')
  expect(await style('input.checkbox', 'forced-color-adjust')).toBe('none')
  await page.locator('[id="title"]').focus()
  expect(await style('[id="title"]', 'outline-width')).toBe('2px')
  // And axe finds nothing in that mode either.
  expect(await scan(page)).toEqual([])
})

// A field with an error says so to a screen reader (scout-6): aria-invalid on its input, the
// problem as its description, and its name the title alone (the mark's words once read as
// part of it). Fixed, it is valid again.
test('a11y: an errored field is aria-invalid, its problem the description, its name the title', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's input carries none of these")
  await t.prepare(page.context())
  await page.goto(t.docPath('post', ID))
  await signInIfAsked(page)
  await t.settle(page)
  const title = t.field(page, 'title')
  await expect(title).not.toHaveAttribute('aria-invalid', 'true')
  await title.fill('')
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAccessibleName('Title')
  await expect(title).toHaveAccessibleDescription('Validation error: Required')
  await title.fill(TITLE)
  await expect(title).not.toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAccessibleDescription('')
  await expect(title).toHaveAccessibleName('Title')
})

// scout-6 (WCAG 4.1.3, 1.3.1): a Vision run's outcome is said, a result and an error alike,
// and Releases, Vision and Media each have one h1, at 1440 and on a phone.
test('a11y: Vision says how a run went; Releases, Vision and Media have one h1', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's Vision says neither, and its tools have no h1")
  await t.prepare(page.context())
  await page.goto('/vision')
  await signInIfAsked(page)
  const heard = page.getByTestId('announcer')
  const query = page.getByRole('textbox', {name: 'Query', exact: true})
  await query.fill('*[_type == "post"][0...3]{title}')
  await page.getByRole('button', {name: 'Fetch'}).click()
  await expect(heard).toHaveText(/^3 results in \d+ ms$/)
  await query.fill('*[_type == "post"')
  await page.getByRole('button', {name: 'Fetch'}).click()
  await expect(heard).toHaveText(/^Query error: /)
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: width < 600 ? 844 : 900})
    for (const tool of ['/releases', '/vision', '/media']) {
      await page.goto(tool)
      await expect(page.getByRole('heading', {level: 1}), `${tool} at ${width}`).toHaveCount(1)
    }
  }
})
