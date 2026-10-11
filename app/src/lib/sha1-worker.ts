// The SHA-1 of a file, off the main thread (a 20 MB image would hold up typing).
self.onmessage = async (e: MessageEvent<File>) => {
  const hash = await crypto.subtle.digest('SHA-1', await e.data.arrayBuffer())
  self.postMessage([...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''))
}
