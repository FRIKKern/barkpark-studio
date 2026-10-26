// The media proxy's asset paths (lib/media-proxy pathCache), one per server process and shared
// across editors: a path is never sent to the browser, and each file read still goes with the
// reader's own token (routes/api/media/$id).
import {pathCache} from '../lib/media-proxy'
import {apiBase, dataset} from './barkpark'

export const mediaPaths = pathCache()
/** The key prefix for this request's Barkpark and dataset. */
export const mediaPathPrefix = () => `${apiBase()}|${dataset()}`
