import {Component, useEffect, useId, useRef, type KeyboardEvent, type ReactNode} from 'react'
import type {Width} from '../../lib/dashboard'
import {useT} from '../../lib/i18n'
import {RefreshIcon, Sync} from '../icons'

// One dashboard widget (Sanity's DashboardWidgetContainer): a labelled region with a header,
// a body that keeps its height while it loads, and a footer. A widget that throws while it
// draws shows its error in its own card; the others keep working (as panes do, J50).

type FrameProps = {
  title: string
  width: Width
  /** Rows the body keeps room for, so loading, empty and loaded are one height. */
  rows?: number
  /** A line under the title: what the widget shows, said plainly. */
  note?: ReactNode
  /** Reads again (the header's Refresh); none for a widget that reads nothing. */
  onRefresh?: () => void
  refreshing?: boolean
  footer?: ReactNode
  testId?: string
  children: ReactNode
}

export function WidgetFrame({title, width, rows, note, onRefresh, refreshing, footer, testId, children}: FrameProps) {
  const t = useT()
  const id = useId()
  return (
    <section className="dash-widget" data-width={width} data-testid={testId} aria-labelledby={id} aria-busy={refreshing || undefined}>
      <header>
        <h2 id={id}>{title}</h2>
        {onRefresh && (
          <button type="button" className="icon-btn dash-refresh" aria-label={t('Refresh {widget}', {widget: title})} data-tip={t('Refresh')} data-busy={refreshing ? '' : undefined} onClick={onRefresh}>
            <RefreshIcon />
          </button>
        )}
      </header>
      {note && <p className="dash-note">{note}</p>}
      <div className="dash-body" style={rows ? ({'--rows': rows} as React.CSSProperties) : undefined}>
        <WidgetBoundary>{children}</WidgetBoundary>
      </div>
      {footer && <footer>{footer}</footer>}
    </section>
  )
}

/** A widget's own crash: its card says so and offers Retry; the page stays. */
class WidgetBoundary extends Component<{children: ReactNode}, {error: unknown}> {
  state = {error: null as unknown}
  static getDerivedStateFromError(error: unknown) {
    return {error}
  }
  render() {
    if (!this.state.error) return this.props.children
    return <WidgetError error={this.state.error} onRetry={() => this.setState({error: null})} crashed />
  }
}

/** A widget's read failed (or it crashed): what happened, and Retry. The other widgets are not touched. */
export function WidgetError({error, onRetry, retrying, crashed}: {error: unknown; onRetry: () => void; retrying?: boolean; crashed?: boolean}) {
  const t = useT()
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="dash-error" role="alert">
      <strong>{crashed ? t('This widget hit an error.') : t('Something went wrong while fetching data.')}</strong>
      <span className="muted">{message}</span>
      <button type="button" className="btn dash-retry" disabled={retrying} onClick={onRetry}>
        <Sync /> {retrying ? t('Retrying…') : t('Retry')}
      </button>
    </div>
  )
}

/** While a widget's first read is out: rows of the shape to come, in the room they will take. */
export function WidgetSkeleton({rows, plain}: {rows: number; plain?: boolean}) {
  const t = useT()
  return (
    <div className="dash-skeleton" role="status" aria-label={t('Loading…')}>
      {Array.from({length: rows}, (_, i) => (
        <div key={i} className="preview skeleton" aria-hidden="true">
          {!plain && <span className="media" />}
          <span className="text">
            <div className="t" />
            <div className="s" />
          </span>
        </div>
      ))}
    </div>
  )
}

/** Nothing to show: a line that says so, and a second that helps. */
export function WidgetEmpty({title, hint}: {title: string; hint?: ReactNode}) {
  return (
    <div className="dash-empty">
      <p>{title}</p>
      {hint && <p className="muted">{hint}</p>}
    </div>
  )
}

/**
 * A widget's rows as one Tab stop, as a list is: Tab lands on the row last used (the first
 * to begin with), the arrows, Home and End move between rows. A row is an `li[data-dash-row]`;
 * its first link or button is what takes the focus.
 */
export function RowList({label, children, className = 'dash-rows'}: {label: string; children: ReactNode; className?: string}) {
  const ref = useRef<HTMLUListElement>(null)
  const at = useRef(0)
  const rows = () => [...(ref.current?.querySelectorAll<HTMLElement>('li[data-dash-row]') ?? [])].flatMap((li) => li.querySelector<HTMLElement>('a, button') ?? [])
  // After every draw: one row takes Tab, the others are reached by arrow.
  useEffect(() => {
    const all = rows()
    at.current = Math.max(0, Math.min(at.current, all.length - 1))
    all.forEach((el, i) => (el.tabIndex = i === at.current ? 0 : -1))
  })
  const onKeyDown = (e: KeyboardEvent) => {
    const all = rows()
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const to = {ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1}[e.key]
    if (to === undefined || e.altKey || e.metaKey || e.ctrlKey) return
    e.preventDefault()
    const next = all[Math.max(0, Math.min(all.length - 1, to))]
    if (!next) return
    all.forEach((el) => (el.tabIndex = el === next ? 0 : -1))
    at.current = all.indexOf(next)
    next.focus()
  }
  return (
    <ul
      ref={ref}
      className={className}
      aria-label={label}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        const all = rows()
        const i = all.indexOf(e.target as HTMLElement)
        if (i < 0) return
        at.current = i
        all.forEach((el, n) => (el.tabIndex = n === i ? 0 : -1))
      }}
    >
      {children}
    </ul>
  )
}
