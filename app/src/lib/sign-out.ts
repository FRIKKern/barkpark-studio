import type {QueryClient} from '@tanstack/react-query'
import {forgetEdits} from './edits'
import {endSession} from './session'

// Sign out of this tab (task-03ca6c0c9a79adf1): the session ends, and nothing of it stays
// for whoever signs in next here, as in Sanity: no unsent edit (lib/edits.ts), no cached
// read, and none of what this browser kept of the editor's work (their recent searches,
// copied field, Vision query, share links, a canvas's kept words). Theme and pane widths stay.
const KEPT = ['bp-recent-searches', 'studio.clipboard', 'bp-vision']
const KEPT_PREFIXES = ['bp-share:', 'bp-kept-words:']

export async function signOutHere(qc: QueryClient) {
  forgetEdits()
  await endSession()
  qc.clear()
  try {
    for (const key of Object.keys(localStorage)) if (KEPT.includes(key) || KEPT_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key)
  } catch {}
}
