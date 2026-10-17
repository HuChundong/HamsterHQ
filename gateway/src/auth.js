/**
 * Gateway authentication: the only thing standing between the public internet
 * and an agent that runs shell commands.
 *
 * dsh ships no authentication layer of its own — its `/api` fence is a
 * confused-deputy defense (DNS rebinding and cross-site), explicitly not an
 * auth boundary, and remote-deployment authentication is recorded as deferred
 * work. The tunnel deliberately presents every forwarded request to dsh as a
 * loopback call, which also disarms that fence. Everything therefore rests
 * here: an unauthenticated request must never reach a tunnel.
 *
 * This module is where a request becomes a caller. Who exists is in
 * `accounts.js`, what a token is worth is in `tokens.js`, and how an address
 * proves itself is in `verification.js`; the job here is to read a browser's
 * cookies and answer with an account or nothing.
 *
 * Refreshing happens here rather than in the browser. The frontend is dsh's own
 * shell, which knows nothing about this deployment's tokens and would meet an
 * expired one as a 401 it retries forever — so when the access token has
 * expired and a refresh token is still good, the gateway renews both and sets
 * the new cookies on whatever request noticed. Nothing in the page has to
 * participate, and nothing in the page could.
 */

import { ACCESS_COOKIE, REFRESH_COOKIE, signedInCookies } from './tokens.js'

/**
 * Parse a Cookie header into a name→value map.
 * @param {string | undefined} header - the raw `Cookie` header.
 * @returns {Record<string, string>} the parsed cookies.
 */
function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {}
  if (header === undefined) return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

/**
 * Whether the browser reached the deployment over TLS.
 *
 * nginx terminates TLS, so the gateway only ever sees plain HTTP and has to be
 * told. It decides whether the token cookies are marked `Secure`, and it is
 * only trustworthy because nothing but nginx can reach this port.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {boolean} whether the original request was HTTPS.
 */
export function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https'
}

/**
 * Resolve the account behind a request, renewing its tokens when they need it.
 *
 * `renew` says whether this request can hand the replacement back. Rotation
 * retires the token it was given, so a caller that cannot deliver the
 * replacement must not spend one: the browser would keep a cookie the store no
 * longer honours, and the next request more than a grace period later would ask
 * the person for a sign-in code. A WebSocket handshake is the case — it has no
 * response object, and its status line is the only thing it can say — so it
 * passes `false` and an expired access token is refused instead, which the
 * browser answers by reconnecting after some ordinary request has renewed it.
 *
 * Reading an unexpired access token needs no store either way, so a socket that
 * was opened while the token was valid keeps working across a renewal.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('./tokens.js').Tokens} tokens - the token store.
 * @param {import('./accounts.js').Accounts} accounts - the account store.
 * @param {boolean} [canRenew] - whether the caller can deliver replacement cookies; default true.
 * @returns {Promise<{account: import('./accounts.js').Account | {email: string, id: string, admin: boolean}, cookies?: string[]} | undefined>} the caller and any cookies to set, or undefined when the request proves nothing.
 */
export async function authenticate(req, tokens, accounts, canRenew = true) {
  const cookies = parseCookies(req.headers.cookie)

  const caller = await tokens.readAccess(cookies[ACCESS_COOKIE])
  // The common path: a valid access token, verified by signature alone. No
  // store is consulted, which is the whole reason the token is short-lived.
  if (caller !== undefined) return { account: caller }

  // Nothing to renew with if this request cannot carry the replacement. Refuse
  // before spending: see the note on `canRenew` above for what spending here
  // costs — a browser holding a token the store has retired.
  if (!canRenew) return undefined

  // The access token is missing or expired. A refresh token is the only thing
  // that can replace it, and spending it is where revocation takes effect:
  // signing out, suspension, and deletion all work by making this step fail.
  const spent = await tokens.spendRefresh(cookies[REFRESH_COOKIE])
  if (spent === undefined) return undefined
  const account = await accounts.read(spent.email)
  if (account === undefined || account.disabled) return undefined

  // The replacement comes from the rotation rather than being minted here, so
  // the several requests a waking browser makes at once all end up holding the
  // same one instead of each issuing another.
  const access = await tokens.issueAccess(account)
  return { account, cookies: signedInCookies(access, spent.refresh, isSecureRequest(req)) }
}
