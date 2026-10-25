import {QueryClient, type QueryKey} from '@tanstack/react-query'

// task-f2bc22f7401aae9e: a server render's reads before its first byte (the locale, who is
// signed in) had no limit, so a slow Barkpark held the whole page blank. Each gets a budget.
// The read runs on a scratch client, so a late answer never holds the page (the request's
// client streams every query it holds, and the page waited for each). Past the budget the
// render goes on with `fallback`, marked provisional, and the browser asks again.

/** `options`' data if Barkpark answers within `ms` (it joins the page's cache), else `fallback()`'s. */
export async function withinBudget<T>(qc: QueryClient, options: {queryKey: QueryKey; queryFn?: unknown}, ms: number, fallback: () => T | Promise<T>): Promise<T> {
  const held = qc.getQueryData<T>(options.queryKey)
  if (held !== undefined) return held
  const scratch = new QueryClient({defaultOptions: {queries: {retry: false}}})
  const read = scratch.fetchQuery(options as Parameters<QueryClient['fetchQuery']>[0]) as Promise<T>
  const inTime = await Promise.race([read.then((v) => ({v}), () => null), new Promise<null>((r) => setTimeout(r, ms, null))])
  if (inTime) {
    qc.setQueryData(options.queryKey, inTime.v)
    return inTime.v
  }
  read.catch(() => {})
  const v = await fallback()
  qc.setQueryData(options.queryKey, v, {updatedAt: 0})
  return v
}
