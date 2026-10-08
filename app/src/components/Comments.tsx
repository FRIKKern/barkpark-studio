import {createContext, useContext, useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {commentsQuery, deleteComment, editComment, postComment, setThreadStatus, threadsOf, type Comment, type CommentStatus, type Thread} from '../lib/comments'
import {meQuery} from '../lib/session'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import {ago} from './HistoryPanel'
import {AddComment, Check, ChevronDown, Close, CommentIcon, Ellipsis, Send, Undo} from './icons'
import {toast} from './Toasts'

// J40, Sanity's field comments: a comment button on every field (shown on hover,
// or always with a count once the field has open threads), a composer under it,
// and the Comments inspector beside the document — threads grouped by field,
// Open / Resolved, reply, resolve and re-open, edit and delete your own. Storage:
// lib/comments.ts.

type Api = {
  docId: string
  docType: string
  threads: Thread[]
  /** Open the inspector, on a field's threads when given. */
  open: (fieldPath?: string) => void
}
export const CommentsContext = createContext<Api | null>(null)

const nameOf = (email: string | null | undefined) => (email ? email.replace(/@.*/, '') : 'Unknown user')
const initialOf = (email: string | null | undefined) => (email ? email[0]!.toUpperCase() : '?')
const newId = () => `comment-${crypto.randomUUID()}`

/** The field's comment button and its composer (Sanity's CommentsField). */
export function FieldComments({path, title}: {path: string; title: string}) {
  const api = useContext(CommentsContext)
  const [composing, setComposing] = useState(false)
  // J43: closing the composer hands focus back to the button that opened it.
  const opener = useRef<HTMLButtonElement>(null)
  const close = () => (setComposing(false), requestAnimationFrame(() => opener.current?.focus()))
  if (!api) return null
  const open = api.threads.filter((t) => t.root.fieldPath === path && t.status === 'open')
  return (
    <div className="field-comments" data-has={open.length || undefined}>
      {open.length ? (
        <button type="button" className="comment-count" aria-label="Open comments" title={open.length === 1 ? 'View comment' : 'View comments'} onClick={() => api.open(path)}>
          <CommentIcon /> {open.length}
        </button>
      ) : (
        <button ref={opener} type="button" className="icon-btn comment-add" aria-label="Add comment" title="Add comment" aria-expanded={composing} onClick={() => setComposing(true)}>
          <AddComment />
        </button>
      )}
      {composing && (
        <div className="popover comment-popover">
          <Composer
            label={`Add comment to ${title}`}
            placeholder={<>Add comment to <strong>{title}</strong></>}
            autoFocus
            onSend={async (message) => {
              await postComment({data: {id: newId(), documentId: api.docId, documentType: api.docType, fieldPath: path, message}})
              setComposing(false)
              api.open(path)
            }}
            onCancel={close}
          />
        </div>
      )}
    </div>
  )
}

/** Sanity's comment input: avatar, a growing text box, Send (Enter sends, Shift+Enter is a new line); Escape asks before throwing text away. */
function Composer({label, placeholder, initial = '', autoFocus, onSend, onCancel, compact}: {
  label: string
  placeholder: React.ReactNode
  initial?: string
  autoFocus?: boolean
  onSend: (message: string) => Promise<void>
  onCancel?: () => void
  compact?: boolean
}) {
  const {data: me} = useQuery(meQuery)
  const qc = useQueryClient()
  const [text, setText] = useState(initial)
  const [sending, setSending] = useState(false)
  const [discard, setDiscard] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus) box.current?.focus()
  }, [autoFocus])
  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await onSend(text)
      setText('')
      void qc.invalidateQueries({queryKey: ['comments']})
    } catch (err) {
      toast({tone: 'critical', title: 'Failed to send.', description: (err as Error).message})
    } finally {
      setSending(false)
    }
  }
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void send())
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      e.stopPropagation()
      if (text.trim() && text !== initial) setDiscard(true)
      else onCancel()
    }
  }
  return (
    <div className={`composer${compact ? ' compact' : ''}`}>
      {!compact && <span className="avatar">{initialOf(me?.email)}</span>}
      <div className="composer-box">
        {!text && <span className="composer-placeholder" aria-hidden="true">{placeholder}</span>}
        <textarea ref={box} rows={1} aria-label={label} value={text} disabled={sending} onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
        <button type="button" className="icon-btn send" aria-label="Send comment" title="Send comment" disabled={!text.trim() || sending} onClick={() => void send()}>
          <Send />
        </button>
      </div>
      {discard && (
        <ConfirmDialog
          title="Discard comment?"
          body="Do you want to discard the comment?"
          confirm="Discard"
          onConfirm={() => (setDiscard(false), setText(''), onCancel?.())}
          onClose={() => (setDiscard(false), box.current?.focus())}
        />
      )}
    </div>
  )
}

/** Over the whole document pane (not inside the inspector or the field), like the other dialogs. */
function ConfirmDialog({title, body, confirm, onConfirm, onClose}: {title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void}) {
  return (
    <PaneOverlay>
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog confirm-dialog" aria-modal="true" aria-label={title} onClose={onClose}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>{body}</p>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            {confirm}
          </button>
        </footer>
      </DialogBox>
    </div>
    </PaneOverlay>
  )
}

