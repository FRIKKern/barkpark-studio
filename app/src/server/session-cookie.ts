// A studio session lives in its cookie, sealed (task-1883ba9b1ace5dcf): AES-256-GCM under
// a server secret, so the cookie can't be read in the browser, and one the server didn't
// seal, or that was changed by one byte, opens to nothing. Nothing is kept in memory, so a
// restart or a deploy signs nobody out.
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto'

const VERSION = 'v1'
const key = (secret: string) => createHash('sha256').update(`barkpark-studio session ${VERSION}\0${secret}`).digest()

export function seal(data: object, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return [VERSION, iv, body, cipher.getAuthTag()].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

/** What `seal` sealed under this secret, or undefined: another secret, a changed byte, not ours. */
export function unseal<T>(cookie: string, secret: string): T | undefined {
  const [version, iv, body, tag] = cookie.split('.')
  if (version !== VERSION || !iv || !body || !tag) return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'), {authTagLength: 16})
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')) as T
  } catch {
    return undefined
  }
}
