import {useContext, useLayoutEffect, useState, type MouseEvent, type ReactNode} from 'react'
import {EditPathContext, FieldView, ParentContext, type OpenRef} from './Fields'
import type {DropHandlers} from './FileBox'
import {Crop as CropIcon, Ellipsis, ErrorOutline, ImageIcon, Search as SearchIcon, Undo, Upload} from './icons'
import {UnsupportedAssetCard} from './BrokenValues'
import type {Field} from '../lib/data'
import {useFileInfo} from '../lib/file-info'
import {focusIn, holdAct, settleBox, type Act} from '../lib/held-act'
import {useT} from '../lib/i18n'
import {cropView, imageRef, imageSrc, sanityImageId, type ImageValue} from '../lib/image'

// task-05dcdef359da08fc: the image input in two parts, both outside the editors' chunk.
//  - ImageFrame: the field's box and the image's own fields (alt). It is never swapped, so typing
//    in Alt goes on whatever the chunk does (task-05dc: they were inside the chunk's boundary, and
//    went with it).
//  - ImageBox: the image (or the empty box) and its buttons, one markup for both sides. The real
//    input (ImageInput, in the chunk) draws it with its handlers; before the chunk is here the same
//    box is drawn on its own: a press is kept for the real input (lib/held-act.ts), a drop refused, said.

type FrameProps = {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef; children: ReactNode}

export function ImageFrame({id, field, value, onChange, readOnly, openRef, children}: FrameProps) {
  const image = (value && typeof value === 'object' ? value : {}) as ImageValue
  const ref = imageRef(image)
  const editPath = useContext(EditPathContext)
  const {error: infoError} = useFileInfo(ref)
  // One path per part, so an editor on the alt text and one on the crop both keep theirs.
  const setPart = (part: string, v: unknown) => (editPath ? editPath(`${id}.${part}`, v) : onChange({...image, [part]: v}))
  // A Sanity image id (a value moved over from Sanity) draws as the image Barkpark serves
  // for it. Only when Barkpark has no file for it (404) is it an asset this studio does
  // not know: the card shows it as it is, as for any other foreign ref (lib/broken.ts).
  if (ref && sanityImageId(ref) && infoError?.message.endsWith(' 404')) return <UnsupportedAssetCard asset={{reason: 'foreignRef', source: ref}} value={value} onChange={onChange} />
  return (
    // With fields of its own (alt, caption) Sanity draws the image as an object: a rule on the left, all inside it.
    <div className="image-input" id={id} data-fields={field.fields?.length ? '' : undefined}>
      {children}
      <ParentContext.Provider value={image}>
        {field.fields?.map((f) => (
          <FieldView key={f.name} field={readOnly ? {...f, readOnly: true} : f} path={`${id}.${f.name}`} value={image[f.name]} openRef={openRef} onChange={(v) => setPart(f.name, v)} />
        ))}
      </ParentContext.Provider>
    </div>
  )
}

/** What the real input hands the box: its handlers, and what only it draws (progress, an open menu). */
export type ImageBoxLive = {
  target: DropHandlers
  over: boolean
  overlay: ReactNode
  chooser: ReactNode
  uploading: ReactNode | null
  failed: boolean
  onRetry: () => void
  act: (act: Act) => void
  onWarm: () => void
  menu: boolean
  menuItems: ReactNode
  onMenuBlur: () => void
}
type BoxProps = {id: string; field: Field; value: unknown; readOnly?: boolean; live?: ImageBoxLive}

