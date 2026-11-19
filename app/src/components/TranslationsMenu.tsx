import {useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import type {Doc} from '../lib/data'
import {edit, reasonOf} from '../lib/edits'
import {t as tt, useT} from '../lib/i18n'
import {useLive} from '../lib/live'
import {openAfter, type Pane} from '../lib/panes'
import {METADATA_TYPE, groupOf, languageOf, languageTitle, type Language, type TranslationConfig} from '../lib/translation-group'
import {createTranslation, groupQuery, translationsIn, unlinkTranslation} from '../lib/translations'
import {DialogBox, MenuPopover} from './FocusScopes'
import {Add, Check, Close, SplitVertical} from './icons'
import {usePaneNavigate} from './PaneLink'
import {RefPreview} from './Preview'
import {toast} from './Toasts'

/** Sanity's TranslateIcon, redrawn: the header's Translations button. */
const TranslateIcon = () => (
  <svg width={25} height={25} viewBox="0 0 25 25" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 7.5H13M8.75 5.5V7.5M11.25 7.5C10.75 11 8.25 13.75 4.75 15M6.25 9.75C7.25 12 9.25 13.9 11.75 14.9" />
    <path d="M13 20L16.75 11L20.5 20M14.25 17H19.25" />
  </svg>
)

/**
 * Document translations, after Sanity's @sanity/document-internationalization: the header's
 * Translations button of a translated type (the schema's `desk.translations`). It carries
 * the document's language as its badge and lists the languages: the current one, each
 * existing translation (opens in the next pane), each missing one ("Create new … translation":
 * a copy of this document in that language, linked). A document with no language yet picks
 * one first. `readOnly` (a read seat, the Published perspective, a history revision): it
 * lists and opens, and writes nothing.
 */
export function TranslationsMenu({doc, config, panes, index, readOnly, reason}: {doc: Doc; config: TranslationConfig; panes: Pane[]; index: number; readOnly: boolean; reason?: string}) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = usePaneNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [managing, setManaging] = useState(false)
  const close = () => setOpen(false)
  const wrap = useRef<HTMLDivElement>(null)
  // The dialog was opened from a menu item that is gone by now: focus goes back to the Translations button.
  const closeManage = () => (setManaging(false), requestAnimationFrame(() => wrap.current?.querySelector<HTMLButtonElement>('.translations-btn')?.focus()))
  const id = doc._publishedId
  const own = languageOf(doc, config)
  const {data: group, isError} = useQuery(groupQuery(id))
  const linked = translationsIn(group, id)
  const others = Object.values(linked).filter((x) => x !== id)
  // The group's metadata and its members, live: a translation made, unlinked or deleted in
  // another browser (or over the API) shows here without a reload.
  useLive(others, [METADATA_TYPE])
  // A group may hold a language the schema no longer lists (a Sanity dataset's): still reachable.
  const languages: Language[] = [...config.languages, ...Object.keys(linked).filter((l) => !config.languages.some((c) => c.id === l)).map((l) => ({id: l, title: l}))]
  const openDoc = (target: string) => void navigate({href: openAfter(panes, index, {kind: 'doc', id: target, type: doc._type})})

  const create = async (language: Language) => {
    close()
    setBusy(true)
    try {
      const made = await createTranslation(qc, doc, config, language.id)
      // Another editor made it a moment before: theirs opens, nothing is doubled.
      if (made.created) toast({tone: 'positive', title: tt('Created “{language}” translation', {language: language.title})})
      openDoc(made.id)
    } catch (err) {
      toast({tone: 'critical', title: tt('Error creating translation'), description: reasonOf((err as Error).message) ?? tt((err as Error).message)})
    } finally {
      setBusy(false)
      // Whatever came back (a lost answer too): the menu reads the group as it now is.
      void qc.invalidateQueries({queryKey: ['translations']})
    }
  }
  const choose = (language: Language) => {
    close()
    // Said only when made: the save refuses a field read-only for this person, and says so itself.
    if (edit(qc, doc, config.languageField, language.id) === false) return
    toast({title: tt('Set document language to {language}', {language: language.title})})
  }

  return (
    <div ref={wrap} className="menu-wrap translations" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn translations-btn" aria-label={t('Translations')} data-tip={t('Translations')} aria-haspopup="menu" aria-expanded={open} aria-busy={busy || undefined} onClick={() => setOpen((o) => !o)}>
        <TranslateIcon />
        {own && (
          <span className="lang-badge" data-testid="language-badge" title={languageTitle(config, own)}>
            {own}
          </span>
        )}
      </button>
      {open && (
        <MenuPopover centered className="popover menu translations-menu" onClose={close}>
          {isError && <p className="menu-note" role="alert">{t('There was an error returning translations metadata')}</p>}
          {(group?.metas.length ?? 0) > 1 && <p className="menu-note" role="status">{t('This document has been found in more than one Translations Metadata document')}</p>}
          {!own && <p className="menu-note" role="status">{t('Choose a language to apply to this document')}</p>}
          {languages.map((language, i) => {
            const target = linked[language.id]
            const current = own === language.id
            const row = (icon: ReactNode) => (
              <span className="menu-icon-text">
                {icon}
                <span className="lang-title">{language.title}</span>
                <span className="lang-badge">{language.id}</span>
              </span>
            )
            if (!own)
              return (
                <button key={language.id} type="button" role="menuitem" className="menu-item" autoFocus={i === 0} disabled={readOnly} title={readOnly ? reason : undefined} aria-label={t('Set document language to {language}', {language: language.title})} onClick={() => choose(language)}>
                  {row(<Add />)}
                </button>
              )
            if (current)
              return (
                <button key={language.id} type="button" role="menuitem" className="menu-item" autoFocus={i === 0} aria-current="true" aria-disabled="true" aria-label={t('{language}: current document', {language: language.title})}>
                  {row(<Check />)}
                </button>
              )
            if (target)
              return (
                <button key={language.id} type="button" role="menuitem" className="menu-item" autoFocus={i === 0} aria-label={t('Open {language} translation', {language: language.title})} onClick={() => (close(), openDoc(target))}>
                  {row(<SplitVertical />)}
                </button>
              )
            return (
              <button key={language.id} type="button" role="menuitem" className="menu-item" autoFocus={i === 0} disabled={readOnly || busy || !group} title={readOnly ? reason : undefined} aria-label={t('Create new {language} translation', {language: language.title})} onClick={() => void create(language)}>
                {row(<Add />)}
              </button>
            )
          })}
          <hr />
          <button type="button" role="menuitem" className="menu-item" disabled={others.length === 0} title={others.length === 0 ? t('Document has no other translations') : undefined} onClick={() => (close(), setManaging(true))}>
            {t('Manage translations')}
          </button>
        </MenuPopover>
      )}
      {/* Over the whole pane, as the pane's other dialogs: not inside the header's button. */}
      {managing && createPortal(<ManageTranslations doc={doc} config={config} readOnly={readOnly} reason={reason} hrefOf={(target) => openAfter(panes, index, {kind: 'doc', id: target, type: doc._type})} onClose={closeManage} />, wrap.current?.closest('.pane') ?? document.body)}
    </div>
  )
}

