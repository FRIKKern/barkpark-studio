import {createServerFn} from '@tanstack/react-start'
import {queryOptions} from '@tanstack/react-query'
import {bpRoot} from '../server/barkpark'

// J69: what a bug report needs about the Barkpark this studio talks to: where it is, its
// version and commit (`GET /v1/version`), and its admin page (Manage project: members & roles).

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}
export type BarkparkInfo = {url: string; version: string | null; commit: string | null; adminUrl: string}

const fetchInfo = createServerFn({method: 'GET'}).handler(async () => {
  const url = process.env.BARKPARK_URL ?? ''
  const v = await bpRoot('/v1/version')
    .then((r) => (r.ok ? (r.json() as Promise<{version?: string; commit?: string}>) : null))
    .catch(() => null)
  return {url, version: v?.version ?? null, commit: v?.commit ?? null, adminUrl: url ? `${url}/studio/org-admin` : ''} as unknown as Json
})

export const barkparkInfoQuery = queryOptions({queryKey: ['barkpark-info'], queryFn: async () => (await fetchInfo()) as unknown as BarkparkInfo, staleTime: Infinity})

/** The dialog's sections as plain text, for "Copy output" (pasted into an issue). */
export const diagnosticsText = (sections: [string, [string, string][]][]) =>
  sections.map(([title, rows]) => [title, ...rows.map(([k, v]) => `  ${k}: ${v}`)].join('\n')).join('\n\n')
