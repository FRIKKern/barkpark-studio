import AxeBuilder from '@axe-core/playwright'
import {expect, test, type Page} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

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

test.afterEach(async ({}, info) => target(info).restore(ID, {title: TITLE}))

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
