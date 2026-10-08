import {useEffect, useRef, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {anyDocQuery, docQuery, previewTitle, schemaOf, searchAllDocs, type Schema} from '../lib/data'
import {applyBlockOps, canvasOrigin, readBlocks, type Block, type BlockOp, type OpsResult, type Rev} from '../lib/blocks'
import {toast} from './Toasts'
import {unsavedElsewhere} from '../lib/edits'
import {fleetQuery, paintFleet, type FleetBlocks} from '../lib/fleet'
import {useLive} from '../lib/live'
import {detachMaster, insertMaster, mastersQuery, pinMaster, saveMaster, type Master, type MasterResult} from '../lib/paper-masters'
import {t as translate, useT} from '../lib/i18n'

// Freeform (decision 0004): Barkpark's own <bp-paper-canvas>, hosted by its
// EMBED-CONTRACT "HTTP host" recipe (paper-editor/EMBED-CONTRACT.md @cad5a11f7).
// Blocks in; `bp-canvas-ops` batches out, each saved fenced on the doc's rev; the saved
// doc goes back in as the canvas's own echo, then the batch is acknowledged. A refused
// batch keeps the edit on screen with Retry / Discard.

/** The element's host-facing surface (barkpark api/assets/paper-editor/src/canvas/index.js). */
type Canvas = HTMLElement & {
  blocks: Block[]
  acknowledgedSaves: boolean
  acknowledgeOps(seq: number, saved: boolean): boolean
  identifyOpsRequest(seq: number, requestId: string, previousRequestId?: string | null): boolean
  discardInflightOps(seq: number): boolean
  resendPendingOps(): boolean
  applyServerBlocks(blocks: Block[], echo?: {mode?: 'own' | 'own-stale'; requestId?: string}): void
  applyServerBlocksIfIdle(blocks: Block[]): boolean
  resolveConflictWithServerBlocks(blocks: Block[]): void
  linkPreviewSource: ((t: LinkTarget) => Promise<{title?: string; excerpt?: string; href?: string} | null>) | null
  wikilinkSource: ((query: string) => Promise<{title: string; id: string; type: string}[]>) | null
  mediaUploader: ((file: File) => Promise<{src?: string; url?: string; alt?: string}>) | null
  hasPendingChanges(): boolean
  focusBlock(id: string): boolean
}

type LinkTarget = {kind: 'link' | 'wikilink'; href: string | null; target: string | null; docId: string | null; alias: string | null}

let bundle: Promise<void> | null = null
/** Load the canvas once per page: script + both stylesheets, from the connected Barkpark. */
function loadCanvas(): Promise<void> {
  bundle ??= (async () => {
    const origin = await canvasOrigin()
    // Its own CSS inject is origin-relative (wrong origin here): link them ourselves.
    ;(window as {BP_PAPER_EDITOR_NO_INJECT?: boolean}).BP_PAPER_EDITOR_NO_INJECT = true
    for (const css of ['bp-paper-editor.css', 'bp-paper-editor-shell.css']) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `${origin}/assets/${css}`
      document.head.appendChild(link)
    }
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `${origin}/assets/bp-paper-editor.bundle.js`
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(translate('could not load the editor from {origin}', {origin})))
      document.head.appendChild(script)
    })
    await customElements.whenDefined('bp-paper-canvas')
  })().catch((e) => {
    bundle = null
    throw e
  })
  return bundle
}

type Save = {state: 'saved' | 'saving' | 'error' | 'idle'; message?: string}
type Problem = {message: string}

/**
 * `field`: edit that richText field's own block list (J10) instead of the document's;
 * `vocabulary`: the field's declared blocks/styles/marks (the schema's `blocks`), which
 * the canvas offers and enforces, as Barkpark's LiveView stamps it (`data-vocabulary`);
 * `labels`: field name → title, shown on the bound field blocks that carry no label;
 * `openDoc`: where a wikilink goes (D06);
 * `label` / `labelledBy`: the editable area's accessible name (F13).
 */
