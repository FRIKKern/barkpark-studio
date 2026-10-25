import {version as reactVersion, useCallback, useEffect, useMemo, useState} from 'react'
import {useHtmlMark} from '../lib/html-mark'
import {createPortal} from 'react-dom'
import {useQuery} from '@tanstack/react-query'
import {DialogBox} from './FocusScopes'
import {Close as CloseIcon} from './icons'
import {toast} from './Toasts'
import {useT} from '../lib/i18n'
import {BUILD, buildName} from '../lib/version'
import {barkparkInfoQuery, diagnosticsJson, listenCheck, mediaCheck, pingStudio, runServerChecks, type Check, type ListenCheck} from '../lib/diagnostics'
import {currentScopeQuery, scopeOptionsQuery} from '../lib/scope-switch'
import {requestSamples, summarize, type Sample} from '../lib/request-timings'
import {schemasQuery} from '../lib/data'
import {meQuery} from '../lib/session'

// J69: Sanity's Help > Diagnostics: what a bug report needs, in cards, its connection tests
// (the live stream, the API, media), and "Copy output" as JSON in Sanity's shape. Ours names
// Barkpark (URL, version, commit) where Sanity names its API host, and tests the studio's
// own routes from the browser and Barkpark from the studio's server, the two hops it has.

type Run = {startedAt: string; generatedAt: string; durationMs: number; protocol: string | null; ttfbMs: number | null; requests: Check[]; first: ListenCheck | null; second: ListenCheck | null}

const browserFacts = () => {
  const nav = navigator as Navigator & {deviceMemory?: number; connection?: {effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean}}
  let localStorageOk = false
  try {
    localStorage.setItem('bp-diagnostics', '1')
    localStorage.removeItem('bp-diagnostics')
    localStorageOk = true
  } catch {
    /* blocked: reported below */
  }
  return {
    userAgent: nav.userAgent,
    language: nav.language,
    languages: [...nav.languages],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: nav.onLine,
    cookieEnabled: nav.cookieEnabled,
    viewport: {width: innerWidth, height: innerHeight},
    screen: {width: screen.width, height: screen.height, availableWidth: screen.availWidth, availableHeight: screen.availHeight},
    devicePixelRatio,
    colorDepth: screen.colorDepth,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemoryGb: nav.deviceMemory ?? null,
    maxTouchPoints: nav.maxTouchPoints,
    connection: nav.connection ? {effectiveType: nav.connection.effectiveType ?? null, downlinkMbps: nav.connection.downlink ?? null, roundtripTimeMs: nav.connection.rtt ?? null, saveData: !!nav.connection.saveData} : null,
    localStorage: {status: localStorageOk ? 'success' : 'error'},
  }
}

