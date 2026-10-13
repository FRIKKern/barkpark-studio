import '@tanstack/react-start/server-only'
import {dataset, requestToken} from './barkpark'
import {describeToken} from './auth'
import {PERSPECTIVES, type Perspective} from '../lib/vision'
import {applyParams, parseParams} from '../lib/vision-params'

// J37: what Vision's Fetch (lib/vision.ts) and Listen (routes/api/vision-listen.ts) send
// Barkpark, checked first. Reads only: a type and a query string, nothing else.
const QUERY = /^[A-Za-z0-9_-]+(\?[^#\n]*)?$/
const DATASET = /^[a-z0-9][a-z0-9_-]*$/

/** A query checked before it reaches Barkpark: the dataset (one this token reads), the type and its query string. */
export async function visionTarget(data: {query: string; perspective: Perspective; dataset?: string; params?: string}): Promise<{error: string} | {ds: string; type: string; params: URLSearchParams; sent: string}> {
  // Params (Sanity's): each $name in the query becomes its value (lib/vision-params.ts).
  const parsed = parseParams(data.params ?? '')
  if ('error' in parsed) return {error: parsed.error}
  const applied = applyParams(data.query.trim(), parsed.params)
  if ('error' in applied) return {error: applied.error}
  const query = applied.query
  const ds = data.dataset || dataset()
  if (!DATASET.test(ds)) return {error: `No dataset is called ${ds}`}
  const bound = (await describeToken(requestToken())).boundDataset
  if (bound && ds !== bound) return {error: `Your token reads only the ${bound} dataset`}
  if (!QUERY.test(query)) return {error: 'A query is a type, then an optional ?query string: post?filter[title][contains]=post&limit=5'}
  const [type = '', qs = ''] = query.split(/\?(.*)/s)
  const params = new URLSearchParams(qs)
  if (!params.has('perspective')) params.set('perspective', PERSPECTIVES.includes(data.perspective) ? data.perspective : 'drafts')
  return {ds, type, params, sent: query}
}

