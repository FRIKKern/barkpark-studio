import {useEffect, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {docQuery} from '../lib/data'
import {applyBlockOps, canvasOrigin, readBlocks, type Block, type BlockOp, type OpsResult} from '../lib/blocks'
import {toast} from './Toasts'

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
  hasPendingChanges(): boolean
}

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
      script.onerror = () => reject(new Error(`could not load the editor from ${origin}`))
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
 * `labels`: field name → title, shown on the bound field blocks that carry no label.
 */
export function PortableDocEditor({type, id, field, vocabulary, labels, editable = true}: {type: string; id: string; field?: string; vocabulary?: unknown; labels?: Record<string, string>; editable?: boolean}) {
  const host = useRef<HTMLDivElement>(null)
  const vocabularyKey = vocabulary ? JSON.stringify(vocabulary) : ''
  const canvas = useRef<Canvas | null>(null)
  const loop = useRef({rev: '', saving: 0, requests: 0})
  const [save, setSave] = useState<Save>({state: 'idle'})
  const [problem, setProblem] = useState<Problem | null>(null)
  const [failed, setFailed] = useState<string>()
  // The failure card's buttons, bound to the save loop below.
  const resolveRef = useRef<{retry: () => void; discard: () => Promise<void>} | null>(null)
  // D01: a bound field block shows its field's title (the server's projection carries none).
  const decorate = useRef((blocks: Block[]) => blocks)
  decorate.current = (blocks) => (labels ? blocks.map((b) => (typeof b.fieldName === 'string' && !b.label && labels[b.fieldName] ? {...b, label: labels[b.fieldName]} : b)) : blocks)

  useEffect(() => {
    let gone = false
    const l = loop.current
    const read = () => readBlocks(type, id, field).then((r) => ({...r, blocks: decorate.current(r.blocks)}))
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
        for (let tries = 0; !r.ok && r.status === 412 && r.actual && tries < 3; tries++) {
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
          toast({tone: 'critical', title: `A ${d.type ?? 'block'} could not be shown`, description: d.message ?? d.error})
        })
        // Plain links open in a new tab; wikilinks into panes arrive with D06.
        el.addEventListener('bp-canvas-open-link', (e) => {
          const {href} = (e as CustomEvent<{href?: string}>).detail
          e.preventDefault()
          if (href) window.open(href, '_blank', 'noopener')
        })
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

  // Someone else saved (the live stream refreshed the doc): take their blocks if the
  // canvas is idle. Busy, it keeps the author's state and the next save's rev decides.
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
      if (gone || fresh.rev === l.rev || l.saving) return
      if (el.applyServerBlocksIfIdle(decorate.current(fresh.blocks))) l.rev = fresh.rev
    })
    return () => {
      gone = true
    }
  }, [seenRev, type, id, field])

  return (
    <div className="pd-editor">
      <div className="pd-status" role="status">
        {save.state === 'saving' ? 'Saving…' : save.state === 'saved' ? 'Saved' : save.state === 'error' ? 'Not saved' : ''}
      </div>
      {problem && (
        <div className="pd-conflict" role="alert">
          <strong>Could not save:</strong> {problem.message}. Your edit is still on screen.
          <div>
            <button type="button" className="btn-text" onClick={() => resolveRef.current?.retry()}>
              Retry
            </button>
            <button type="button" className="btn-text" onClick={() => void resolveRef.current?.discard()}>
              Discard unsaved edits
            </button>
          </div>
        </div>
      )}
      {failed && <p role="alert">The editor could not load: {failed}</p>}
      <div className="pd-canvas" ref={host} />
    </div>
  )
}
