import {useEffect, useRef, useState, type ReactNode} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate, useRouter, useRouterState} from '@tanstack/react-router'
import {accessQuery, answerInvite, askAccess, withdrawAccess} from '../lib/access-calls'
import {NOTE_MAX, noteToSend, pollEvery, refusal, roleWords, screenFor, type Action, type Words} from '../lib/access-request'
import {dateTitle, useLocale, useT} from '../lib/i18n'
import {useZone} from '../lib/now'
import {signOutHere} from '../lib/sign-out'
import '../request-access.css'

// Another tab of this browser asked, withdrew or answered: read again here at once.
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bp-access')

/**
 * task-cc6a6d85be054b17, Sanity's request-access screen (@sanity/access-ui RequestAccessForm):
 * signed in with no seat in the URL's workspace (or no such workspace: Barkpark answers both
 * alike, and so does this), the person asks for one with an optional message, sees it
 * pending with the date sent and may withdraw it; a decline says so and offers asking again.
 * A pending invitation here offers Accept and Decline instead. While a request waits the
 * screen asks every 15 s, and an approval opens the workspace without a reload.
 */
export function RequestAccess({email}: {email: string}) {
  const t = useT()
  const qc = useQueryClient()
  const router = useRouter()
  const locale = useLocale()
  const zone = useZone()
  const [entered, setEntered] = useState<ReadonlySet<string>>(new Set())
  const [askAgain, setAskAgain] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<Action>()
  const [notice, setNotice] = useState<Words>()
  const [declining, setDeclining] = useState(false)
  // One call at a time: a slow answer never sends the same ask (or withdraw) twice.
  const sending = useRef(false)
  const access = useQuery({...accessQuery, refetchInterval: (q) => pollEvery(screenFor(q.state.data, {entered, askAgain}))})
  const screen = screenFor(access.data, {entered, askAgain})
  const heading = useRef<HTMLHeadingElement>(null)
  const shown = useRef(screen.view)

  // Who is signed in, asked again: in now (the screen goes), signed out (the sign-in screen), or still here.
  const enter = async () => {
    await qc.invalidateQueries({queryKey: ['me']})
    await Promise.all([qc.invalidateQueries({predicate: (q) => q.queryKey[0] !== 'me'}), router.invalidate()])
  }
  const reread = () => qc.invalidateQueries({queryKey: ['access']})

  useEffect(() => {
    if (!channel) return
    const f = () => void reread()
    channel.addEventListener('message', f)
    return () => channel.removeEventListener('message', f)
  }, [])
  // The server found no session: whoAmI says so too, and the gate shows the sign-in screen.
  useEffect(() => void (access.data?.kind === 'signed_out' && qc.invalidateQueries({queryKey: ['me']})), [access.data, qc])
  // Approved: let in once. Still here after that, the seat has gone since: ask again.
  const approvedId = screen.view === 'approved' ? screen.id : undefined
  useEffect(() => {
    if (!approvedId) return
    void enter().finally(() => setEntered((s) => new Set(s).add(approvedId)))
  }, [approvedId])
  // A new state (sent, withdrawn, decided): focus its heading, never lost to a removed button.
  useEffect(() => {
    if (shown.current !== screen.view) heading.current?.focus()
    shown.current = screen.view
  }, [screen.view])

  const run = async (action: Action, call: () => Promise<{ok: true} | {ok: false; answer: {status: number}}>, done?: () => void | Promise<void>) => {
    if (sending.current) return
    sending.current = true
    setBusy(action)
    setNotice(undefined)
    try {
      const r = await call().catch(() => ({ok: false as const, answer: {status: 0}}))
      if (r.ok) {
        await done?.()
        channel?.postMessage('changed')
        await reread()
        return
      }
      const {then, words} = refusal(action, r.answer)
      setNotice(words)
      if (then === 'refresh_me') await enter()
      if (then === 'refetch') await reread()
    } finally {
      sending.current = false
      setBusy(undefined)
    }
  }

  const date = (iso: string | null) => (iso ? dateTitle(iso, locale, zone) : '')
  const alert = notice && (
    <p className="access-alert" role="alert">
      {t(notice.en, notice.vars)}
    </p>
  )
  const title = (words: string) => (
    <h1 ref={heading} tabIndex={-1}>
      {t(words)}
    </h1>
  )

  let body: ReactNode
  if (screen.view === 'loading') body = <p className="muted">{t('Checking your access…')}</p>
  else if (screen.view === 'unavailable')
    body = (
      <>
        {title("You don't have access to this workspace")}
        <p>{t("Your account doesn't have access to this content. Ask a workspace admin to add you.")}</p>
      </>
    )
  else if (screen.view === 'failed')
    body = (
      <>
        {title('Request access')}
        <p className="access-alert" role="alert">
          {t(refusal('load', access.data?.kind === 'error' ? access.data.answer : {status: 0}).words.en)}
        </p>
        <button type="button" className="btn btn-ghost" disabled={access.isFetching} onClick={() => void access.refetch()}>
          {t('Retry')}
        </button>
      </>
    )
  else if (screen.view === 'invited') {
    const {invitation} = screen
    body = (
      <>
        {title("You've been invited")}
        <p className="muted">{t("You've been invited to join {workspace} as {role}.", {workspace: invitation.workspace_name || invitation.workspace, role: t(roleWords(invitation.role))})}</p>
        {alert}
        {declining ? (
          <>
            <p>{t('Decline the invitation? An admin would have to invite you again.')}</p>
            <button type="button" className="publish danger access-wide" disabled={!!busy} onClick={() => void run('decline', () => answerInvite({data: {id: invitation.id, accept: false}}), () => setDeclining(false))}>
              {busy === 'decline' ? t('Declining…') : t('Decline invitation')}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => setDeclining(false)}>
              {t('Keep it')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="publish access-wide" disabled={!!busy} onClick={() => void run('accept', () => answerInvite({data: {id: invitation.id, accept: true}}), enter)}>
              {busy === 'accept' ? t('Accepting…') : t('Accept invitation')}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => (setNotice(undefined), setDeclining(true))}>
              {t('Decline')}
            </button>
          </>
        )}
      </>
    )
  } else if (screen.view === 'pending')
    body = (
      <>
        {title('Access request sent')}
        <p className="muted" role="status">
          {t('Your request to access this workspace is pending approval.')}
        </p>
        <p className="muted">{t('Sent {date}', {date: date(screen.sentAt)})}</p>
        {screen.note && <blockquote className="access-note">{screen.note}</blockquote>}
        <p className="muted">{t('This page opens the workspace once an admin approves.')}</p>
        {alert}
        <button type="button" className="btn btn-ghost access-wide" disabled={!!busy} onClick={() => void run('withdraw', () => withdrawAccess({data: {id: screen.id}}))}>
          {busy === 'withdraw' ? t('Withdrawing…') : t('Withdraw request')}
        </button>
      </>
    )
  else if (screen.view === 'denied')
    body = (
      <>
        {title('Access request declined')}
        <p className="access-caution" role="status">
          {t('Your request to access this workspace has been declined.')}
        </p>
        {screen.decidedAt && <p className="muted">{t('Declined {date}', {date: date(screen.decidedAt)})}</p>}
        <button type="button" className="btn btn-ghost access-wide" onClick={() => (setNotice(undefined), setAskAgain(true))}>
          {t('Ask again')}
        </button>
      </>
    )
  else if (screen.view === 'approved')
    body = (
      <>
        {title('Access approved')}
        <p className="muted" role="status">
          {t('Opening the workspace…')}
        </p>
      </>
    )
  else
    body = (
      <>
        {title('Request access')}
        <p className="muted">{t("Your account doesn't have access to this content.")}</p>
        {screen.again === 'denied' && <p className="muted">{t('Your earlier request was declined. You may ask again.')}</p>}
        {screen.again === 'removed' && <p className="muted">{t('Your earlier request was approved, but you no longer have a seat here. You may ask again.')}</p>}
        <form
          className="access-form"
          aria-label={t('Request access')}
          onSubmit={(e) => {
            e.preventDefault()
            void run('ask', () => askAccess({data: {note: noteToSend(note)}}), () => (setNote(''), setAskAgain(false)))
          }}
        >
          <p>{t('Send a request to the workspace admins.')}</p>
          <div className="access-message">
            <textarea className="input" aria-label={t('Message')} placeholder={t('Message (optional)')} rows={3} maxLength={NOTE_MAX} value={note} disabled={busy === 'ask'} onChange={(e) => setNote(e.currentTarget.value)} />
            <span className="access-count" aria-hidden="true">
              {note.length}/{NOTE_MAX}
            </span>
          </div>
          {alert}
          <button type="submit" className="publish access-wide" disabled={!!busy}>
            {busy === 'ask' ? t('Requesting…') : t('Request access')}
          </button>
        </form>
      </>
    )

  return (
    <main className="login">
      <section className="card request-access" aria-busy={screen.view === 'loading' || undefined}>
        <div className="access-body">{body}</div>
        <AccountFooter email={email} />
      </section>
    </main>
  )
}

/** Sanity's footer: the account, and "Wrong account? Sign out" back to the sign-in screen for this page. */
function AccountFooter({email}: {email: string}) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const here = useRouterState({select: (s) => s.location.href})
  return (
    <footer className="access-footer">
      <p>
        {t('Signed in as')} <strong>{email}</strong>
      </p>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          await signOutHere(qc)
          await navigate({to: '/login', search: {redirect: here}})
        }}
      >
        {t('Wrong account? Sign out')}
      </button>
    </footer>
  )
}
