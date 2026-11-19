// Paste document and Paste field as the menus run them (DocHeaderMenu, Fields.tsx): the reads
// are taken here, the schemas and the workspace's roles from Barkpark, so no menu can hand the
// paste a roles read of its own (task-fcedb95f343c738b). The paste itself: lib/paste-locked.ts.
import type {QueryClient} from '@tanstack/react-query'
import type {Field} from './data'
import {schemasQuery} from './data'
import type {Person} from './conditions'
import {pasteDocumentReading, pasteFieldReading, type PasteAsks} from './paste-locked'
import {workspaceRolesQuery} from './workspace-roles-query'

const readsOf = (qc: QueryClient) => ({schemas: () => qc.ensureQueryData(schemasQuery), roles: () => qc.ensureQueryData(workspaceRolesQuery)})

/** Paste document: what the copy writes, with the fields a rule locks for this person kept. */
export const pasteDocumentWith = (qc: QueryClient, fields: Field[], values: Record<string, unknown>, user: Person, context: PasteAsks) => pasteDocumentReading(readsOf(qc), fields, values, user, context)
/** Paste field: the value to set, with what a rule locks for this person kept inside it; no document yet, the value as pasted. */
export const pasteFieldWith = (qc: QueryClient, f: Field, path: string, pasted: unknown, target: unknown, user: Person, context: PasteAsks | null) => pasteFieldReading(readsOf(qc), f, path, pasted, target, user, context)
