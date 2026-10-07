import {expect, type Locator, type Page} from '@playwright/test'

// Review footage needs a readable hold after real content arrives. These waits
// only apply to reference recordings, never to CI or performance measurements.
export async function referenceHold(page: Page, ready: Locator, value?: string) {
  if (!process.env.REFERENCE_RUN_ID) return
  await expect(ready).toBeVisible({timeout: 15_000})
  if (value !== undefined) await expect(ready).toHaveValue(value, {timeout: 15_000})
  await expect(page.locator('[data-ui$="Skeleton"]:visible')).toHaveCount(0, {timeout: 30_000})
  await page.waitForTimeout(2000)
}
