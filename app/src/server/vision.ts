import '@tanstack/react-start/server-only'
import {dataset, requestToken} from './barkpark'
import {describeToken} from './auth'
import {PERSPECTIVES, type Perspective} from '../lib/vision'
import {applyParams, parseParams} from '../lib/vision-params'
import {groqPath, groqTypes, isQueryString} from '../lib/vision-groq'

// J37: what Vision's Fetch (lib/vision.ts) and Listen (routes/api/vision-listen.ts) send
// Barkpark, checked first. Reads only: a GROQ query (Barkpark's Sanity-compatible GROQ
// read, task-8919d95d9e581c6b), or Barkpark's older form, a type and a query string.
const DATASET = /^[a-z0-9][a-z0-9_-]*$/

export type VisionTarget =
  | {kind: 'groq'; ds: string; path: string; types: string[]; perspective: Perspective; sent: string}
  | {kind: 'string'; ds: string; type: string; params: URLSearchParams; sent: string}

/** A query checked before it reaches Barkpark: the dataset (one this token reads), then the query itself. */
export async function visionTarget(data: {query: string; perspective: Perspective; dataset?: string; params?: string; version?: string}): Promise<{error: string} | VisionTarget> {
  const parsed = parseParams(data.params ?? '')
  if ('error' in parsed) return {error: parsed.error}
  const ds = data.dataset || dataset()
  if (!DATASET.test(ds)) return {error: `No dataset is called ${ds}`}
  const bound = (await describeToken(requestToken())).boundDataset
  if (bound && ds !== bound) return {error: `Your token reads only the ${bound} dataset`}
  const perspective = PERSPECTIVES.includes(data.perspective) ? data.perspective : 'drafts'
  const raw = data.query.trim()
  if (!raw) return {error: 'Write a GROQ query, like *[_type == "post"][0...10]'}
  // GROQ, as Sanity's Vision: $name params go to Barkpark as JSON, Barkpark resolves them.
  if (!isQueryString(raw)) return {kind: 'groq', ds, path: groqPath(ds, data.version ?? '', raw, parsed.params, perspective), types: groqTypes(raw), perspective, sent: raw}
  // Barkpark's query string: each $name in the query becomes its value (lib/vision-params.ts).
  const applied = applyParams(raw, parsed.params)
  if ('error' in applied) return {error: applied.error}
  const query = applied.query
  const [type = '', qs = ''] = query.split(/\?(.*)/s)
  const params = new URLSearchParams(qs)
  if (!params.has('perspective')) params.set('perspective', perspective)
  return {kind: 'string', ds, type, params, sent: query}
}
