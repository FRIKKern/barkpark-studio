import {useEffect, useReducer, useRef, useState} from 'react'
import {useT} from '../lib/i18n'
import {SyncIcon} from './icons'

/**
 * J58, Sanity's Presentation tool: the site in an iframe beside the document
 * panel, with Sanity's connection states (its presentation machine, sanity 6.17):
 *
 *   iframe loading ── 15 s, no load event ──▶ "Could not connect to the preview"
 *   (Loading.)                                [Retry] [Continue anyway]
 *        │ load
 *        ▼
 *   no hello yet ── 5 s ──▶ "Connecting." ── 3 s ──▶ "Unable to connect, …"
 *   (Loading.)                                        [Continue anyway]
 *        │ hello
 *        ▼
 *   connected: the overlays go, the page is usable
 *
 * The site talks to us with a few postMessage events (reference/preview-site/src/
 * barkpark.ts) where Sanity's uses comlink. "Continue anyway" on a failed connection
 * holds until the site connects, across reloads, as Sanity's does.
 */

export const LOAD_TIMEOUT = 15_000
export const SLOW_AFTER = 5_000
export const TIMEOUT_AFTER = 3_000

type State = {
  load: 'loading' | 'timedOut' | 'dismissed' | 'loaded'
  /** The site said hello since the iframe last (re)loaded, or since a refresh it asked for. */
  connected: boolean
  /** It has connected before on this page: a refresh reconnects without the overlays. */
  hadConnection: boolean
  wait: 'pending' | 'slow' | 'timedOut'
  /** "Continue anyway" after a failed connection, until one succeeds. */
  dismissed: boolean
  refreshing: boolean
}

type Action =
  | {type: 'reload'}
  | {type: 'refresh'}
  | {type: 'load timeout'}
  | {type: 'continue'}
  | {type: 'loaded'}
  | {type: 'hello'}
  | {type: 'slow'}
  | {type: 'wait timeout'}

const initial: State = {load: 'loading', connected: false, hadConnection: false, wait: 'pending', dismissed: false, refreshing: false}

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'reload':
      return {...s, load: 'loading', connected: false, hadConnection: false, wait: 'pending', refreshing: false}
    case 'refresh':
      return {...s, connected: false, refreshing: true}
    case 'load timeout':
      return s.load === 'loading' ? {...s, load: 'timedOut'} : s
    case 'continue':
      return s.load === 'timedOut' ? {...s, load: 'dismissed'} : {...s, dismissed: true}
    case 'loaded':
      return {...s, load: 'loaded', wait: 'pending'}
    case 'hello':
      return {...s, connected: true, hadConnection: true, dismissed: false, refreshing: false}
    case 'slow':
      return s.wait === 'pending' ? {...s, wait: 'slow'} : s
    case 'wait timeout':
      return s.wait === 'slow' ? {...s, wait: 'timedOut'} : s
  }
}

