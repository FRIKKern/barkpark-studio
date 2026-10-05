// Global setup: request every route once so the dev server has compiled them
// before any timing is taken (a cold Vite compile is not what F3 measures).
// CI runs a production build: nothing to compile, and the far-away round trips
// cost seconds of the suite budget.
export default async function warmup() {
  if (process.env.CI) return
  const base = 'http://localhost:3000'
  for (const path of ['/health', '/structure', '/structure/post', '/structure/post;post-01;author-alan,type=author,parentRefPath=author'])
    await fetch(base + path).then((r) => r.text())
}
