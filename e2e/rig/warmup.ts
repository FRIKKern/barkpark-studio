// Global setup: request every route once so the dev server has compiled them
// before any timing is taken (a cold Vite compile is not what F3 measures).
export default async function warmup() {
  const base = 'http://localhost:3100'
  for (const path of ['/health', '/structure', '/structure/post', '/structure/post;post-01;author-alan,type=author,parentRefPath=author'])
    await fetch(base + path).then((r) => r.text())
}
