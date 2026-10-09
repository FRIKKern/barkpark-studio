import {useCallback, useContext, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent} from 'react'
import {useQuery} from '@tanstack/react-query'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import {EditPathContext, FieldView, type OpenRef} from './Fields'
import {toast} from './Toasts'
import {RefPreview} from './Preview'
import {Close as CloseIcon, Crop as CropIcon, Download, Ellipsis, ErrorOutline, ImageIcon, LinkIcon, Reset, Search as SearchIcon, Trash, Undo, Upload} from './icons'
import {AssetDeleteDialog} from './AssetDelete'
import type {Field} from '../lib/data'
import {useT} from '../lib/i18n'
import {assetUrl, dragCrop, frame, imageRef, moveCrop, pickedImage, moveHotspot, NO_CROP, NO_HOTSPOT, resizeHotspot, type Crop, type CropSide, type Hotspot, type ImageValue} from '../lib/image'
import {uploadFile, UploadError} from '../lib/upload'
import {UploadProgress} from './UploadProgress'

// J12, after Sanity's image input: upload; the image with an "Edit hotspot and
// crop" button (when the schema asks for options.hotspot) and an options menu;
// the image's own fields (alt) below it. Hotspot and crop are edited in a dialog
// with the mouse or the keyboard: the circle (hotspot) and the rectangle (crop)
// are focusable, arrows move them by 0.5% of the image, Shift+arrows by 2.5%.
// J36: drop a file on it ("Drop to upload"), paste one into it, a failed upload
// says so and offers Retry (Sanity only toasts), replace (Upload / Select in the
// menu) and Clear, and Select picks an image already in the library, whose "…"
// shows which documents use it.

type Props = {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}

const imageOf = (list: FileList | DataTransferItemList | undefined | null): File | undefined => {
  for (const item of Array.from((list ?? []) as ArrayLike<File | DataTransferItem>)) {
    const f = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null
    if (f && f.type.startsWith('image/')) return f
  }
}
const carriesFiles = (e: DragEvent<HTMLElement>) => [...e.dataTransfer.types].includes('Files')

