import {createContext, forwardRef, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react'
import {createPortal} from 'react-dom'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {commentsQuery, readerCommentsQuery, deleteComment, editComment, postComment, reactToComment, setThreadStatus, threadsOf, type Comment, type CommentStatus, type Thread} from '../lib/comments'
import {peopleQuery} from '../lib/people'
import {insertMention, mentionAt, messageParts, REACTIONS, reactionGroups} from '../lib/comment-threads'
import {meQuery, useCanWrite} from '../lib/session'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import {ago} from './HistoryPanel'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {AddComment, Check, ChevronDown, Close, CommentIcon, Ellipsis, LinkRemoved, Mention, Send, Undo} from './icons'
import {toast} from './Toasts'
import {PersonName} from './Presence'
import {localPart, usePersonName} from '../lib/person'
import {peopleNamesQuery} from '../lib/people'
import {glide} from '../lib/layout'

// J40, Sanity's field comments: a comment button on every field (shown on hover,
// or always with a count once the field has open threads), a composer under it,
// and the Comments inspector beside the document — threads grouped by field,
// Open / Resolved, reply, resolve and re-open, edit and delete your own. Storage:
// lib/comments.ts.

type Api = {
  docId: string
  docType: string
  threads: Thread[]
  /** Open the inspector, on a field's threads when given, and on one thread (an inline comment's). */
  open: (fieldPath?: string, threadId?: string) => void
  /** The thread the author has picked (Sanity's selected thread): its span of text shows active. */
  active?: string
  select: (threadId?: string) => void
}
export const CommentsContext = createContext<Api | null>(null)

// No author email: written in shared-token mode, where nobody is signed in and the
// studio itself writes. It is named as presence names that session ("Studio").
/** A comment avatar's letter: the first of the person's name (lib/person.ts), S for the studio. */
const PersonInitial = ({who}: {who: string | null | undefined}) => <>{usePersonName(who)?.[0]?.toUpperCase() ?? 'S'}</>
export const newId = () => `comment-${crypto.randomUUID()}`

/** The field's comment button and its composer (Sanity's CommentsField). */
export function FieldComments({path, title, titleId}: {path: string; title: string; titleId?: string}) {
  const {canWrite, commentReason: lockedReason} = useCanWrite()
  // J49: Sanity's Viewer comments; ours may when the comment schema lets read seats write.
  const {data: readers} = useQuery({...readerCommentsQuery, enabled: !canWrite})
  const commentReason = canWrite || readers ? undefined : lockedReason
  const api = useContext(CommentsContext)
  const t = useT()
  const [composing, setComposing] = useState(false)
  // J43: closing the composer hands focus back to the button that opened it (or, once the field
  // has a comment, the count that takes its place).
  const opener = useRef<HTMLSpanElement>(null)
  const close = () => (setComposing(false), requestAnimationFrame(() => requestAnimationFrame(() => opener.current?.focus())))
  // After a send the add button turns into the count when the new thread arrives: it takes the focus.
  const refocus = useRef(false)
  const count = api ? api.threads.filter((th) => th.root.fieldPath === path && th.status === 'open').length : 0
  useEffect(() => {
    if (refocus.current && count) (refocus.current = false), opener.current?.focus()
  }, [count])
  if (!api) return null
  const open = api.threads.filter((th) => th.root.fieldPath === path && th.status === 'open')
  return (
    <div className="field-comments" data-has={open.length || undefined}>
      {/* J49: not <button>s, and the composer in a layer of its own: a Viewer's form is a
          disabled fieldset, which would disable them too, and a Viewer may comment. */}
      {open.length ? (
        <SpanButton ref={opener} className="comment-count" aria-label={t('Open comments')} aria-describedby={titleId} title={open.length === 1 ? t('View comment') : t('View comments')} onPress={() => api.open(path)}>
          <CommentIcon /> {open.length}
        </SpanButton>
      ) : (
        <SpanButton ref={opener} className="icon-btn comment-add" aria-label={t('Add comment')} aria-describedby={titleId} data-tip={t('Add comment')} title={commentReason} disabled={!!commentReason} aria-expanded={composing} onPress={() => setComposing(true)}>
          <AddComment />
        </SpanButton>
      )}
      {composing && (
        <FollowLayer anchor={opener} className="popover comment-popover">
          <Composer
            label={t('Add comment to {field}', {field: title})}
            placeholder={<>{t('Add comment to')} <strong>{title}</strong></>}
            autoFocus
            onSend={async (message) => {
              await postComment({data: {id: newId(), documentId: api.docId, documentType: api.docType, fieldPath: path, message}})
              // Sanity's: the composer closes and focus goes back to the field's comment button
              // (now its count), while the panel shows the new thread.
              refocus.current = true
              close()
              api.open(path)
            }}
            onCancel={close}
          />
        </FollowLayer>
      )}
    </div>
  )
}

/** A button that a disabled fieldset around it leaves alone (role=button; Enter and Space press it). */
const SpanButton = forwardRef<HTMLSpanElement, {onPress: () => void; disabled?: boolean; children: React.ReactNode} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'onClick'> & Record<`data-${string}`, string | undefined>>(function SpanButton({onPress, disabled, children, ...rest}, ref) {
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      {...rest}
      onClick={() => !disabled && onPress()}
      onKeyDown={(e) => {
        if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        onPress()
      }}
    >
      {children}
    </span>
  )
})

