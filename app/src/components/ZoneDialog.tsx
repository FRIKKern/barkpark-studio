import {useMemo, useState, type KeyboardEvent} from 'react'
import {DialogBox} from './FocusScopes'
import {ChevronDown, Close, Search} from './icons'
import {useT} from '../lib/i18n'
import {listedLocal, zoneList, zoneMatches} from '../lib/field-zone'
import '../field-zone.css'

// Sanity's "Select time zone" dialog (DialogTimeZone.tsx), for the Releases tool and a datetime field
// (task-a9e1da2562bec7a4): its list (zones with a city, by offset, named at `at`), its search (city,
// GMT offset, long name), "Select local time zone", and Update only once another zone is chosen.

const longName = (z: {alternativeName: string; namePretty: string}) => `${z.alternativeName} (${z.namePretty})`

export function ZoneDialog({zone, info, at, onClose, onPick}: {zone: string; info: string; at?: Date; onClose: () => void; onPick: (zone: string) => void}) {
  const t = useT()
  const [chosen, setChosen] = useState(zone)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const day = at?.toISOString().slice(0, 10)
  const all = useMemo(() => zoneList(at), [day])
  const local = listedLocal(all)
  const picked = all.find((z) => z.name === chosen)
  const options = query === null ? [] : all.filter((o) => zoneMatches(o, query.trim()))
  const choose = (z: string) => (setChosen(z), setQuery(null))
  const keys = (e: KeyboardEvent) => {
    if (!options.length) return
    if (e.key === 'ArrowDown') e.preventDefault(), setActive((i) => Math.min(i + 1, options.length - 1))
    else if (e.key === 'ArrowUp') e.preventDefault(), setActive((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter') e.preventDefault(), choose(options[active]!.name)
    else if (e.key === 'Escape') e.stopPropagation(), setQuery(null)
  }
  const shown = query ?? (picked ? longName(picked) : chosen)
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog zone-dialog" aria-modal="true" aria-labelledby="zone-title" onClose={onClose}>
        <header>
          <h2 id="zone-title">{t('Select time zone')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>{info}</p>
          <div className="zone-head">
            <label className="zone-label" htmlFor="zone-search">
              {t('Time zone')} {chosen === local?.name && <span className="muted">{t('local time')}</span>}
            </label>
            {local && chosen !== local.name && (
              <button type="button" className="zone-local" onClick={() => choose(local.name)}>
                {t('Select local time zone')}
              </button>
            )}
          </div>
          <div className="zone-combo">
            <span className="zone-input">
              <Search />
              <input
                id="zone-search"
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="zone-options"
                aria-activedescendant={options.length ? `zone-${active}` : undefined}
                autoComplete="off"
                placeholder={t('Search for a city or time zone')}
                value={shown}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => (setQuery(e.target.value), setActive(0))}
                onKeyDown={keys}
              />
              {shown && (
                <button type="button" className="icon-btn" aria-label={t('Clear')} onClick={() => (setQuery(''), setActive(0))}>
                  <Close />
                </button>
              )}
            </span>
            <button type="button" className="zone-open" aria-label={t('Open')} onClick={() => setQuery((v) => (v === null ? '' : null))}>
              <ChevronDown />
            </button>
            {options.length > 0 && (
              <div id="zone-options" role="listbox" className="zone-options">
                {options.map((o, i) => (
                  <div key={o.name} id={`zone-${i}`} role="option" aria-selected={i === active} className="zone-option" onMouseDown={(e) => (e.preventDefault(), choose(o.name))} onMouseEnter={() => setActive(i)}>
                    <span>
                      {o.city} <span className="muted">(GMT{o.offset})</span>
                    </span>
                    <span className="zone-name">{o.alternativeName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={chosen === zone} onClick={() => onPick(chosen)}>
            {t('Update time zone')}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}
