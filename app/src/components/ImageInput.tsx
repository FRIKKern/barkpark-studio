import {useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent} from 'react'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import {EditPathContext, FieldView, type OpenRef} from './Fields'
import {toast} from './Toasts'
import {Close as CloseIcon, Crop as CropIcon, Download, Ellipsis, ImageIcon, LinkIcon, Reset, Upload} from './icons'
import type {Field} from '../lib/data'
import {assetUrl, dragCrop, frame, moveCrop, moveHotspot, NO_CROP, NO_HOTSPOT, resizeHotspot, type Crop, type CropSide, type Hotspot, type ImageValue} from '../lib/image'

// J12, after Sanity's image input: upload; the image with an "Edit hotspot and
// crop" button (when the schema asks for options.hotspot) and an options menu;
// the image's own fields (alt) below it. Hotspot and crop are edited in a dialog
// with the mouse or the keyboard: the circle (hotspot) and the rectangle (crop)
// are focusable, arrows move them by 0.5% of the image, Shift+arrows by 2.5%.
// Drop, paste, retry, and picking an existing asset are J36.

type Props = {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}

export function ImageInput({id, field, value, onChange, readOnly, openRef}: Props) {
  const image = (value && typeof value === 'object' ? value : {}) as ImageValue
  const ref = image.asset?._ref
  const editPath = useContext(EditPathContext)
  const file = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const hotspot = !!(field.options as {hotspot?: boolean} | undefined)?.hotspot
  // One path per part, so an editor on the alt text and one on the crop both keep theirs.
  const setPart = (part: string, v: unknown) => (editPath ? editPath(`${id}.${part}`, v) : onChange({...image, [part]: v}))

  const upload = async (f: File) => {
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', f)
      const res = await fetch('/api/media/upload', {method: 'POST', body})
      if (!res.ok) throw new Error(`upload failed (${res.status})`)
      const {ref: next} = (await res.json()) as {ref: string}
      // A new image: its own fields (alt) stay, the old hotspot and crop go.
      const {hotspot: _h, crop: _c, ...keep} = image
      onChange({...keep, asset: {_ref: next}})
    } catch (err) {
      toast({tone: 'critical', title: 'The image could not be uploaded', description: (err as Error).message})
    } finally {
      setUploading(false)
    }
  }
  const pick = () => file.current?.click()
  const url = ref ? assetUrl(ref) : undefined

  return (
    <div className="image-input" id={id}>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
      {!ref ? (
        <div className="image-empty-box" data-uploading={uploading || undefined}>
          <span className="hint">
            <ImageIcon /> {uploading ? 'Uploading…' : 'Drag or paste image here'}
          </span>
          <button type="button" className="btn" disabled={readOnly || uploading} onClick={pick}>
            <Upload /> Upload
          </button>
        </div>
      ) : (
        <div className="image-preview">
          <img src={url} alt="Preview of uploaded image" />
          {uploading && <span className="uploading">Uploading…</span>}
          <div className="image-actions">
            {hotspot && (
              <button type="button" className="icon-btn" aria-label="Open image edit dialog" title="Edit hotspot and crop" disabled={readOnly} onClick={() => setEditing(true)}>
                <CropIcon />
              </button>
            )}
            <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
              <button id={`${id}-menuButton`} type="button" className="icon-btn" aria-label="Open image options menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <Ellipsis />
              </button>
              {menu && (
                <MenuPopover className="popover menu image-menu" onClose={() => setMenu(false)} aria-labelledby={`${id}-menuButton`}>
                  <button type="button" role="menuitem" className="menu-item" disabled={readOnly} onClick={() => (setMenu(false), pick())}>
                    <Upload /> Upload
                  </button>
                  <a role="menuitem" className="menu-item" href={url} download onClick={() => setMenu(false)}>
                    <Download /> Download
                  </a>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => (setMenu(false), navigator.clipboard.writeText(new URL(url!, location.href).href).then(() => toast({title: 'The URL is copied to the clipboard'})))}
                  >
                    <LinkIcon /> Copy URL
                  </button>
                  <button type="button" role="menuitem" className="menu-item danger" disabled={readOnly} onClick={() => (setMenu(false), onChange(undefined))}>
                    <Reset /> Clear field
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
          title={field.title ?? field.name}
          url={url}
          hotspot={image.hotspot ?? NO_HOTSPOT}
          crop={image.crop ?? NO_CROP}
          onChange={(h, c) => (setPart('hotspot', h), setPart('crop', c))}
          onClose={() => setEditing(false)}
        />
      )}
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
          <h2 id="hotspot-title">Edit hotspot and crop</h2>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <p className="label">Hotspot &amp; Crop</p>
          <p className="muted">Adjust the rectangle to crop image. Adjust the circle to specify the area that should always be visible.</p>
          <div className="hotspot-tool" aria-label={`${title}: hotspot and crop`}>
            <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{touchAction: 'none'}}>
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
                aria-label="Crop: arrow keys move it"
                aria-valuetext={`left ${pct(c.left)}, top ${pct(c.top)}, right ${pct(c.right)}, bottom ${pct(c.bottom)}`}
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
                aria-label="Hotspot: arrow keys move it"
                aria-valuetext={`centre ${pct(h.x)} across, ${pct(h.y)} down; ${pct(h.width)} wide, ${pct(h.height)} high`}
                cx={cx}
                cy={cy}
                rx={rx}
                ry={ry}
                onKeyDown={keys('hotspot')}
                onPointerDown={drag((p, s, from) => ({h: moveHotspot(from.h, p.x - s.x, p.y - s.y), c: from.c}))}
              />
              <circle
                className="hotspot-handle"
                data-handle="hotspotHandle"
                cx={cx + rx * Math.SQRT1_2}
                cy={cy + ry * Math.SQRT1_2}
                r={8}
                onPointerDown={drag((p, s, from) => ({h: resizeHotspot(from.h, p.x - s.x, p.y - s.y), c: from.c}))}
              />
              {handles.map(([side, x, y]) => (
                <rect
                  key={side}
                  className="crop-handle"
                  data-handle={`crop-${side}`}
                  x={x - 6}
                  y={y - 6}
                  width={12}
                  height={12}
                  onPointerDown={drag((p, _s, from) => ({h: from.h, c: dragCrop(from.c, side, p.x, p.y)}))}
                />
              ))}
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
                    <figcaption>{p.name}</figcaption>
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

