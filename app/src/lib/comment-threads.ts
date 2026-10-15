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
}
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
  const roots = comments.filter((c) => !c.parentCommentId)
  return roots.map((root) => ({root, replies: comments.filter((c) => c.parentCommentId === root._id), status: root.state ?? 'open'}))
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

/** A person's name from their email, as the chip shows it. */
export const personName = (email: string) => email.replace(/@.*/, '')

/**
 * J49, Sanity's Viewer may comment: Barkpark lets a read seat write comments when the
 * comment type's schema opts in (`readerWrites`, Barkpark #22790): create, and resolve
 * through the listed fields. Older Barkparks, or a schema without it, keep viewers out.
 */
export function readersMayComment(schema: {readerWrites?: unknown; reader_writes?: unknown} | undefined): boolean {
  const rule = (schema?.readerWrites ?? schema?.reader_writes) as {create?: unknown; patchFields?: unknown} | undefined
  return rule?.create === true && Array.isArray(rule.patchFields) && rule.patchFields.includes('state')
}
