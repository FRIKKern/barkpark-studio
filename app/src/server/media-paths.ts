// The media proxy's asset paths (lib/media-proxy pathCache), one per server process. Each reader
// has their own: a path is never sent to the browser, never skips another reader's access check,
// and each file read still goes with the reader's own token (routes/api/media/$id).
import {createHash} from 'node:crypto'
import {pathCache} from '../lib/media-proxy'
import {apiBase, dataset, requestToken} from './barkpark'

export const mediaPaths = pathCache()
/** The key prefix for this request's Barkpark, dataset and reader (their token, hashed). */
export const mediaPathPrefix = () => `${apiBase()}|${dataset()}|${createHash('sha256').update(requestToken() ?? '').digest('hex').slice(0, 16)}`
