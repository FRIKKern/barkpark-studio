import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

// B02 (Barkpark-native, ours only), after LiveView's switcher: the navbar names the
// workspace / project / dataset; switching opens the same tool in the other dataset, its
// URL carrying it (/w/<ws>/p/<project>/d/<dataset>/…), with the open panes that exist
// there (a doc that doesn't closes; its list stays), and links and a reload keep it.
// Read-only: it writes nothing.
test('@local B02: switch dataset; the URL carries it through links and a reload', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity switches workspaces, not datasets')
  const here = process.env.BARKPARK_DATASET!
  await page.goto(t.docPath('post', 'post-02'))
  await t.settle(page)
  const button = page.getByRole('button', {name: /^Workspace .* Switch$/})
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${here}\\.`))
  await button.click()
  const dialog = page.getByRole('dialog', {name: 'Switch workspace, project or dataset'})
  // A click outside closes it, as Sanity's workspace menu.
  await page.mouse.click(900, 600)
  await expect(dialog).toHaveCount(0)
  await button.click()
  // Sanity's workspace list: one row a place, where you are checked, one click to go.
  // Where you are comes first: its workspace and project's datasets (a dataset name may recur elsewhere).
  const place = (ds: string) => dialog.locator('section').first().locator('.scope-place').filter({has: page.locator('.scope-place-title', {hasText: new RegExp(`^${ds}$`)})})
  await expect(place(here)).toHaveAttribute('aria-current', 'true')
  const there = (await dialog.locator('section').first().locator('.scope-place-title').allTextContents()).find((v) => v.startsWith('e2e-') && v !== here)!
  await place(there).click()
  // The same panes, there: the post list and post-02 (every lane dataset has the fixtures).
  await page.waitForURL(new RegExp(`/w/[^/]+/p/[^/]+/d/${there}/structure/post;post-02$`))
  await t.settle(page)
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${there}\\.`))
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 02')

  // Links and panes keep the scope; so does a reload of a deep URL.
  const row = page.getByTestId('pane-item').first()
  await expect(row).toHaveAttribute('href', new RegExp(`^/w/[^/]+/p/[^/]+/d/${there}/structure/post;`))
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/d/${there}/structure/post;`))
  await page.reload()
  await t.settle(page)
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${there}\\.`))
  await expect(page.locator('[data-pane-index="2"]')).toBeVisible()
  await page.screenshot({path: 'evidence/B02-1-switched-studio.png'})

  // And back, from a doc that isn't here: it closes, its list stays.
  await page.goto(page.url().replace(/structure\/.*$/, 'structure/post;b02-not-in-any-dataset'))
  await t.settle(page)
  await button.click()
  await place(here).click()
  await page.waitForURL(new RegExp(`/d/${here}/structure/post$`))
  await t.settle(page)
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${here}\\.`))
})

// The list's scroll-to-current effect returned scrollIntoView's Promise (Chrome now returns
// one), which React called as the cleanup on close: "destroy is not a function", the error screen.
test('B02: the switcher opens on its list and closes without an error', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity switches workspaces, not datasets')
  const bad: string[] = []
  page.on('pageerror', (e) => bad.push(e.message))
  page.on('console', (m) => m.type() === 'error' && /must not return anything besides a function/.test(m.text()) && bad.push(m.text()))
  await page.goto(t.listPath('post'))
  await t.settle(page)
  const button = page.getByRole('button', {name: /^Workspace .* Switch$/})
  const dialog = page.getByRole('dialog', {name: 'Switch workspace, project or dataset'})
  await button.click()
  await expect(dialog.locator('.scope-place[aria-current="true"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', {name: 'An error occurred'})).toHaveCount(0)
  expect(bad).toEqual([])
})
