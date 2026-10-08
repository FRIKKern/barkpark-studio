// B02: which Barkpark workspace, project and dataset a page works in. The URL carries
// it the way Barkpark's own LiveView Studio does: /w/<workspace>/p/<project>/d/<dataset>/…
// in front of the studio's own path. No prefix: the studio's configured default (.env).
// (Media file paths, /w/<ws>/p/<project>/media/files/…, have no /d/ and are no scope.)

export type Scope = {workspace: string; project: string; dataset: string}

const NAME = '[a-z0-9][a-z0-9_-]*'
const PREFIX = new RegExp(`^/w/(${NAME})/p/(${NAME})/d/(${NAME})(?=/|$)`)

/** The scope a path names, and the studio path after it; `scope` undefined when it names none. */
export function parseScope(pathname: string): {scope?: Scope; rest: string} {
  const m = PREFIX.exec(pathname)
  if (!m) return {rest: pathname}
  return {scope: {workspace: m[1]!, project: m[2]!, dataset: m[3]!}, rest: pathname.slice(m[0].length) || '/'}
}

/** The path for `rest` in `scope`. */
export const scopedPath = (scope: Scope, rest: string) => `/w/${scope.workspace}/p/${scope.project}/d/${scope.dataset}${rest.startsWith('/') ? rest : `/${rest}`}`
