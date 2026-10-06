// Global setup: request every route once so the dev server has compiled them, and
// the server has made its first Barkpark round trips, before any timing is taken
// (a cold compile or cold connection is not what F2/F3 measure). In parallel: in CI
// each request crosses to a far-away Barkpark, and the suite has a 60 s budget.
export default async function warmup() {
  const base = `http://localhost:${process.env.E2E_PORT || 3100}`
  await fetch(`${base}/health`).then((r) => r.text())
  await Promise.all(
    ['/structure', '/structure/post', '/structure/post;post-01;author-alan,type=author,parentRefPath=author'].map((path) => fetch(base + path).then((r) => r.text())),
  )
}
