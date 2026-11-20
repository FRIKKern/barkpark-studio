// The text of a kept edit, as the person typed it, for the Restore card to show when it could not
// be put back (task-28470f0d0ace566c): a Portable Text block or list as its paragraphs, a string as it is.
import {isText, textOf} from './pt-merge.ts'

/** The fields' names for the card, each once (two blocks of one field read "Body", not "Body, Body"). */
export function fieldNames(paths: string[], labels: Record<string, string>): string {
  return [...new Set(paths.map((f) => labels[f.split(/[.[]/)[0]!] ?? f))].join(', ')
}

export function keptText(value: unknown): string {
  if (typeof value === 'string') return value
  if (isText(value)) return textOf(value)
  if (Array.isArray(value)) return value.map(keptText).filter(Boolean).join('\n')
  return ''
}
