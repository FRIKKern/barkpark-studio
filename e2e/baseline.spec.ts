import {expect, test} from '@playwright/test'
import {installProbes, seenAt, stats, timeToReady, typeAndMeasure} from './rig/feel'
import {target} from './rig/targets'

// Measures F1 / F2 / F4 on post-01 with two browsers. Not a gate: it prints the
// numbers the QUALITY.md baseline column is copied from. Run: pnpm baseline --project sanity
const ID = 'post-01'
const TITLE = 'Fixture post 01'

test('@baseline feel: F1 typing, F2 pane open, F4 remote edit', async ({browser}, info) => {
  test.setTimeout(90_000)
  const t = target(info)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  for (const ctx of contexts) await Promise.all([t.prepare(ctx), installProbes(ctx)])
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()))
  const title = (p: typeof a) => t.field(p, 'title')
  const results: Record<string, unknown> = {}

  try {
    // F2 — warm pane open: list → doc, five different docs after one warm-up.
    await a.goto(t.listPath('post'))
    await t.listItem(a, 'post-02').waitFor()
    await t.settle(a)
    const opens = []
    for (const n of ['02', '03', '04', '05', '06', '07']) {
      const r = await timeToReady(
        a,
        t.listItem(a, `post-${n}`),
        `(want) => document.getElementById('title')?.value === want`,
        `Fixture post ${n}`,
      )
      opens.push(r)
    }
    opens.shift() // warm-up
    results.F2 = {...stats(opens.map((o) => o.ms)), clsMax: Math.max(...opens.map((o) => o.cls))}

    // Both browsers on the same doc.
    await Promise.all([a.goto(t.docPath('post', ID)), b.goto(t.docPath('post', ID))])
    await Promise.all([expect(title(a)).toHaveValue(TITLE), expect(title(b)).toHaveValue(TITLE)])
    await Promise.all([t.settle(a), t.settle(b)])

    // F4a — another client writes over HTTP; how fast does browser B show it?
    const http = []
    for (let i = 0; i < 10; i++) {
      const value = `${TITLE} http ${i}`
      const seen = seenAt(b, '[id="title"]', value)
      const sent = Date.now()
      await t.patch(ID, {title: value})
      http.push((await seen) - sent)
    }
    results.F4_http = stats(http)
    await t.restore(ID, {title: TITLE})
    await Promise.all([expect(title(a)).toHaveValue(TITLE), expect(title(b)).toHaveValue(TITLE)])

    // F4b — browser A types; how fast does browser B show each keystroke?
    await title(a).click()
    await a.keyboard.press('End')
    const typed = []
    let value = TITLE
    for (const ch of ' abcdefghij') {
      value += ch
      const seen = seenAt(b, '[id="title"]', value)
      const sent = Date.now()
      await a.keyboard.press(ch === ' ' ? 'Space' : ch)
      typed.push((await seen) - sent)
      await a.waitForTimeout(250)
    }
    results.F4_typed = stats(typed)

    // F1 — keystroke → paint while typing a sentence in A.
    const f1 = await typeAndMeasure(a, title(a), ' the quick brown fox jumps')
    results.F1 = {frame: stats(f1.keys), eventTiming: stats(f1.slowKeys)}
  } finally {
    await t.restore(ID, {title: TITLE})
    await Promise.all(contexts.map((c) => c.close()))
  }

  console.log(`[baseline ${t.name}]`, JSON.stringify(results))
  await info.attach(`baseline-${t.name}.json`, {body: JSON.stringify(results, null, 2), contentType: 'application/json'})
})
