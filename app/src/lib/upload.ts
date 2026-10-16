// Upload a file to Barkpark's media library through this studio (/api/media/upload),
// reporting progress as the browser sends it. XHR, because fetch reports no upload
// progress. Abort through `signal`: the promise then rejects with an AbortError. Bytes the
// library already holds (same SHA-1) are not sent: their asset is used.

export class UploadError extends Error {
  constructor(message: string, readonly network = false) {
    super(message)
  }
}

/** The file's SHA-1, hashed in a worker (main thread where workers are missing); null if it can't. */
export async function sha1Of(file: File): Promise<string | null> {
  try {
    if (typeof Worker === 'undefined') {
      const hash = await crypto.subtle.digest('SHA-1', await file.arrayBuffer())
      return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
    const worker = new Worker(new URL('./sha1-worker.ts', import.meta.url), {type: 'module'})
    return await new Promise<string | null>((resolve) => {
      worker.onmessage = (e: MessageEvent<string>) => resolve(e.data)
      worker.onerror = () => resolve(null)
      worker.postMessage(file)
    }).finally(() => worker.terminate())
  } catch {
    return null
  }
}

/**
 * The library's asset with these exact bytes, if it has one: then nothing is sent, as
 * Sanity reuses an asset whose hash it knows (Barkpark #22700). Any failure: null, upload.
 */
export async function existingAsset(file: File, signal?: AbortSignal): Promise<{ref: string; url?: string} | null> {
  const sha1 = await sha1Of(file)
  if (!sha1 || signal?.aborted) return null
  const res = await fetch(`/api/media/by-sha1?sha1=${sha1}`, {signal}).catch(() => null)
  return res?.ok ? ((await res.json()) as {ref: string; url?: string}) : null
}

/** `meta`: the optional metadata Barkpark reads at upload, as Sanity's (`exif`, `location`; lib/image-meta.ts). */
export async function uploadFile(file: File, onProgress: (fraction: number) => void, signal: AbortSignal, meta: string[] = []): Promise<string> {
  const known = await existingAsset(file, signal)
  if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
  if (known) return onProgress(1), known.ref
  return send(file, onProgress, signal, meta)
}

// F9: the browser going offline keeps an in-flight request open (Chromium), so the
// upload would wait in silence: it fails at once with the field's Retry. Bytes that stop
// moving for STALL_MS fail the same way (while sending; the answer may take its time).
const STALL_MS = 15_000

function send(file: File, onProgress: (fraction: number) => void, signal: AbortSignal, meta: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let stall: ReturnType<typeof setTimeout> | undefined
    // Rejected before the abort: the first settles, and an AbortError would read as Cancel.
    const lost = () => (done(), reject(new UploadError('The network is unreachable.', true)), xhr.abort())
    const moved = () => (clearTimeout(stall), (stall = setTimeout(lost, STALL_MS)))
    const done = () => (clearTimeout(stall), removeEventListener('offline', lost))
    xhr.open('POST', '/api/media/upload')
    xhr.upload.onprogress = (e) => (moved(), e.lengthComputable && onProgress(e.loaded / e.total))
    xhr.upload.onload = () => clearTimeout(stall)
    xhr.onload = () => {
      done()
      if (xhr.status < 200 || xhr.status >= 300) return reject(new UploadError(`The server answered ${xhr.status}.`))
      try {
        resolve((JSON.parse(xhr.responseText) as {ref: string}).ref)
      } catch {
        reject(new UploadError('The server answered with something unreadable.'))
      }
    }
    xhr.onerror = () => (done(), reject(new UploadError('The network is unreachable.', true)))
    xhr.onabort = () => (done(), reject(new DOMException('Upload cancelled', 'AbortError')))
    if (signal.aborted) return xhr.onabort(new ProgressEvent('abort'))
    if (!navigator.onLine) return lost()
    signal.addEventListener('abort', () => xhr.abort(), {once: true})
    addEventListener('offline', lost)
    const body = new FormData()
    body.append('file', file)
    if (meta.length) body.append('meta', meta.join(','))
    xhr.send(body)
    moved()
  })
}
