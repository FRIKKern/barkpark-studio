import {useEffect, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {docQuery} from '../lib/data'
import {applyBlockOps, canvasOrigin, readBlocks, type Block, type BlockOp, type OpsResult} from '../lib/blocks'

// Freeform (decision 0004): Barkpark's own <bp-paper-canvas>, hosted the way Barkdown
// hosts it. Blocks in; `bp-canvas-ops` batches out, each saved with the doc's rev and
// acknowledged, then the server echo fed back so minted ids land. A stale rev (412)
// keeps the edit on screen and asks: load theirs, or re-apply mine on top.
// The save loop is ported from Barkdown (app/renderer/src/tabs/paper.js, Apache-2.0;
// see THIRD-PARTY.md).

/** The element's host-facing surface (barkpark api/assets/paper-editor/src/canvas/index.js). */
type Canvas = HTMLElement & {
  blocks: Block[]
  acknowledgedSaves: boolean
  acknowledgeOps(seq: number, saved: boolean): boolean
  discardInflightOps(seq: number): boolean
  resendPendingOps(): boolean
  applyServerBlocks(blocks: Block[]): void
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

type Save = {state: 'saved' | 'saving' | 'error' | 'conflict' | 'idle'; message?: string}
type Problem =
  | {kind: 'conflict'; server: {rev: string; blocks: Block[]}; retry: {ops: BlockOp[]; seq: number}}
  | {kind: 'failed'; message: string; discarded: boolean; partial: boolean; retry: {ops: BlockOp[]; seq: number}}

export function PortableDocEditor({type, id, editable = true}: {type: string; id: string; editable?: boolean}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<Canvas | null>(null)
  const loop = useRef({rev: '', latestSeq: -1, saving: 0, mergeAfterSave: false})
  const [save, setSave] = useState<Save>({state: 'idle'})
  const [problem, setProblem] = useState<Problem | null>(null)
  const [failed, setFailed] = useState<string>()
  // The conflict / failure card's buttons, bound to the save loop below.
  const resolveRef = useRef<{
    theirs: (server: {rev: string; blocks: Block[]}) => void
    mine: (server: {rev: string; blocks: Block[]}, retry: {ops: BlockOp[]; seq: number}) => void
    retry: (failed: Extract<Problem, {kind: 'failed'}>) => void
    discard: () => Promise<void>
  } | null>(null)

  useEffect(() => {
    let gone = false
    const l = loop.current
    async function applyOps(ops: BlockOp[], seq: number) {
      const el = canvas.current
      if (!el || !ops.length) return
      l.saving++
      setSave({state: 'saving'})
      try {
        const r = (await applyBlockOps({data: {type, id, ops: ops as never, ifRev: l.rev}})) as unknown as OpsResult
        if (gone) return
        l.rev = r.rev
        if (r.ok) {
          el.acknowledgeOps(seq, true)
          // Saved only when nothing newer is queued (an ack may flush the next batch).
          if (seq === l.latestSeq && !el.hasPendingChanges()) setSave({state: 'saved'})
          setProblem((p) => (p?.kind === 'conflict' && p.retry.seq !== seq ? p : null))
          // Echo: the server's blocks carry the ids it minted for new blocks.
          const echoRev = l.rev
          const fresh = await readBlocks(type, id)
          if (gone || echoRev !== l.rev || seq !== l.latestSeq) return
          if (l.mergeAfterSave && !el.hasPendingChanges()) el.resolveConflictWithServerBlocks(fresh.blocks)
          else el.applyServerBlocks(fresh.blocks)
          l.rev = fresh.rev
          l.mergeAfterSave = false
          return
        }
        if (r.status === 412 && r.applied === 0) {
          // Someone else wrote first. Keep the batch; the author chooses.
          const server = await readBlocks(type, id)
          if (gone) return
          setSave({state: 'conflict'})
          setProblem({kind: 'conflict', server, retry: {ops, seq}})
          return
        }
        // Refused, or landed part-way (one op per request): never leave the canvas
        // waiting on this batch. Part-way, only the server's copy is safe to diff against.
        const partial = r.applied > 0
        const discarded = !partial && el.discardInflightOps(seq)
        if (partial) el.resolveConflictWithServerBlocks((await readBlocks(type, id)).blocks)
        setSave({state: 'error', message: r.message})
        setProblem({kind: 'failed', message: r.message, discarded, partial, retry: {ops, seq}})
      } catch (e) {
        if (gone) return
        const discarded = el.discardInflightOps(seq)
        setSave({state: 'error', message: (e as Error).message})
        setProblem({kind: 'failed', message: (e as Error).message, discarded, partial: false, retry: {ops, seq}})
      } finally {
        l.saving--
      }
    }
    resolveRef.current = {
      theirs: (server) => {
        canvas.current?.resolveConflictWithServerBlocks(server.blocks)
        l.rev = server.rev
        l.mergeAfterSave = false
        setProblem(null)
        setSave({state: 'saved'})
      },
      mine: (server, retry) => {
        setProblem(null)
        l.rev = server.rev
        l.mergeAfterSave = true
        void applyOps(retry.ops, retry.seq)
      },
      // Discarded, the canvas re-diffs (resending old ops could land an insert twice);
      // otherwise the batch is still in flight and goes again as it was.
      retry: (failed) => {
        setProblem(null)
        if (!failed.discarded) return void applyOps(failed.retry.ops, failed.retry.seq)
        setSave({state: 'saving'})
        if (!canvas.current?.resendPendingOps()) setSave({state: 'saved'})
      },
      discard: async () => {
        const fresh = await readBlocks(type, id)
        if (gone) return
        canvas.current?.resolveConflictWithServerBlocks(fresh.blocks)
        l.rev = fresh.rev
        setProblem(null)
        setSave({state: 'saved'})
      },
    }

    void (async () => {
      try {
        const [first] = await Promise.all([readBlocks(type, id), loadCanvas()])
        if (gone || !host.current) return
        const el = document.createElement('bp-paper-canvas') as Canvas
        el.acknowledgedSaves = true
        el.blocks = first.blocks
        el.setAttribute('editable', String(editable))
        el.addEventListener('bp-canvas-ops', (e) => {
          const {ops, seq} = (e as CustomEvent<{ops: BlockOp[]; seq: number}>).detail
          l.latestSeq = seq
          void applyOps(ops, seq)
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
  }, [type, id, editable])

  // Someone else saved (the live stream refreshed the doc): take their blocks if the
  // canvas is idle. Busy, it keeps the author's state and the next save's rev decides.
  const {data: doc} = useQuery(docQuery(type, id))
  const seenRev = doc?._rev
  useEffect(() => {
    const l = loop.current
    const el = canvas.current
    if (!el || !seenRev || seenRev === l.rev || l.saving || el.hasPendingChanges()) return
    let gone = false
    void readBlocks(type, id).then((fresh) => {
      if (gone || fresh.rev === l.rev || l.saving) return
      if (el.applyServerBlocksIfIdle(fresh.blocks)) l.rev = fresh.rev
    })
    return () => {
      gone = true
    }
  }, [seenRev, type, id])

  return (
    <div className="pd-editor">
      <div className="pd-status" role="status">
        {save.state === 'saving' ? 'Saving…' : save.state === 'saved' ? 'Saved' : save.state === 'conflict' ? 'Conflict' : save.state === 'error' ? 'Not saved' : ''}
      </div>
      {problem?.kind === 'conflict' && (
        <div className="pd-conflict" role="alert">
          <strong>Someone else changed this document.</strong> Your unsaved edit is still on screen.
          <div>
            <button type="button" className="btn-text" onClick={() => resolveRef.current?.theirs(problem.server)}>
              Load their version
            </button>
            <button type="button" className="btn-text" onClick={() => resolveRef.current?.mine(problem.server, problem.retry)}>
              Re-apply my edit on top
            </button>
          </div>
        </div>
      )}
      {problem?.kind === 'failed' && (
        <div className="pd-conflict" role="alert">
          <strong>Could not save:</strong> {problem.message}
          {problem.partial && ' Part of the edit was saved; the saved version is shown.'}
          <div>
            {!problem.partial && (
              <button type="button" className="btn-text" onClick={() => resolveRef.current?.retry(problem)}>
                Retry
              </button>
            )}
            <button type="button" className="btn-text" onClick={() => void resolveRef.current?.discard()}>
              {problem.partial ? 'OK' : 'Discard unsaved edits'}
            </button>
          </div>
        </div>
      )}
      {failed && <p role="alert">The editor could not load: {failed}</p>}
      <div className="pd-canvas" ref={host} />
    </div>
  )
}
