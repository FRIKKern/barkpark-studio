import {version as reactVersion} from 'react'
import {createPortal} from 'react-dom'
import {useQuery} from '@tanstack/react-query'
import {DialogBox} from './FocusScopes'
import {Close as CloseIcon} from './icons'
import {toast} from './Toasts'
import {useT} from '../lib/i18n'
import {BUILD, buildName} from '../lib/version'
import {barkparkInfoQuery, diagnosticsText} from '../lib/diagnostics'
import {currentScopeQuery} from '../lib/scope-switch'
import {schemasQuery} from '../lib/data'
import {meQuery} from '../lib/session'

// J69: Sanity's Help > Diagnostics: what a bug report needs, in cards, and "Copy output"
// to paste it into an issue. Ours names Barkpark (URL, version, commit) where Sanity names
// its API host; Sanity's live connection tests are left out.

export function Diagnostics({onClose}: {onClose: () => void}) {
  const t = useT()
  const bp = useQuery(barkparkInfoQuery).data
  const scope = useQuery(currentScopeQuery).data
  const schemas = useQuery(schemasQuery).data ?? []
  const me = useQuery(meQuery).data
  const pending = '…'
  const sections: [string, [string, string][]][] = [
    [t('Studio'), [[t('Studio version'), buildName(BUILD)], [t('React version'), reactVersion]]],
    [
      t('Workspace'),
      [
        [t('Workspace'), scope?.workspace ?? pending],
        [t('Project'), scope?.project ?? pending],
        [t('Dataset'), scope?.dataset ?? pending],
        ['Barkpark', bp?.url ?? pending],
        [t('Barkpark version'), bp ? (bp.version ?? '–') : pending],
        [t('Barkpark commit'), bp ? (bp.commit ?? '–') : pending],
      ],
    ],
    [t('Schema'), [[t('Document types'), String(schemas.length)]]],
    [
      t('User'),
      [
        [t('Email'), me?.email ?? '–'],
        [t('Sign-in'), me?.signIn ?? pending],
        [t('Roles'), me ? (me.canWrite ? t('Editor') : t('Viewer')) : pending],
      ],
    ],
    [
      t('Browser'),
      [
        [t('User agent'), navigator.userAgent],
        [t('Language'), navigator.language],
        [t('Timezone'), Intl.DateTimeFormat().resolvedOptions().timeZone],
        [t('Online'), navigator.onLine ? t('Yes') : t('No')],
        [t('Viewport'), `${innerWidth} × ${innerHeight}`],
        [t('Screen'), `${screen.width} × ${screen.height}`],
      ],
    ],
  ]
  const copyOutput = () =>
    navigator.clipboard
      .writeText(diagnosticsText(sections))
      .then(() => toast({title: t('Diagnostics copied to clipboard')}))
      .catch(() => toast({tone: 'critical', title: t('Could not copy the diagnostics')}))
  return createPortal(
    <div className="dialog-backdrop diagnostics-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog diagnostics" aria-modal="true" aria-label={t('Studio diagnostics')} onClose={onClose}>
        <header>
          <h2>{t('Studio diagnostics')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body diagnostics-body">
          {sections.map(([title, rows]) => (
            <section key={title} className="diagnostics-card" aria-label={title}>
              <h3>{title}</h3>
              <dl>
                {rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd title={v}>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer>
          <button type="button" className="btn-text" onClick={onClose}>
            {t('Close')}
          </button>
          <button type="button" className="btn btn-primary" autoFocus onClick={copyOutput}>
            {t('Copy output')}
          </button>
        </footer>
      </DialogBox>
    </div>,
    document.body,
  )
}
