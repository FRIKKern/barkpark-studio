import '@tanstack/react-start/server-only'
import {bpFetch, dataset} from './barkpark'
import {previewQueryPath, type PreviewAnswer} from '../lib/presentation-comlink'

// A preview site's loader query (Sanity's `loader/query-listen`), run for the page the
// editor has open in Presentation. The page is someone's site, so:
//  - it is read with the signed-in editor's own token (bpFetch's default), never the
//    studio's service token: the page sees what this editor may read, no more;
//  - it is a GET of Barkpark's GROQ read, in this request's own dataset, in drafts or
//    published only (never raw): a query cannot write, and names no other dataset;
//  - only the result and its source map go back. No token, no header, no Barkpark address.

export async function previewQuery(data: unknown): Promise<PreviewAnswer> {
  const target = previewQueryPath(data, dataset())
  if ('error' in target) return {ok: false, error: target.error}
  const res = await bpFetch(target.path)
  let body: {result?: unknown; resultSourceMap?: unknown; syncTags?: unknown; error?: {description?: unknown}} = {}
  try {
    body = (await res.json()) as typeof body
  } catch {}
  if (!res.ok) return {ok: false, error: `Barkpark query → ${res.status}${typeof body.error?.description === 'string' ? `: ${body.error.description.slice(0, 300)}` : ''}`}
  return {ok: true, perspective: target.perspective, result: body.result ?? null, resultSourceMap: body.resultSourceMap, ...(Array.isArray(body.syncTags) && {tags: body.syncTags.filter((t): t is string => typeof t === 'string')})}
}
