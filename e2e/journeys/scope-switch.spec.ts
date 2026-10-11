import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// B02 (Barkpark-native, ours only), after LiveView's switcher: the navbar names the
// workspace / project / dataset; switching opens the same tool in the other dataset, its
// URL carrying it (/w/<ws>/p/<project>/d/<dataset>/…), and links, a reload and a pane
// opened there keep it. Switching back returns. Read-only: it writes nothing.
test('@local B02: switch dataset; the URL carries it through links and a reload', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'Barkpark-native: Sanity switches workspaces, not datasets')
  const here = process.env.BARKPARK_DATASET!
  await page.goto(t.listPath('post'))
  await t.settle(page)
  const button = page.getByRole('button', {name: /^Workspace .* Switch$/})
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${here}\\.`))
  await button.click()
  const dialog = page.getByRole('dialog', {name: 'Switch workspace, project or dataset'})
  const datasets = dialog.getByRole('combobox', {name: 'Dataset'})
  await expect.poll(() => datasets.locator('option').count()).toBeGreaterThan(1) // the list has loaded
  await expect(datasets.locator('option', {hasText: here})).toHaveCount(1)
  const there = (await datasets.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).find((v) => v.startsWith('e2e-') && v !== process.env.BARKPARK_DATASET)!
  await datasets.selectOption(there)
  await dialog.getByRole('button', {name: 'Switch'}).click()
  await page.waitForURL(new RegExp(`/w/[^/]+/p/[^/]+/d/${there}/structure$`))
  await t.settle(page)
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${there}\\.`))

  // Links and panes keep the scope; so does a reload of a deep URL.
  await page.locator('[data-pane="types"] .type-row', {hasText: /^Post$/}).click()
  const row = page.getByTestId('pane-item').first()
  await expect(row).toHaveAttribute('href', new RegExp(`^/w/[^/]+/p/[^/]+/d/${there}/structure/post;`))
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/d/${there}/structure/post;`))
  await page.reload()
  await t.settle(page)
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${there}\\.`))
  await expect(page.locator('[data-pane-index="2"]')).toBeVisible()
  await page.screenshot({path: 'evidence/B02-1-switched-studio.png'})

  // And back.
  await button.click()
  await dialog.getByRole('combobox', {name: 'Dataset'}).selectOption(here)
  await dialog.getByRole('button', {name: 'Switch'}).click()
  await page.waitForURL(new RegExp(`/d/${here}/structure$`))
  await t.settle(page)
  await expect(button).toHaveAttribute('aria-label', new RegExp(`dataset ${here}\\.`))
})
