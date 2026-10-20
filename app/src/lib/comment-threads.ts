// J40: the comment model, without the server (so tests and the page can share it).

export const COMMENT_TYPE = 'studioComment'
export type CommentStatus = 'open' | 'resolved'
export type Comment = {
  _id: string
  documentId: string
  documentType: string
  fieldPath: string
  threadId: string
  parentCommentId?: string
  message: string
  authorEmail: string | null
  /** open / resolved, on a thread's first comment (`status` is Barkpark's own document field). */
  state?: CommentStatus
  createdAt: string
  editedAt?: string
  /** Who the message @-mentions (emails), Sanity's mentions. */
  mentions?: string[]
  /** Sanity's reactions: who reacted with what (one of REACTIONS). */
  reactions?: Reaction[]
  /** Sanity's inline comments: the span of body text a thread is on, as canvas Points. */
  selection?: CommentSelection
  /** The text it was on when written (Sanity's contentSnapshot). */
  contentSnapshot?: string
  /** That text has since been deleted: the thread stays, its highlight goes. */
  textDeleted?: boolean
}
/** A spot in a canvas body (Barkpark EMBED-CONTRACT, Shared carets). */
export type Point = {blockId: string; path?: string; offset: number}
export type CommentSelection = {anchor: Point; head: Point}
export type Reaction = {_key: string; shortName: string; userId: string | null; addedAt: string}

/** Sanity's six comment reactions (COMMENT_REACTION_OPTIONS), in its order. */
export const REACTIONS: {shortName: string; title: string; emoji: string}[] = [
  {shortName: ':+1:', title: 'Thumbs up', emoji: '👍'},
  {shortName: ':-1:', title: 'Thumbs down', emoji: '👎'},
  {shortName: ':heart:', title: 'Heart', emoji: '❤️'},
  {shortName: ':rocket:', title: 'Rocket', emoji: '🚀'},
  {shortName: ':heavy_plus_sign:', title: 'Heavy plus sign', emoji: '➕'},
  {shortName: ':eyes:', title: 'Eyes', emoji: '👀'},
]

/** A reaction added by `user`, or taken back when they already gave it (Sanity's toggle). */
export function toggleReaction(reactions: Reaction[] = [], shortName: string, user: string | null, now = new Date().toISOString()): Reaction[] {
  const mine = reactions.find((r) => r.shortName === shortName && r.userId === user)
  return mine ? reactions.filter((r) => r !== mine) : [...reactions, {_key: `${shortName}-${now}`.replace(/[^\w-]/g, ''), shortName, userId: user, addedAt: now}]
}

/** Reactions grouped as Sanity shows them: in REACTIONS order, each with who gave it. */
export const reactionGroups = (reactions: Reaction[] = []) =>
  REACTIONS.flatMap((r) => {
    const users = reactions.filter((x) => x.shortName === r.shortName).map((x) => x.userId)
    return users.length ? [{...r, users}] : []
  })
export type Thread = {root: Comment; replies: Comment[]; status: CommentStatus}

/** Threads in the order Sanity lists them: by field, then oldest first. */
export function threadsOf(comments: Comment[]): Thread[] {
  // Replies by their thread in one pass: per root over every comment was 120,000 steps for
  // 200 threads of three, each time the doc pane drew.
  const replies = new Map<string, Comment[]>()
  for (const c of comments) if (c.parentCommentId) replies.set(c.parentCommentId, [...(replies.get(c.parentCommentId) ?? []), c])
  return comments.filter((c) => !c.parentCommentId).map((root) => ({root, replies: replies.get(root._id) ?? [], status: root.state ?? 'open'}))
}

/** Painted in the body: an open thread on a span of text that is still there. */
const painted = (th: Thread, fieldPath: string) => th.status === 'open' && th.root.fieldPath === fieldPath && !!th.root.selection && !th.root.textDeleted

/**
 * The canvas's comment ranges for one field. `live` holds the Points the canvas has
 * mapped through edits since; they win over the saved ones, which may lag behind.
 */
export function commentRangesOf(threads: Thread[], fieldPath: string, active: string | undefined, live: ReadonlyMap<string, CommentSelection>) {
  return threads.filter((th) => painted(th, fieldPath)).map((th) => ({id: th.root._id, ...(live.get(th.root._id) ?? th.root.selection!), ...(th.root._id === active ? {active: true} : {})}))
}

const samePoint = (a: Point, b: Point) => a.blockId === b.blockId && (a.path ?? '') === (b.path ?? '') && a.offset === b.offset

/**
 * What to save after the canvas moved or dropped ranges: each thread's new Points, or
 * null when its text is gone. Only a range the canvas once painted (`seen`) counts as
 * gone: one it never placed (blocks it has not loaded yet) is left alone.
 */
export function rangeMoves(threads: Thread[], fieldPath: string, live: ({id: string} & CommentSelection)[], seen: ReadonlySet<string>): {id: string; selection: CommentSelection | null}[] {
  const byId = new Map(live.map((r) => [r.id, r]))
  return threads.filter((th) => painted(th, fieldPath)).flatMap((th): {id: string; selection: CommentSelection | null}[] => {
    const now = byId.get(th.root._id)
    const was = th.root.selection!
    if (!now) return seen.has(th.root._id) ? [{id: th.root._id, selection: null}] : []
    return samePoint(now.anchor, was.anchor) && samePoint(now.head, was.head) ? [] : [{id: th.root._id, selection: {anchor: now.anchor, head: now.head}}]
  })
}

// Mentions (J40), as Sanity's: "@" opens the list of users; a pick puts @<email> in
// the text, shown as a chip with the name. Emails are what Barkpark knows people by.
const MENTION = /@([^\s@]+@[^\s@]+\.[^\s@.,;:!?)]+)/g

/** The emails a message mentions, once each. */
export const mentionsIn = (message: string) => [...new Set([...message.matchAll(MENTION)].map((m) => m[1]!))]

/** A message as text and mentions, in order. */
export function messageParts(message: string): ({text: string} | {mention: string})[] {
  const out: ({text: string} | {mention: string})[] = []
  let at = 0
  for (const m of message.matchAll(MENTION)) {
    if (m.index! > at) out.push({text: message.slice(at, m.index)})
    out.push({mention: m[1]!})
    at = m.index! + m[0].length
  }
  if (at < message.length) out.push({text: message.slice(at)})
  return out
}

/** If the caret is in an "@…" being typed (at the start or after a space): where it starts and the query. */
export function mentionAt(text: string, caret: number): {start: number; query: string} | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]*)$/.exec(before)
  return m ? {start: caret - m[2]!.length - 1, query: m[2]!} : null
}

/** Put @<email> in place of the "@query" from `start` to `caret`; the caret goes after it. */
export function insertMention(text: string, start: number, caret: number, email: string): {text: string; caret: number} {
  const chip = `@${email} `
  return {text: text.slice(0, start) + chip + text.slice(caret), caret: start + chip.length}
}

/**
 * J49, Sanity's Viewer may comment: Barkpark lets a read seat write comments when the
 * comment type's schema opts in (`readerWrites`, Barkpark #22790): create, and resolve
 * through the listed fields. Older Barkparks, or a schema without it, keep viewers out.
 */
export function readersMayComment(schema: {readerWrites?: unknown; reader_writes?: unknown} | undefined): boolean {
  const rule = (schema?.readerWrites ?? schema?.reader_writes) as {create?: unknown; patchFields?: unknown} | undefined
  return rule?.create === true && Array.isArray(rule.patchFields) && rule.patchFields.includes('state')
}
