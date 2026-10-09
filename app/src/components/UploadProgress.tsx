import {useT} from '../lib/i18n'

/**
 * Sanity's upload card: the file's name over a progress bar, and Cancel, which
 * stops the upload and leaves the field as it was.
 */
export function UploadProgress({name, progress, onCancel}: {name: string; progress: number; onCancel: () => void}) {
  const t = useT()
  const percent = Math.round(progress * 100)
  return (
    <div className="upload-progress" role="status" aria-label={t('Uploading {name}', {name})}>
      <div className="upload-progress-body">
        <code>{name}</code>
        <div className="upload-progress-bar" role="progressbar" aria-label={t('Uploading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{width: `${percent}%`}} />
        </div>
      </div>
      <button type="button" className="btn upload-cancel" onClick={onCancel}>
        {t('Cancel')}
      </button>
    </div>
  )
}
