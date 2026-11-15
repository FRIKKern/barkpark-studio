// J66: the task model and its activity log, without the server (so tests and the page share it).
//
//   history rows (newest first) ──snapshotRows──▶ the rows worth reading, oldest first
//   their contents (snapshots)  ──taskChanges───▶ one change per field that differs
//   changes + comment threads   ──activityFeed──▶ the Activity list, oldest first
//
// Nothing is stored for the log: it is read back from the task document's own revisions,
// as Sanity reads its transaction log (trackFieldChanges, groupChanges).

import type {Thread} from './comment-threads'

export const TASK_TYPE = 'studioTask'
/** `draft`: started and not created yet; only its author is sent it (lib/tasks.ts). */
export type TaskState = 'open' | 'done' | 'draft'
export type Task = {
  _id: string
  _rev?: string
  title: string
  description?: string
  /** The document the task is about. */
  target?: {_type: 'reference'; _ref: string} | null
  targetType?: string | null
  /** An editor's email. */
  assignee?: string | null
  /** yyyy-mm-dd */
  dueAt?: string | null
  subscribers?: string[]
  state: TaskState
  createdBy?: string | null
  createdAt: string
}
export type TaskInput = {
  title: string
  description?: string
  target?: {id: string; type: string} | null
  assignee?: string | null
  dueAt?: string | null
}

/** The creator, the assignee, whoever changes or comments, whoever is mentioned: once each. */
export const followers = (...emails: (string | null | undefined)[]) => [...new Set(emails.filter((e): e is string => !!e))]

/**
 * A change to a task that depends on what it holds now (its followers): read it, write the
 * change fenced on the revision read, and when someone else wrote in between ('stale'),
 * read again and try again. Two editors who follow at the same moment are both kept: the
 * unfenced write kept only the last one.
 */
export async function fencedChange<T extends {_rev?: string}>(read: () => Promise<T | null>, write: (now: T) => Promise<'ok' | 'stale' | 'same'>, tries = 6): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const now = await read()
    if (!now) return null
    if ((await write(now)) !== 'stale') return now
  }
  throw new Error('The task kept changing. Try again.')
}

/**
 * A text box of the open task (its title, its description). `typed` is what the editor has
 * put in it and not saved yet; null while they have not touched it. An untouched box shows
 * the task as it is now, so another editor's save shows in it and is never written back;
 * only a box the editor changed is unsaved, and saves the editor's text.
 */
export const boxShows = (typed: string | null, saved: string) => typed ?? saved
/** What leaving the box writes: nothing when untouched, unchanged, or (a title) empty. */
export function boxSaves(typed: string | null, saved: string, required = false): string | undefined {
  if (typed === null) return undefined
  const text = required ? typed.trim() : typed
  return text === saved || (required && !text) ? undefined : text
}

/** Sanity's Duplicate task: the same task, "(copy)" after its title, to do again. */
export const duplicateOf = (task: Pick<Task, 'title' | 'description' | 'target' | 'targetType' | 'assignee' | 'dueAt'>): TaskInput => ({
  title: `${task.title} (copy)`,
  description: task.description ?? '',
  target: task.target ? {id: task.target._ref, type: task.targetType ?? ''} : null,
  assignee: task.assignee ?? null,
  dueAt: task.dueAt ?? null,
})

/** One row of the task's history (Barkpark /v1/data/history). */
export type TaskRevision = {id: string; action: string; status: 'draft' | 'published'; timestamp: string; rev?: string; actor?: string | null; actorId?: string}

const PAIR_MS = 5_000
/**
 * The history rows whose content the log needs, oldest first. The studio saves a task as
 * a draft write and its publish in one request: two rows with the same content, so the
 * draft row right under its own publish is not read (half the reads). A draft row on its
 * own (a write from outside that published nothing) stays. Deletes hold no content.
 */
export function snapshotRows(revisions: TaskRevision[]): TaskRevision[] {
  const rows = revisions.filter((r) => r.action !== 'delete' && r.action !== 'unpublish')
  return rows
    .filter((r, i) => {
      const newer = rows[i - 1]
      const paired = r.status === 'draft' && newer?.action === 'publish' && newer.actorId === r.actorId && Date.parse(newer.timestamp) - Date.parse(r.timestamp) < PAIR_MS
      return !paired
    })
    .reverse()
}

export type TaskField = 'state' | 'target' | 'dueAt' | 'assignee' | 'description' | 'title'
// Sanity's order of the fields it tracks (useActivityLog).
const FIELDS: TaskField[] = ['title', 'description', 'dueAt', 'assignee', 'state', 'target']
export type TaskSnapshot = {at: string; actor?: string | null; content: Partial<Record<TaskField, unknown>>}
export type TaskChange = {field: TaskField; from: string | null; to: string | null; at: string; actor: string | null}

/** A field as the log compares it: nothing, an empty text and a missing key are the same; a target is its document. */
const read = (content: TaskSnapshot['content'], field: TaskField): string | null => {
  const v = content[field]
  if (field === 'target') return (v as {_ref?: string} | null | undefined)?._ref || null
  return typeof v === 'string' && v !== '' ? v : null
}

const GROUP_MS = 120_000
/**
 * The changes between the task's snapshots (oldest first), as Sanity lists them: one per
 * field that differs from the snapshot before, by whoever wrote it. What happened while the
 * task was still a draft is not activity: the log starts at the snapshot that created it.
 * One person changing one field again within two minutes is one line (the last value).
 */
export function taskChanges(snapshots: TaskSnapshot[]): TaskChange[] {
  const created = snapshots.reduce((at, s, i) => (s.content.state === 'draft' ? i + 1 : at), 0)
  const out: TaskChange[] = []
  for (let i = created + 1; i < snapshots.length; i++) {
    const before = snapshots[i - 1]!
    const now = snapshots[i]!
    for (const field of FIELDS) {
      const from = read(before.content, field)
      const to = read(now.content, field)
      if (from === to) continue
      const last = out.at(-1)
      const actor = now.actor ?? null
      if (last && last.field === field && last.actor === actor && Math.abs(Date.parse(now.at) - Date.parse(last.at)) <= GROUP_MS) (last.to = to), (last.at = now.at)
      else out.push({field, from, to, at: now.at, actor})
    }
  }
  return out
}

export type ChangeKind = 'status' | 'target-set' | 'target-removed' | 'due-set' | 'due-changed' | 'due-removed' | 'assigned' | 'unassigned' | 'description' | 'title'
/** Which of Sanity's sentences a change reads as (getChangeDetails). */
export function changeKind(c: Pick<TaskChange, 'field' | 'from' | 'to'>): ChangeKind {
  switch (c.field) {
    case 'state':
      return 'status'
    case 'target':
      return c.to ? 'target-set' : 'target-removed'
    case 'dueAt':
      return !c.to ? 'due-removed' : c.from ? 'due-changed' : 'due-set'
    case 'assignee':
      return c.to ? 'assigned' : 'unassigned'
    default:
      return c.field
  }
}

export type FeedItem = {kind: 'change'; at: string; change: TaskChange} | {kind: 'thread'; at: string; thread: Thread}
/** The Activity list: field changes and comment threads together, oldest first (a thread sits where it began). */
export function activityFeed(changes: TaskChange[], threads: Thread[]): FeedItem[] {
  const items: FeedItem[] = [...changes.map((change): FeedItem => ({kind: 'change', at: change.at, change})), ...threads.map((thread): FeedItem => ({kind: 'thread', at: thread.root.createdAt, thread}))]
  return items.map((item, i) => ({item, i})).sort((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at) || a.i - b.i).map((x) => x.item)
}
