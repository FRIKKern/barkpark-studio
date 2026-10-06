import {Component, type ReactNode} from 'react'
import {useRouter, type ErrorComponentProps} from '@tanstack/react-router'
import {AUTO_RETRIES} from '../lib/connection'
import {toast} from './Toasts'
import {Copy, Sync} from './icons'

// J50, Sanity's error cards: a read that keeps failing (structure/panes/documentList/
// DocumentListPaneContent.tsx) and a pane that crashed (core/studio/screens/
// FallbackErrorScreen.tsx). Both say what failed and offer Retry and "Copy error details".

const details = (error: unknown) =>
  JSON.stringify({error: error instanceof Error ? {name: error.name, message: error.message, stack: error.stack} : error}, null, 2)

function ErrorActions({error, onRetry}: {error: unknown; onRetry?: () => void}) {
  return (
    <div className="error-actions">
      {onRetry && (
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          <Sync /> Retry
        </button>
      )}
      <button
        type="button"
        className="btn btn-ghost"
        title="These technical details may be useful for developers."
        onClick={() => navigator.clipboard.writeText(details(error)).catch(() => toast({tone: 'critical', title: 'Failed to copy error details'}))}
      >
        <Copy /> Copy error details
      </button>
    </div>
  )
}

/**
 * A pane's read failed. `failures` counts attempts; while `retrying` the next try is
 * on its way by itself, after AUTO_RETRIES it waits for Retry. Offline, Retry waits too.
 */
export function ReadErrorCard({title, error, failures, retrying, onRetry}: {title: string; error: unknown; failures: number; retrying: boolean; onRetry: () => void}) {
  const online = typeof navigator === 'undefined' || navigator.onLine
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="pane-error" role="alert">
      <h3>{title}</h3>
      <p>
        {!online ? (
          'The Internet connection appears to be offline.'
        ) : import.meta.env.DEV ? (
          <>
            Error: <code>{message}</code>
          </>
        ) : (
          'Encountered an error while fetching documents.'
        )}
      </p>
      <ErrorActions error={error} onRetry={online ? onRetry : undefined} />
      <p className="muted">
        {retrying ? (failures > 1 ? `Retrying… (#${failures - 1}).` : 'Retrying…') : `Not automatically retrying after ${Math.min(failures, AUTO_RETRIES)} unsuccessful attempts.`}
      </p>
    </div>
  )
}

/** One pane that throws while rendering shows this card in its place; the others keep working. */
// Keyed by the pane: navigating it somewhere else starts it afresh.
export class PaneBoundary extends Component<{children: ReactNode}, {error: unknown}> {
  state = {error: null as unknown}
  static getDerivedStateFromError(error: unknown) {
    return {error}
  }
  render() {
    if (!this.state.error) return this.props.children
    const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
    return (
      <section className="pane pane-crashed" data-testid="pane" data-pane-crashed="">
        <div className="pane-error" role="alert">
          <h3>An error occurred</h3>
          <p>This pane hit an error it could not recover from. The other panes keep working.</p>
          {import.meta.env.DEV && <pre className="error-detail">{message}</pre>}
          <ErrorActions error={this.state.error} onRetry={() => this.setState({error: null})} />
        </div>
      </section>
    )
  }
}

/** The whole studio could not load (the content model itself, or a route): Sanity's fallback screen, with Retry. */
export function StudioError({error, reset}: ErrorComponentProps) {
  const router = useRouter()
  const message = error instanceof Error ? error.message : String(error)
  return (
    <main className="studio-error" data-testid="studio-error">
      <div className="pane-error" role="alert">
        <h3>An error occurred</h3>
        <p>An error occurred that Barkpark Studio was unable to recover from.</p>
        {import.meta.env.DEV && <pre className="error-detail">{message}</pre>}
        <ErrorActions error={error} onRetry={() => void router.invalidate().then(reset)} />
      </div>
    </main>
  )
}
