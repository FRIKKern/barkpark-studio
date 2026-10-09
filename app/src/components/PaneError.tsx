import {Component, useLayoutEffect, useRef, type ReactNode} from 'react'
import {useRouter, useRouterState, type ErrorComponentProps} from '@tanstack/react-router'
import {useBoundElsewhere, useStudioTokenRefused} from '../lib/session'
import {scopedPath} from '../lib/scope'
import {AUTO_RETRIES} from '../lib/connection'
import {toast} from './Toasts'
import {Copy, Sync} from './icons'
import {t as tt, useT} from '../lib/i18n'

// J50, Sanity's error cards: a read that keeps failing (structure/panes/documentList/
// DocumentListPaneContent.tsx) and a pane that crashed (core/studio/screens/
// FallbackErrorScreen.tsx). Both say what failed and offer Retry and "Copy error details".

const details = (error: unknown) =>
  JSON.stringify({error: error instanceof Error ? {name: error.name, message: error.message, stack: error.stack} : error}, null, 2)

function ErrorActions({error, onRetry}: {error: unknown; onRetry?: () => void}) {
  const t = useT()
  return (
    <div className="error-actions">
      {onRetry && (
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          <Sync /> {t('Retry')}
        </button>
      )}
      <button
        type="button"
        className="btn btn-ghost"
        title={t('These technical details may be useful for developers.')}
        onClick={() => navigator.clipboard.writeText(details(error)).catch(() => toast({tone: 'critical', title: tt('Failed to copy error details')}))}
      >
        <Copy /> {t('Copy error details')}
      </button>
    </div>
  )
}

/**
 * A pane's read failed. `failures` counts attempts; while `retrying` the next try is
 * on its way by itself, after AUTO_RETRIES it waits for Retry. Offline, Retry waits too.
 */
export function ReadErrorCard(props: {title: string; error: unknown; failures: number; retrying: boolean; onRetry: () => void}) {
  // The studio's own token refused, or a dataset-bound token (Barkpark #22393) opened at
  // another dataset: that is why it failed, and Retry won't help.
  const refused = useStudioTokenRefused()
  const elsewhere = useBoundElsewhere()
  if (elsewhere) return <BoundDatasetCard {...elsewhere} />
  if (refused) return <RefusedTokenCard />
  return <FailedReadCard {...props} />
}

/** The studio's own token is refused: no read will work until someone renews it. */
export function RefusedTokenCard() {
  const t = useT()
  return (
    <div className="pane-error" role="alert">
      <h3>{t("Barkpark refused this studio's token.")}</h3>
      <p>{t('It was revoked or no longer belongs to this workspace. Ask whoever runs this studio to renew its Barkpark token.')}</p>
    </div>
  )
}

/** The switcher's own words (B02), with the way to the dataset this token can open: the same place there. */
export function BoundDatasetCard({bound, here}: {bound: string; here: {workspace: string; project: string; dataset: string}}) {
  const t = useT()
  const path = useRouterState({select: (s) => s.location.pathname})
  const rest = path.replace(/^\/w\/[^/]+\/p\/[^/]+\/d\/[^/]+/, '') || '/structure'
  return (
    <div className="pane-error" role="alert">
      <h3>{t('This token can only open the dataset {dataset}.', {dataset: bound})}</h3>
      <p>{t('This page is in {dataset}.', {dataset: here.dataset})}</p>
      <div className="error-actions">
        <a className="btn btn-primary" href={scopedPath({...here, dataset: bound}, rest)}>
          {t('Open {dataset}', {dataset: bound})}
        </a>
      </div>
    </div>
  )
}

function FailedReadCard({title, error, failures, retrying, onRetry}: {title: string; error: unknown; failures: number; retrying: boolean; onRetry: () => void}) {
  const t = useT()
  const online = typeof navigator === 'undefined' || navigator.onLine
  const message = error instanceof Error ? error.message : String(error)
  // J50/F6: Retry worked and the card goes: focus moves on to what loaded (the pane's
  // first row or field), not to the page.
  const card = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = card.current
    const pane = el?.closest<HTMLElement>('[data-pane-index]')
    return () => {
      if (!el || !pane || !el.contains(document.activeElement)) return
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return
        const next = ['[data-testid="pane-item"]', '.pane-body input:not([type=checkbox]), .pane-body textarea', '.pane-body a, .pane-body button'].map((q) => pane.querySelector<HTMLElement>(q)).find(Boolean)
        next?.focus()
      })
    }
  }, [])
  return (
    <div className="pane-error" role="alert" ref={card}>
      <h3>{title}</h3>
      <p>
        {!online ? (
          t('The Internet connection appears to be offline.')
        ) : import.meta.env.DEV ? (
          <>
            {t('Error:')} <code>{message}</code>
          </>
        ) : (
          t('Encountered an error while fetching documents.')
        )}
      </p>
      <ErrorActions error={error} onRetry={online ? onRetry : undefined} />
      <p className="muted">
        {retrying
          ? failures > 1
            ? t('Retrying… (#{n}).', {n: failures - 1})
            : t('Retrying…')
          : t('Not automatically retrying after {n} unsuccessful attempts.', {n: Math.min(failures, AUTO_RETRIES)})}
      </p>
    </div>
  )
}

/** One pane that throws while rendering shows this card in its place; the others keep working. */
// Keyed by the pane: navigating it somewhere else starts it afresh.
export class PaneBoundary extends Component<{children: ReactNode; kind?: string}, {error: unknown}> {
  state = {error: null as unknown}
  static getDerivedStateFromError(error: unknown) {
    return {error}
  }
  render() {
    if (!this.state.error) return this.props.children
    return <CrashCard error={this.state.error} kind={this.props.kind} onRetry={() => this.setState({error: null})} />
  }
}

function CrashCard({error, kind, onRetry}: {error: unknown; kind?: string; onRetry: () => void}) {
  const t = useT()
  const message = error instanceof Error ? error.message : String(error)
  return (
    <section className="pane pane-crashed" data-testid="pane" data-pane-crashed="">
      <div className="pane-error" role="alert">
        {/* Sanity's words for its document and list panes. */}
        <h3>{kind === 'doc' ? t('Could not render the document editor') : kind === 'list' ? t('Could not render the document list') : t('An error occurred')}</h3>
        <p>{t('This pane hit an error it could not recover from. The other panes keep working.')}</p>
        {import.meta.env.DEV && <pre className="error-detail">{message}</pre>}
        <ErrorActions error={error} onRetry={onRetry} />
      </div>
    </section>
  )
}

/** The whole studio could not load (the content model itself, or a route): Sanity's fallback screen, with Retry. */
export function StudioError({error, reset}: ErrorComponentProps) {
  const t = useT()
  const router = useRouter()
  const message = error instanceof Error ? error.message : String(error)
  // The content model itself read with a dead studio token (401, Barkpark #22517): say that,
  // as a pane would (#312), not a bare "error occurred".
  if (/\b401\b/.test(message))
    return (
      <main className="studio-error" data-testid="studio-error">
        <RefusedTokenCard />
      </main>
    )
  return (
    <main className="studio-error" data-testid="studio-error">
      <div className="pane-error" role="alert">
        <h3>{t('An error occurred')}</h3>
        <p>{t('An error occurred that Barkpark Studio was unable to recover from.')}</p>
        {import.meta.env.DEV && <pre className="error-detail">{message}</pre>}
        <ErrorActions error={error} onRetry={() => void router.invalidate().then(reset)} />
      </div>
    </main>
  )
}
