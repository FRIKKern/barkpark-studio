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
}
export type Thread = {root: Comment; replies: Comment[]; status: CommentStatus}

/** Threads in the order Sanity lists them: by field, then oldest first. */
export function threadsOf(comments: Comment[]): Thread[] {
  const roots = comments.filter((c) => !c.parentCommentId)
  return roots.map((root) => ({root, replies: comments.filter((c) => c.parentCommentId === root._id), status: root.state ?? 'open'}))
}