/** The field composer, in a layer on the page under its button (outside the form), following it as the form scrolls. */
function FollowLayer({anchor, className, children}: {anchor: React.RefObject<HTMLElement | null>; className: string; children: React.ReactNode}) {
  const [box, setBox] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const place = () => anchor.current && setBox(anchor.current.getBoundingClientRect())
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => (window.removeEventListener('scroll', place, true), window.removeEventListener('resize', place))
  }, [anchor])
  if (!box) return null
  return createPortal(
    <div className={className} style={{position: 'fixed', top: box.bottom + 4, left: Math.max(8, box.right - 320)}}>
      {children}
    </div>,
    document.body,
  )
}

/** Sanity's comment input: avatar, a growing text box, Send (Enter sends, Shift+Enter is a new line); Escape asks before throwing text away. */
export function Composer({label, placeholder, initial = '', autoFocus, onSend, onCancel, compact}: {
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
  // Asked as the composer opens, so the list is there by the time '@' is typed (it said
  // 'No users found' while still loading).
  const {data: people = [], isPending: peoplePending} = useQuery(peopleQuery)
  const {data: known} = useQuery(peopleNamesQuery)
  // By email or by name (lib/person.ts).
  const matches = men ? people.filter((p) => `${p} ${known?.[p] ?? ''}`.toLowerCase().includes(men.query.toLowerCase())).slice(0, 8) : []
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
      {!compact && (
        <span className="avatar">
          <PersonInitial who={me?.email} />
        </span>
      )}
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
          {peoplePending ? (
            <p className="muted">{t('Loading…')}</p>
          ) : matches.length ? (
            matches.map((p, i) => (
              <div key={p} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => (e.preventDefault(), pick(p))} onMouseEnter={() => setActive(i)}>
                <span className="avatar small">
                  <PersonInitial who={p} />
                </span>
                <span className="mention-name">
                  <PersonName who={p} />
                </span>
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

const ONBOARDED = 'bp-comments-onboarded'
const seen = () => {
  try {
    return localStorage.getItem(ONBOARDED) === '1'
  } catch {
    return true
  }
}

/**
 * Sanity's first-time hint beside the Comments panel: a 280 px card 4 px left of it, level
 * with its top; Got it puts it away for good. Drawn in the pane (the panel scrolls, and
 * would clip it), placed from the panel's own box.
 */
function CommentsOnboarding({panel}: {panel: React.RefObject<HTMLElement | null>}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(!seen()), [])
  const [place, setPlace] = useState<{top: number; right: number} | null>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const aside = panel.current
    const pane = aside?.closest<HTMLElement>('.pane.doc')
    if (!open || !aside || !pane) return
    const a = aside.getBoundingClientRect()
    const p = pane.getBoundingClientRect()
    setPlace({top: a.top - p.top, right: p.right - a.left + 4})
  }, [open, panel])
  if (!open || !place) return null
  const done = () => {
    try {
      localStorage.setItem(ONBOARDED, '1')
    } catch {
      // Private mode: it shows again next time.
    }
    setOpen(false)
  }
  return (
    <PaneOverlay whole>
      <section className="comments-onboarding" aria-labelledby={titleId} style={{top: place.top, right: place.right}}>
        <h3 id={titleId}>{t('Document fields now have comments')}</h3>
        <p>{t("You can add comments to any field in a document. They'll show up here, grouped by field.")}</p>
        <button type="button" className="btn btn-primary" onClick={done}>
          {t('Got it')}
        </button>
      </section>
    </PaneOverlay>
  )
}

/** Sanity's Comments inspector. */
export function CommentsPanel({docId, docType, fieldTitle, focusField, active, onSelect, onGoToField, onClose}: {
  docId: string
  docType: string
  fieldTitle: (path: string) => string
  focusField?: string
  /** The picked thread: marked, and scrolled to in the list. */
  active?: string
  onSelect: (threadId: string) => void
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
  // A comment's link (Copy link to comment): its thread's tab, scrolled to and marked.
  const linked = typeof location !== 'undefined' && location.hash.startsWith('#comment-') ? location.hash.slice('#comment-'.length) : null
  const linkedThread = linked ? threadsOf(data ?? []).find((th) => th.root._id === linked || th.replies.some((r) => r._id === linked)) : undefined
  useEffect(() => {
    if (linkedThread && linkedThread.status !== status) setStatus(linkedThread.status)
    const el = linked ? document.getElementById(`comment-${linked}`) : null
    if (el) (el.scrollIntoView({block: 'center'}), el.setAttribute('data-linked', ''))
  }, [linked, linkedThread?.status, data])
  // An inline comment's highlight picked in the body: its thread, scrolled to.
  const activeThread = active ? threadsOf(data ?? []).find((th) => th.root._id === active) : undefined
  useEffect(() => {
    if (activeThread && activeThread.status !== status) setStatus(activeThread.status)
    if (active) list.current?.querySelector(`[data-thread="${CSS.escape(active)}"]`)?.scrollIntoView({block: 'nearest'})
  }, [active, activeThread?.status, data])
  const panel = useRef<HTMLElement>(null)
  return (
    <aside ref={panel} className="inspector comments" aria-label={t('Comments')}>
      <CommentsOnboarding panel={panel} />
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
                <ThreadCard key={th.root._id} thread={th} docId={docId} docType={docType} active={th.root._id === active} onSelect={() => onSelect(th.root._id)} />
              ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

function ThreadCard({thread, docId, docType, active, onSelect}: {thread: Thread; docId: string; docType: string; active: boolean; onSelect: () => void}) {
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
    // Picking a thread on a span of text marks that span in the body and brings it into view (Sanity's).
    <article
      className="comment-thread"
      data-status={thread.status}
      data-thread={thread.root._id}
      data-active={active || undefined}
      onClick={(e) => {
        // Its own controls (resolve, menu, reply) do their own thing.
        if (!thread.root.selection || (e.target as HTMLElement).closest('button, textarea, [role=menu], [role=button]')) return
        onSelect()
        document.querySelector(`.bp-comment-range[data-comment-id="${CSS.escape(thread.root._id)}"]`)?.scrollIntoView({block: 'center', behavior: glide()})
      }}
    >
      {thread.root.selection && <CommentedText text={thread.root.contentSnapshot ?? ''} gone={!!thread.root.textDeleted} />}
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

/**
 * Sanity's referenced value: the text an inline comment is on, cut at 250 characters; once
 * deleted, a grey rule and a link-removed mark that says so.
 */
function CommentedText({text, gone}: {text: string; gone: boolean}) {
  const t = useT()
  const note = t('The commented text has been deleted')
  return (
    <blockquote className="commented-text" data-gone={gone || undefined}>
      {gone && (
        <span className="commented-gone" role="img" aria-label={note} data-tip={note}>
          <LinkRemoved />
        </span>
      )}
      {text.length <= 250 ? text : `${text.slice(0, 250)}...`}
    </blockquote>
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
  // The author by name (lib/person.ts); a shared-token comment is the studio's.
  const author = usePersonName(comment.authorEmail) ?? t('Studio')
  // A read seat writes its comments but never deletes (Barkpark #22790 refuses it).
  const {canWrite} = useCanWrite()
  const thread = head && replyIds.length > 0
  return (
    <div className="comment-item" id={`comment-${comment._id}`}>
      <span className="avatar">{author[0]!.toUpperCase()}</span>
      <div className="comment-body">
        <div className="comment-meta">
          <strong>{author}</strong>
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
            <ReactionPicker comment={comment} />
            {(
              <span className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
                <button type="button" className="icon-btn" aria-label={t('Open comment actions menu')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                  <Ellipsis />
                </button>
                {menu && (
                  <MenuPopover className="popover menu" onClose={() => setMenu(false)}>
                    {mine && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), setEditing(true))}>
                        {t('Edit comment')}
                      </button>
                    )}
                    {mine && (
                      <button type="button" role="menuitem" className="menu-item danger" disabled={!canWrite} title={canWrite ? undefined : t('Your role Viewer does not have permission to delete this comment.')} onClick={() => (setMenu(false), setDeleting(true))}>
                        {t('Delete comment')}
                      </button>
                    )}
                    {/* Sanity's: a link that opens this document's comments at this one. */}
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        setMenu(false)
                        navigator.clipboard.writeText(`${location.href.split('#')[0]}#comment-${comment._id}`).catch(() => toast({tone: 'critical', title: t('Unable to copy link to clipboard')}))
                      }}
                    >
                      {t('Copy link to comment')}
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
                  @<PersonName who={part.mention} />
                </span>
              ) : (
                part.text
              ),
            )}
          </p>
        )}
        <Reactions comment={comment} />
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

/** Sanity's reactions under a comment: each with its count; yours pressed; a click takes yours back or adds it. */
function Reactions({comment}: {comment: Comment}) {
  const t = useT()
  const qc = useQueryClient()
  const {data: me} = useQuery(meQuery)
  const {data: known} = useQuery(peopleNamesQuery)
  const groups = reactionGroups(comment.reactions)
  if (!groups.length) return null
  const names = (users: (string | null)[]) => users.map((u) => (u && u === (me?.email ?? null) ? t('you') : u ? (known?.[u] ?? localPart(u)) : t('Studio'))).join(', ')
  return (
    <div className="comment-reactions">
      {groups.map((g) => {
        const mine = g.users.includes(me?.email ?? null)
        const tip = t('{users} reacted with {reaction}', {users: names(g.users), reaction: t(g.title)})
        return (
          <button key={g.shortName} type="button" className="reaction" aria-pressed={mine} aria-label={tip} data-tip={tip} onClick={() => void reactToComment({data: {id: comment._id, shortName: g.shortName}}).then(() => qc.invalidateQueries({queryKey: ['comments']}))}>
            <span aria-hidden="true">{g.emoji}</span> {g.users.length}
          </button>
        )
      })}
    </div>
  )
}

/** Sanity's "Add reaction": its six, by name. */
function ReactionPicker({comment}: {comment: Comment}) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  return (
    <span className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button type="button" className="icon-btn" aria-label={t('Add reaction')} data-tip={t('Add reaction')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" className="add-reaction">☺︎</span>
      </button>
      {open && (
        <MenuPopover className="popover menu reaction-menu" onClose={() => setOpen(false)} aria-label={t('Add reaction')}>
          {REACTIONS.map((r) => (
            <button key={r.shortName} type="button" role="menuitem" className="menu-item" aria-label={t('React with {reaction}', {reaction: t(r.title)})} data-tip={t(r.title)} onClick={() => (setOpen(false), void reactToComment({data: {id: comment._id, shortName: r.shortName}}).then(() => qc.invalidateQueries({queryKey: ['comments']})))}>
              {r.emoji}
            </button>
          ))}
        </MenuPopover>
      )}
    </span>
  )
}
