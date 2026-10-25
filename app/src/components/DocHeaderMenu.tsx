import {useEffect, useState, useSyncExternalStore} from 'react'
import {MenuPopover} from './FocusScopes'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {copy, isEmpty, read, signature, transfer} from '../lib/clipboard'
import {edit} from '../lib/edits'
import type {Doc, Schema} from '../lib/data'
import {Check, ClipboardIcon, Copy, Ellipsis, Share, LinkIcon, TargetIcon, Transfer, EarthAmericas, JsonIcon, LaunchIcon, RestoreIcon, SyncIcon, TaskIcon} from './icons'
import studio from '../studio.config'
import {toast} from './Toasts'
import {useScopedHref} from './PaneLink'
import {t as tt, useT} from '../lib/i18n'
import {showTasks} from '../lib/tasks-ui'
import {barkparkInfoQuery} from '../lib/diagnostics'
import {currentScopeQuery} from '../lib/scope-switch'
import {PAPER_TYPES} from '../lib/paper'

/** Sanity names the Alt key "Option" on a Mac in its shortcut chips; known only in the browser. */
export function useAltName() {
  const [alt, setAlt] = useState('Alt')
  useEffect(() => setAlt(/Mac|iPhone|iPad/.test(navigator.platform) ? 'Option' : 'Alt'), [])
  return alt
}

/** A shortcut chip, Sanity's: each key in its own box ("Ctrl" "Option" "D"). */
export function Keys({keys}: {keys: string[]}) {
  return (
    <span className="keys" aria-hidden="true">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  )
}

/** J65: "Open preview" (menu and Ctrl+Alt+O) opens the studio config's URL for the document in a new tab. */
export function openPreview(url: string) {
  window.open(url, '_blank', 'noopener')
}

/** Copy the document's URL or ID, confirmed with Sanity's toast. */
function useCopyRef(doc: Doc, after: () => void) {
  const scoped = useScopedHref()
  // Runs on a click (browser only): the global translate.
  const put = (text: string, done: string, failed: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast({title: tt(done)}))
      .catch(() => toast({tone: 'critical', title: tt(failed)}))
    after()
  }
  return {
    url: () => put(`${location.origin}${scoped(`/structure/${doc._type};${doc._publishedId}`)}`, 'Document URL copied to clipboard', 'Could not copy document url'),
    id: () => put(doc._id, 'Document ID copied to clipboard', 'Could not copy document id'),
  }
}

/**
 * The document pane header's "…" menu, after Sanity's:
 * History, Incoming references (J17), Inspect, Compare versions and Inline changes
 * (J68), Open preview (J65), Copy document, Paste document (J29). A paste fills every field whose name and schema type match the
 * copied document's and leaves the rest alone, so pasting a post into an author
 * moves only what fits.
 */
// Under 600 px wide Sanity's menu has no History (measured at 599 and 600): there the panel
// covered the whole pane, so a picked revision and its Revert could not be seen.
const PHONE = '(max-width: 599px)'
const onPhoneChange = (f: () => void) => {
  const m = matchMedia(PHONE)
  m.addEventListener('change', f)
  return () => m.removeEventListener('change', f)
}
const usePhone = () => useSyncExternalStore(onPhoneChange, () => matchMedia(PHONE).matches, () => false)