/**
 * "Manage translations": the group as it is stored, a row per language with its document
 * (a link that opens it in the next pane) and Unlink, which takes that document out of the
 * group and keeps the document. The plugin opens the metadata document itself for this.
 */
function ManageTranslations({doc, config, readOnly, reason, hrefOf, onClose}: {doc: Doc; config: TranslationConfig; readOnly: boolean; reason?: string; hrefOf: (id: string) => string; onClose: () => void}) {
  const t = useT()
  const qc = useQueryClient()
  const id = doc._publishedId
  const {data: group} = useQuery(groupQuery(id))
  const linked = Object.entries(translationsIn(group, id))
  const meta = group && groupOf(group.metas, id)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const closeButton = useRef<HTMLButtonElement>(null)
  const unlink = async (member: string) => {
    // The pressed Unlink goes with its row: focus moves to Close first, never onto the page.
    closeButton.current?.focus()
    setBusy(member)
    setError(undefined)
    try {
      await unlinkTranslation(qc, member)
      toast({title: tt('Translation reference unset')})
    } catch (err) {
      setError(reasonOf((err as Error).message) ?? (err as Error).message)
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog translations-dialog" aria-modal="true" aria-labelledby="translations-title" onClose={onClose}>
        <header>
          <h2 id="translations-title">{t('Manage translations')}</h2>
          <button ref={closeButton} type="button" className="icon-btn" aria-label={t('Close')} autoFocus onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          {!meta || linked.length < 2 ? (
            <p role="status">{t('Document has no other translations')}</p>
          ) : (
            <ul className="translations-list">
              {linked.map(([language, member]) => (
                <li key={language}>
                  <span className="lang-badge" title={languageTitle(config, language)}>{language}</span>
                  <span className="ref-box" onClick={member === id ? undefined : onClose}>
                    <RefPreview type={doc._type} id={member} href={member === id ? undefined : hrefOf(member)} selected={false} />
                  </span>
                  <button type="button" className="btn" disabled={readOnly || !!busy} title={readOnly ? reason : t('Take this document out of the translation group. The document is kept.')} aria-label={t('Unlink {language}', {language: languageTitle(config, language)})} onClick={() => void unlink(member)}>
                    {t('Unlink')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="field-error" role="alert">{t('Could not unlink: {error}', {error})}</p>}
        </div>
      </DialogBox>
    </div>
  )
}
