import {useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {anyDocQuery, docQuery, previewTitle, schemaOf, searchAllDocs, type Doc, type Schema} from '../lib/data'
import {loadCanvas} from '../lib/canvas-bundle'
import {applyBlockOps, readBlocks, type Block, type BlockOp, type Blocks, type OpsResult, type Rev} from '../lib/blocks'
import {paceMs, paced} from '../lib/write-pace'

import {toast} from './Toasts'
import {bodyHistory, isNetworkError, OFFLINE_RETRY_MS, registerBody, setCanvasOffline, setCanvasProblem, unsavedElsewhere} from '../lib/edits'
import {usePersonNamer} from '../lib/person'
import {existingAsset} from '../lib/upload'
import {assetUrl} from '../lib/image'
import {AssetPicker} from './ImageInput'
import {BlockObjectDialog, type BlockObjectRequest} from './BlockObjectDialog'
import {fleetQuery, paintFleet, type FleetBlocks} from '../lib/fleet'
import {useLive} from '../lib/live'
import {reportSelection, usePresences, type CaretSelection} from '../lib/presence'
import {detachMaster, insertMaster, mastersQuery, pinMaster, saveMaster, type Master, type MasterResult} from '../lib/paper-masters'
import {ago, t as translate, useCanvasStrings, useT, useLocale} from '../lib/i18n'
import {meQuery} from '../lib/session'
import {forget, keep, keptKey, putBackOps, readKept, restoreOps, type Kept} from '../lib/kept-words'
import {editedBy} from '../lib/history'
import {useRouter} from '@tanstack/react-router'
import {FindBar, findKey, type FindCanvas} from './FindBar'
import {InlineComments} from './InlineComments'


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
  /** `refusal.reason`: the server's "path: why"; a refused inline-object save reopens its dialog on that field. */
  discardInflightOps(seq: number, refusal?: {reason: string}): boolean
  resendPendingOps(): boolean
  applyServerBlocks(blocks: Block[], echo?: {mode?: 'own' | 'own-stale'; requestId?: string}): void
  applyServerBlocksIfIdle(blocks: Block[]): boolean
  resolveConflictWithServerBlocks(blocks: Block[]): void
  linkPreviewSource: ((t: LinkTarget) => Promise<{title?: string; excerpt?: string; href?: string; subtitle?: string; badge?: string} | null>) | null
  wikilinkSource: ((query: string) => Promise<{title: string; id: string; type: string; doc?: Doc}[]>) | null
  /** Barkpark canvas 1.10.0: one step of its own history (with `bp-canvas-history`). */
  undo?: () => boolean
  redo?: () => boolean
  mediaUploader: ((file: File) => Promise<{src?: string; url?: string; alt?: string}>) | null
  /** J11: the studio's own image dialog for the canvas's Image insert and an image's Select (Barkpark contract 1.4). */
  mediaPicker?: ((request: {kind: 'insert' | 'replace'; current: {src: string; alt: string | null} | null}) => Promise<{src: string; alt?: string} | null>) | null
  /** J11: the studio's own modal for a declared block or inline object (Barkpark contract 1.5). */
  editBlockObject?: ((request: BlockObjectRequest) => Promise<Record<string, unknown> | null>) | null
  hasPendingChanges(): boolean
  focusBlock(id: string): boolean
  /** D11: the other editors' carets (decorations only). */
  setRemoteSelections(list: ({id: string; name: string; color: string} & CaretSelection)[]): void
  /** What the author has now, saved or not (D21). */
  recoverySnapshot?(): {blocks?: Block[]} | null
}

type LinkTarget = {kind: 'link' | 'wikilink'; href: string | null; target: string | null; docId: string | null; alias: string | null}


/**
 * Two block lists say the same thing: block ids and labels aside (a paste mints new
 * ids), keys in any order, and a block's plain `text` the same as one text run.
 */
const sameContent = (a: Block[], b: Block[]) => {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip)
    if (!v || typeof v !== 'object') return v
    const o = {...(v as Record<string, unknown>)}
    if (typeof o.text === 'string' && !('content' in o) && 'type' in o && o.type !== 'text') (o.content = [{type: 'text', value: o.text}]), delete o.text
    return Object.fromEntries(Object.keys(o).filter((k) => k !== 'id' && k !== 'label').sort().map((k) => [k, strip(o[k])]))
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

/** A rev as the card shows it: a paper's number, or a document rev's first characters. */

