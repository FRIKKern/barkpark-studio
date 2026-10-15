import {useState} from 'react'
import {DialogBox} from './FocusScopes'
import {Close} from './icons'
import {useT} from '../lib/i18n'
import {localInput} from '../lib/schedule-read'


/**
 * J40, Sanity's "Schedule draft for publishing": pick a future date and time; Schedule
 * stays off (with Sanity's warning) until it is in the future. It opens on now, as Sanity's,
 * or on a paused schedule's own time (`initial`).
 */
export function ScheduleDialog({initial, run, onClose}: {initial?: Date; run: (publishAt: string) => Promise<unknown>; onClose: () => void}) {
  const t = useT()
  const [value, setValue] = useState(() => localInput(initial ?? new Date()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const at = value ? new Date(value) : null
  const future = !!at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now()
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog schedule-dialog" aria-modal="true" aria-labelledby="schedule-title" onClose={onClose}>
        <header>
          <h2 id="schedule-title">{t('Schedule draft for publishing')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>{t('Select when this document should be published.')}</p>
          <label className="schedule-field">
            <span>{t('Publish on')}</span>
            <input type="datetime-local" className="input" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
          </label>
          {!future && (
            <p className="schedule-warning" role="alert">
              {t('Schedule for a future time and date.')}
            </p>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!future || busy}
            onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                await run(at!.toISOString())
                onClose()
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('Schedule')}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}
