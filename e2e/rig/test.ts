import {test as base, expect as baseExpect, type Browser, type BrowserContext, type Page} from '@playwright/test'

export * from '@playwright/test'

// expect.poll asks again every 250 ms at most (BACKEND_POLL's steps), not after Playwright's
// 500 ms and 1 s waits: on CI a value that landed just after a try waited up to a second for the
// next one (44 polls on main, 21 s; task-c1df532bed870536). A spec's own intervals still win.
const poll: typeof baseExpect.poll = (generator, options) => baseExpect.poll(generator, {intervals: [100, 250], ...(typeof options === 'string' ? {message: options} : options)})
export const expect = new Proxy(baseExpect, {get: (target, key, receiver) => (key === 'poll' ? poll : Reflect.get(target, key, receiver))})

// Every spec takes `test` from here, not from @playwright/test: a test also fails on an
// uncaught error in any of its pages, or the studio's error screen (StudioError). The
// workspace switcher's crash (#1075) left the error screen up and only an @local run
// saw it; CI's prod build shows no React warning, but the crash and the screen it leaves.
// On dev, React's "an effect must not return anything besides a function" fails it too.
// A test that expects one says so: test('…', allowErrors(/pattern/), async …).

/** What a test expects to go wrong: each pattern matches a problem's text. */
export const allowErrors = (...patterns: RegExp[]) => ({annotation: patterns.map((p) => ({type: 'allow-error', description: p.source}))})

const SCREEN = '__e2eStudioError'
// In every page: the error screen, the moment it is drawn (a page closed by an afterEach is
// gone by teardown).
const watchScreen = (binding: string) => {
  let told = false
  const look = () => {
    const el = !told && document.querySelector('[data-testid="studio-error"]')
    if (!el) return
    told = true
    // Once the rig has it: the self-test (error-listener.spec) waits for this, not a fixed time.
    const told_ = (window as unknown as Record<string, (t: string) => Promise<void>>)[binding]?.((el.textContent ?? '').slice(0, 300))
    void told_?.then(() => ((window as {__e2eStudioErrorTold?: boolean}).__e2eStudioErrorTold = true))
  }
  new MutationObserver(look).observe(document, {childList: true, subtree: true})
  look()
}

// The Phoenix desk (project `desk`) asks for a Barkpark session: one sign-in per worker with
// the rig's token (the desk is for workspace admins), its cookie given to every context.
// Kept in memory only: a session is a credential.
let deskSession: Parameters<BrowserContext['addCookies']>[0] | undefined
async function deskSignIn(browser: Browser, baseURL: string | undefined) {
  if (deskSession) return deskSession
  const ctx = await browser.newContext({baseURL})
  const page = await ctx.newPage()
  await page.goto('/login')
  // The token form sits behind a disclosure: filled and sent in the page.
  await page.evaluate((token) => {
    const form = document.querySelector<HTMLFormElement>('form[action="/login"]')!
    form.querySelector<HTMLInputElement>('[name="token"]')!.value = token
    form.requestSubmit()
  }, process.env.BARKPARK_TOKEN ?? '')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
  deskSession = await ctx.cookies()
  await ctx.close()
  return deskSession
}

export const test = base.extend<{errorWatch: void; testStart: number}>({
  // When this test's timeout began counting (fixtures included): set up first, it only reads the clock.
  testStart: [async ({}, use) => use(Date.now()), {auto: true}],
  errorWatch: [
    async ({context, browser}, use, info) => {
      const problems: string[] = []
      const session = info.project.name === 'desk' ? await deskSignIn(browser, info.project.use.baseURL) : undefined
      const watchPage = (page: Page) => {
        page.on('pageerror', (e) => problems.push(`uncaught error in ${page.url()}: ${e.message}`))
        page.on('console', (m) => {
          if (m.type() === 'error' && /must not return anything besides a function/.test(m.text())) problems.push(`React: an effect returned a non-function (${page.url()})`)
        })
      }
      const watch = async (c: BrowserContext) => {
        c.pages().forEach(watchPage)
        c.on('page', watchPage)
        if (session) await c.addCookies(session)
        await c.exposeBinding(SCREEN, ({page}, text: string) => void problems.push(`the studio's error screen in ${page.url()}: ${text}`))
        await c.addInitScript(watchScreen, SCREEN)
      }
      const watched = [context]
      await watch(context)
      // A context the test opens itself (two editors, two browsers) is watched too.
      const newContext = browser.newContext.bind(browser)
      browser.newContext = async (...args) => {
        const c = await newContext(...args)
        await watch(c)
        watched.push(c)
        return c
      }
      await new Promise((r) => setTimeout(r, 1_500)) // PLANT 2 (never merged): setup held back 1.5 s
      try {
        await use()
      } finally {
        browser.newContext = newContext
      }
      // An error from a task the page had queued as the test ended (a click's setTimeout) may not
      // have been thrown yet: each open page answers from a timer of its own first. Timers of the
      // same delay run in order and the page's events come before the answer, so that error is
      // counted. At most 1 s (a page held by a dialog does not answer). task-0529370e1626e4ae.
      await Promise.all(watched.flatMap((c) => c.pages()).filter((pg) => !pg.isClosed()).map((pg) => Promise.race([pg.evaluate(() => new Promise((r) => setTimeout(r, 0))).catch(() => 0), new Promise((r) => setTimeout(r, 1_000))])))
      const allowed = info.annotations.filter((a) => a.type === 'allow-error').map((a) => new RegExp(a.description ?? ''))
      const left = problems.filter((p) => !allowed.some((re) => re.test(p)))
      if (!left.length) return
      // A test that failed already keeps its own error first; these are noted beside it.
      if (info.status !== 'passed') return void info.annotations.push(...left.map((p) => ({type: 'page error', description: p})))
      throw new Error(`The page went wrong during the test:\n${left.map((p) => `  - ${p}`).join('\n')}\n(expected? test('…', allowErrors(/…/), …) in e2e/rig/test.ts)`)
    },
    {auto: true},
  ],
})
