/**
 * Obtain a sandbox-local browser session through Connection's public token
 * exchange. The tunnel owns a Host context; it does not sign cookies itself.
 * Neither the launch token nor the resulting cookie leaves this process.
 */

/**
 * @param {object} connection - the injected Host Connection service.
 * @param {string} authority - this sandbox's loopback Host authority.
 * @returns {{cookie: string, expiresAt: number}} a private, renewable session.
 */
export function localSession(connection, authority) {
  let status
  let headers
  const allowed = connection.authorizeIndex({
    method: 'GET',
    url: connection.authenticatedUrl(`http://${authority}`),
    headers: { host: authority },
  }, {
    writeHead(code, values) { status = code; headers = values },
    end() {},
  })
  const setCookie = headers?.['set-cookie']
  const maxAge = typeof setCookie === 'string' ? /;\s*Max-Age=(\d+)/i.exec(setCookie) : null
  if (allowed !== false || status !== 303 || maxAge === null || Number(maxAge[1]) <= 0) {
    throw new Error('gateway-tunnel: DSH did not issue a local browser session')
  }
  return {
    cookie: setCookie.split(';', 1)[0],
    expiresAt: Date.now() + Number(maxAge[1]) * 1000,
  }
}
