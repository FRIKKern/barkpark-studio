import {expect, test} from '@playwright/test'
import {target} from '../rig/targets'

// J03: typing is local-first. Fast typing must never drop a keystroke (a controlled
// input re-rendered from a stale cache does exactly that, silently), the edit must
// land as a draft that survives a reload, and undo works on what was typed.
const ID = 'post-05'
const TITLE = 'Fixture post 05'

test('J03: type in title — nothing dropped, saved as draft, undo works', async ({page}, info) => {
  const t = target(info)
  await t.prepare(page.context())
  try {
    await page.goto(t.docPath('post', ID))
    await t.settle(page)
    const title = t.field(page, 'title')
    await expect(title).toHaveValue(TITLE)
    await title.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' the quick brown fox', {delay: 0})
    await expect(title).toHaveValue(`${TITLE} the quick brown fox`)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(title).not.toHaveValue(`${TITLE} the quick brown fox`)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(title).toHaveValue(`${TITLE} the quick brown fox`)

    await expect(page.getByText(/^Saved$/)).toBeVisible({timeout: 5000})
    await page.reload()
    await expect(t.field(page, 'title')).toHaveValue(`${TITLE} the quick brown fox`)
  } finally {
    await t.restore(ID, {title: TITLE})
  }
})
