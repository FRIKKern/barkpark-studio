import {expect, test} from '../rig/test'
import {target} from '../rig/targets'

// J67, task-cc6a6d85be054b17: signed in with no seat here, Sanity's request-access screen asks
// for one, shows it pending, withdraws it, says why a request was refused, and an invitation's
// Accept opens the workspace without a reload. Barkpark's asker routes and the seatless person
// are the server's stand-in (server/access-stub.ts, STUDIO_E2E_HOOKS): seats are real, so no
// request, seat or invitation is ever written to Barkpark. Writes nothing to the dataset.
test('no seat: ask, pending, withdraw, a refusal in words, an invitation lets you in', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the stand-in is our server')
  // The page's workspace, as the server sends it (lower case).
  const ws = (process.env.BARKPARK_WORKSPACE ?? '').toLowerCase()
  const access = (body: Record<string, unknown>) => page.request.post('/api/e2e-listen', {data: {action: 'access', ...body}})
  try {
    await access({op: 'on', email: 'ada@example.com'})
    await page.goto('/structure')
    await expect(page.getByRole('heading', {name: 'Request access'})).toBeVisible()
    await expect(page.locator('.access-footer')).toContainText('ada@example.com')

    await page.getByLabel('Message').fill('  I write the newsletter. ')
    await page.getByRole('button', {name: 'Request access'}).click()
    await expect(page.getByRole('heading', {name: 'Access request sent'})).toBeVisible()
    await expect(page.locator('.access-note')).toHaveText('I write the newsletter.')
    const calls = (await (await page.request.get('/api/e2e-listen?access=1')).json()).calls as {method: string; body?: {workspace: string; note?: string}}[]
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts, 'one request, for the page workspace, the note trimmed').toEqual([{method: 'POST', path: '/access-requests', body: {workspace: ws, note: 'I write the newsletter.'}}])

    await page.getByRole('button', {name: 'Withdraw request'}).click()
    await expect(page.getByRole('heading', {name: 'Request access'})).toBeVisible()
    await access({op: 'fail', method: 'POST', status: 429, code: 'rate_limited', retryAfter: 720})
    await page.getByRole('button', {name: 'Request access'}).click()
    await expect(page.getByRole('alert')).toHaveText("You've reached the limit for access requests. Try again in 12 min.")

    await access({op: 'on', email: 'ada@example.com', invitations: [{id: '0b6f8d4e-5f1a-4c3b-9f42-1d2e3f4a5b6c', workspace: ws, workspace_name: 'Studio Parity', role: 'member'}]})
    await page.goto('/structure')
    await expect(page.getByText("You've been invited to join Studio Parity as Member.")).toBeVisible()
    await page.evaluate(() => ((window as unknown as {stayed: boolean}).stayed = true))
    await page.getByRole('button', {name: 'Accept invitation'}).click()
    await expect(page.locator('.request-access')).toHaveCount(0)
    await expect(page.getByRole('navigation').first()).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as {stayed?: boolean}).stayed), 'in without a reload').toBe(true)
  } finally {
    await access({op: 'off'})
  }
})
