// e2e only (STUDIO_E2E_HOOKS=1, POST /api/e2e-listen {action: 'write-fault', …}): the save path
// meets a fault, for writes that name one document, so a spec can watch the studio through it
// (the save fault sweep, task-2f360f9920e578b1). Other documents' writes are untouched.
//   '500'   Barkpark answers 500 until `ms` from now;
//   'hang'  each write waits `ms` before it goes;
//   '412'   the next `count` writes are refused as a stale revision;
//   'reset' the next `count` writes land, and their answer is lost (a reset mid-request);
//   '413'   the next `count` writes are refused as too large.
export type WriteFault = {kind: '500' | 'hang' | '412' | 'reset' | '413'; until?: number; ms?: number; left?: number}
const faults = new Map<string, WriteFault>()

export function setWriteFault(id: string, f: {kind: WriteFault['kind']; ms?: number; count?: number} | null) {
  if (!f) return void faults.delete(id)
  faults.set(id, {kind: f.kind, until: f.kind === '500' ? Date.now() + (f.ms ?? 0) : undefined, ms: f.ms, left: f.count ?? 1})
}

/** The fault for this write, if one is set for a document it names (and still live). */
export function writeFaultFor(mutations: unknown): WriteFault | null {
  if (process.env.STUDIO_E2E_HOOKS !== '1' || !faults.size) return null
  const text = JSON.stringify(mutations)
  for (const [id, f] of faults) {
    if (!text.includes(`"${id}"`)) continue
    if (f.kind === '500') return Date.now() < f.until! ? f : (faults.delete(id), null)
    if (f.kind === 'hang') return f
    if ((f.left ?? 0) <= 0) return (faults.delete(id), null)
    f.left = (f.left ?? 1) - 1
    return f
  }
  return null
}
