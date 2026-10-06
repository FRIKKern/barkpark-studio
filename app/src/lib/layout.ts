import {createContext} from 'react'

// Which panes collapse to strips — Sanity's own algorithm (structure/components/pane/
// paneLayoutController.ts, _notifyObservers), ported as-is so the two studios
// collapse the same panes at every width:
//  - visit the focused pane first (it never collapses), then the rest right to left;
//  - start from the width left after giving every other pane a 51 px strip;
//  - a pane collapses when its min width exceeds what is left; an open pane uses
//    (min - 51) of it, a collapsed one 51 more (Sanity's accounting, kept exact).
// Min widths: list 320, document 600 (DOCUMENT_PANEL_INITIAL_MIN_WIDTH).
// Ported from Sanity (MIT, Copyright (c) 2016 - 2026 Sanity.io): see THIRD-PARTY.md.
export const STRIP = 51
const MIN = {types: 320, list: 320, doc: 600} as const

export function collapsed(kinds: (keyof typeof MIN)[], width: number, focus = kinds.length - 1): boolean[] {
  const order = [focus, ...kinds.map((_, i) => kinds.length - 1 - i).filter((i) => i !== focus)]
  const out = kinds.map(() => false)
  let remaining = width - (kinds.length - 1) * STRIP
  for (const i of order) {
    const min = MIN[kinds[i]]
    out[i] = i !== focus && min > remaining
    remaining -= out[i] ? STRIP : min - STRIP
  }
  return out
}

/**
 * J42: below this width the structure shows one pane, the last, with a back link
 * (Sanity: the PaneLayout's minWidth is theme media[1] = 600; under it the layout
 * collapses, BackLink appears and split/close go: StructureTool.tsx, StructureToolProvider.tsx).
 */
export const NARROW = 600
export const NarrowContext = createContext(false)
