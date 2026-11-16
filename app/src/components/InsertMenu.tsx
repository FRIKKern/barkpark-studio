import {useState, type KeyboardEvent} from 'react'
import {ALL_ITEMS, filterChoices, gridStep, previewUrl, type Choice, type MenuSetup} from '../lib/insert-menu'
import {Search as SearchIcon, ThLargeIcon, UlistIcon} from './icons'
import {TypeIcon} from './Preview'
import {useT} from '../lib/i18n'
import '../array-tools.css'

// Sanity's array insert menu (inputs.array.insert-menu.*), drawn inside a MenuPopover: a
// search box that narrows the types as you type (Enter adds the first), filter tabs, and a
// list/grid toggle where the schema offers a grid (`options.insertMenu.views`, lib/insert-menu.ts).
// Every control is a menu item, so the arrow keys reach them all (Tab closes a menu here); in
// the grid the arrows move by tile and by row. Escape closes, focus back on the opener.

export function InsertMenu({choices, setup, pick}: {choices: Choice[]; setup: MenuSetup; pick: (value: string) => void}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(ALL_ITEMS)
  const [view, setView] = useState(setup.views[0]!)
  const shown = filterChoices(choices, query, setup.groups.find((g) => g.name === group))
  const next = setup.views[(setup.views.indexOf(view) + 1) % setup.views.length]!
  const toggleLabel = next === 'grid' ? t('Toggle grid view') : t('Toggle list view')
  // The grid's arrows, before the menu's own (which only go up and down the items in order).
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const tiles = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > [role=menuitem]')]
    const at = tiles.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    const cols = getComputedStyle(e.currentTarget).gridTemplateColumns.split(' ').filter(Boolean).length
    e.preventDefault()
    e.stopPropagation()
    tiles[gridStep(at, e.key, tiles.length, cols)]?.focus()
  }
  return (
    <div className="insert-menu" data-view={view}>
      {(setup.filter || setup.views.length > 1) && (
        <div className="insert-menu-head">
          {setup.filter && (
            <div className="menu-search">
              <SearchIcon />
              <input
                type="search"
                className="input"
                data-autofocus
                aria-label={t('Search')}
                placeholder={t('Search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && shown[0] && (e.preventDefault(), pick(shown[0].value))}
              />
            </div>
          )}
          {setup.views.length > 1 && (
            <button type="button" role="menuitemcheckbox" aria-checked={view === 'grid'} className="icon-btn insert-view-toggle" aria-label={toggleLabel} data-tip={toggleLabel} onClick={() => setView(next)}>
              {next === 'grid' ? <ThLargeIcon /> : <UlistIcon />}
            </button>
          )}
        </div>
      )}
      {setup.groups.length > 0 && (
        <div className="insert-menu-tabs" role="group" aria-label={t('Filter')}>
          {setup.groups.map((g) => (
            <button key={g.name} type="button" role="menuitemradio" aria-checked={g.name === group} className="insert-menu-tab" onClick={() => setGroup(g.name)}>
              {g.title}
            </button>
          ))}
        </div>
      )}
      {!shown.length ? (
        <p className="menu-empty muted" role="status">
          {t('No items found')}
        </p>
      ) : view === 'grid' ? (
        <div className="insert-grid" onKeyDownCapture={onGridKey}>
          {shown.map((c, i) => (
            <button key={c.value} type="button" role="menuitem" className="menu-item insert-tile" autoFocus={!setup.filter && i === 0} onClick={() => pick(c.value)}>
              <Tile choice={c} src={previewUrl(setup.preview, c.value)} icons={setup.showIcons} />
              <span className="insert-tile-title">{c.title}</span>
            </button>
          ))}
        </div>
      ) : (
        shown.map((c, i) => (
          <button key={c.value} type="button" role="menuitem" className="menu-item insert-item" autoFocus={!setup.filter && i === 0} onClick={() => pick(c.value)}>
            {setup.showIcons && c.icon?.iconSvg ? (
              <span className="menu-icon-text">
                <TypeIcon schema={c.icon} /> {c.title}
              </span>
            ) : (
              c.title
            )}
          </button>
        ))
      )}
    </div>
  )
}

/** A grid tile's picture: the schema's preview image, else the type's icon, else a quiet box (Sanity's). */
function Tile({choice, src, icons}: {choice: Choice; src?: string; icons: boolean}) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="insert-tile-media" aria-hidden>
      {src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : icons && choice.icon?.iconSvg ? <TypeIcon schema={choice.icon} /> : null}
    </span>
  )
}
