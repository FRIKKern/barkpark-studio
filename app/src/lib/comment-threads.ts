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
}
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
