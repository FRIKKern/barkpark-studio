import {useMemo, useState} from 'react'
import {defineContainer, useEditor, type ContainerRenderProps, type Editor} from '@portabletext/editor'
import {defineTable} from '@portabletext/plugin-table'
import {referenceContainers, Table, type TableLabels, type TableMenuProps} from '@portabletext/plugin-table/ui'
import '@portabletext/plugin-table/ui/styles.css'
import '../pt-table.css'
import {useT} from '../lib/i18n'
import {MenuPopover} from './FocusScopes'
import {Ellipsis, TableIcon, Trash} from './icons'

// Tables in a Portable Text field, as Sanity's input has them (its PortableTextTablePlugin
// over @portabletext/plugin-table): the block edits as a grid, a cell holding text as the
// field does. Row and column handles select, drag to reorder and delete; the dots between
// rows and columns insert there; the lanes at the right and the bottom add one at the end;
// the menu over the table's corner has the header row, Select table and Delete table.
// Sanity's words, through our i18n. The value's shape and what a save sends: lib/pt-table.ts.

const table = defineTable({
  containers: {
    ...referenceContainers,
    table: defineContainer({type: 'table', arrayField: 'rows', render: (props) => <StudioTable {...props} />}),
  },
})

/** The table's nodes and keys (Tab between cells, the rectangle selection, copy and paste), beside the editor's text. */
export const PtTablePlugin = table.Plugin

/**
 * A new table after the caret's block (never splitting its text, as the other inserts):
 * three by three with a header row, as Sanity's insert makes one, the caret in its first
 * cell. The editor gives every row, cell and block its key.
 */
export function insertTable(editor: Editor) {
  const outer = outerBlock(editor)
  editor.send({type: 'insert.block', block: table.createBlock({headerRows: 1}), placement: 'after', select: 'start', ...(outer && {at: outer})})
  editor.send({type: 'focus'})
}

/**
 * With the caret in a table's cell, that table as a place to insert at: a cell takes text
 * only, so a block inserted from inside one (a second table, an image) goes after its table.
 * Undefined with the caret anywhere else.
 */
export function outerBlock(editor: Editor) {
  const path = editor.getSnapshot().context.selection?.focus.path
  const top = path && path.length > 3 && path[1] === 'rows' ? path[0] : undefined
  const at = top && typeof top === 'object' && '_key' in top ? {path: [{_key: top._key}], offset: 0} : undefined
  return at && {anchor: at, focus: at}
}

const trash = {trash: <Trash />}

function StudioTable(props: ContainerRenderProps) {
  const t = useT()
  const labels = useMemo<Partial<TableLabels>>(
    () => ({
      'add-column': t('Add column at end'),
      'add-row': t('Add row at end'),
      'column-handle': t('Column handle'),
      'delete-column': t('Delete column'),
      'delete-row': t('Delete row'),
      'insert-here': t('Insert here'),
      'row-handle': t('Row handle'),
    }),
    [t],
  )
  return <Table {...props} icons={trash} labels={labels} renderMenu={menu} />
}

const menu = (props: TableMenuProps) => <TableMenu {...props} />

/** Sanity's table menu: the header row's switch, Select table, Delete table. */
function TableMenu({hasHeader, onToggleHeader, onSelectTable, onDeleteTable, onOpenChange}: TableMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const editor = useEditor()
  const show = (next: boolean) => (setOpen(next), onOpenChange(next))
  // The focus left the menu (a press in the text): closed once it has landed there, so the
  // closing menu does not hand it back to its button and the caret stays where the press put it.
  const left = (wrap: HTMLElement) => setTimeout(() => !wrap.contains(document.activeElement) && show(false))
  // Select table and Delete table end in the text, the selection theirs.
  const pick = (act: () => void) => (show(false), act(), requestAnimationFrame(() => editor.send({type: 'focus'})))
  return (
    // The editor never sees the menu's pointer and keys (it would take the focus back and close it).
    // The button takes the focus itself (the plugin's anchor keeps a press from moving it): the menu returns it there.
    <span className="menu-wrap pt-table-menu" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && open && left(e.currentTarget)}>
      <button type="button" className="icon-btn pt-table-more" aria-label={t('Table options')} data-tip={t('Table options')} data-tip-side="top" aria-haspopup="menu" aria-expanded={open} onClick={(e) => (e.currentTarget.focus(), show(!open))}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover className="popover menu pt-table-actions" onClose={() => show(false)} aria-label={t('Table options')}>
          <button type="button" role="menuitemcheckbox" aria-checked={hasHeader} className="menu-item pt-table-header" autoFocus onClick={onToggleHeader}>
            <span className="switch" aria-hidden>
              <input type="checkbox" checked={hasHeader} readOnly tabIndex={-1} />
              <span />
            </span>
            {t('Header row')}
          </button>
          <hr />
          <button type="button" role="menuitem" className="menu-item" onClick={() => pick(onSelectTable)}>
            <span className="menu-icon-text">
              <TableIcon /> {t('Select table')}
            </span>
          </button>
          <hr />
          <button type="button" role="menuitem" className="menu-item danger" onClick={() => pick(onDeleteTable)}>
            <span className="menu-icon-text">
              <Trash /> {t('Delete table')}
            </span>
          </button>
        </MenuPopover>
      )}
    </span>
  )
}
