import {useState} from 'react'
import {DialogBox} from './FocusScopes'
import {Close} from './icons'
import {useT} from '../lib/i18n'
import {DateTimeInput} from './DateTimeInput'


/**
 * J40, Sanity's "Schedule draft for publishing": pick a future date and time; Schedule
 * stays off (with Sanity's warning) until it is in the future. It opens on now, as Sanity's,
 * or on a paused schedule's own time (`initial`).
 */
export function ScheduleDialog({initial, run, onClose}: {initial?: Date; run: (publishAt: string) => Promise<unknown>; onClose: () => void}) {
  const t = useT()
  // An instant, sent as UTC; shown in this computer's time, as Sanity's text field with its
  // calendar (task-7821e8da66b7d5a9).
  const [value, setValue] = useState<string | undefined>(() => {
    const d = new Date(initial ?? Date.now())
    d.setSeconds(0, 0)
    return d.toISOString()
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const at = value ? new Date(value) : null
  const future = !!at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now()
  return (
    <div className="dialog-backdrop pane-confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog pane-confirm schedule-dialog" aria-modal="true" aria-labelledby="schedule-title" onClose={onClose}>
        <header>
          <h2 id="schedule-title">{t('Schedule draft for publishing')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>{t('Select when this document should be published.')}</p>
          <div className="schedule-field">
            <label htmlFor="schedule-at">{t('Publish on')}</label>
            <DateTimeInput
              id="schedule-at"
              value={value}
              onChange={(v) => setValue(v as string | undefined)}
              options={{dateFormat: 'MMM D, YYYY', timeFormat: 'HH:mm'}}
              min={new Date()}
              notice={future ? undefined : t('Select a date in the future.')}
              autoFocus
              showZone
            />
          </div>
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