export function DocHeaderMenu({doc, schema, readOnly, onInspect, onHistory, onIncoming, onCompare, inline, onInline}: {doc: Doc; schema: Schema; readOnly: boolean; onInspect: () => void; onHistory: () => void; onIncoming: () => void; onCompare?: () => void; inline: boolean; onInline: () => void}) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const alt = useAltName()
  const phone = usePhone()
  const previewUrl = studio.document?.productionUrl?.(doc)
  // LiveView's paper header: "Open standalone", Barkpark's reader for the paper (its slug is its id).
  const barkpark = useQuery({...barkparkInfoQuery, enabled: PAPER_TYPES.has(doc._type)}).data?.url
  const scope = useQuery({...currentScopeQuery, enabled: PAPER_TYPES.has(doc._type)}).data
  const standalone = PAPER_TYPES.has(doc._type) && barkpark && scope ? `${barkpark}/w/${scope.workspace}/p/${scope.project}/papers/${encodeURIComponent(doc._publishedId)}` : undefined
  return (
    <div className="menu-wrap doc-actions" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" data-doc-actions aria-label={t('Show document actions')} data-tip={t('Show more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover centered onClose={close}>
          {/* J66: Sanity lists "Create new task" first; it opens the Tasks sidebar on this document. */}
          <button type="button" role="menuitem" className="menu-item" autoFocus onClick={() => (close(), showTasks({kind: 'create', target: {id: doc._publishedId, type: doc._type}}))}>
            <span className="menu-icon-text">
              <TaskIcon /> {t('Create new task')}
            </span>
          </button>
          <hr />
          {!phone && (
            <button type="button" role="menuitem" className="menu-item" onClick={() => (close(), onHistory())}>
              <span className="menu-icon-text">
                <RestoreIcon /> {t('History')}
              </span>
            </button>
          )}
          {/* J17 widen: Sanity's "Incoming references", next after History as there. */}
          <button type="button" role="menuitem" className="menu-item" onClick={() => (close(), onIncoming())}>
            <span className="menu-icon-text">
              <SyncIcon /> {t('Incoming references')}
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-item" aria-keyshortcuts="Control+Alt+I" onClick={() => (close(), onInspect())}>
            <span className="menu-icon-text">
              <JsonIcon /> {t('Inspect')}
            </span>
            <Keys keys={['Ctrl', alt, 'I']} />
          </button>
          {/* J68: draft beside published; with one version there is nothing to compare, and the item says so. */}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            aria-disabled={!onCompare || undefined}
            title={onCompare ? undefined : t('There are no other versions of this document to compare.')}
            onClick={() => onCompare && (close(), onCompare())}
          >
            <span className="menu-icon-text">
              <Transfer /> {t('Compare versions')}
            </span>
          </button>
          {/* J68: a toggle, checked while on (Sanity keeps the check's space when off). */}
          <button type="button" role="menuitemcheckbox" className="menu-item" aria-checked={inline} onClick={() => (close(), onInline())}>
            <span className="menu-icon-text">
              <span className="menu-check" data-on={inline || undefined}>
                <Check />
              </span>
              {t('Inline changes')}
            </span>
          </button>
          <hr />
          {standalone && (
            <>
              <button type="button" role="menuitem" className="menu-item" onClick={() => (close(), window.open(standalone, '_blank', 'noopener'))}>
                <span className="menu-icon-text">
                  <LaunchIcon /> {t('Open standalone')}
                </span>
              </button>
              <hr />
            </>
          )}
          {/* J65: the studio config's preview URL, opened in a new tab. */}
          {previewUrl && (
            <>
              <button type="button" role="menuitem" className="menu-item" aria-keyshortcuts="Control+Alt+O" onClick={() => (close(), openPreview(previewUrl))}>
                <span className="menu-icon-text">
                  <EarthAmericas /> {t('Open preview')}
                </span>
                <Keys keys={['Ctrl', alt, 'O']} />
              </button>
              <hr />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              void copy({kind: 'document', docType: schema.name, fields: schema.fields.map((f) => ({name: f.name, sig: signature(f), value: doc[f.name]}))}, {id: doc._publishedId, type: doc._type})
              close()
            }}
          >
            <span className="menu-icon-text">
              <Copy /> {t('Copy document')}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={readOnly}
            onClick={async () => {
              close()
              const clip = await read()
              if (clip?.kind !== 'document') return toast({title: tt('Nothing to paste')})
              const matching = schema.fields.flatMap((f) => {
                const from = clip.fields.find((c) => c.name === f.name)
                const pasted = from && !isEmpty(from.value) ? transfer(from, f, doc[f.name]) : undefined
                return pasted && 'value' in pasted ? [[f.name, pasted.value] as const] : []
              })
              if (!matching.length) return toast({tone: 'critical', title: tt('Invalid clipboard item'), description: tt('Source and target schema types are not compatible')})
              for (const [name, value] of matching) edit(qc, doc, name, value)
            }}
          >
            <span className="menu-icon-text">
              <ClipboardIcon /> {t('Paste document')}
            </span>
          </button>
        </MenuPopover>
      )}
    </div>
  )
}

/**
 * The share button that heads Sanity's document pane (J28): Copy document URL,
 * Copy document ID, each confirmed with Sanity's toast. The URL is this studio's
 * deep link to the document.
 */
export function DocShareMenu({doc}: {doc: Doc}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const copyRef = useCopyRef(doc, close)
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="icon-btn" aria-label={t('Share document')} data-tip={t('Share')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Share />
      </button>
      {open && (
        <MenuPopover className="popover menu share-menu" onClose={close}>
          <button type="button" role="menuitem" className="menu-item" autoFocus onClick={copyRef.url}>
            <span className="menu-icon-text">
              <LinkIcon /> {t('Copy document URL')}
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={copyRef.id}>
            <span className="menu-icon-text">
              <TargetIcon /> {t('Copy document ID')}
            </span>
          </button>
        </MenuPopover>
      )}
    </div>
  )
}
