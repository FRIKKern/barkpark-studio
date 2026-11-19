// task-96c28256661a6179: when the route's loader made the page's data (lib/structure-route.tsx
// loadPanes), for a render that compares a time with now. The loader reads the clock, once, outside
// any render; the value travels with the route's data, so the server's page and the browser's
// first paint (which hydrates on the server's data) compare with the same now and draw the same.
import {createContext} from 'react'
import type {Doc} from './data.ts'

/** The pane chain's load time (ms since epoch); none outside a pane chain. */
export const LoadedAtContext = createContext<number | undefined>(undefined)

/** D04: how long after its creation a doc saved but never published still counts as just made. */
export const JUST_MADE_MS = 15_000

/** D04: a doc never published, created less than JUST_MADE_MS before the page's data was loaded. */
export const madeJustBefore = (doc: Doc, at: number | undefined): boolean =>
  at !== undefined && doc._hasPublished === false && at - Date.parse(String(doc._createdAt ?? '')) < JUST_MADE_MS

/** The docs edited in this page (the browser's: an edit is a browser event, so the server's stays empty). */
const editedHere = new Set<string>()
/** D04: the first edit of `id` in this page. */
export const noteEdit = (id: string) => void editedHere.add(id)
/**
 * D04: not edited yet, by the doc as the pane holds it now and by this page. A save after its create
 * moves `_updatedAt` past `_createdAt` (Barkpark's two stamps, so no clock between them; a create
 * stamps both alike); an edit here counts before its save lands, and when its save was the create.
 * `at` is no help here: a cached route's is as old as its first open (task-96c28256661a6179).
 */
export const unedited = (doc: Doc, id: string): boolean => !editedHere.has(id) && Date.parse(String(doc._updatedAt ?? '')) <= Date.parse(String(doc._createdAt ?? ''))