export function ImageInput({id, field, value, onChange, readOnly, openRef}: Props) {
  const image = (value && typeof value === 'object' ? value : {}) as ImageValue
  const ref = imageRef(image)
  const editPath = useContext(EditPathContext)
  const t = useT()
  const file = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<{name: string; progress: number; stop: AbortController} | null>(null)
  const [failed, setFailed] = useState<File | null>(null)
  const [over, setOver] = useState(false)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const title = field.title ?? field.name
  // Sanity's options.hotspot; Barkpark's schemas also say it on the field itself ({hotspot: true}).
  const hotspot = !!((field.options as {hotspot?: boolean} | undefined)?.hotspot || (field as {hotspot?: boolean}).hotspot)
  // One path per part, so an editor on the alt text and one on the crop both keep theirs.
  const setPart = (part: string, v: unknown) => (editPath ? editPath(`${id}.${part}`, v) : onChange({...image, [part]: v}))
  // A new image: its own fields (alt) stay, the old hotspot and crop go.
  const use = (next: string) => {
    onChange(pickedImage(image, next))
    // Legacy-shaped content (the Agency twin) also gets the new file's url, which its site reads.
    if (typeof image.assetId === 'string' || typeof image.url === 'string')
      void fetch(`/api/media/${encodeURIComponent(next.replace(/^asset-/, ''))}/info`)
        .then((r) => (r.ok ? (r.json() as Promise<{url?: string}>) : null))
        .then((info) => info?.url && onChange(pickedImage(image, next, info.url)))
        .catch(() => {})
  }

  // Progress as it goes; Cancel aborts it and the field keeps its value.
  const upload = async (f: File) => {
    const stop = new AbortController()
    setUploading({name: f.name, progress: 0, stop})
    setFailed(null)
    try {
      use(await uploadFile(f, (progress) => setUploading((u) => (u && u.stop === stop ? {...u, progress} : u)), stop.signal))
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setFailed(f)
      toast({tone: 'critical', title: t('Upload failed'), description: err instanceof UploadError && err.network ? t('The network is unreachable.') : (err as Error).message})
    } finally {
      setUploading((u) => (u?.stop === stop ? null : u))
    }
  }
  const pick = () => file.current?.click()
  const url = ref ? assetUrl(ref) : undefined
  // Drop and paste land on the image box (empty or filled), as in Sanity.
  const target = readOnly
    ? {}
    : {
        onDragEnter: (e: DragEvent<HTMLElement>) => carriesFiles(e) && (e.preventDefault(), setOver(true)),
        onDragOver: (e: DragEvent<HTMLElement>) => carriesFiles(e) && e.preventDefault(),
        onDragLeave: (e: DragEvent<HTMLElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false),
        onDrop: (e: DragEvent<HTMLElement>) => {
          e.preventDefault()
          setOver(false)
          const f = imageOf(e.dataTransfer.files)
          if (f) void upload(f)
        },
        onPaste: (e: ClipboardEvent<HTMLElement>) => {
          const f = imageOf(e.clipboardData.files) ?? imageOf(e.clipboardData.items)
          if (f) (e.preventDefault(), void upload(f))
        },
      }
  const overlay = over && (
    <div className="drop-overlay" aria-live="polite">
      <Upload /> {t('Drop to upload')}
    </div>
  )

  return (
    <div className="image-input" id={id}>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
      {uploading ? (
        <UploadProgress name={uploading.name} progress={uploading.progress} onCancel={() => uploading.stop.abort()} />
      ) : !ref ? (
        // Focusable so a paste has somewhere to land.
        <div className="image-empty-box" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop, paste or upload an image', {title})} data-over={over || undefined} {...target}>
          {overlay}
          {failed ? (
            <span className="hint failed" role="alert">
              <ErrorOutline /> {t('Upload failed')}
            </span>
          ) : (
            <span className="hint">
              <ImageIcon /> {t('Drag or paste image here')}
            </span>
          )}
          <span className="image-empty-actions">
            {failed && (
              <button type="button" className="btn" onClick={() => upload(failed)}>
                <Undo /> {t('Retry')}
              </button>
            )}
            <button type="button" className="btn" disabled={readOnly} onClick={pick}>
              <Upload /> {t('Upload')}
            </button>
            <button type="button" className="btn" disabled={readOnly} onClick={() => setBrowsing(true)}>
              <SearchIcon /> {t('Select')}
            </button>
          </span>
        </div>
      ) : (
        <div className="image-preview" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop or paste an image to replace it', {title})} data-over={over || undefined} {...target}>
          {overlay}
          <img src={url} alt={t('Preview of uploaded image')} />
          <div className="image-actions">
            {hotspot && (
              <button type="button" className="icon-btn" aria-label={t('Open image edit dialog')} title={t('Edit hotspot and crop')} disabled={readOnly} onClick={() => setEditing(true)}>
                <CropIcon />
              </button>
            )}
            <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
              <button id={`${id}-menuButton`} type="button" className="icon-btn" aria-label={t('Open image options menu')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <Ellipsis />
              </button>
              {menu && (
                <MenuPopover className="popover menu image-menu" onClose={() => setMenu(false)} aria-labelledby={`${id}-menuButton`}>
                  <button type="button" role="menuitem" className="menu-item" disabled={readOnly} onClick={() => (setMenu(false), pick())}>
                    <Upload /> {t('Upload')}
                  </button>
                  <button type="button" role="menuitem" className="menu-item" disabled={readOnly} onClick={() => (setMenu(false), setBrowsing(true))}>
                    <SearchIcon /> {t('Select')}
                  </button>
                  <a role="menuitem" className="menu-item" href={url} download onClick={() => setMenu(false)}>
                    <Download /> {t('Download')}
                  </a>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => (setMenu(false), navigator.clipboard.writeText(new URL(url!, location.href).href).then(() => toast({title: t('The URL is copied to the clipboard')})))}
                  >
                    <LinkIcon /> {t('Copy URL')}
                  </button>
                  <button type="button" role="menuitem" className="menu-item danger" disabled={readOnly} onClick={() => (setMenu(false), onChange(undefined))}>
                    <Reset /> {t('Clear field')}
                  </button>
                </MenuPopover>
              )}
            </div>
          </div>
        </div>
      )}
      {field.fields?.map((f) => (
        <FieldView key={f.name} field={readOnly ? {...f, readOnly: true} : f} path={`${id}.${f.name}`} value={image[f.name]} openRef={openRef} onChange={(v) => setPart(f.name, v)} />
      ))}
      {editing && url && (
        <HotspotDialog
          title={title}
          url={url}
          hotspot={image.hotspot ?? NO_HOTSPOT}
          crop={image.crop ?? NO_CROP}
          onChange={(h, c) => (setPart('hotspot', h), setPart('crop', c))}
          onClose={() => setEditing(false)}
        />
      )}
      {browsing && <AssetPicker title={title} path={id} openRef={openRef} onPick={(next) => (setBrowsing(false), use(next))} onClose={() => setBrowsing(false)} />}
    </div>
  )
}

