import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {apiBase, bpFetch, dataset} from '../server/barkpark'

// B10: the actions a document's schema declares (a plugin's, e.g. OnixEdit's
// "Publish to Bokbasen"), as Barkpark's LiveView editor runs them: a `link` opens a
// URL; a `modal` asks first, runs a dry-run, shows its preview, and only then runs
// for real. Barkpark resolves the live list (a plugin can hide an action for the
// document as it is now) and dispatches (task-bd311f4b5ea2b3b8): admin tier, as in
// LiveView. Built-in actions in that list (publish, delete…) are this studio's own.

export type DocAction = {name: string; label: string; kind: 'link' | 'modal'; href?: string; modal?: {title?: string; body?: string}}
export type ActionPreview = {kind: 'xml'; xml: string; summary?: Record<string, unknown>} | {kind: 'error'; message: string} | {kind: string; [k: string]: unknown}
export type ActionOutcome = {preview: ActionPreview} | {result: unknown} | {error: string}

const path = (type: string, id: string) => `/v1/data/doc/${dataset()}/${encodeURIComponent(type)}/${encodeURIComponent(id)}/actions`

const fetchDocActions = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string; slug?: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(path(data.type, data.id))
    // Not an admin here (403), or an older Barkpark (404): no schema actions, as in LiveView.
    if (!res.ok) return []
    const {actions = []} = (await res.json()) as {actions?: {name: string; label: string; kind: string; href?: string | null; modal?: DocAction['modal'] | null}[]}
    return actions.flatMap((a): DocAction[] => {
      if (a.kind === 'modal') return [{name: a.name, label: a.label, kind: 'modal', modal: a.modal ?? undefined}]
      if (a.kind !== 'link' || !a.href) return []
      // LiveView's placeholders; a template naming :slug on a doc without one is left out.
      if (a.href.includes(':slug') && !data.slug) return []
      const href = a.href.replace(/:dataset\b/g, dataset()).replace(/:id\b/g, encodeURIComponent(data.id)).replace(/:slug\b/g, encodeURIComponent(data.slug ?? ''))
      return [{name: a.name, label: a.label, kind: 'link', href: /^https?:/.test(href) ? href : `${apiBase()}${href}`}]
    })
  })

export const docActionsQuery = (type: string, id: string, slug?: string) =>
  queryOptions({queryKey: ['doc-actions', type, id, slug ?? ''], queryFn: () => fetchDocActions({data: {type, id, slug}}) as Promise<DocAction[]>, staleTime: 30_000})

// A preview is whatever the plugin returns: it crosses as JSON text.
const dispatchDocAction = createServerFn({method: 'POST'})
  .validator((d: {type: string; id: string; name: string; mode: 'dryrun' | 'real'}) => d)
  .handler(async ({data}): Promise<string> => {
    const res = await bpFetch(`${path(data.type, data.id)}/${encodeURIComponent(data.name)}?mode=${data.mode}`, {method: 'POST'})
    const body = (await res.json().catch(() => ({}))) as {preview?: ActionPreview; result?: unknown; error?: {message?: string} | string; message?: string}
    const out: ActionOutcome = !res.ok
      ? {error: (typeof body.error === 'object' ? body.error?.message : body.error) ?? body.message ?? `Barkpark answered ${res.status}`}
      : body.preview
        ? {preview: body.preview}
        : {result: body.result ?? null}
    return JSON.stringify(out)
  })

export const runDocAction = async (opts: {data: {type: string; id: string; name: string; mode: 'dryrun' | 'real'}}): Promise<ActionOutcome> => JSON.parse(await dispatchDocAction(opts))
