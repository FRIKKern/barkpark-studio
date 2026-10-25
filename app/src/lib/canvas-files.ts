// Which URLs the canvas (<bp-paper-canvas>) loads from on the connected Barkpark
// (task-c57dd84f98c1296c). A Barkpark with GET /v1/embed/canvas (#24066) names the files
// under their content hash, which it serves as immutable. An older one answers 404, a slow
// or odd answer is ignored, and the plain names (no-cache) stand in.

export type Files = {script: string; styles: string[]}
export const PLAIN: Files = {script: '/assets/bp-paper-editor.bundle.js', styles: ['/assets/bp-paper-editor.css', '/assets/bp-paper-editor-shell.css', '/assets/bp-paper-surface.css']}

// A same-origin asset path, never another host (`//host`) or a way out of /assets.
const assetPath = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/assets/') && !p.includes('//') && !p.includes('..')
const named = (v: unknown): v is Files => {
  const f = v as Partial<Files> | null
  return assetPath(f?.script) && Array.isArray(f?.styles) && f.styles.length > 0 && f.styles.every(assetPath)
}

/** Ask `origin` where the canvas files are; the plain names on anything but a valid answer. */
export async function askCanvasFiles(origin: string, get: typeof fetch = fetch): Promise<Files> {
  const body: unknown = await get(`${origin}/v1/embed/canvas`, {signal: AbortSignal.timeout(3_000)})
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return named(body) ? {script: body.script, styles: [...body.styles]} : PLAIN
}