/** Sanity's Comments inspector. */
export function CommentsPanel({docId, docType, fieldTitle, focusField, onGoToField, onClose}: {
  docId: string
  docType: string
  fieldTitle: (path: string) => string
  focusField?: string
  onGoToField: (path: string) => void
  onClose: () => void
}) {
  const {data, isPending, isError} = useQuery(commentsQuery(docId))
  const [status, setStatus] = useState<CommentStatus>('open')
  const [menu, setMenu] = useState(false)
  const threads = threadsOf(data ?? []).filter((t) => t.status === status)
  const fields = [...new Set(threads.map((t) => t.root.fieldPath))]
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusField) list.current?.querySelector(`[data-field="${CSS.escape(focusField)}"]`)?.scrollIntoView({block: 'nearest'})
  }, [focusField, data])
  return (
    <aside className="inspector comments" aria-label="Comments">
      <header>
        <h2>Comments</h2>
        <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
          <button type="button" className="chip-btn plain" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            {status === 'open' ? 'Open' : 'Resolved'} <ChevronDown />
          </button>
          {menu && (
            <MenuPopover className="popover menu comments-status" onClose={() => setMenu(false)}>
              {(['open', 'resolved'] as const).map((s) => (
                <button key={s} type="button" role="menuitemradio" aria-checked={status === s} className="menu-item check" onClick={() => (setStatus(s), setMenu(false))}>
                  {s === 'open' ? 'Open comments' : 'Resolved comments'}
                </button>
              ))}
            </MenuPopover>
          )}
        </div>
        <button type="button" className="icon-btn" aria-label="Close comments" onClick={onClose}>
          <Close />
        </button>
      </header>
      <div className="comments-list" ref={list}>
        {isPending && <p className="muted" role="status">Loading comments</p>}
        {isError && <p role="alert">Something went wrong</p>}
        {data && threads.length === 0 && (
          <div className="comments-empty">
            <p className="title">{status === 'open' ? 'No open comments yet' : 'No resolved comments yet'}</p>
            <p className="muted">{status === 'open' ? 'Open comments on this document will be shown here.' : 'Resolved comments on this document will be shown here.'}</p>
          </div>
        )}
        {fields.map((f) => (
          <section key={f} className="comment-group" data-field={f} data-focused={f === focusField || undefined}>
            <button type="button" className="comment-field" aria-label={`Go to ${fieldTitle(f)} field`} onClick={() => onGoToField(f)}>
              {fieldTitle(f)}
            </button>
            {threads
              .filter((t) => t.root.fieldPath === f)
              .map((t) => (
                <ThreadCard key={t.root._id} thread={t} docId={docId} docType={docType} />
              ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

function ThreadCard({thread, docId, docType}: {thread: Thread; docId: string; docType: string}) {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({queryKey: ['comments']})
  const resolved = thread.status === 'resolved'
  const toggle = async () => {
    try {
      await setThreadStatus({data: {threadId: thread.root._id, status: resolved ? 'open' : 'resolved'}})
      refresh()
    } catch (err) {
      toast({tone: 'critical', title: 'Could not update the comment', description: (err as Error).message})
    }
  }
  return (
    <article className="comment-thread" data-status={thread.status}>
      <CommentItem comment={thread.root} replyIds={thread.replies.map((r) => r._id)} head onToggle={toggle} resolved={resolved} />
      {thread.replies.map((r) => (
        <CommentItem key={r._id} comment={r} />
      ))}
      {!resolved && (
        <Composer
          compact
          label="Reply"
          placeholder="Reply"
          onSend={async (message) => void (await postComment({data: {id: newId(), documentId: docId, documentType: docType, fieldPath: thread.root.fieldPath, message, parentCommentId: thread.root._id}}))}
        />
      )}
    </article>
  )
}

function CommentItem({comment, head, replyIds = [], resolved, onToggle}: {comment: Comment; head?: boolean; replyIds?: string[]; resolved?: boolean; onToggle?: () => void}) {
  const {data: me} = useQuery(meQuery)
  const qc = useQueryClient()
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const mine = (comment.authorEmail ?? null) === (me?.email ?? null)
  const thread = head && replyIds.length > 0
  return (
    <div className="comment-item">
      <span className="avatar">{initialOf(comment.authorEmail)}</span>
      <div className="comment-body">
        <div className="comment-meta">
          <strong>{nameOf(comment.authorEmail)}</strong>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
            {ago(comment.createdAt)}
          </time>
          {comment.editedAt && <span className="muted">(edited)</span>}
          <span className="comment-actions">
            {head && onToggle && (
              <button type="button" className="icon-btn" aria-label={resolved ? 'Re-open' : 'Mark comment as resolved'} title={resolved ? 'Re-open' : 'Mark as resolved'} onClick={onToggle}>
                {resolved ? <Undo /> : <Check />}
              </button>
            )}
            {mine && (
              <span className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
                <button type="button" className="icon-btn" aria-label="Open comment actions menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                  <Ellipsis />
                </button>
                {menu && (
                  <MenuPopover className="popover menu" onClose={() => setMenu(false)}>
                    <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), setEditing(true))}>
                      Edit comment
                    </button>
                    <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(false), setDeleting(true))}>
                      Delete comment
                    </button>
                  </MenuPopover>
                )}
              </span>
            )}
          </span>
        </div>
        {editing ? (
          <Composer
            compact
            autoFocus
            label="Edit comment"
            placeholder=""
            initial={comment.message}
            onSend={async (message) => (await editComment({data: {id: comment._id, message}}), setEditing(false))}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <p className="comment-message">{comment.message}</p>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={thread ? 'Delete this comment thread?' : 'Delete this comment?'}
          body={thread ? 'This comment and its replies will be deleted, and once deleted cannot be recovered.' : 'Once deleted, a comment cannot be recovered.'}
          confirm={thread ? 'Delete thread' : 'Delete comment'}
          onConfirm={async () => {
            setDeleting(false)
            try {
              await deleteComment({data: {id: comment._id, replyIds: head ? replyIds : []}})
              void qc.invalidateQueries({queryKey: ['comments']})
            } catch (err) {
              toast({tone: 'critical', title: 'An error occurred while deleting the comment. Please try again.', description: (err as Error).message})
            }
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  )
}