export function Diagnostics({onClose}: {onClose: () => void}) {
  useHtmlMark('diagnostics-open') // toasts above it (styles.css)
  const t = useT()
  const bp = useQuery(barkparkInfoQuery).data
  const scope = useQuery(currentScopeQuery).data
  const schemas = useQuery(schemasQuery).data ?? []
  const me = useQuery(meQuery).data
  const [run, setRun] = useState<Run | null>(null)
  const [running, setRunning] = useState(false)
  // Sanity's UTC time switch: the run's times, tracking start and the chart's axis in UTC.
  const [utc, setUtc] = useState(false)
  const options = useQuery({...scopeOptionsQuery(scope ?? {workspace: '', project: ''}), enabled: !!scope}).data
  const type = schemas[0]?.name
  // The tests, as Sanity's: run on open and by "Run again".
  const start = useCallback(async () => {
    if (!type) return
    setRunning(true)
    const startedAt = new Date().toISOString()
    const t0 = performance.now()
    const ping = await pingStudio()
    const server = (await runServerChecks({data: {type}})) as unknown as {checks: Check[]; image: string | null}
    const media = await mediaCheck(server.image)
    const first = await listenCheck(type)
    const second = await listenCheck(type) // while the first is still open, as Sanity's second test
    first.close()
    second.close()
    setRun({startedAt, generatedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - t0), protocol: ping.protocol, ttfbMs: ping.ttfbMs, requests: [ping.check, ...server.checks, media], first, second})
    setRunning(false)
  }, [type])
  useEffect(() => void start(), [start])
  const browser = browserFacts()
  const pending = '…'
  const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(undefined, utc ? {timeZone: 'UTC'} : undefined) : pending)
  // This tab's requests to the studio server since it opened (Resource Timing), read again per run.
  const samples = useMemo(() => requestSamples(), [run])
  const tabOpen = (() => {
    const s = Math.round(performance.now() / 1000)
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  })()
  const ms = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n)} ms`)
  const sections: [string, [string, string][]][] = [
    [t('Studio'), [[t('Studio version'), buildName(BUILD)], [t('React version'), reactVersion], [t('Workspaces'), options?.workspaces ? String(options.workspaces.length) : '–']]],
    [
      t('Workspace'),
      [
        [t('Workspace'), scope?.workspace ?? pending],
        [t('Project'), scope?.project ?? pending],
        [t('Dataset'), scope?.dataset ?? pending],
        ['Barkpark', bp?.url ?? pending],
        [t('Barkpark version'), bp ? (bp.version ?? '–') : pending],
        [t('Barkpark commit'), bp ? (bp.commit ?? '–') : pending],
      ],
    ],
    [t('Schema'), [[t('Document types'), String(schemas.length)]]],
    [
      t('User'),
      [
        [t('User ID'), me?.userId ?? '–'],
        [t('Email'), me?.email ?? '–'],
        [t('Sign-in'), me?.signIn ?? pending],
        [t('Roles'), me ? (me.role ? me.role[0]!.toUpperCase() + me.role.slice(1) : me.canWrite ? t('Editor') : t('Viewer')) : pending],
      ],
    ],
    [
      t('Browser'),
      [
        [t('User agent'), browser.userAgent],
        [t('Language'), browser.language],
        [t('Timezone'), browser.timezone],
        [t('Online'), browser.online ? t('Yes') : t('No')],
        [t('Viewport'), `${browser.viewport.width} × ${browser.viewport.height}`],
        [t('Screen'), `${browser.screen.width} × ${browser.screen.height}`],
        [t('Connection estimate'), browser.connection ? `${browser.connection.effectiveType ?? '?'} · ${browser.connection.downlinkMbps ?? '?'} Mbps · ${browser.connection.roundtripTimeMs ?? '?'} ms RTT` : '–'],
        [t('Local storage'), browser.localStorage.status === 'success' ? t('Enabled') : t('Blocked')],
        [t('Hardware'), t('{cpus} logical processors · {memory} GB memory', {cpus: browser.hardwareConcurrency, memory: browser.deviceMemoryGb ?? '?'})],
        [t('Max touch points'), String(browser.maxTouchPoints)],
      ],
    ],
    [
      t('Network'),
      [
        [t('Protocol'), run?.protocol ?? (running ? pending : '–')],
        [t('Studio server TTFB'), run ? ms(run.ttfbMs) : pending],
        [t('Barkpark ping'), run ? ms(run.requests.find((r) => r.path === '/v1/version')?.durationMs) : pending],
        [t('Live stream'), run ? (run.first?.status === 'success' ? t('Connected') : t('Failed')) : pending],
        [t('Session requests'), String(samples.length)],
        [t('Tracking started'), time(new Date(performance.timeOrigin).toISOString())],
        [t('Tab open'), tabOpen],
      ],
    ],
  ]
  const copyOutput = () => {
    const json = diagnosticsJson({
      startedAt: run?.startedAt ?? '',
      generatedAt: run?.generatedAt ?? new Date().toISOString(),
      durationMs: run?.durationMs ?? 0,
      studio: {version: buildName(BUILD), reactVersion, workspaceName: scope?.workspace ?? null, workspaceTitle: scope?.workspace ?? null, projectId: scope?.project ?? null, dataset: scope?.dataset ?? null, apiHost: bp?.url ?? null, barkparkVersion: bp?.version ?? null, barkparkCommit: bp?.commit ?? null, basePath: '/'},
      schema: {documentTypes: schemas.length},
      user: {id: me?.userId ?? me?.email ?? null, provider: me?.signIn ?? null, roles: [me?.canWrite ? {name: 'editor', title: 'Editor'} : {name: 'viewer', title: 'Viewer'}]},
      browser: browser as unknown as Record<string, never>,
      network: {protocol: {protocol: run?.protocol ?? null, ttfbMs: run?.ttfbMs ?? null}, requests: run?.requests ?? [], requestHistory: samples, listen: {first: run?.first ?? null, secondWhileFirstOpen: run?.second ?? null}},
    })
    return navigator.clipboard
      .writeText(JSON.stringify(json, null, 2))
      .then(() => toast({title: t('Diagnostics copied to clipboard')}))
      .catch(() => toast({tone: 'critical', title: t('Could not copy the diagnostics')}))
  }
  const status = (s: 'success' | 'error') => <span className="diagnostics-status" data-status={s}>{s === 'success' ? t('Success') : t('Failed')}</span>
  return createPortal(
    <div className="dialog-backdrop diagnostics-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog diagnostics" aria-modal="true" aria-label={t('Studio diagnostics')} onClose={onClose}>
        <header>
          <h2>{t('Studio diagnostics')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body diagnostics-body">
          <section className="diagnostics-run" aria-label={t('Diagnostics run')}>
            <dl>
              <div><dt>{t('Started')}</dt><dd>{time(run?.startedAt)}</dd></div>
              <div><dt>{t('Completed')}</dt><dd>{running ? pending : time(run?.generatedAt)}</dd></div>
              <div><dt>{t('Diagnostics duration')}</dt><dd>{running || !run ? pending : ms(run.durationMs)}</dd></div>
            </dl>
            <label className="diagnostics-utc">
              <span>{t('UTC time')}</span>
              <input type="checkbox" role="switch" checked={utc} onChange={(e) => setUtc(e.target.checked)} />
            </label>
            <button type="button" className="btn" disabled={running} onClick={() => void start()}>{t('Run again')}</button>
          </section>
          {sections.map(([title, rows]) => (
            <section key={title} className="diagnostics-card" aria-label={title}>
              <h3>{title}</h3>
              <dl>
                {rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd title={v}>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section className="diagnostics-wide" aria-label={t('Recent request timings')}>
            <h3 className="diagnostics-chart-head">
              {t('Recent request timings')}
              <span className="muted">{t('{n} requests this session', {n: samples.length})}</span>
            </h3>
            <RequestTimings samples={samples} utc={utc} />
          </section>
          <section className="diagnostics-wide" aria-label={t('Live stream connection tests')}>
            <h3>{t('Live stream connection tests')}</h3>
            <div className="diagnostics-listen">
              {([[t('First connection'), run?.first], [t('Second connection while first is open'), run?.second]] as const).map(([label, l]) => (
                <div key={label} className="diagnostics-card">
                  <h4>{label} {l && status(l.status)}</h4>
                  <dl className="diagnostics-stats">
                    <div><dt>{t('Open event')}</dt><dd>{l ? ms(l.openMs) : pending}</dd></div>
                    <div><dt>{t('Welcome event')}</dt><dd>{l ? ms(l.welcomeMs) : pending}</dd></div>
                    <div><dt>{t('Total')}</dt><dd>{l ? ms(l.durationMs) : pending}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          </section>
          <section className="diagnostics-wide" aria-label={t('API request tests')}>
            <h3>{t('API request tests')}</h3>
            <ul className="diagnostics-requests">
              {(run?.requests ?? []).map((r) => (
                <li key={r.path} className="diagnostics-card">
                  <span>
                    <code>{r.path}</code>
                    <span className="muted">{r.detail}</span>
                  </span>
                  <span>
                    {ms(r.durationMs)} {status(r.status)}
                  </span>
                </li>
              ))}
              {!run && <li className="diagnostics-card">{pending}</li>}
            </ul>
          </section>
        </div>
        <footer>
          <button type="button" className="btn-text" onClick={onClose}>
            {t('Close')}
          </button>
          <button type="button" className="btn btn-primary" autoFocus disabled={!run} onClick={() => void copyOutput()}>
            {t('Copy output')}
          </button>
        </footer>
      </DialogBox>
    </div>,
    document.body,
  )
}

// One colour per series, as Sanity's chart: the avatar palette, then muted.
const COLORS = ['var(--avatar-blue)', 'var(--avatar-green)', 'var(--avatar-orange)', 'var(--avatar-yellow)']

/** Sanity's "Recent request timings": each request a dot (when, how long), and per series n / median / p95 / max. */
function RequestTimings({samples, utc}: {samples: Sample[]; utc: boolean}) {
  const t = useT()
  const summary = summarize(samples)
  if (!samples.length) return <p className="muted">{t('No requests yet.')}</p>
  const color = (series: string) => COLORS[summary.findIndex((s) => s.series === series)] ?? 'var(--muted)'
  const [W, H, L, R, T, B] = [800, 180, 64, 12, 12, 26]
  const t0 = samples[0]!.at
  const t1 = Math.max(samples.at(-1)!.at, t0 + 1)
  const top = Math.max(...samples.map((s) => s.ms), 1)
  const x = (at: number) => L + ((at - t0) / (t1 - t0)) * (W - L - R)
  const y = (ms: number) => T + (1 - ms / top) * (H - T - B)
  const clock = (at: number) => new Date(performance.timeOrigin + at).toLocaleTimeString(undefined, utc ? {timeZone: 'UTC'} : undefined)
  return (
    <div className="diagnostics-card diagnostics-timings">
      <svg className="diagnostics-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Request durations over time')}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end">
              {Math.round(v)} ms
            </text>
          </g>
        ))}
        <text x={L} y={H - 6}>{clock(t0)}</text>
        <text x={W - R} y={H - 6} textAnchor="end">
          {clock(t1)}
        </text>
        {samples.map((s, i) => (
          <circle key={i} cx={x(s.at)} cy={y(s.ms)} r="3.5" fill={color(s.series)}>
            <title>{`${s.series} · ${s.ms} ms · ${clock(s.at)}`}</title>
          </circle>
        ))}
      </svg>
      <table className="diagnostics-summary">
        <caption>{t('Session summary')}</caption>
        <thead>
          <tr>
            <th>{t('Series')}</th>
            <th>n</th>
            <th>{t('Median')}</th>
            <th>p95</th>
            <th>{t('Max')}</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.series}>
              <td>
                <span className="diagnostics-dot" style={{background: color(s.series)}} /> {s.series}
              </td>
              <td>{s.n}</td>
              <td>{s.median} ms</td>
              <td>{s.p95} ms</td>
              <td>{s.max} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

