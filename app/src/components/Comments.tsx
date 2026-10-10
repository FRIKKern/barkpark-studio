import {createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {commentsQuery, deleteComment, editComment, mentionableQuery, postComment, setThreadStatus, threadsOf, type Comment, type CommentStatus, type Thread} from '../lib/comments'
import {insertMention, mentionAt, messageParts, personName} from '../lib/comment-threads'
import {meQuery, useCanWrite} from '../lib/session'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import {ago} from './HistoryPanel'
import {intlTag, useLocale, useT, type T} from '../lib/i18n'
import {AddComment, Check, ChevronDown, Close, CommentIcon, Ellipsis, Mention, Send, Undo} from './icons'
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

const nameOf = (t: T, email: string | null | undefined) => (email ? email.replace(/@.*/, '') : t('Unknown user'))
const initialOf = (email: string | null | undefined) => (email ? email[0]!.toUpperCase() : '?')
const newId = () => `comment-${crypto.randomUUID()}`

/** The field's comment button and its composer (Sanity's CommentsField). */
export function FieldComments({path, title}: {path: string; title: string}) {
  const {commentReason} = useCanWrite()
  const api = useContext(CommentsContext)
  const t = useT()
  const [composing, setComposing] = useState(false)
  // J43: closing the composer hands focus back to the button that opened it.
  const opener = useRef<HTMLButtonElement>(null)
  const close = () => (setComposing(false), requestAnimationFrame(() => opener.current?.focus()))
  if (!api) return null
  const open = api.threads.filter((th) => th.root.fieldPath === path && th.status === 'open')
  return (
    <div className="field-comments" data-has={open.length || undefined}>
      {open.length ? (
        <button type="button" className="comment-count" aria-label={t('Open comments')} title={open.length === 1 ? t('View comment') : t('View comments')} onClick={() => api.open(path)}>
          <CommentIcon /> {open.length}
        </button>
      ) : (
        <button ref={opener} type="button" className="icon-btn comment-add" aria-label={t('Add comment')} data-tip={t('Add comment')} title={commentReason} disabled={!!commentReason} aria-expanded={composing} onClick={() => setComposing(true)}>
          <AddComment />
        </button>
      )}
      {composing && (
        <div className="popover comment-popover">
          <Composer
            label={t('Add comment to {field}', {field: title})}
            placeholder={<>{t('Add comment to')} <strong>{title}</strong></>}
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
  const t = useT()
  const qc = useQueryClient()
  const [text, setText] = useState(initial)
  const [sending, setSending] = useState(false)
  const [discard, setDiscard] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus) box.current?.focus()
  }, [autoFocus])
  // Mentions (Sanity's): "@" (typed, or the @ button) opens the list of users; a pick puts @<email> in.
  const [men, setMen] = useState<{start: number; query: string} | null>(null)
  const [active, setActive] = useState(0)
  const listId = useId()
  const {data: people = []} = useQuery({...mentionableQuery, enabled: men !== null})
  const matches = men ? people.filter((p) => p.toLowerCase().includes(men.query.toLowerCase())).slice(0, 8) : []
  const follow = (value: string, caret: number) => (setMen(mentionAt(value, caret)), setActive(0))
  const pick = (email: string) => {
    if (!men) return
    const out = insertMention(text, men.start, box.current?.selectionStart ?? text.length, email)
    setText(out.text)
    setMen(null)
    requestAnimationFrame(() => (box.current?.focus(), box.current?.setSelectionRange(out.caret, out.caret)))
  }
  const openMention = () => {
    const at = box.current?.selectionStart ?? text.length
    const space = at > 0 && !/\s/.test(text[at - 1]!) ? ' ' : ''
    const value = `${text.slice(0, at)}${space}@${text.slice(at)}`
    setText(value)
    setMen({start: at + space.length, query: ''})
    setActive(0)
    const caret = at + space.length + 1
    requestAnimationFrame(() => (box.current?.focus(), box.current?.setSelectionRange(caret, caret)))
  }
  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await onSend(text)
      setText('')
      void qc.invalidateQueries({queryKey: ['comments']})
    } catch (err) {
      toast({tone: 'critical', title: t('Failed to send.'), description: (err as Error).message})
    } finally {
      setSending(false)
    }
  }
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (men) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (matches.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
        return
      }
      // Enter or Tab picks; with nothing to pick, Enter just closes the list (Sanity's).
      if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && matches.length)) {
        e.preventDefault()
        if (matches[active]) pick(matches[active]!)
        else setMen(null)
        return
      }
      if (e.key === 'Escape') return void (e.preventDefault(), e.stopPropagation(), setMen(null))
    }
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
        <textarea
          ref={box}
          rows={1}
          aria-label={label}
          value={text}
          disabled={sending}
          aria-controls={men ? listId : undefined}
          aria-activedescendant={men && matches[active] ? `${listId}-${active}` : undefined}
          onChange={(e) => (setText(e.target.value), follow(e.target.value, e.target.selectionStart))}
          onClick={(e) => follow(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setMen(null)}
          onKeyDown={keys}
        />
        <button type="button" className="icon-btn mention" aria-label={t('Mention user')} title={t('Mention user')} disabled={sending} onMouseDown={(e) => e.preventDefault()} onClick={openMention}>
          <Mention />
        </button>
        <button type="button" className="icon-btn send" aria-label={t('Send comment')} title={t('Send comment')} disabled={!text.trim() || sending} onClick={() => void send()}>
          <Send />
        </button>
      </div>
      {men && (
        <div className="popover mention-menu" role="listbox" id={listId} aria-label={t('List of users to mention')}>
          {matches.length ? (
            matches.map((p, i) => (
              <div key={p} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => (e.preventDefault(), pick(p))} onMouseEnter={() => setActive(i)}>
                <span className="avatar small">{initialOf(p)}</span>
                <span className="mention-name">{personName(p)}</span>
                <span className="muted">{p}</span>
              </div>
            ))
          ) : (
            <p className="muted">{t('No users found')}</p>
          )}
        </div>
      )}
      {discard && (
        <ConfirmDialog
          title={t('Discard comment?')}
          body={t('Do you want to discard the comment?')}
          confirm={t('Discard')}
          onConfirm={() => (setDiscard(false), setText(''), onCancel?.())}
          onClose={() => (setDiscard(false), box.current?.focus())}
        />
      )}
    </div>
  )
}

