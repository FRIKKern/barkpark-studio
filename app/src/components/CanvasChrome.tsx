import {useEffect, useState} from 'react'
import {docStats} from '../lib/doc-stats'
import {useT} from '../lib/i18n'
import {toast} from './Toasts'

// task-dd9f680bbc4369a7: the chrome under a freeform canvas, as Barkpark's LiveView
// Studio draws it under its Beta editor (paper_editor.ex): "+ Add block" (a block type and
// Add, appended after the last block), then the words and blocks, and on a paper Undo and
// Redo. Undo/Redo need the canvas's own history (Barkpark canvas 1.10.0, `undo()`,
// `redo()` and `bp-canvas-history`); a canvas without it shows neither, as before.

type Block = Record<string, unknown>
type Canvas = HTMLElement & {
  blocks?: Block[]
  recoverySnapshot?(): {blocks?: Block[]} | null
  run?: (command: 'insertBlock', args: {type: string}) => boolean
  undo?: () => boolean
  redo?: () => boolean
}

// LiveView's add-block groups (paper_editor.ex add_block_options/0) that the canvas inserts.
const GROUPS: [group: string, types: [type: string, title: string][]][] = [
  ['Text', [['paragraph', 'Paragraph'], ['heading', 'Heading'], ['list', 'List'], ['callout', 'Callout'], ['code', 'Code'], ['blockquote', 'Blockquote'], ['divider', 'Divider'], ['section', 'Section'], ['expandable', 'Expandable'], ['steps', 'Steps'], ['tabs', 'Tabs']]],
  ['Article chrome', [['eyebrow', 'Eyebrow'], ['byline', 'Byline'], ['ingress', 'Ingress'], ['pullquote', 'Pullquote']]],
  ['Visual', [['table', 'Table'], ['note', 'Note'], ['figure', 'Figure'], ['equation', 'Equation'], ['toc', 'Table of contents']]],
]

/** Put the caret at the end of the canvas's last block, where an appended block goes. */
function caretToEnd(canvas: Canvas) {
  const pm = canvas.querySelector<HTMLElement>('.ProseMirror')
  const last = pm?.lastElementChild
  if (!pm || !last) return
  pm.focus({preventScroll: true})
  const range = document.createRange()
  range.selectNodeContents(last)
  range.collapse(false)
  const sel = getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function CanvasChrome({canvas, paper}: {canvas: Canvas | null; paper: boolean}) {
  const t = useT()
  const [stats, setStats] = useState({words: 0, blocks: 0})
  const [type, setType] = useState('paragraph')
  const [history, setHistory] = useState({undo: false, redo: false})
  const undoable = !!canvas && typeof canvas.undo === 'function' && typeof canvas.redo === 'function'
  useEffect(() => {
    if (!canvas) return
    // The count follows what the author has now, saved or not.
    const count = () => setStats(docStats(canvas.recoverySnapshot?.()?.blocks ?? canvas.blocks))
    count()
    const later = () => setTimeout(count)
    const onHistory = (e: Event) => {
      const d = (e as CustomEvent<{undo?: boolean; redo?: boolean}>).detail ?? {}
      setHistory({undo: !!d.undo, redo: !!d.redo})
    }
    canvas.addEventListener('bp-canvas-ops', later)
    canvas.addEventListener('bp-canvas-history', onHistory)
    return () => (canvas.removeEventListener('bp-canvas-ops', later), canvas.removeEventListener('bp-canvas-history', onHistory))
  }, [canvas])
  if (!canvas) return null
  const add = () => {
    caretToEnd(canvas)
    // The canvas reads the new selection on its own frame.
    requestAnimationFrame(() => {
      if (!canvas.run?.('insertBlock', {type})) toast({tone: 'caution', title: t('This block cannot be added here')})
    })
  }
  return (
    <div className="pd-chrome">
      <form className="pd-add-block" onSubmit={(e) => (e.preventDefault(), add())}>
        <label>
          <span>{t('+ Add block')}</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)} disabled={!canvas.run}>
            {GROUPS.map(([group, types]) => (
              <optgroup key={group} label={t(group)}>
                {types.map(([value, title]) => (
                  <option key={value} value={value}>
                    {t(title)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-ghost" disabled={!canvas.run}>
          {t('Add')}
        </button>
      </form>
      <footer className="pd-footer">
        <span>{stats.words === 1 ? t('1 word') : t('{n} words', {n: stats.words})}</span>
        <span aria-hidden="true">·</span>
        <span>{stats.blocks === 1 ? t('1 block') : t('{n} blocks', {n: stats.blocks})}</span>
        {paper && undoable && (
          <span className="pd-history" role="group" aria-label={t('Content change history')}>
            <button type="button" className="btn btn-ghost" aria-label={t('Undo content change')} disabled={!history.undo} onClick={() => canvas.undo!()}>
              {t('Undo')}
            </button>
            <button type="button" className="btn btn-ghost" aria-label={t('Redo content change')} disabled={!history.redo} onClick={() => canvas.redo!()}>
              {t('Redo')}
            </button>
          </span>
        )}
      </footer>
    </div>
  )
}
