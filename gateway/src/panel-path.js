/**
 * What the right-hand panel is allowed to name.
 *
 * This decides the panel's SCOPE, and it is worth being exact about what that
 * is and is not. It is not what keeps one tenant out of another's files —
 * `panel.js` asks `sandboxes.ensure` for the caller's own sandbox and there is
 * no way to name someone else's. It is not a defence against the tenant
 * either: inside their own sandbox they are root, and their agent is a shell
 * they type into. It is what makes this a workspace browser instead of a
 * filesystem browser, and what keeps every path absolute and rooted so the
 * routes never have to guess.
 *
 * Kept free of I/O and separate from the routes so every case can be produced
 * without a deployment; `scripts/check-panel-paths.mjs` runs them.
 *
 * One rule, with a specific failure behind it.
 *
 * Absolute only, and never assembled from a relative one. `ENV HOME` in the
 * Dockerfile is a container environment variable, not root's home in
 * `/etc/passwd`, and envd resolves a relative path against passwd — so
 * `notes.md` does not mean a file in the workspace, it means `/root/notes.md`.
 * Guessing a base would therefore land somewhere the caller never named. The
 * client resolves against the session's cwd before it asks.
 *
 * There used to be a second rule — inside {@link ROOT} after normalisation —
 * and it is worth recording why it went rather than leaving a gap. It read as
 * a boundary and was not one: the sandbox is the boundary, and inside their
 * own a tenant is root with a shell. All it did was withhold the one file most
 * able to break their backend from the one interface they could still reach
 * when it was broken.
 *
 * Symlinks are deliberately NOT chased. A path spelled inside the workspace
 * that resolves elsewhere in the sandbox is followed, because a tenant who
 * links their own directory into their own workspace means for it to open. An
 * earlier version resolved every path and re-checked the answer; it bought no
 * safety — the tenant's agent reads anything they ask it to — and cost a round
 * trip on every request.
 *
 * @module panel-path
 */

import path from 'node:path/posix'

/**
 * The directory the panel is a browser of.
 *
 * A real directory on the tenant's mount, and the same path whether or not
 * they have a volume. It used to be `/workspace`, a symlink into the volume —
 * which meant the workspace had two names, and the one the panel used was the
 * one `find` refuses to follow.
 */
export const ROOT = '/mnt/workspace'

/** What a refusal carries: a status the route can answer with, and a reason. */
export class PathRefused extends Error {
  /**
   * @param {number} status - the HTTP status this refusal deserves.
   * @param {string} message - what was wrong, in terms the caller can act on.
   */
  constructor(status, message) {
    super(message)
    this.name = 'PathRefused'
    this.status = status
  }
}

/**
 * Normalise a caller-supplied path, or refuse it.
 *
 * Refuses anything that is not already absolute rather than resolving it
 * against a base — see the module comment for why a base would be the wrong
 * one. A NUL byte is refused outright: it truncates the path in every C API it
 * eventually reaches, so `/mnt/workspace/ok\0/../../etc/shadow` would be
 * judged as one path and read as another.
 *
 * @param {unknown} value - what the caller sent.
 * @returns {string} the normalised absolute path.
 * @throws {PathRefused} when it is not a usable absolute path.
 */
export function requireAbsolute(value) {
  if (typeof value !== 'string' || value === '') {
    throw new PathRefused(400, 'a path is required')
  }
  if (value.includes('\0')) {
    throw new PathRefused(400, 'a path may not contain a null byte')
  }
  if (!value.startsWith('/')) {
    throw new PathRefused(400, `"${value}" is not an absolute path`)
  }
  // `normalize` collapses `.`, `..` and repeated separators. It is a string
  // operation and knows nothing about links, which is deliberate — see the
  // module comment.
  const resolved = path.normalize(value)
  return resolved.length > 1 && resolved.endsWith('/') ? resolved.slice(0, -1) : resolved
}

/**
 * The one rule left: name a place, absolutely.
 *
 * This used to be two functions, because writes were confined to the workspace
 * while reads were not. The confinement is gone, and the reason it went is the
 * reason it never belonged: a tenant is root inside their own sandbox and
 * their agent is a shell they type into, so the panel refusing to write
 * `/mnt/dsh` stopped nobody — it only meant the one file most able to break
 * their backend was the one file they could not fix from the interface. That
 * is exactly the state a tenant reached, and the way out was a shell they
 * could not open because the thing that serves it had not started.
 *
 * What is scoped is what the tree OPENS at, which is still {@link ROOT}. A
 * browser that starts at the workspace and can be steered elsewhere is a
 * workspace browser with an escape hatch; a browser that refuses to go there
 * is a workspace browser with a hostage.
 *
 * @param {string | null | undefined} value - the path as the caller wrote it.
 * @returns {string} the normalised absolute path.
 * @throws {PathRefused} when it is missing, relative, or not a string.
 */
export function requirePath(value) {
  return requireAbsolute(value)
}

/** The route prefix the raw-bytes reader answers on. */
export const RAW_PREFIX = '/sandbox/raw/'

/**
 * Build the URL that serves one file's bytes.
 *
 * Path-encoded rather than a query parameter, and that is load-bearing for the
 * HTML preview: a previewed page resolves `./style.css` against its own URL,
 * and the URL algorithm drops the query of a path-relative reference. With the
 * file's path in the query, every relative asset in a previewed page would
 * arrive here naming nothing.
 *
 * @param {string} absolute - an absolute path inside the root.
 * @returns {string} the route URL.
 */
export function rawUrl(absolute) {
  const segments = absolute.split('/').filter((segment) => segment !== '')
  return RAW_PREFIX + segments.map((segment) => encodeURIComponent(segment)).join('/')
}

/**
 * Read back the path from a raw-route URL.
 *
 * The caller still passes the result through {@link requirePath}: this
 * decodes, it does not judge. A `..` written as `%2e%2e` decodes to something
 * that normalises out of the root, and it is refused there.
 *
 * @param {string} pathname - the request's pathname.
 * @returns {string|undefined} the decoded absolute path, or undefined when the URL is not one of ours.
 */
export function pathFromRawUrl(pathname) {
  if (!pathname.startsWith(RAW_PREFIX)) return undefined
  const rest = pathname.slice(RAW_PREFIX.length)
  if (rest === '') return undefined
  let segments
  try {
    segments = rest.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    // Malformed percent-encoding. Undefined rather than a throw: to the route
    // this is indistinguishable from a URL that was never ours.
    return undefined
  }
  if (segments.some((segment) => segment === '')) return undefined
  return `/${segments.join('/')}`
}
