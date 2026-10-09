import {useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {anyDocQuery, docQuery, previewTitle, schemaOf, searchAllDocs, type Schema} from '../lib/data'
import {applyBlockOps, canvasOrigin, readBlocks, type Block, type BlockOp, type OpsResult, type Rev} from '../lib/blocks'
import {toast} from './Toasts'
import {unsavedElsewhere} from '../lib/edits'
import {fleetQuery, paintFleet, type FleetBlocks} from '../lib/fleet'
import {useLive} from '../lib/live'
import {detachMaster, insertMaster, mastersQuery, pinMaster, saveMaster, type Master, type MasterResult} from '../lib/paper-masters'
import {t as translate, useCanvasStrings, useT, useLocale} from '../lib/i18n'
import {forget, keep, keptKey, putBackOps, readKept, restoreOps, type Kept} from '../lib/kept-words'
import {editedBy} from '../lib/history'
import {useRouter} from '@tanstack/react-router'
import {FindBar, findKey, type FindCanvas} from './FindBar'

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
  /** What the author has now, saved or not (D21). */
  recoverySnapshot?(): {blocks?: Block[]} | null
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
const shortRev = (rev: Rev) => (typeof rev === 'number' ? String(rev) : String(rev).slice(0, 7))

type Save = {state: 'saved' | 'saving' | 'error' | 'idle'; message?: string}
type Problem = {message: string; kept?: boolean; conflict?: {mine: Rev; theirs: Rev; blocks: Block[]}}

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
  const loop = useRef<{rev: Rev; saving: number; requests: number; merge?: boolean}>({rev: '', saving: 0, requests: 0})
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
  useEffect(() => {
    const check = () => refused.current || !!canvas.current?.hasPendingChanges()
    unsavedElsewhere.add(check)
    return () => void unsavedElsewhere.delete(check)
  }, [])
  const [failed, setFailed] = useState<string>()
  // D21: a failed save's words, kept on this computer (lib/kept-words.ts).
  const scope = (useRouter().options.context as {scope?: {current?: unknown}}).scope?.current
  const keyRef = useRef('')
  keyRef.current = keptKey(scope ? JSON.stringify(scope) : '-', type, id, field)
  const [offer, setOffer] = useState<Kept | null>(null)
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
    const l = loop.current
    const read = () => readBase().then((r) => (track(r.blocks), {...r, blocks: decorate.current(r.blocks)}))
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
        // D20: the resends ran out (another writer kept saving): ask, as Barkdown does.
        if (!r.ok && r.status === 412) {
          const mine = l.rev
          const server = await read().catch(() => null)
          if (gone) return
          el.discardInflightOps(seq)
          setSave({state: 'error', message: r.message})
          if (!server) throw new Error(t('Conflict, and the server copy could not be fetched'))
          setProblem({message: r.message, kept: keepNow(), conflict: {mine, theirs: server.rev, blocks: server.blocks}})
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
        if (!el.hasPendingChanges()) (setSave({state: 'saved'}), forget(keyRef.current))
      } catch (e) {
        if (gone) return
        // Refused: the edit stays on screen and goes out with the next batch, and the
        // words are kept on this computer now, so closing the tab loses nothing (D21).
        el.discardInflightOps(seq)
        setSave({state: 'error', message: (e as Error).message})
        setProblem({message: (e as Error).message, kept: keepNow()})
      } finally {
        l.saving--
      }
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
          return {title: previewTitle(doc, schema, t), excerpt: doc.preview?.description ?? schema?.title}
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
          return (await searchAllDocs(query)).map((d) => ({title: previewTitle(d, schemaOf(schemas, d._type), t), id: d._publishedId, type: d._type}))
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
        // D21: words a failed save kept the last time, offered back unless the
        // document already says them.
        const kept = readKept(keyRef.current)
        if (kept && putBackOps(first.blocks, kept.blocks).length) setOffer(kept)
        else if (kept) forget(keyRef.current)
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
    const leaving = () => void ((refused.current || canvas.current?.hasPendingChanges()) && keepNow())
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
    if (!el || !seenRev || seenRev === l.rev || l.saving || el.hasPendingChanges()) return
    let gone = false
    const before = base.current
    void readBase().then((fresh) => {
      track(fresh.blocks)
      if (gone || fresh.rev === l.rev || l.saving) return
      // D22: from the blocks this canvas held, so Undo can put them back.
      if (before?.rev === l.rev) {
        setOtherEdit({before: before.blocks, afterRev: fresh.rev, who: null})
        if (fresh.docRev) void editedBy({data: {type, id, rev: fresh.docRev}}).then((who) => !gone && setOtherEdit((e) => (e?.afterRev === fresh.rev ? {...e, who} : e)))
      } else setOtherEdit(null)
      // Idle: taken now. Focused (the author is in a field block, say): the canvas defers
      // it until they leave (EMBED-CONTRACT applyServerBlocks) instead of dropping it (D05).
      if (!el.applyServerBlocksIfIdle(decorate.current(fresh.blocks))) el.applyServerBlocks(decorate.current(fresh.blocks))
      l.rev = fresh.rev
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
      <div className="pd-status" role="status">
        {save.state === 'saving' ? t('Saving…') : save.state === 'saved' ? t('Saved') : save.state === 'error' ? (problem?.conflict ? t('Conflict') : t('Not saved')) : ''}
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
          <strong>{t('Someone else changed this document')}</strong> {t('(Barkpark is at rev {theirs}, you were editing rev {mine}).', {theirs: shortRev(problem.conflict.theirs), mine: shortRev(problem.conflict.mine)})} {t('Your unsaved edits are still on screen.')}
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
