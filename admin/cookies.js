/**
 * How this service reads and writes the two cookies it has.
 *
 * There are two — a session and the half-open challenge between the two steps
 * of signing in — and they differ in exactly two things: the name and how long
 * they last. Everything else about them is one decision made once, and it was
 * written out twice: two identical `Set-Cookie` builders, two identical
 * header parsers, in files that would have to be edited together to stay
 * correct. A cookie attribute that changed in one of them and not the other is
 * a security property that quietly applies to half the service.
 *
 * @module cookies
 */

/**
 * The attributes both cookies carry.
 *
 * `Strict`, not `Lax`. `Lax` exists so a link from elsewhere still arrives
 * signed in, which is a courtesy for a product and a liability for a console:
 * there is no legitimate journey into this service from another site, and
 * refusing to send the cookie on one closes the whole class of cross-site
 * request forgery without a token anywhere.
 *
 * `Secure` only over TLS, because a browser discards a `Secure` cookie set
 * over plain HTTP — which is how a local run would be unable to sign in at
 * all.
 *
 * @param {boolean} secure - whether the request arrived over TLS.
 * @returns {string} the attributes, without a leading separator.
 */
const attributes = (secure) => `HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Path=/`

/**
 * The `Set-Cookie` value that opens or closes one of them.
 *
 * @param {string} name - which cookie.
 * @param {string|undefined} token - what to put in it, or nothing to end it.
 * @param {boolean} secure - whether the request arrived over TLS.
 * @param {number} ttlSeconds - how long it lasts, when it is being opened.
 * @returns {string} the header value.
 */
export function setCookie(name, token, secure, ttlSeconds) {
  return token === undefined
    ? `${name}=; ${attributes(secure)}; Max-Age=0`
    : `${name}=${token}; ${attributes(secure)}; Max-Age=${String(ttlSeconds)}`
}

/**
 * The value of one cookie on a request, if it is there.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {string} name - which cookie.
 * @returns {string|undefined} its value, or nothing.
 */
export function readCookie(req, name) {
  const pair = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return pair === undefined ? undefined : pair.slice(name.length + 1)
}
