import {useEffect, useRef, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {commentsQuery, deleteComment, editComment, postComment, setThreadStatus, threadsOf, type Comment, type CommentStatus, type Thread} from '../lib/comments'
import {messageParts, personName} from '../lib/comment-threads'
import {meQuery} from '../lib/session'
import {ago, intlTag, useLocale, useT} from '../lib/i18n'
import {CommentsContext, Composer, ConfirmDialog, initialOf, nameOf, newId} from './Comments'
import {Check, ChevronDown, Close, CommentIcon, Ellipsis, Undo} from './icons'
import {MenuPopover} from './FocusScopes'
import {toast} from './Toasts'

// J40: the Comments inspector beside the document (its own chunk: it loads when the
// panel opens, not with every document). The field buttons and composer: Comments.tsx.

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
