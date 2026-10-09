// Upload a file to Barkpark's media library through this studio (/api/media/upload),
// reporting progress as the browser sends it. XHR, because fetch reports no upload
// progress. Abort through `signal`: the promise then rejects with an AbortError.

export class UploadError extends Error {
  constructor(message: string, readonly network = false) {
    super(message)
  }
}

export function uploadFile(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media/upload')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new UploadError(`The server answered ${xhr.status}.`))
      try {
        resolve((JSON.parse(xhr.responseText) as {ref: string}).ref)
      } catch {
        reject(new UploadError('The server answered with something unreadable.'))
      }
    }
    xhr.onerror = () => reject(new UploadError('The network is unreachable.', true))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    if (signal.aborted) return xhr.onabort(new ProgressEvent('abort'))
    signal.addEventListener('abort', () => xhr.abort(), {once: true})
    const body = new FormData()
    body.append('file', file)
    xhr.send(body)
  })
}