/** Over the whole document pane (not inside the inspector or the field), like the other dialogs. */
function ConfirmDialog({title, body, confirm, onConfirm, onClose}: {title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void}) {
  const t = useT()
  return (
    <PaneOverlay>
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog confirm-dialog" aria-modal="true" aria-label={title} onClose={onClose}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>{body}</p>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
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
  const t = useT()
  const [status, setStatus] = useState<CommentStatus>('open')
  const [menu, setMenu] = useState(false)
  const threads = threadsOf(data ?? []).filter((th) => th.status === status)
  const fields = [...new Set(threads.map((th) => th.root.fieldPath))]
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusField) list.current?.querySelector(`[data-field="${CSS.escape(focusField)}"]`)?.scrollIntoView({block: 'nearest'})
  }, [focusField, data])
  return (
    <aside className="inspector comments" aria-label={t('Comments')}>
      <header>
        <h2>{t('Comments')}</h2>
        <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
          <button type="button" className="chip-btn plain" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            {status === 'open' ? t('Open') : t('Resolved')} <ChevronDown />
          </button>
          {menu && (
            <MenuPopover className="popover menu comments-status" onClose={() => setMenu(false)}>
              {(['open', 'resolved'] as const).map((s) => (
                <button key={s} type="button" role="menuitemradio" aria-checked={status === s} className="menu-item check" onClick={() => (setStatus(s), setMenu(false))}>
                  {s === 'open' ? t('Open comments') : t('Resolved comments')}
                </button>
              ))}
            </MenuPopover>
          )}
        </div>
        <button type="button" className="icon-btn" aria-label={t('Close comments')} onClick={onClose}>
          <Close />
        </button>
      </header>
      <div className="comments-list" ref={list}>
        {isPending && <p className="muted" role="status">{t('Loading comments')}</p>}
        {isError && <p role="alert">{t('Something went wrong')}</p>}
        {data && threads.length === 0 && (
          <div className="comments-empty">
            <p className="title">{status === 'open' ? t('No open comments yet') : t('No resolved comments yet')}</p>
            <p className="muted">{status === 'open' ? t('Open comments on this document will be shown here.') : t('Resolved comments on this document will be shown here.')}</p>
          </div>
        )}
        {fields.map((f) => (
          <section key={f} className="comment-group" data-field={f} data-focused={f === focusField || undefined}>
            <button type="button" className="comment-field" aria-label={t('Go to {field} field', {field: fieldTitle(f)})} onClick={() => onGoToField(f)}>
              {fieldTitle(f)}
            </button>
            {threads
              .filter((th) => th.root.fieldPath === f)
              .map((th) => (
                <ThreadCard key={th.root._id} thread={th} docId={docId} docType={docType} />
              ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

function ThreadCard({thread, docId, docType}: {thread: Thread; docId: string; docType: string}) {
  const qc = useQueryClient()
  const t = useT()
  const refresh = () => void qc.invalidateQueries({queryKey: ['comments']})
  const resolved = thread.status === 'resolved'
  const toggle = async () => {
    try {
      await setThreadStatus({data: {threadId: thread.root._id, status: resolved ? 'open' : 'resolved'}})
      refresh()
    } catch (err) {
      toast({tone: 'critical', title: t('Could not update the comment'), description: (err as Error).message})
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
          label={t('Reply')}
          placeholder={t('Reply')}
          onSend={async (message) => void (await postComment({data: {id: newId(), documentId: docId, documentType: docType, fieldPath: thread.root.fieldPath, message, parentCommentId: thread.root._id}}))}
        />
      )}
    </article>
  )
}

function CommentItem({comment, head, replyIds = [], resolved, onToggle}: {comment: Comment; head?: boolean; replyIds?: string[]; resolved?: boolean; onToggle?: () => void}) {
  const {data: me} = useQuery(meQuery)
  const t = useT()
  const locale = useLocale()
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
          <strong>{nameOf(t, comment.authorEmail)}</strong>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString(intlTag(locale))}>
            {ago(comment.createdAt, locale)}
          </time>
          {comment.editedAt && <span className="muted">{t('(edited)')}</span>}
          <span className="comment-actions">
            {head && onToggle && (
              <button type="button" className="icon-btn" aria-label={resolved ? t('Re-open') : t('Mark comment as resolved')} title={resolved ? t('Re-open') : t('Mark as resolved')} onClick={onToggle}>
                {resolved ? <Undo /> : <Check />}
              </button>
            )}
            {mine && (
              <span className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
                <button type="button" className="icon-btn" aria-label={t('Open comment actions menu')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                  <Ellipsis />
                </button>
                {menu && (
                  <MenuPopover className="popover menu" onClose={() => setMenu(false)}>
                    <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), setEditing(true))}>
                      {t('Edit comment')}
                    </button>
                    <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(false), setDeleting(true))}>
                      {t('Delete comment')}
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
            label={t('Edit comment')}
            placeholder=""
            initial={comment.message}
            onSend={async (message) => (await editComment({data: {id: comment._id, message}}), setEditing(false))}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <p className="comment-message">
            {messageParts(comment.message).map((part, i) =>
              'mention' in part ? (
                <span key={i} className="mention-chip" title={part.mention}>
                  @{personName(part.mention)}
                </span>
              ) : (
                part.text
              ),
            )}
          </p>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={thread ? t('Delete this comment thread?') : t('Delete this comment?')}
          body={thread ? t('This comment and its replies will be deleted, and once deleted cannot be recovered.') : t('Once deleted, a comment cannot be recovered.')}
          confirm={thread ? t('Delete thread') : t('Delete comment')}
          onConfirm={async () => {
            setDeleting(false)
            try {
              await deleteComment({data: {id: comment._id, replyIds: head ? replyIds : []}})
              void qc.invalidateQueries({queryKey: ['comments']})
            } catch (err) {
              toast({tone: 'critical', title: t('An error occurred while deleting the comment. Please try again.'), description: (err as Error).message})
            }
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  )
}
