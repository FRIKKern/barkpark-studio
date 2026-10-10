import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useContext} from 'react'
import {settleClash, useFieldClash} from '../lib/edits'
import {editedBy} from '../lib/history'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {DocIdContext, DocTypeContext} from './Fields'
import {toast} from './Toasts'

const show = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v))

/**
 * Someone else rewrote the text this editor had changed (lib/edits.ts clash): both
 * versions on the field, who and when, and the editor's answer, in the canvas's D20
 * words. Until then the editor's text stays on screen, not saved (the footer says so).
 */
export function FieldClashCard({path}: {path: string}) {
  const id = useContext(DocIdContext)
  const type = useContext(DocTypeContext)
  const clash = useFieldClash(id, path)
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const {data: who} = useQuery({
    queryKey: ['edited-by', id, clash?.rev],
    enabled: !!clash && !!id && !!type,
    staleTime: Infinity,
    queryFn: async () => (await editedBy({data: {type: type!, id: id!, rev: clash!.rev}})) ?? null,
  })
  if (!clash || !id) return null
  const when = clash.at ? new Date(clash.at).toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : ''
  const copy = () =>
    navigator.clipboard.writeText(show(clash.mine)).then(
      () => toast({title: t('Your text is copied to the clipboard')}),
      () => toast({tone: 'critical', title: t('Could not copy your text')}),
    )
  return (
    <div className="field-clash" role="alert" data-testid="field-clash">
      <strong>{t('Someone else rewrote this field')}</strong>{' '}
      <span className="field-clash-who">{who ? t('{who}, {when}', {who, when}) : when}</span>
      <dl>
        <dt>{t('Theirs')}</dt>
        <dd data-version="theirs">{show(clash.theirs)}</dd>
        <dt>{t('Yours, not saved')}</dt>
        <dd data-version="mine">{show(clash.mine)}</dd>
      </dl>
      <div>
        <button type="button" className="btn-text" onClick={() => settleClash(qc, id, path, 'mine')}>
          {t('Keep mine')}
        </button>
        <button type="button" className="btn-text" onClick={() => settleClash(qc, id, path, 'theirs')}>
          {t('Take theirs')}
        </button>
        <button type="button" className="btn-text" onClick={() => void copy()}>
          {t('Copy mine')}
        </button>
      </div>
    </div>
  )
}