export function PortableDocEditor({type, id, field, vocabulary, labels, openDoc, label, labelledBy, editable = true}: {
  type: string
  id: string
  field?: string
  vocabulary?: unknown
  labels?: Record<string, string>
  /** D06: open a linked doc (a wikilink) in the next pane. */
  openDoc?: (id: string, type: string) => void
  label?: string
  labelledBy?: string
  editable?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const t = useT()
  // D14: a paper's task blocks show Barkpark's live previews (lib/fleet.ts).
  const fleetOn = type === 'paper' && !field
  const {data: fleet} = useQuery({...fleetQuery(id), enabled: fleetOn})
  useLive([], fleetOn && fleet && Object.keys(fleet).length ? ['task'] : [])
  const fleetRef = useRef<FleetBlocks | undefined>(undefined)
  fleetRef.current = fleet
  const emptyText = t('Nothing to show yet.')
  useEffect(() => {
    const root = host.current
    if (!fleetOn || !root) return
    // The canvas draws (and redraws) the holes; paint whatever is there, once a frame.
    let frame = 0
    const paint = () => {
      frame = 0
      if (fleetRef.current) paintFleet(root, fleetRef.current, emptyText)
    }
    const watch = new MutationObserver(() => void (frame ||= requestAnimationFrame(paint)))
    watch.observe(root, {childList: true, subtree: true})
    paint()
    return () => (watch.disconnect(), cancelAnimationFrame(frame))
  }, [fleetOn, fleet, emptyText])
  // D13: a Bulldocs paper's own canvas offers its masters (never a field canvas).
  const mastersOn = type === 'paper' && !field && editable
  const {data: masters} = useQuery({...mastersQuery(id), enabled: mastersOn})
  // Linked master blocks (`master-ref`): the canvas shows a chip; their note and
  // Pin / Unpin / Detach are ours, as LiveView draws them outside its canvas.
  const [linked, setLinked] = useState<LinkedRef[]>([])
  const track = (blocks: Block[]) => mastersOn && setLinked(blocks.filter((b) => b.type === 'master-ref').map((b) => ({id: b.id, master: String(b.master ?? ''), pinned: b.version != null})))
  const masterActions = useRef<{refresh: () => Promise<void>; idle: () => Promise<void>} | null>(null)
  const qc = useQueryClient()
  const openDocRef = useRef(openDoc)
  openDocRef.current = openDoc
  const vocabularyKey = vocabulary ? JSON.stringify(vocabulary) : ''
  const canvas = useRef<Canvas | null>(null)
  const loop = useRef<{rev: Rev; saving: number; requests: number}>({rev: '', saving: 0, requests: 0})
  const [save, setSave] = useState<Save>({state: 'idle'})
  const [problem, setProblem] = useState<Problem | null>(null)
  // B11: closing the tab asks first while this canvas holds a batch not yet saved or refused.
  const refused = useRef(false)
  refused.current = !!problem
  useEffect(() => {
    const check = () => refused.current || !!canvas.current?.hasPendingChanges()
    unsavedElsewhere.add(check)
    return () => void unsavedElsewhere.delete(check)
  }, [])
  const [failed, setFailed] = useState<string>()
  // The failure card's buttons, bound to the save loop below.
  const resolveRef = useRef<{retry: () => void; discard: () => Promise<void>} | null>(null)
  // D01: a bound field block shows its field's title (the server's projection carries none).
  const decorate = useRef((blocks: Block[]) => blocks)
  decorate.current = (blocks) => (labels ? blocks.map((b) => (typeof b.fieldName === 'string' && !b.label && labels[b.fieldName] ? {...b, label: labels[b.fieldName]} : b)) : blocks)

  useEffect(() => {
    let gone = false
    const l = loop.current
    const read = () => readBlocks(type, id, field).then((r) => (track(r.blocks), {...r, blocks: decorate.current(r.blocks)}))
    // Barkpark's EMBED-CONTRACT "HTTP host" recipe (paper-editor/EMBED-CONTRACT.md @cad5a11f7):
    // one batch in flight; a 412 resends the same batch fenced on the other writer's rev
    // (ops are id-keyed, so both writers' blocks are kept); after a save, read the doc
    // and hand its blocks back as the canvas's own echo BEFORE acknowledging.
    async function applyOps(ops: BlockOp[], seq: number) {
      const el = canvas.current
      if (!el || !ops.length) return
      const requestId = `http-${++l.requests}`
      el.identifyOpsRequest(seq, requestId)
      l.saving++
      setSave({state: 'saving'})
      try {
        let r = (await applyBlockOps({data: {type, id, field, ops: ops as never, ifRev: l.rev}})) as unknown as OpsResult
        for (let tries = 0; !r.ok && r.status === 412 && r.actual !== undefined && r.actual !== null && tries < 3; tries++) {
          l.rev = r.actual
          r = (await applyBlockOps({data: {type, id, field, ops: ops as never, ifRev: l.rev}})) as unknown as OpsResult
        }
        if (gone) return
        if (!r.ok) throw new Error(r.message)
        l.rev = r.rev
        const echo = await read().catch(() => null) // if it fails, the save still stands: r.rev fences the next
        if (gone) return
        if (echo) {
          l.rev = echo.rev
          el.applyServerBlocks(echo.blocks, {mode: 'own', requestId})
        }
        el.acknowledgeOps(seq, true)
        if (type === 'paper' && !field) void qc.invalidateQueries({queryKey: ['fleet', id]})
        setProblem(null)
        if (!el.hasPendingChanges()) setSave({state: 'saved'})
      } catch (e) {
        if (gone) return
        // Refused: the edit stays on screen and goes out with the next batch.
        el.discardInflightOps(seq)
        setSave({state: 'error', message: (e as Error).message})
        setProblem({message: (e as Error).message})
      } finally {
        l.saving--
      }
    }
    resolveRef.current = {
      retry: () => {
        setProblem(null)
        setSave({state: 'saving'})
        if (!canvas.current?.resendPendingOps()) setSave({state: 'saved'})
      },
      discard: async () => {
        const fresh = await read()
        if (gone) return
        canvas.current?.resolveConflictWithServerBlocks(fresh.blocks)
        l.rev = fresh.rev
        setProblem(null)
        setSave({state: 'saved'})
      },
    }

    void (async () => {
      try {
        // Seeded from the server's read and nothing else: a projected doc's block ids
        // (synth-f-title-0, …) are the only ones its ops may name.
        const [first] = await Promise.all([read(), loadCanvas()])
        if (gone || !host.current) return
        const el = document.createElement('bp-paper-canvas') as Canvas
        el.acknowledgedSaves = true
        el.blocks = first.blocks
        el.setAttribute('editable', String(editable))
        if (vocabulary) el.setAttribute('data-vocabulary', JSON.stringify(vocabulary))
        el.addEventListener('bp-canvas-ops', (e) => {
          const {ops, seq} = (e as CustomEvent<{ops: BlockOp[]; seq: number}>).detail
          void applyOps(ops, seq)
        })
        // A block the canvas could not draw says so (never a silent gap: F8).
        el.addEventListener('bp-canvas-node-failed', (e) => {
          const d = (e as CustomEvent<{type?: string; message?: string; error?: string}>).detail ?? {}
          console.error('[canvas] node failed', d)
          toast({tone: 'critical', title: t('A {type} could not be shown', {type: d.type ?? t('block')}), description: d.message ?? d.error})
        })
        // D13: paper masters. The canvas asks, we write, then hand it the blocks back.
        if (mastersOn) {
          // A write here is outside the save loop (no rev fence): it waits for the loop
          // to settle, and the loop's next batch picks up the new rev from the read.
          const idle = async () => {
            for (let i = 0; i < 50 && (l.saving || canvas.current?.hasPendingChanges()); i++) await new Promise((r) => setTimeout(r, 100))
          }
          const refresh = async () => {
            const fresh = await read()
            if (gone) return
            l.rev = fresh.rev
            if (!el.applyServerBlocksIfIdle(fresh.blocks)) el.applyServerBlocks(fresh.blocks)
          }
          masterActions.current = {refresh, idle}
          const refused = (r: MasterResult, title: string) => !r.ok && (toast({tone: 'critical', title, description: r.message}), true)
          el.addEventListener('bp-save-master', (e) => {
            const {block_id} = (e as CustomEvent<{block_id: string}>).detail
            void (async () => {
              await idle()
              const r = (await saveMaster({data: {slug: id, blockId: block_id}})) as MasterResult
              if (gone || refused(r, t('Could not save the block as a master'))) return
              void qc.invalidateQueries({queryKey: ['paper-masters', id]})
              toast({tone: 'positive', title: t('Saved as master'), description: r.ok ? r.master?.title : undefined})
            })()
          })
          el.addEventListener('bp-master-insert', (e) => {
            const {master_id, after_id, mode} = (e as CustomEvent<{master_id: string; after_id: string | null; mode?: 'linked'}>).detail
            void (async () => {
              await idle()
              setSave({state: 'saving'})
              const r = (await insertMaster({data: {slug: id, masterId: master_id, afterId: after_id, mode: mode ?? 'detached', requestId: crypto.randomUUID()}})) as MasterResult
              if (gone) return
              if (refused(r, t('Could not insert the master'))) return setSave({state: 'saved'})
              await refresh()
              if (!gone) setSave({state: 'saved'})
            })()
          })
        }
        // D06: a wikilink opens its doc in the next pane; a plain link a new tab.
        el.addEventListener('bp-canvas-open-link', (e) => {
          const {kind, docId} = (e as CustomEvent<LinkTarget>).detail
          if (kind !== 'wikilink') return // the canvas opens it in a new window itself
          e.preventDefault()
          if (docId && openDocRef.current)
            void qc.fetchQuery(anyDocQuery(docId)).then((doc) =>
              doc ? openDocRef.current?.(docId, doc._type) : toast({tone: 'critical', title: t('This link points to a document that does not exist'), description: docId}),
            )
        })
        // The hover card: a wikilink shows its doc's title and excerpt.
        el.linkPreviewSource = async ({kind, docId}) => {
          if (kind !== 'wikilink' || !docId) return null
          const doc = await qc.fetchQuery(anyDocQuery(docId))
          if (!doc) return {title: t('Document not found'), excerpt: docId}
          const schema = schemaOf(qc.getQueryData<Schema[]>(['schemas']) ?? [], doc._type)
          return {title: previewTitle(doc, schema), excerpt: doc.preview?.description ?? schema?.title}
        }
        // D07: a dropped or pasted picture uploads to Barkpark's media; the block stores the
        // file's Barkpark path. The canvas shows "uploading" and any failure on the block.
        el.mediaUploader = async (file) => {
          const body = new FormData()
          body.append('file', file)
          const res = await fetch('/api/media/upload', {method: 'POST', body})
          if (!res.ok) throw new Error(t('upload failed ({status})', {status: res.status}))
          const {url} = (await res.json()) as {url?: string}
          if (!url) throw new Error(t('upload failed (no file url)'))
          return {src: url}
        }
        // The `[[` menu: documents of any type.
        el.wikilinkSource = async (query) => {
          const schemas = qc.getQueryData<Schema[]>(['schemas']) ?? []
          return (await searchAllDocs(query)).map((d) => ({title: previewTitle(d, schemaOf(schemas, d._type)), id: d._publishedId, type: d._type}))
        }
        // A fresh canvas starts with a node selection on its first block. When that is a
        // bound field and a click into text doesn't reach the editor's state, the next
        // keystroke replaces the field (canvas bug task-f24549dea0618da2). Until it is
        // fixed there, park the caret in the last text block instead, without keeping focus.
        // The canvas's ProseMirror area carries no name of its own (axe aria-input-field-name).
        el.addEventListener(
          'bp-ready',
          () => {
            const pm = el.querySelector('.ProseMirror')
            if (labelledBy) pm?.setAttribute('aria-labelledby', labelledBy)
            else pm?.setAttribute('aria-label', label ?? t('Document body'))
          },
          {once: true},
        )
        el.addEventListener(
          'bp-ready',
          () => {
            const text = [...first.blocks].reverse().find((b) => b.type === 'paragraph' || b.type === 'heading')
            if (!text || !first.blocks[0]?.type.startsWith('field-')) return
            const had = document.activeElement
            if (!el.focusBlock(text.id) || document.activeElement === had) return
            // Focus elsewhere (another field, a sidebar) gets it back; nothing focused stays so.
            if (had instanceof HTMLElement && had !== document.body) had.focus({preventScroll: true})
            else (document.activeElement as HTMLElement | null)?.blur()
          },
          {once: true},
        )
        l.rev = first.rev
        host.current.replaceChildren(el)
        canvas.current = el
        setSave({state: 'saved'})
      } catch (e) {
        if (!gone) setFailed((e as Error).message)
      }
    })()
    return () => {
      gone = true
      canvas.current?.remove()
      canvas.current = null
    }
  }, [type, id, field, editable, vocabularyKey])

  // Someone else saved (the live stream refreshed the doc): take their blocks, now or
  // when the author leaves the block they are in. Saving, the next save's rev decides.
  // Known canvas bug: after it takes a changed block, the next keystroke can replace
  // the first block (task-f24549dea0618da2).
  const {data: doc} = useQuery(docQuery(type, id))
  const seenRev = doc?._rev
  useEffect(() => {
    const l = loop.current
    const el = canvas.current
    if (!el || !seenRev || seenRev === l.rev || l.saving || el.hasPendingChanges()) return
    let gone = false
    void readBlocks(type, id, field).then((fresh) => {
      track(fresh.blocks)
      if (gone || fresh.rev === l.rev || l.saving) return
      // Idle: taken now. Focused (the author is in a field block, say): the canvas defers
      // it until they leave (EMBED-CONTRACT applyServerBlocks) instead of dropping it (D05).
      if (!el.applyServerBlocksIfIdle(decorate.current(fresh.blocks))) el.applyServerBlocks(decorate.current(fresh.blocks))
      l.rev = fresh.rev
    })
    return () => {
      gone = true
    }
  }, [seenRev, type, id, field])

  return (
    <div className="pd-editor">
      <div className="pd-status" role="status">
        {save.state === 'saving' ? t('Saving…') : save.state === 'saved' ? t('Saved') : save.state === 'error' ? t('Not saved') : ''}
      </div>
      {problem && (
        <div className="pd-conflict" role="alert">
          <strong>{t('Could not save:')}</strong> {problem.message}. {t('Your edit is still on screen.')}
          <div>
            <button type="button" className="btn-text" onClick={() => resolveRef.current?.retry()}>
              {t('Retry')}
            </button>
            <button type="button" className="btn-text" onClick={() => void resolveRef.current?.discard()}>
              {t('Discard unsaved edits')}
            </button>
          </div>
        </div>
      )}
      {failed && <p role="alert">{t('The editor could not load: {reason}', {reason: failed})}</p>}
      {mastersOn ? (
        // The canvas finds its masters on this carrier inside a `.bp-paper-editor`, as
        // Barkpark's LiveView renders it (paper_editor.ex).
        <div className="bp-paper-editor pd-masters">
          <div hidden data-paper-masters={JSON.stringify((masters ?? []).map((m) => ({id: m.docId, title: m.title, tier: m.tier, block_type: m.blockType})))} />
          <div className="pd-canvas" ref={host} />
          {linked.length > 0 && <LinkedMasters slug={id} linked={linked} masters={masters ?? []} actions={masterActions} />}
        </div>
      ) : (
        <div className="pd-canvas" ref={host} />
      )}
    </div>
  )
}

type LinkedRef = {id: string; master: string; pinned: boolean}

/**
 * D13: the paper's linked master blocks, each with Barkpark's note and its Pin / Unpin
 * and Detach (LiveView's paper_editor.ex wording). An action writes, then the canvas
 * takes the paper's blocks again.
 */
function LinkedMasters({slug, linked, masters, actions}: {slug: string; linked: LinkedRef[]; masters: Master[]; actions: {current: {refresh: () => Promise<void>; idle: () => Promise<void>} | null}}) {
  const t = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (blockId: string, write: () => Promise<unknown>) => {
    setBusy(blockId)
    try {
      await actions.current?.idle()
      const r = (await write()) as MasterResult
      if (!r.ok) return void toast({tone: 'critical', title: t('Could not change the linked master'), description: r.message})
      await actions.current?.refresh()
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="pd-linked-masters" role="list" aria-label={t('Linked masters')}>
      {linked.map((l) => (
        <div role="listitem" key={l.id} className="pd-linked" data-testid="linked-master">
          <span className="pd-linked-title">{masters.find((m) => m.docId === l.master)?.title ?? l.master}</span>
          <span className="pd-linked-note">
            {l.pinned
              ? t('Pinned to a published version of the master — readers see exactly this. Unpin to follow the master, or Detach to edit it here.')
              : t('Linked master — it shows the master\'s content. Edit the master, or Detach to edit it here.')}
          </span>
          <button
            type="button"
            className="btn"
            disabled={busy === l.id}
            title={l.pinned ? t("Unpin: follow the master's latest") : t("Pin to the master's published version")}
            onClick={() => void run(l.id, () => pinMaster({data: {slug, blockId: l.id, pin: !l.pinned, requestId: crypto.randomUUID()}}))}
          >
            {l.pinned ? t('Unpin') : t('Pin')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy === l.id}
            title={t('Detach: copy the published version readers see in as plain blocks')}
            onClick={() => void run(l.id, () => detachMaster({data: {slug, blockId: l.id, requestId: crypto.randomUUID()}}))}
          >
            {t('Detach')}
          </button>
        </div>
      ))}
    </div>
  )
}