export function Presentation({previewUrl, initialPath = '/'}: {previewUrl: string; initialPath?: string}) {
  const t = useT()
  const origin = new URL(previewUrl).origin
  const frame = useRef<HTMLIFrameElement>(null)
  const [src, setSrc] = useState(() => new URL(initialPath, previewUrl).toString())
  const [url, setUrl] = useState(src)
  const [s, send] = useReducer(reduce, initial)
  // The frame mounts after hydration: one rendered on the server can fire its load
  // event before React listens, and the overlay would wait forever.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Overlays only while the page has never connected since it loaded.
  const connecting = s.load === 'loaded' && !s.connected && !s.hadConnection && !s.dismissed

  useEffect(() => {
    if (s.load !== 'loading') return
    const timer = setTimeout(() => send({type: 'load timeout'}), LOAD_TIMEOUT)
    return () => clearTimeout(timer)
  }, [s.load, src])
  useEffect(() => {
    if (!connecting) return
    const timer = s.wait === 'pending' ? setTimeout(() => send({type: 'slow'}), SLOW_AFTER) : s.wait === 'slow' ? setTimeout(() => send({type: 'wait timeout'}), TIMEOUT_AFTER) : undefined
    return () => clearTimeout(timer)
  }, [connecting, s.wait])

  // The overlay says "check the browser console": this is what it finds there.
  useEffect(() => {
    if (s.load === 'timedOut') console.error(`The preview iframe hasn't finished loading after ${LOAD_TIMEOUT}ms (${src}).`)
  }, [s.load])
  useEffect(() => {
    if (connecting && s.wait === 'timedOut')
      console.error(`Unable to connect to the preview at ${origin}. The site has to post {bp: 'preview', type: 'hello'} to its parent (see reference/preview-site/src/barkpark.ts).`)
  }, [connecting, s.wait])
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow || e.data?.bp !== 'preview') return
      if (e.data.type === 'hello') send({type: 'hello'})
      if (e.data.type === 'location' && typeof e.data.url === 'string') setUrl(new URL(e.data.url, origin).toString())
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin])

  // A new frame each reload: assigning the same src to one still loading is ignored.
  const [generation, setGeneration] = useState(0)
  const reload = () => {
    send({type: 'reload'})
    setSrc(url)
    setGeneration((g) => g + 1)
  }
  // Sanity's refresh: a connected site reloads itself and says hello again; otherwise
  // the frame reloads.
  const refresh = () => {
    if (!s.connected) return reload()
    send({type: 'refresh'})
    frame.current?.contentWindow?.postMessage({bp: 'studio', type: 'refresh'}, origin)
  }

  const busy = s.load === 'loading' || s.refreshing || connecting
  const status = s.load === 'loading' ? t('Loading.') : s.refreshing ? t('Refreshing.') : undefined
  const blocked = s.load === 'loading' || s.load === 'timedOut' || connecting
  return (
    <div className="presentation">
      <section className="presentation-preview" aria-label={t('Presentation')}>
        <div className="presentation-toolbar">
          <button type="button" className="icon-btn" aria-label={t('Refresh preview')} data-tip={status ?? t('Refresh preview')} aria-busy={s.refreshing || s.load === 'loading'} onClick={refresh}>
            <SyncIcon />
          </button>
          <input className="input presentation-url" aria-label="URL" value={url} readOnly />
        </div>
        <div className="presentation-frame" style={{cursor: busy ? 'wait' : undefined}}>
          {mounted && <iframe key={generation} ref={frame} src={src} title={t('Presentation')} style={{pointerEvents: blocked ? 'none' : undefined}} onLoad={() => send({type: 'loaded'})} />}
          {s.load === 'loading' ? (
            <Status text={t('Loading.')} />
          ) : s.load === 'timedOut' ? (
            <div className="presentation-overlay error" role="alert">
              <div className="presentation-error">
                <h2>{t('An error occurred')}</h2>
                <p>{t('Could not connect to the preview')}</p>
                <div>
                  <button type="button" className="btn" onClick={reload}>
                    {t('Retry')}
                  </button>
                  <button type="button" className="btn continue" onClick={() => send({type: 'continue'})}>
                    {t('Continue anyway')}
                  </button>
                </div>
              </div>
            </div>
          ) : connecting && s.wait === 'pending' ? (
            <Status text={t('Loading.')} />
          ) : connecting ? (
            <div className="presentation-overlay connecting" data-timed-out={s.wait === 'timedOut' || undefined}>
              <div className="presentation-status" role="status" data-tone={s.wait === 'timedOut' ? 'caution' : undefined}>
                <span className="spinner" aria-hidden="true" />
                {s.wait === 'timedOut' ? t('Unable to connect, check the browser console for more information.') : t('Connecting.')}
              </div>
              {s.wait === 'timedOut' && (
                <button type="button" className="btn danger" onClick={() => send({type: 'continue'})}>
                  {t('Continue anyway')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </section>
      <aside className="presentation-panel" aria-label={t('Documents on this page')}>
        <h2>{t('Documents on this page')}</h2>
        <p className="presentation-empty">{t('No matching documents')}</p>
      </aside>
    </div>
  )
}

function Status({text}: {text: string}) {
  return (
    <div className="presentation-overlay">
      <div className="presentation-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        {text}
      </div>
    </div>
  )
}
