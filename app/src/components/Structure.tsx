import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {docQuery, listQuery, previewTitle, schemaOf, schemasQuery} from '../lib/data'
import {collapsed} from '../lib/layout'
import {useLive} from '../lib/live'
import {closeFrom, openAfter, paneKey, panesPath, type Pane} from '../lib/panes'
import {DocumentPane, docTitle} from './DocumentPane'
import {ChevronRight, Close, Search} from './icons'
import {DocPreview} from './Preview'
import {PaneLink} from './PaneLink'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Width of the pane area. Starts from the server's hint (cookie) so SSR and the first paint agree. */
function usePaneWidth(hint: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(hint)
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setWidth(el.clientWidth)
      document.cookie = `bp_vw=${el.clientWidth}; path=/; max-age=31536000; samesite=lax`
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export function Structure({panes, widthHint}: {panes: Pane[]; widthHint: number}) {
  const [ref, width] = usePaneWidth(widthHint)
  useEffect(() => void (document.documentElement.dataset.hydrated = ''), [])
  const {data: schemas = []} = useQuery(schemasQuery)
  // Live: open docs, open lists, and every type an open doc references, so a
  // reference preview follows edits made anywhere (J23).
  const refTypes = (type: string) =>
    (schemaOf(schemas, type)?.fields ?? []).flatMap((f) => [f.refType, f.of?.refType]).filter((t): t is string => !!t)
  useLive(
    panes.flatMap((p) => (p.kind === 'doc' ? [p.id] : [])),
    panes.flatMap((p) => (p.kind === 'list' ? [p.type] : p.kind === 'doc' ? [p.type, ...refTypes(p.type)] : [])),
  )
  const path = panesPath(panes)
  // A clicked strip takes focus until the path changes.
  const [focus, setFocus] = useState<{path: string; index: number} | null>(null)
  const focusIndex = focus?.path === path ? focus.index : panes.length - 1
  const isCollapsed = collapsed(
    panes.map((p) => p.kind),
    width,
    focusIndex,
  )

  return (
    <div className="panes" ref={ref} data-testid="panes">
      {panes.map((pane, i) =>
        isCollapsed[i] ? (
          <Strip key={paneKey(pane) + i} pane={pane} index={i} onOpen={() => setFocus({path, index: i})} />
        ) : (
          <PaneView key={paneKey(pane) + i} panes={panes} index={i} />
        ),
      )}
      {panes[panes.length - 1].kind !== 'doc' && <div className="pane filler" />}
    </div>
  )
}

function usePaneTitle(pane: Pane) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: doc} = useQuery({
    ...docQuery(pane.kind === 'doc' ? pane.type : '', pane.kind === 'doc' ? pane.id : ''),
    enabled: pane.kind === 'doc',
  })
  if (pane.kind === 'types') return 'Content'
  if (pane.kind === 'list') return schemaOf(schemas, pane.type)?.title ?? pane.type
  const schema = schemaOf(schemas, pane.type)
  return doc && schema ? docTitle(doc, schema) : previewTitle(doc, schema)
}

function Strip({pane, index, onOpen}: {pane: Pane; index: number; onOpen: () => void}) {
  const title = usePaneTitle(pane)
  return (
    <div
      className="pane strip"
      role="button"
      tabIndex={0}
      aria-label={`Expand ${title}`}
      data-testid="pane-strip"
      data-pane-index={index}
      data-pane-collapsed=""
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
    >
      <div className="strip-title">{title}</div>
    </div>
  )
}

function PaneView({panes, index}: {panes: Pane[]; index: number}) {
  const pane = panes[index]
  const next = panes[index + 1]
  if (pane.kind === 'types') return <TypesPane panes={panes} index={index} selected={next?.kind === 'list' ? next.type : undefined} />
  if (pane.kind === 'list') return <ListPane panes={panes} index={index} type={pane.type} selected={next?.kind === 'doc' ? next.id : undefined} />
  return (
    <DocumentPane
      panes={panes}
      index={index}
      closeHref={closeFrom(panes, index)}
      header={<PaneTitle pane={pane} />}
      closeIcon={<Close />}
    />
  )
}

function PaneTitle({pane}: {pane: Pane}) {
  return <span className="title">{usePaneTitle(pane)}</span>
}

function TypesPane({panes, index, selected}: {panes: Pane[]; index: number; selected?: string}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  // Sanity's default structure: one row per document type, in schema order.
  const order = ['post', 'author', 'category']
  const types = [...schemas].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  return (
    <section className="pane types" data-testid="pane" data-pane="types" data-pane-index={index}>
      <header className="pane-header">
        <span className="title">Content</span>
      </header>
      <div className="pane-body">
        {types.map((s) => (
          <PaneLink key={s.name} className="type-row" href={openAfter(panes, index, {kind: 'list', type: s.name})} aria-current={selected === s.name && index === panes.length - 2} data-selected={selected === s.name ? '' : undefined}>
            {s.title}
            <span className="chev">
              <ChevronRight />
            </span>
          </PaneLink>
        ))}
      </div>
    </section>
  )
}

function ListPane({panes, index, type, selected}: {panes: Pane[]; index: number; type: string; selected?: string}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: docs, error} = useQuery(listQuery(type))
  return (
    <section className="pane list" data-testid="pane" data-pane={`list:${type}`} data-pane-index={index}>
      <header className="pane-header">
        <span className="title">{schemaOf(schemas, type)?.title ?? type}</span>
      </header>
      <div className="search">
        <span style={{position: 'absolute', left: 2, top: 3}}>
          <Search />
        </span>
        Search list
      </div>
      <div className="pane-body list-rows">
        {error && <p role="alert">Could not load {type}: {String(error)}</p>}
        {docs?.map((d) => (
          <DocPreview
            key={d._publishedId}
            doc={d}
            href={openAfter(panes, index, {kind: 'doc', id: d._publishedId, type})}
            selected={selected === d._publishedId}
            active={index === panes.length - 2}
            testId="pane-item"
          />
        ))}
      </div>
    </section>
  )
}
