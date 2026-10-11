import {useEffect, useState, useSyncExternalStore} from 'react'
import {studio, tellStudio} from './barkpark'

// J59, Barkpark mode: Sanity's Edit overlay. A value marked `data-bp-edit`
// (from Barkpark's source map) gets an outline and its document's type icon and title
// on hover, in Sanity's colour; a click opens that field in the studio instead of
// following the page. The icons come from the studio (a fixed set of @sanity/icons bodies).
const useOverlays = () => useSyncExternalStore((l) => (studio.listeners.add(l), () => studio.listeners.delete(l)), () => studio.overlays)

export function EditOverlays() {
  const on = useOverlays()
  const [hover, setHover] = useState<{el: HTMLElement; box: DOMRect} | null>(null)
  useEffect(() => {
    if (!on) return setHover(null)
    const target = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('[data-bp-edit]') ?? null
    const move = (e: MouseEvent) => {
      const el = target(e)
      setHover(el ? {el, box: el.getBoundingClientRect()} : null)
    }
    const click = (e: MouseEvent) => {
      const el = target(e)
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const [type, id, path] = el.dataset.bpEdit!.split(':')
      tellStudio({type: 'edit', doc: {type, id}, path})
    }
    const keep = () => setHover((h) => h && {el: h.el, box: h.el.getBoundingClientRect()})
    addEventListener('mousemove', move)
    addEventListener('click', click, true)
    addEventListener('scroll', keep, true)
    addEventListener('resize', keep)
    return () => {
      removeEventListener('mousemove', move)
      removeEventListener('click', click, true)
      removeEventListener('scroll', keep, true)
      removeEventListener('resize', keep)
    }
  }, [on])
  if (!hover) return null
  const {box, el} = hover
  const icon = studio.icons.byType[el.dataset.bpEdit!.split(':')[0]!] ?? studio.icons.fallback
  return (
    <div aria-hidden="true" style={{position: 'fixed', left: box.left - 2, top: box.top - 2, width: box.width + 4, height: box.height + 4, border: '1px solid #556bfc', borderRadius: 3, pointerEvents: 'none', zIndex: 2147483647}}>
      <span style={{position: 'absolute', left: -1, bottom: '100%', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 2, background: '#556bfc', color: '#fff', font: '600 13px/15px system-ui, sans-serif', padding: '4px 7px 4px 4px', borderRadius: 3, whiteSpace: 'nowrap'}}>
        {icon && <svg width={15} height={15} viewBox="0 0 25 25" fill="none" dangerouslySetInnerHTML={{__html: icon}} />}
        {el.dataset.bpLabel || el.dataset.bpEdit}
      </span>
    </div>
  )
}