export function ImageBox({id, field, value, readOnly, live}: BoxProps) {
  const t = useT()
  const image = (value && typeof value === 'object' ? value : {}) as ImageValue
  const ref = imageRef(image)
  const title = field.title ?? field.name
  // While the image loads, its blur placeholder (the asset's lqip) where the image will
  // sit: contained in the 270 px box, never larger than the image itself.
  const {data: info} = useFileInfo(ref)
  const [loaded, setLoaded] = useState<string>()
  // A crop set on the image: the preview shows that part only (cropView in lib/image.ts).
  const crop = info?.width && info.height ? cropView(image.crop, {width: info.width, height: info.height}) : null
  const placeholder =
    ref && loaded !== ref && info?.lqip && info.width && info.height
      ? {backgroundImage: `url("${info.lqip}")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: `min(${info.width}px, 100%, ${Math.round((270 * info.width) / info.height)}px) auto`}
      : undefined
  // Sanity's options.hotspot; Barkpark's schemas also say it on the field itself ({hotspot: true}).
  const hotspot = !!((field.options as {hotspot?: boolean} | undefined)?.hotspot || (field as {hotspot?: boolean}).hotspot)
  const press = (act: Act) => (e: MouseEvent<HTMLButtonElement>) => (live ? live.act(act) : holdAct(id, act, e.currentTarget))
  // Drawn before the chunk: as React takes this box away for the real one, what had the focus in it
  // (and so whether a held press stands) is read, before the box leaves the page (lib/held-act.ts).
  const before = !live
  useLayoutEffect(() => (before ? () => settleBox(id, focusIn(id)) : undefined), [before, id])
  // Before the chunk a dropped file is kept from the tab by DocEditors.tsx (guardDrops), server HTML or this.
  const target = live?.target ?? {}
  const over = live?.over || undefined
  const onLoadRef = (el: HTMLImageElement | null) => void (el?.complete && el.naturalWidth && loaded !== ref && setLoaded(ref))
  return (
    <>
      {live ? live.chooser : <input type="file" accept="image/*" hidden />}
      {live?.uploading ? (
        live.uploading
      ) : !ref ? (
        // Focusable so a paste has somewhere to land.
        <div className="image-empty-box" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop, paste or upload an image', {title})} data-over={over} {...target}>
          {live?.overlay}
          {live?.failed ? (
            <span className="hint failed" role="alert">
              <ErrorOutline /> {t('Upload failed')}
            </span>
          ) : (
            <span className="hint">
              <ImageIcon /> {t('Drag or paste image here')}
            </span>
          )}
          <span className="image-empty-actions">
            {live?.failed && (
              <button type="button" className="btn" onClick={live.onRetry}>
                <Undo /> {t('Retry')}
              </button>
            )}
            <button type="button" className="btn" data-act="upload" disabled={readOnly} onClick={press('upload')}>
              <Upload /> {t('Upload')}
            </button>
            <button type="button" className="btn" data-act="select" disabled={readOnly} onPointerEnter={live?.onWarm} onFocus={live?.onWarm} onClick={press('select')}>
              <SearchIcon /> {t('Select')}
            </button>
          </span>
        </div>
      ) : (
        <div className="image-preview" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop or paste an image to replace it', {title})} data-over={over} style={placeholder} {...target}>
          {live?.overlay}
          {crop ? (
            // Sanity's preview shows the crop (its rect), never more of the image than the crop.
            <span className="image-crop" style={{width: `min(100%, ${Math.round(270 * crop.ratio)}px, ${Math.round(crop.width)}px)`, aspectRatio: String(crop.ratio)}}>
              <img src={imageSrc(ref, 1200, 540)} alt={t('Preview of uploaded image')} decoding="async" onLoad={() => setLoaded(ref)} ref={onLoadRef} style={crop.style} />
            </span>
          ) : (
            <img src={imageSrc(ref, 1200, 540)} alt={t('Preview of uploaded image')} decoding="async" onLoad={() => setLoaded(ref)} ref={onLoadRef} />
          )}
          <div className="image-actions">
            {hotspot && (
              <button type="button" className="icon-btn" data-act="edit" aria-label={t('Open image edit dialog')} title={t('Edit hotspot and crop')} disabled={readOnly} onClick={press('edit')}>
                <CropIcon />
              </button>
            )}
            <div className="menu-wrap" onBlur={(e) => live && !e.currentTarget.contains(e.relatedTarget) && live.onMenuBlur()}>
              <button id={`${id}-menuButton`} type="button" className="icon-btn" data-act="menu" aria-label={t('Open image options menu')} aria-haspopup="menu" aria-expanded={!!live?.menu} onClick={press('menu')}>
                <Ellipsis />
              </button>
              {live?.menu && live.menuItems}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
