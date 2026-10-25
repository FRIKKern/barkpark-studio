import {test as base, type BrowserContext, type Page} from '@playwright/test'

export * from '@playwright/test'

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
    void (window as unknown as Record<string, (t: string) => void>)[binding]?.((el.textContent ?? '').slice(0, 300))
  }
  new MutationObserver(look).observe(document, {childList: true, subtree: true})
  look()
}

export const test = base.extend<{errorWatch: void}>({
  errorWatch: [
    async ({context, browser}, use, info) => {
      const problems: string[] = []
      const watchPage = (page: Page) => {
        page.on('pageerror', (e) => problems.push(`uncaught error in ${page.url()}: ${e.message}`))
        page.on('console', (m) => {
          if (m.type() === 'error' && /must not return anything besides a function/.test(m.text())) problems.push(`React: an effect returned a non-function (${page.url()})`)
        })
      }
      const watch = async (c: BrowserContext) => {
        c.pages().forEach(watchPage)
        c.on('page', watchPage)
        await c.exposeBinding(SCREEN, ({page}, text: string) => void problems.push(`the studio's error screen in ${page.url()}: ${text}`))
        await c.addInitScript(watchScreen, SCREEN)
      }
      await watch(context)
      // A context the test opens itself (two editors, two browsers) is watched too.
      const newContext = browser.newContext.bind(browser)
      browser.newContext = async (...args) => {
        const c = await newContext(...args)
        await watch(c)
        return c
      }
      try {
        await use()
      } finally {
        browser.newContext = newContext
      }
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
