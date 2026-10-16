// speakingurl ships no types: the one call Sanity's slugify (and ours, lib/slug.ts) makes.
declare module 'speakingurl' {
  export default function speakingurl(input: string, options?: {truncate?: number; symbols?: boolean; lang?: string | false; separator?: string}): string
}