type Asset = {id: string; name: string}
type Use = {_id: string; _type: string; title?: string}

/** Sanity's "Select image for <field>": the library as tiles; each tile's "…" shows where it is used. */
function AssetPicker({title, path, openRef, onPick, onClose}: {title: string; path: string; openRef: OpenRef; onPick: (ref: string) => void; onClose: () => void}) {
  const {data: assets, isPending, error} = useQuery({queryKey: ['media'], queryFn: () => fetch('/api/media/').then((r) => (r.ok ? (r.json() as Promise<Asset[]>) : Promise.reject(new Error(`media list → ${r.status}`))))})
  const t = useT()
  const [usageOf, setUsageOf] = useState<Asset | null>(null)
  const [deleting, setDeleting] = useState<Asset | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  return (
    <PaneOverlay>
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <DialogBox className="dialog asset-dialog" aria-modal="true" aria-labelledby={`${path}-assets-title`} onClose={onClose}>
          <header>
            <h2 id={`${path}-assets-title`}>{t('Select image for "{title}"', {title})}</h2>
            <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
              <CloseIcon />
            </button>
          </header>
          <div className="dialog-body">
            {isPending && <p className="muted">{t('Loading images…')}</p>}
            {error && <p role="alert">{t('Could not load the images: {message}', {message: (error as Error).message})}</p>}
            {assets?.length === 0 && <p className="muted">{t('No images yet. Upload one first.')}</p>}
            <div className="asset-grid">
              {assets?.map((a) => (
                <div key={a.id} className="asset-tile">
                  <button type="button" className="asset-pick" aria-label={a.name} title={a.name} onClick={() => onPick(`asset-${a.id}`)}>
                    <img src={`${assetUrl(a.id)}?size=thumb`} alt={a.name} />
                  </button>
                  <div className="menu-wrap asset-more" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenuFor(null)}>
                    <button id={`asset-${a.id}-menuButton`} type="button" className="icon-btn" aria-label={t('{name}: more', {name: a.name})} aria-haspopup="menu" aria-expanded={menuFor === a.id} onClick={() => setMenuFor(menuFor === a.id ? null : a.id)}>
                      <Ellipsis />
                    </button>
                    {menuFor === a.id && (
                      <MenuPopover className="popover menu image-menu" onClose={() => setMenuFor(null)} aria-labelledby={`asset-${a.id}-menuButton`}>
                        <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenuFor(null), setUsageOf(a))}>
                          <LinkIcon /> {t('Show usage')}
                        </button>
                        <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenuFor(null), setDeleting(a))}>
                          <Trash /> {t('Delete')}
                        </button>
                      </MenuPopover>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogBox>
        {usageOf && <UsageDialog asset={usageOf} path={path} openRef={openRef} onClose={() => setUsageOf(null)} onOpen={onClose} />}
        {deleting && <AssetDeleteDialog kind="image" asset={deleting} path={path} openRef={openRef} onClose={() => setDeleting(null)} onOpen={onClose} />}
      </div>
    </PaneOverlay>
  )
}

