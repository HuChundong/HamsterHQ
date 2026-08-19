/**
 * What the panel asks the gateway for.
 *
 * Every call in one place because they share one shape — a path in, JSON out,
 * a refusal that has to be readable — and because the routes they name are a
 * contract with `gateway/src/panel.js` that is easier to keep true when it is
 * written down once.
 *
 * @module api
 */

import { ROOT } from './constants.js'
import { fromServer, say } from './i18n.js'

/**
 * Whether a path is one the tree can show.
 *
 * The panel opens anything in the sandbox; the tree lists one directory of
 * it. This is the line between those two, and the reason a file from
 * `/tmp` gets a tab and no highlighted row.
 *
 * @param {string|undefined} path - an absolute path.
 * @returns {boolean} whether the tree holds it.
 */
export const insideWorkspace = (path) => typeof path === 'string' && path.startsWith(`${ROOT}/`)

/**
 * Ask the gateway about the tenant's workspace.
 *
 * Same origin, so the session cookie goes along without anything being
 * said about it here — the panel has no notion of this deployment's
 * tokens and does not want one.
 *
 * @param {string} path - an absolute path inside the workspace.
 * @returns {Promise<Array<object>>} the directory's entries.
 * @throws {Error} carrying whatever the gateway said, for the row to show.
 */
export const listDir = async (path) => {
  const response = await fetch(`/sandbox/fs/list?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.read', { status: String(response.status) }))
  return payload.entries ?? []
}

/**
 * Whether a path is still there.
 *
 * Bytes are not asked for — the two viewers that need this are an image
 * and an HTML page, both of which have already handed their URL to the
 * browser, and downloading a file a second time to find out whether it
 * exists would cost more than what it answers.
 *
 * A 404 is the sandbox saying no such path, and nothing else answers 404
 * here: a sandbox that cannot be reached at all is a 502, so this cannot
 * mistake a deployment being down for a file being deleted.
 *
 * @param {string} path - an absolute path inside the workspace.
 * @returns {Promise<boolean>} false only when the sandbox says it is gone.
 */
export const stillThere = async (path) => {
  try {
    const response = await fetch(`/sandbox/fs/stat?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
    return response.status !== 404
  } catch {
    // A network that failed says nothing about the file, and a tab is not
    // closed on a question that went unanswered.
    return true
  }
}

/**
 * The URL one file's bytes are served at.
 *
 * Path-encoded rather than a query parameter, and the gateway decodes it
 * the same way. That is what lets an HTML preview resolve `./style.css`
 * back into this route: a path-relative reference keeps the path and drops
 * the query.
 *
 * @param {string} path - an absolute path inside the workspace.
 * @returns {string} the URL.
 */
export const rawUrl = (path) => `/sandbox/raw/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`

/**
 * A short-lived ticket that lets an HTML preview fetch its own assets.
 *
 * The frame a preview loads in is sandboxed to an opaque origin, so its
 * requests for `./style.css` carry no session cookie and come back 401.
 * The ticket rides in the URL path ahead of the file, which is what makes
 * a relative reference resolve to a URL that is still authenticated.
 *
 * @returns {Promise<string>} the ticket.
 */
export const mintTicket = async () => {
  const response = await fetch('/sandbox/fs/ticket', { credentials: 'same-origin' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.preview'))
  return payload.ticket
}

/**
 * The URL an HTML preview is loaded from.
 * @param {string} ticket - a minted ticket.
 * @param {string} path - the file's absolute path.
 * @returns {string} the URL.
 */
export const previewUrl = (ticket, path) => `/sandbox/preview/${encodeURIComponent(ticket)}/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`

/**
 * Ask the gateway to change something in the workspace.
 *
 * @param {string} action - `move`, `remove` or `mkdir`.
 * @param {object} body - the paths the action needs.
 * @returns {Promise<object>} what the gateway answered.
 * @throws {Error} carrying the gateway's own message, for the row to show.
 */
export const command = async (action, body) => {
  const response = await fetch(`/sandbox/fs/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.act', { status: String(response.status) }))
  return payload
}

/**
 * The newest page in the workspace, and when it was written.
 *
 * One answer covers both questions the canvas has: which page to show, and
 * whether the one on screen is still current.
 *
 * @returns {Promise<{path: string, modified: number}|undefined>} the page, or undefined when there is none.
 */
export const newestPage = async () => {
  const response = await fetch('/sandbox/fs/newest', { credentials: 'same-origin' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.read', { status: String(response.status) }))
  return payload.path === undefined ? undefined : payload
}

/** The last segment of a path, which is what a tab is called. */
export const basename = (path) => path.slice(path.lastIndexOf('/') + 1) || path
