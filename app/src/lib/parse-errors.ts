import {useSyncExternalStore} from 'react'

// Sanity's useReportParseError: an input holding text it can't read (a date typed in another
// format) reports it, so the field's header and the document's validation list show it, not
// only the line under the input (task-dd31e51507a6fd56). The stored value is untouched, and,
// as in Sanity, it doesn't block publishing.

const byDoc = new Map<string, Map<string, string>>()
const listeners = new Set<() => void>()
const snapshots = new Map<string, [string, string][]>()
const NONE: [string, string][] = []

/** `message` for the field at `path` of document `docId`, or null when it reads again. */
export function reportParseError(docId: string, path: string, message: string | null) {
  const paths = byDoc.get(docId) ?? new Map<string, string>()
  if ((paths.get(path) ?? null) === message) return
  if (message === null) paths.delete(path)
  else paths.set(path, message)
  if (paths.size) byDoc.set(docId, paths)
  else byDoc.delete(docId)
  snapshots.delete(docId)
  for (const l of listeners) l()
}

/** The same list, outside React (tests). */
export const parseErrorsOf = (docId: string) => read(docId)

function read(docId: string) {
  let s = snapshots.get(docId)
  if (!s) snapshots.set(docId, (s = [...(byDoc.get(docId) ?? [])]))
  return s
}

/** The document's unreadable fields, [path, message] in the order reported. */
export function useParseErrors(docId: string | null | undefined): [string, string][] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => (docId ? read(docId) : NONE),
    () => NONE,
  )
}