/** Sanity's "Documents using file": every document whose image field uses the asset. */
function UsageDialog({asset, path, openRef, onClose, onOpen}: {asset: Asset; path: string; openRef: OpenRef; onClose: () => void; onOpen: () => void}) {
  const t = useT()
  const {data: uses, isPending} = useQuery({queryKey: ['media-usage', asset.id], queryFn: () => fetch(`/api/media/${encodeURIComponent(asset.id)}/usage`).then((r) => r.json() as Promise<Use[]>)})
  return (
    <div className="dialog-backdrop nested" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog usage-dialog" aria-modal="true" aria-label={t('Documents using file')} onClose={onClose}>
        <header>
          <h2>{t('Documents using file')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          {isPending && <p className="muted">{t('Looking…')}</p>}
          {uses?.length === 0 && (
            <h3 className="usage-none">
              {t('No documents are using file')} <code>{asset.name}</code>
            </h3>
          )}
          {!!uses?.length && (
            <>
              <h3 className="usage-count">
                {uses.length === 1 ? t('One document is using file') : t('{n} documents are using file', {n: uses.length})} <code>{asset.name}</code>
              </h3>
              {/* Each one as its list row (thumbnail, title, subtitle), like Sanity's. */}
              <ul className="usage-list">
                {uses.map((u) => (
                  <li key={u._id} onClick={onOpen}>
                    <RefPreview type={u._type} id={u._id} href={openRef(u._type, u._id, path).href} selected={false} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </DialogBox>
    </div>
  )
}

const PREVIEWS = [
  {name: '3:4', ratio: 3 / 4},
  {name: 'Square', ratio: 1},
  {name: '16:9', ratio: 16 / 9},
  {name: 'Panorama', ratio: 4},
]

function HotspotDialog({title, url, hotspot, crop, onChange, onClose}: {title: string; url: string; hotspot: Hotspot; crop: Crop; onChange: (h: Hotspot, c: Crop) => void; onClose: () => void}) {
  const t = useT()
  // Local while dragging; written on release (and on every key press).
  const [h, setH] = useState(hotspot)
  const [c, setC] = useState(crop)
  // The image's pixel size: for the tool's shape, the size label and the previews.
  const [natural, setNatural] = useState<{width: number; height: number} | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setNatural({width: img.naturalWidth, height: img.naturalHeight})
    img.src = url
  }, [url])
  const latest = useRef({h, c})
  latest.current = {h, c}
  const commit = (nh: Hotspot, nc: Crop) => (setH(nh), setC(nc), onChange(nh, nc))

  const W = 560
  const maskId = useId()
  const H = natural ? (W * natural.height) / natural.width : 350
  const svg = useRef<SVGSVGElement>(null)
  // SVG units per screen pixel: the handles' grab circles stay 44 px wide however
  // small the tool is drawn (phone width, F12; shown only there, in CSS).
  // (A callback ref: the dialog mounts through a portal, after this component's effects.)
  const [unit, setUnit] = useState(1)
  const sized = useRef<ResizeObserver | null>(null)
  const svgRef = useCallback((el: SVGSVGElement | null) => {
    svg.current = el
    sized.current?.disconnect()
    sized.current = el && new ResizeObserver(() => el.getBoundingClientRect().width && setUnit(W / el.getBoundingClientRect().width))
    if (el) sized.current!.observe(el)
  }, [])
  const at = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return {x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height}
  }
  const drag = (apply: (p: {x: number; y: number}, start: {x: number; y: number}, from: {h: Hotspot; c: Crop}) => {h: Hotspot; c: Crop}) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = at(e.nativeEvent)
    const from = latest.current
    const move = (ev: PointerEvent) => {
      const next = apply(at(ev), start, from)
      setH(next.h)
      setC(next.c)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      onChange(latest.current.h, latest.current.c)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  const keys = (target: 'hotspot' | 'crop') => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.025 : 0.005
    const d = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[e.key]
    if (!d) return
    e.preventDefault()
    if (target === 'hotspot') commit(moveHotspot(h, d[0]!, d[1]!), c)
    else commit(h, moveCrop(c, d[0]!, d[1]!))
  }

  const cx = h.x * W
  const cy = h.y * H
  const rx = (h.width * W) / 2
  const ry = (h.height * H) / 2
  const crect = {x: c.left * W, y: c.top * H, w: (1 - c.left - c.right) * W, h: (1 - c.top - c.bottom) * H}
  const handles: [CropSide, number, number][] = [
    ['top', crect.x + crect.w / 2, crect.y],
    ['bottom', crect.x + crect.w / 2, crect.y + crect.h],
    ['left', crect.x, crect.y + crect.h / 2],
    ['right', crect.x + crect.w, crect.y + crect.h / 2],
    ['topLeft', crect.x, crect.y],
    ['topRight', crect.x + crect.w, crect.y],
    ['bottomLeft', crect.x, crect.y + crect.h],
    ['bottomRight', crect.x + crect.w, crect.y + crect.h],
  ]

  return (
    <PaneOverlay>
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog hotspot-dialog" aria-modal="true" aria-labelledby="hotspot-title" onClose={onClose}>
        <header>
          <h2 id="hotspot-title">{t('Edit hotspot and crop')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <p className="label">{t('Hotspot & Crop')}</p>
          <p className="muted">{t('Adjust the rectangle to crop image. Adjust the circle to specify the area that should always be visible.')}</p>
          <div className="hotspot-tool" aria-label={t('{title}: hotspot and crop', {title})}>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{touchAction: 'none'}}>
              <image href={url} width={W} height={H} opacity={0.25} />
              <svg x={crect.x} y={crect.y} width={crect.w} height={crect.h} viewBox={`${crect.x} ${crect.y} ${crect.w} ${crect.h}`} overflow="hidden">
                <image href={url} width={W} height={H} />
              </svg>
              {/* The crop dims, except inside the hotspot (as Sanity's tool). */}
              <mask id={`${maskId}-m`}>
                <rect width={W} height={H} fill="#fff" />
                <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" />
              </mask>
              <rect x={crect.x} y={crect.y} width={crect.w} height={crect.h} fill="rgba(0,0,0,.4)" mask={`url(#${maskId}-m)`} pointerEvents="none" />
              <rect
                className="crop-rect"
                data-handle="crop"
                tabIndex={0}
                role="slider"
                aria-label={t('Crop: arrow keys move it')}
                aria-valuetext={t('left {left}, top {top}, right {right}, bottom {bottom}', {left: pct(c.left), top: pct(c.top), right: pct(c.right), bottom: pct(c.bottom)})}
                x={crect.x}
                y={crect.y}
                width={crect.w}
                height={crect.h}
                onKeyDown={keys('crop')}
                onPointerDown={drag((p, s, from) => ({h: from.h, c: moveCrop(from.c, p.x - s.x, p.y - s.y)}))}
              />
              <ellipse
                className="hotspot"
                data-handle="hotspot"
                tabIndex={0}
                role="slider"
                aria-label={t('Hotspot: arrow keys move it')}
                aria-valuetext={t('centre {x} across, {y} down; {width} wide, {height} high', {x: pct(h.x), y: pct(h.y), width: pct(h.width), height: pct(h.height)})}
                cx={cx}
                cy={cy}
                rx={rx}
                ry={ry}
                onKeyDown={keys('hotspot')}
                onPointerDown={drag((p, s, from) => ({h: moveHotspot(from.h, p.x - s.x, p.y - s.y), c: from.c}))}
              />
              {(() => {
                const resize = drag((p, s, from) => ({h: resizeHotspot(from.h, p.x - s.x, p.y - s.y), c: from.c}))
                const [hx, hy] = [cx + rx * Math.SQRT1_2, cy + ry * Math.SQRT1_2]
                return (
                  <>
                    <circle className="handle-grab" cx={hx} cy={hy} r={22 * unit} onPointerDown={resize} />
                    <circle className="hotspot-handle" data-handle="hotspotHandle" cx={hx} cy={hy} r={8} onPointerDown={resize} />
                  </>
                )
              })()}
              {handles.map(([side, x, y]) => {
                const pull = drag((p, _s, from) => ({h: from.h, c: dragCrop(from.c, side, p.x, p.y)}))
                return (
                  <g key={side}>
                    <circle className="handle-grab" cx={x} cy={y} r={22 * unit} onPointerDown={pull} />
                    <rect className="crop-handle" data-handle={`crop-${side}`} x={x - 6} y={y - 6} width={12} height={12} onPointerDown={pull} />
                  </g>
                )
              })}
            </svg>
            {natural && (
              <span className="crop-size">
                {Math.round((1 - c.left - c.right) * natural.width)} × {Math.round((1 - c.top - c.bottom) * natural.height)}
              </span>
            )}
          </div>
          {natural && (
            <div className="crop-previews">
              {PREVIEWS.map((p) => {
                const f = frame(c, h, natural, p.ratio)
                return (
                  <figure key={p.name}>
                    <figcaption>{t(p.name)}</figcaption>
                    <div className="crop-preview" style={{aspectRatio: String(p.ratio)}}>
                      <img src={url} alt="" style={{width: `${100 / f.width}%`, left: `${(-f.left / f.width) * 100}%`, top: `${(-f.top / f.height) * 100}%`, height: `${100 / f.height}%`}} />
                    </div>
                  </figure>
                )
              })}
            </div>
          )}
        </div>
      </DialogBox>
    </div>
    </PaneOverlay>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

