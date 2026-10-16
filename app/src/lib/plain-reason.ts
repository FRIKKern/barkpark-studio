// Barkpark's codes for a fault that is not the request's own, in plain words: a raw
// "unknown error (Postgrex.Error)" told the editor nothing (task-bb3d759d9354bae9).
// Kept free of app imports so node's tests load it.

type Translate = (en: string, vars?: Record<string, string | number>) => string
const english: Translate = (en) => en

/** The words for a server-side code, or undefined to keep Barkpark's own message. */
export function plainReason(code: string | undefined, t: Translate = english): string | undefined {
  // A 500: the server failed on its side; nothing about the document was refused.
  if (code === 'internal_error') return t('Barkpark could not finish this. Try again.')
  // Another write to the same document landed first (a race, not a mistake).
  if (code === 'rev_mismatch' || code === 'precondition_failed') return t('Someone else changed this document at the same time. Try again.')
  // A busy or briefly unreachable database: transient.
  if (code === 'storage_unavailable') return t('Barkpark is busy. Try again in a moment.')
  return undefined
}