type Save = {state: 'saved' | 'saving' | 'error' | 'offline' | 'idle'; message?: string}
// D20: who wrote the version that won, and when (the card names them, not revision ids).
type Problem = {message: string; kept?: boolean; conflict?: {mine: Rev; theirs: Rev; blocks: Block[]; who?: string | null; at?: string | null}}

/**
 * `field`: edit that richText field's own block list (J10) instead of the document's;
 * `vocabulary`: the field's declared blocks/styles/marks (the schema's `blocks`), which
 * the canvas offers and enforces, as Barkpark's LiveView stamps it (`data-vocabulary`);
 * `labels`: field name → title, shown on the bound field blocks that carry no label;
 * `openDoc`: where a wikilink goes (D06);
 * `label` / `labelledBy`: the editable area's accessible name (F13);
 * `commentsTitle`: a field canvas takes inline comments on its text, named so.
 */
export function PortableDocEditor({type, id, field, vocabulary, labels, openDoc, label, labelledBy, editable = true, commentsTitle}: {
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
  commentsTitle?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const t = useT()
  const locale = useLocale()
  // The canvas's own words (its chrome: block handle, slash menu, bubble), in the editor's
  // language: Barkpark's map (lib/i18n), read from the nearest data-strings when it mounts.
  const canvasStrings = useCanvasStrings()
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
  // The mounted canvas, for what renders beside it (inline comments).
  const [mounted, setMounted] = useState<Canvas | null>(null)
  // D11, shared carets: everyone else's caret in this document, in their presence color.
  // A caret in another canvas of the same document names blocks this one hasn't, and
  // the canvas drops it.
  const nameOf = usePersonNamer()
  const remote = usePresences()
    .filter((p) => p.documentId === id && p.selection)
    .map((p) => ({id: p.sessionId, name: nameOf(p.name) ?? p.name, color: p.color, ...p.selection!}))
  const remoteRef = useRef(remote)
  remoteRef.current = remote
  const remoteKey = JSON.stringify(remote)
  useEffect(() => canvas.current?.setRemoteSelections(remoteRef.current), [remoteKey])
  const loop = useRef<{rev: Rev; saving: number; requests: number; lastSent: number; merge?: boolean}>({rev: '', saving: 0, requests: 0, lastSent: 0})
  const [save, setSave] = useState<Save>({state: 'idle'})
  const [problem, setProblem] = useState<Problem | null>(null)
  // D22: the server's blocks as this canvas last read them, and the other writer's
  // edit those became (Barkdown's agent-edit row): Undo puts `before` back.
  const base = useRef<{rev: Rev; blocks: Block[]} | null>(null)
  const readBase = () => readBlocks(type, id, field).then((r) => ((base.current = r), r))
  const [otherEdit, setOtherEdit] = useState<{before: Block[]; afterRev: Rev; who: string | null} | null>(null)
  // B11: closing the tab asks first while this canvas holds a batch not yet saved or refused.
  const refused = useRef(false)
  refused.current = !!problem
  // A batch that failed for want of a network: its words are on screen and nothing is
  // pending in the canvas, so, as for a refused one, the server's blocks wait.
  const offline = useRef(false)
  // The document's footer says it too (lib/edits.ts setCanvasProblem).
  useEffect(() => {
    setCanvasProblem(id, field ?? '', problem ? problem.message : null)
    return () => setCanvasProblem(id, field ?? '', null)
  }, [id, field, problem?.message])
  useEffect(() => {
    const check = () => refused.current || offline.current || !!canvas.current?.hasPendingChanges()
    unsavedElsewhere.add(check)
    return () => void unsavedElsewhere.delete(check)
  }, [])
  const [failed, setFailed] = useState<string>()
  const [mountTry, setMountTry] = useState(0)
  // D21: a failed save's words, kept on this computer (lib/kept-words.ts).
  const scope = (useRouter().options.context as {scope?: {current?: unknown}}).scope?.current
  const keyRef = useRef('')
  const editor = useQuery(meQuery).data?.editorKey ?? null
  keyRef.current = keptKey(scope ? JSON.stringify(scope) : '-', editor, type, id, field)
  const [offer, setOffer] = useState<Kept | null>(null)
  // J11: the canvas asks for a picture (its Image insert, an image's Select); the
  // library dialog answers with the picked asset's address, or null when closed.
  const [picking, setPicking] = useState<((picked: {src: string} | null) => void) | null>(null)
  // J11: the canvas asks the studio to edit a declared object (a block or an inline
  // object): our modal with our fields answers, or null when nothing changed.
  const [objectEdit, setObjectEdit] = useState<{request: BlockObjectRequest; done: (value: Record<string, unknown> | null) => void} | null>(null)
  const keepNow = () => {
    const blocks = canvas.current?.recoverySnapshot?.()?.blocks
    return Array.isArray(blocks) && keep(keyRef.current, {at: Date.now(), rev: loop.current.rev, blocks})
  }
  // The failure card's buttons, bound to the save loop below.
  const resolveRef = useRef<{retry: () => void; discard: () => Promise<void>; theirs: (blocks: Block[], rev: Rev) => void; mine: (rev: Rev) => void} | null>(null)
  // D01: a bound field block shows its field's title (the server's projection carries none).
  const decorate = useRef((blocks: Block[]) => blocks)
  decorate.current = (blocks) => (labels ? blocks.map((b) => (typeof b.fieldName === 'string' && !b.label && labels[b.fieldName] ? {...b, label: labels[b.fieldName]} : b)) : blocks)

  useEffect(() => {
    let gone = false
    let caret: CaretSelection | null = null
    let unregisterBody: (() => void) | undefined
    const l = loop.current
    const read = () => readBase().then((r) => (track(r.blocks), {...r, blocks: decorate.current(r.blocks)}))
    // Barkpark's EMBED-CONTRACT "HTTP host" recipe (paper-editor/EMBED-CONTRACT.md @cad5a11f7):
    // one batch in flight; a 412 resends the same batch fenced on the other writer's rev
    // (ops are id-keyed, so both writers' blocks are kept); after a save, read the doc
    // and hand its blocks back as the canvas's own echo BEFORE acknowledging.
    // The conflict card's "who": the history row of the server's version (D22's lookup).
    const whoWrote = (server: Blocks) =>
      server.docRev && void editedBy({data: {type, id, rev: server.docRev}}).then((who) => !gone && setProblem((p) => (p?.conflict?.theirs === server.rev ? {...p, conflict: {...p.conflict, who}} : p)))
    async function applyOps(ops: BlockOp[], seq: number) {
      const el = canvas.current
      if (!el || !ops.length) return
      const requestId = `http-${++l.requests}`
      el.identifyOpsRequest(seq, requestId)
      l.saving++
      setSave({state: 'saving'})
      try {
        // While Barkpark's write budget runs out, a batch waits its turn (lib/write-pace.ts);
        // the canvas gathers what is typed meanwhile into its next one.
        const hold = l.lastSent + paceMs() - Date.now()
        if (hold > 0) await new Promise((done) => setTimeout(done, hold))
        if (gone) return
        l.lastSent = Date.now()
        let r = (await applyBlockOps({data: {type, id, field, ops: ops as never, ifRev: l.rev}})) as unknown as OpsResult
        paced(!!r.throttled || (!r.ok && r.status === 429))
        // Barkpark's write budget ran out (429) on a batch that never landed: it waits its turn
        // and goes again, instead of "Could not save" (five editors on one document,
        // task-86f75846c256e3b4).
        for (let tries = 0; !r.ok && r.status === 429 && tries < 6; tries++) {
          await new Promise((done) => setTimeout(done, Math.max(paceMs(), 500) * (0.5 + Math.random())))
          if (gone) return
          l.lastSent = Date.now()
          r = (await applyBlockOps({data: {type, id, field, ops: ops as never, ifRev: l.rev}})) as unknown as OpsResult
          paced(!!r.throttled || (!r.ok && r.status === 429))
        }
        // Collaboration hour: the other writer changed a block this batch rewrites (both typed
        // in one paragraph). Resending on their rev would silently put ours over theirs, so ask
        // instead (D20), with both versions kept. Separate blocks still resend (D05).
        // Barkpark answers a batch that races the doc's first draft (a field's save making it
        // at the same moment, as both go out after a reconnect) with 422 invalid_op, not 412.
        // Same race, same way: on the server's rev, unless the blocks it names changed.
        const raced = !r.ok && r.code === 'invalid_op'
        if (!r.ok && (r.status === 412 || raced) && base.current) {
          const was = new Map(base.current.blocks.map((b) => [b.id, JSON.stringify(b)]))
          const touched = new Set(ops.flatMap((o) => [o.id, (o.block as Block | undefined)?.id].filter((x): x is string => typeof x === 'string')))
          const server = await readBase().catch(() => null)
          if (gone) return
          if (raced && server) r = {...r, status: 412, actual: server.rev}
          if (server && server.blocks.some((b) => touched.has(b.id) && was.has(b.id) && was.get(b.id) !== JSON.stringify(b))) {
            el.discardInflightOps(seq)
            setSave({state: 'error', message: t('Someone else changed the same block')})
            refused.current = true // now, not at the next render: a read on its way checks it

            setProblem({message: t('Someone else changed the same block'), kept: keepNow(), conflict: {mine: l.rev, theirs: server.rev, blocks: decorate.current(server.blocks), at: server.updatedAt}})
            whoWrote(server)
            return
          }
        }
        for (let tries = 0; !r.ok && r.status === 412 && r.actual !== undefined && r.actual !== null && tries < 3; tries++) {
          l.rev = r.actual
          r = (await applyBlockOps({data: {type, id, field, ops: ops as never, ifRev: l.rev}})) as unknown as OpsResult
        }
        if (gone) return
        // D20: the resends ran out (another writer kept saving): ask, as Barkdown does.
        if (!r.ok && r.status === 412) {
          const mine = l.rev
          const server = await read().catch(() => null)
          if (gone) return
          el.discardInflightOps(seq)
          // The editor's words, not Barkpark's ("document revision mismatch").
          const said = t('Someone else changed this document')
          setSave({state: 'error', message: said})
          if (!server) throw new Error(t('Conflict, and the server copy could not be fetched'))
          refused.current = true

          setProblem({message: said, kept: keepNow(), conflict: {mine, theirs: server.rev, blocks: server.blocks, at: server.updatedAt}})
          whoWrote(server)
          return
        }
        if (!r.ok) throw new Error(r.message)
        l.rev = r.rev
        const echo = await read().catch(() => null) // if it fails, the save still stands: r.rev fences the next
        if (gone) return
        if (echo) {
          l.rev = echo.rev
          // After "Re-apply my edit on top" the server also holds the other writer's
          // blocks: with nothing pending here, take the server's truth.
          if (l.merge && !el.hasPendingChanges()) el.resolveConflictWithServerBlocks(echo.blocks)
          else el.applyServerBlocks(echo.blocks, {mode: 'own', requestId})
          l.merge = false
        }
        el.acknowledgeOps(seq, true)
        setOtherEdit(null) // the author wrote after it: Undo would take their words too
        if (type === 'paper' && !field) void qc.invalidateQueries({queryKey: ['fleet', id]})
        setProblem(null)
        offline.current = false
        setCanvasOffline(id, field ?? '', false)
        if (!el.hasPendingChanges()) (setSave({state: 'saved'}), forget(keyRef.current))
      } catch (e) {
        if (gone) return
        // No network (offline, or a connection that died): not a refusal. The batch stays
        // pending and goes again once the network is back, as a field's edits do
        // (lib/edits.ts waitForNetwork); its words are kept on this computer meanwhile.
        if (isNetworkError(e)) {
          el.discardInflightOps(seq)
          offline.current = true
          keepNow()
          setSave({state: 'offline'})
          setCanvasOffline(id, field ?? '', true)
          waitForNetwork()
          return
        }
        // Refused: the edit stays on screen and goes out with the next batch, and the
        // words are kept on this computer now, so closing the tab loses nothing (D21).
        // Barkpark's vocabulary refusal reads "not allowed in this field: <path>: <why>".
        el.discardInflightOps(seq, {reason: (e as Error).message.replace(/^not allowed in this field: /, '')})
        setSave({state: 'error', message: (e as Error).message})
        refused.current = true

        setProblem({message: (e as Error).message, kept: keepNow()})
      } finally {
        l.saving--
      }
    }
    let offlineRetry: ReturnType<typeof setTimeout> | undefined
    const sendAgain = () => {
      clearTimeout(offlineRetry)
      removeEventListener('online', sendAgain)
      if (gone) return
      if (!canvas.current?.resendPendingOps()) (setSave({state: 'saved'}), (offline.current = false), setCanvasOffline(id, field ?? '', false))
    }
    const waitForNetwork = () => {
      clearTimeout(offlineRetry)
      addEventListener('online', sendAgain)
      offlineRetry = setTimeout(() => (navigator.onLine ? sendAgain() : waitForNetwork()), OFFLINE_RETRY_MS)
    }
    resolveRef.current = {
      // D20, Barkdown's two answers to a conflict.
      theirs: (blocks: Block[], rev: Rev) => {
        canvas.current?.resolveConflictWithServerBlocks(blocks)
        l.rev = rev
        l.merge = false
        setOtherEdit(null)
        setProblem(null)
        forget(keyRef.current)
        setSave({state: 'saved'})
      },
      mine: (rev: Rev) => {
        l.rev = rev
        l.merge = true
        setProblem(null)
        setSave({state: 'saving'})
        if (!canvas.current?.resendPendingOps()) (setSave({state: 'saved'}), (l.merge = false))
      },
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
        forget(keyRef.current)
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
        el.setRemoteSelections(remoteRef.current)
        // D11: our caret goes out with our presence focus (lib/presence.ts).
        el.addEventListener('bp-canvas-selection', (e) => {
          caret = (e as CustomEvent<CaretSelection | null>).detail
          reportSelection(id, caret)
        })
        el.addEventListener('bp-canvas-ops', (e) => {
          const {ops, seq} = (e as CustomEvent<{ops: BlockOp[]; seq: number}>).detail
          void applyOps(ops, seq)
        })
        // F7, as Sanity's: a field's body takes part in the document's undo (Mod+Z from the
        // form walks back into it). Its steps stay the canvas's; the document's undo follows
        // them by the canvas's history report. A canvas without one (before 1.10.0) keeps
        // its undo to itself, as before.
        if (field && typeof el.undo === 'function' && typeof el.redo === 'function') {
          el.addEventListener('bp-canvas-history', (e) => {
            const {kind, count} = (e as CustomEvent<{kind: 'step' | 'undo' | 'redo' | 'clear'; count: number}>).detail
            bodyHistory(id, type, field, kind, count)
          })
          unregisterBody = registerBody(id, field, {undo: () => el.undo!(), redo: () => el.redo!(), focus: () => el.querySelector<HTMLElement>('.ProseMirror')?.focus()})
        }
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
        // The hover card: a wikilink shows its doc as Sanity's preview does: the title, its
        // subtitle in place of the [[target]] markup, and the type (canvas 1.9's `subtitle`,
        // `badge`; an older canvas shows the title and the excerpt).
        el.linkPreviewSource = async ({kind, docId}) => {
          if (kind !== 'wikilink' || !docId) return null
          const doc = await qc.fetchQuery(anyDocQuery(docId))
          if (!doc) return {title: t('Document not found'), excerpt: docId}
          const schema = schemaOf(qc.getQueryData<Schema[]>(['schemas']) ?? [], doc._type)
          const subtitle = doc.preview?.description
          return {title: previewTitle(doc, schema, t), excerpt: subtitle ?? schema?.title, subtitle: subtitle ?? '', badge: schema?.title ?? doc._type}
        }
        // D07: a dropped or pasted picture uploads to Barkpark's media; the block stores the
        // file's Barkpark path. The canvas shows "uploading" and any failure on the block.
        el.mediaUploader = async (file) => {
          const known = await existingAsset(file)
          if (known?.url) return {src: known.url}
          const body = new FormData()
          body.append('file', file)
          const res = await fetch('/api/media/upload', {method: 'POST', body})
          if (!res.ok) throw new Error(t('upload failed ({status})', {status: res.status}))
          const {url} = (await res.json()) as {url?: string}
          if (!url) throw new Error(t('upload failed (no file url)'))
          return {src: url}
        }
        // Sanity's Image opens its asset dialog: so does the canvas's, with ours (Barkpark 1.4+;
        // an older canvas never asks).
        el.mediaPicker = () => new Promise((resolve) => setPicking(() => resolve))
        // Sanity edits a block object in a modal with its inputs: so does ours (1.5+).
        el.editBlockObject = (request) => new Promise((done) => setObjectEdit({request, done}))
        // The `[[` menu: documents of any type.
        el.wikilinkSource = async (query) => {
          const schemas = qc.getQueryData<Schema[]>(['schemas']) ?? []
          return (await searchAllDocs(query)).map((d) => ({title: previewTitle(d, schemaOf(schemas, d._type), t), id: d._publishedId, type: d._type, doc: d}))
        }
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
        l.rev = first.rev
        host.current.replaceChildren(el)
        canvas.current = el
        setMounted(el)
        setSave({state: 'saved'})
        // D21: words a failed save kept the last time, offered back unless the
        // document already says them.
        const kept = readKept(keyRef.current)
        if (kept && putBackOps(first.blocks, kept.blocks).length) setOffer(kept)
        else if (kept) forget(keyRef.current)
      } catch (e) {
        if (gone) return
        setFailed((e as Error).message)
        // Opened offline: read again once the network is back (the body stays as drawn).
        if (isNetworkError(e)) waitToMount()
      }
    })()
    let mountRetry: ReturnType<typeof setTimeout> | undefined
    function mountAgain() {
      clearTimeout(mountRetry)
      removeEventListener('online', mountAgain)
      if (!gone) (setFailed(undefined), setMountTry((n) => n + 1))
    }
    function waitToMount() {
      addEventListener('online', mountAgain)
      mountRetry = setTimeout(() => (navigator.onLine ? mountAgain() : waitToMount()), OFFLINE_RETRY_MS)
    }
    return () => {
      gone = true
      clearTimeout(offlineRetry)
      clearTimeout(mountRetry)
      removeEventListener('online', sendAgain)
      removeEventListener('online', mountAgain)
      setCanvasOffline(id, field ?? '', false)
      if (caret) reportSelection(id, null)
      unregisterBody?.()
      if (field) bodyHistory(id, type, field, 'clear')
      canvas.current?.remove()
      canvas.current = null
      setMounted(null)
    }
  }, [type, id, field, editable, vocabularyKey, mountTry])

  // D16: after a refused batch the author may put the words back by hand (a vetoed
  // cut, then paste): the canvas then has no diff to send, and Barkdown's tab keeps
  // saying "Not saved". Here, once nothing is pending and the canvas says what the
  // server holds, the card goes and the state is Saved.
  useEffect(() => {
    if (!problem || problem.conflict) return
    let busy = false
    const timer = setInterval(async () => {
      const el = canvas.current
      if (busy || !el || loop.current.saving || el.hasPendingChanges()) return
      busy = true
      try {
        const mine = el.recoverySnapshot?.()?.blocks
        const server = await readBase()
        if (mine && sameContent(mine, decorate.current(server.blocks))) {
          loop.current.rev = server.rev
          forget(keyRef.current)
          setProblem(null)
          setSave({state: 'saved'})
        }
      } catch {
      } finally {
        busy = false
      }
    }, 700)
    return () => clearInterval(timer)
  }, [problem, type, id, field])

  // D21: leaving with a refused or unsent batch keeps the words as they are now.
  useEffect(() => {
    const leaving = () => void ((refused.current || offline.current || canvas.current?.hasPendingChanges()) && keepNow())
    addEventListener('pagehide', leaving)
    return () => (removeEventListener('pagehide', leaving), leaving())
  }, [])

  // D21: "Put the words back": one write, fenced on the document's rev, then the
  // canvas shows the result; the text it replaced stays in the document's history.
  const [armed, setArmed] = useState(false)
  const putBack = async () => {
    if (!offer) return
    if (!armed) return setArmed(true)
    const l = loop.current
    let held = false
    try {
      if (l.saving || canvas.current?.hasPendingChanges()) throw new Error(t('Finish saving your edit first.'))
      l.saving++ // our own write's frame is not another writer's edit (D22)
      held = true
      const fresh = await readBase()
      const ops = putBackOps(fresh.blocks, offer.blocks)
      if (ops.length) {
        const r = (await applyBlockOps({data: {type, id, field, ops: ops as never, ifRev: fresh.rev}})) as unknown as OpsResult
        if (!r.ok) throw new Error(r.message)
      }
      const now = await readBase()
      l.rev = now.rev
      setOtherEdit(null)
      canvas.current?.resolveConflictWithServerBlocks(decorate.current(now.blocks))
      forget(keyRef.current)
      setOffer(null)
      setArmed(false)
      toast({tone: 'positive', title: t('The kept words are back in the document.'), description: t('The text they replaced is in its history.')})
    } catch (e) {
      setArmed(false)
      toast({tone: 'critical', title: t('Could not put the words back'), description: (e as Error).message})
    } finally {
      if (held) l.saving--
    }
  }

  // Someone else saved (the live stream refreshed the doc): take their blocks, now or
  // when the author leaves the block they are in. Saving, the next save's rev decides.
  // Known canvas bug: after it takes a changed block, the next keystroke can replace
  // the first block (task-f24549dea0618da2).
  const {data: doc} = useQuery(docQuery(type, id))
  const seenRev = doc?._rev
  useEffect(() => {
    const l = loop.current
    const el = canvas.current
    // A refused batch (or one waiting for the network) leaves the author's words on screen
    // with nothing pending in the canvas (discardInflightOps): taking the server's blocks now would type over them, and
    // the D16 check would then call it Saved. They wait for Retry or the conflict card.
    if (!el || !seenRev || seenRev === l.rev || l.saving || refused.current || offline.current || el.hasPendingChanges()) return
    let gone = false
    const before = base.current
    void readBlocks(type, id, field).then((fresh) => {
      track(fresh.blocks)
      if (gone || fresh.rev === l.rev || l.saving || refused.current || offline.current) return
      // D22: from the blocks this canvas held, so Undo can put them back.
      if (before?.rev === l.rev) {
        setOtherEdit({before: before.blocks, afterRev: fresh.rev, who: null})
        if (fresh.docRev) void editedBy({data: {type, id, rev: fresh.docRev}}).then((who) => !gone && setOtherEdit((e) => (e?.afterRev === fresh.rev ? {...e, who} : e)))
      } else setOtherEdit(null)
      // Idle: taken now. Focused (the author is in a field block, say): the canvas defers
      // it until they leave (EMBED-CONTRACT applyServerBlocks) instead of dropping it (D05).
      if (el.applyServerBlocksIfIdle(decorate.current(fresh.blocks))) {
        base.current = fresh
        l.rev = fresh.rev
      } else {
        // Deferred (the author is in a block): the canvas still holds the old blocks, so the
        // base and rev stay theirs: a batch made meanwhile 412s and is checked for a clash in
        // the same block (applyOps) instead of silently landing over the other writer's words.
        el.applyServerBlocks(decorate.current(fresh.blocks))
      }
    })
    return () => {
      gone = true
    }
  }, [seenRev, type, id, field])

  // D19: find and replace, from inside the editor (Barkdown: inside the paper pane).
  const [finding, setFinding] = useState<{focus: 'find' | 'replace'; at: number} | null>(null)
  const findCanvas = () => canvas.current as unknown as FindCanvas | null
  const closeFind = () => {
    findCanvas()?.findClear()
    setFinding(null)
    host.current?.querySelector<HTMLElement>('.ProseMirror')?.focus()
  }
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const want = findKey(e)
    if (want && canvas.current) {
      e.preventDefault()
      e.stopPropagation()
      setFinding({focus: want, at: Date.now()})
    } else if (e.key === 'Escape' && finding && host.current?.contains(e.target as Node)) {
      e.preventDefault()
      e.stopPropagation()
      closeFind()
    }
  }

  // D22: Undo the other writer's edit in one click, fenced on the rev it made: if
  // anyone wrote since, nothing is changed and it says so (Barkdown's undoAgentEdit).
  const [undoing, setUndoing] = useState(false)
  const undoOther = async () => {
    if (!otherEdit) return
    const l = loop.current
    setUndoing(true)
    let held = false
    try {
      if (l.saving || canvas.current?.hasPendingChanges()) throw new Error(t('Finish saving your edit before Undo.'))
      l.saving++ // our own write's frame is not another writer's edit
      held = true
      const fresh = await readBase()
      if (fresh.rev !== otherEdit.afterRev) throw new Error(t('The document changed again. Undo was not applied.'))
      const ops = restoreOps(fresh.blocks, otherEdit.before)
      if (ops.length) {
        const r = (await applyBlockOps({data: {type, id, field, ops: ops as never, ifRev: fresh.rev}})) as unknown as OpsResult
        if (!r.ok) throw new Error(r.status === 412 ? t('The document changed again. Undo was not applied.') : r.message)
      }
      const now = await readBase()
      l.rev = now.rev
      canvas.current?.resolveConflictWithServerBlocks(decorate.current(now.blocks))
      setOtherEdit(null)
    } catch (e) {
      toast({tone: 'critical', title: t('Could not undo the edit'), description: (e as Error).message})
    } finally {
      if (held) l.saving--
      setUndoing(false)
    }
  }

  return (
    <div className="pd-editor" onKeyDownCapture={onKeyDownCapture}>
      {finding && <FindBar canvas={findCanvas} opened={finding} onClose={closeFind} editable={editable} />}
      {picking && (
        <AssetPicker
          title={t('Image')}
          path={field ?? 'body'}
          openRef={(docType, docId) => ({href: `/structure/${docType};${docId}`, selected: false, active: false})}
          onPick={(ref) => {
            const done = picking
            setPicking(null)
            // The asset's own address, as an upload answers it; the studio path if Barkpark has none.
            void fetch(`${assetUrl(ref)}/info`)
              .then((r) => (r.ok ? (r.json() as Promise<{url?: string}>) : null))
              .catch(() => null)
              .then((info) => done({src: info?.url || assetUrl(ref)}))
          }}
          onClose={() => {
            const done = picking
            setPicking(null)
            done(null)
          }}
        />
      )}
      {objectEdit && (
        <BlockObjectDialog
          key={JSON.stringify(objectEdit.request)}
          request={objectEdit.request}
          path={`${field ?? 'body'}.${objectEdit.request.type}`}
          openRef={(docType, docId) => ({href: `/structure/${docType};${docId}`, selected: false, active: false})}
          onDone={(value) => {
            const {done} = objectEdit
            setObjectEdit(null)
            done(value)
          }}
        />
      )}
      <div className="pd-status" role="status">
        {save.state === 'saving' ? t('Saving…') : save.state === 'saved' ? t('Saved') : save.state === 'offline' ? t('Offline — not saving. Your edits are kept here.') : save.state === 'error' ? (problem?.conflict ? t('Conflict') : t('Not saved')) : ''}
      </div>
      {otherEdit && !problem && (
        <div className="pd-other-edit" role="status" data-other-edit>
          <span>{otherEdit.who ? t('Edited by {who}', {who: otherEdit.who}) : t('Edited elsewhere')}</span>
          <button type="button" className="btn-text" disabled={undoing} onClick={() => void undoOther()}>
            {t('Undo')}
          </button>
        </div>
      )}
      {problem?.conflict && (
        <div className="pd-conflict" role="alert" data-conflict>
          <strong>{problem.conflict.who ? t('{who} changed this document', {who: problem.conflict.who}) : t('Someone else changed this document')}</strong>
          {problem.conflict.at && <> {ago(problem.conflict.at, locale)}.</>} {t('Your unsaved edits are still on screen.')}
          {problem.kept && <> {t('Your words are kept on this computer.')}</>}
          <div>
            <button type="button" className="btn-text" onClick={() => resolveRef.current?.theirs(problem.conflict!.blocks, problem.conflict!.theirs)}>
              {t('Load the server version')}
            </button>
            <button type="button" className="btn-text" onClick={() => resolveRef.current?.mine(problem.conflict!.theirs)}>
              {t('Re-apply my edit on top')}
            </button>
          </div>
        </div>
      )}
      {problem && !problem.conflict && (
        <div className="pd-conflict" role="alert">
          <strong>{t('Could not save:')}</strong> {problem.message}. {t('Your edit is still on screen.')}
          {problem.kept && <> {t('Your words are kept on this computer.')}</>}
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
      {offer && !problem && (
        <div className="pd-conflict" role="alert" data-kept-words>
          <strong>{t('Words were not saved:')}</strong> {t('the last time this document was open, a save did not reach Barkpark. What you had written is kept on this computer from {date}.', {date: new Date(offer.at).toLocaleString(locale)})}
          <div>
            <button type="button" className="btn-text" onClick={() => void putBack()}>
              {armed ? t('Confirm: replace this text with the kept words') : t('Put the words back')}
            </button>
            <button type="button" className="btn-text" onClick={() => (forget(keyRef.current), setOffer(null), setArmed(false))}>
              {t('Dismiss')}
            </button>
          </div>
        </div>
      )}
      {field && commentsTitle && <InlineComments canvas={mounted} field={field} title={commentsTitle} />}
      {failed && <p role="alert">{t('The editor could not load: {reason}', {reason: failed})}</p>}
      {mastersOn ? (
        // The canvas finds its masters on this carrier inside a `.bp-paper-editor`, as
        // Barkpark's LiveView renders it (paper_editor.ex).
        <div className="bp-paper-editor pd-masters">
          <div hidden data-paper-masters={JSON.stringify((masters ?? []).map((m) => ({id: m.docId, title: m.title, tier: m.tier, block_type: m.blockType})))} />
          <div className="pd-canvas" ref={host} data-strings={canvasStrings} />
          {linked.length > 0 && <LinkedMasters slug={id} linked={linked} masters={masters ?? []} actions={masterActions} />}
        </div>
      ) : (
        <div className="pd-canvas" ref={host} data-strings={canvasStrings} />
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
            {/* The state in a few words; the buttons' tooltips say what each does. */}
            {l.pinned ? t('Pinned · readers see this version') : t('Linked · follows the master')}
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
