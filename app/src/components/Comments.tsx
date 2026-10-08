import {createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {commentsQuery, deleteComment, editComment, mentionableQuery, postComment, setThreadStatus, threadsOf, type Comment, type CommentStatus, type Thread} from '../lib/comments'
import {insertMention, mentionAt, messageParts, personName} from '../lib/comment-threads'
import {meQuery} from '../lib/session'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
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

export const nameOf = (t: T, email: string | null | undefined) => (email ? email.replace(/@.*/, '') : t('Unknown user'))
export const initialOf = (email: string | null | undefined) => (email ? email[0]!.toUpperCase() : '?')
export const newId = () => `comment-${crypto.randomUUID()}`

/** The field's comment button and its composer (Sanity's CommentsField). */
export function FieldComments({path, title}: {path: string; title: string}) {
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
        <button ref={opener} type="button" className="icon-btn comment-add" aria-label={t('Add comment')} title={t('Add comment')} aria-expanded={composing} onClick={() => setComposing(true)}>
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
export function ConfirmDialog({title, body, confirm, onConfirm, onClose}: {title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void}) {
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
