/**
 * The sandbox's browser, watched from outside.
 *
 * The sandbox carries a headless Chromium on loopback:9222, driven by the
 * agent through playwright-cli. A tenant reading the conversation sees the
 * commands succeed and nothing else — the browser is a screen in a machine
 * nobody sits at. These two questions are the window onto it: which pages
 * are open, and what one of them looks like right now, as a JPEG small
 * enough to cross the RPC envelope.
 *
 * Pull, not push, and deliberately. Chromium's screencast would push frames
 * the moment they change, but a push needs a socket, and a socket needs an
 * upgrade route through every hop between the panel and here. The panel
 * asking about once a second gets a preview a person can follow, costs
 * nothing when nobody is looking, and rides the request/response channel
 * this plugin already stands on.
 *
 * The CDP port is a remote control for the browser AS the tenant — that is
 * why it is loopback-only and why this file does not forward it. What
 * crosses here is two read-only questions, not the protocol: the panel
 * cannot navigate, type, or reach anything the agent's own hands could not.
 *
 * @module dsh-sandbox-host/browser
 */

/** Where the sandbox's browser answers; see sandbox/start-browser.sh. */
const CDP = 'http://127.0.0.1:9222'

/** How long a page gets to produce a screenshot before it is called stuck. */
const SHOT_TIMEOUT_MS = 8000

/**
 * Every open page, oldest first, the way CDP lists them.
 * @returns {Promise<Array<{id: string, url: string, title: string, ws: string}>>} the pages.
 */
async function pages() {
  const response = await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(3000) })
  const targets = await response.json()
  return targets
    .filter((target) => target.type === 'page')
    .map((target) => ({
      id: target.id,
      url: target.url,
      title: target.title,
      ws: target.webSocketDebuggerUrl,
    }))
}

/**
 * Whether the browser is up, and what it has open.
 *
 * An unreachable browser is an answer rather than an error: an image built
 * without the engine, or a browser that has died, are states the panel has
 * wording for, not failures of this call.
 *
 * @returns {Promise<{running: boolean, pages: Array<{id: string, url: string, title: string}>}>} the state.
 */
export async function status() {
  try {
    const open = await pages()
    return { running: true, pages: open.map(({ id, url, title }) => ({ id, url, title })) }
  } catch {
    return { running: false, pages: [] }
  }
}

/**
 * One frame of one page.
 *
 * The connection is opened for the shot and closed with it. Chromium allows
 * several debugger clients on one target, so this coexists with the CLI
 * driving the page; holding a connection open between shots would only be
 * one more thing to reconcile when the browser or the page goes away.
 *
 * @param {string} [id] - the page target; the first page when omitted.
 * @returns {Promise<{id: string, url: string, title: string, data: string}|undefined>} the frame as base64 JPEG, or undefined when there is no such page.
 */
export async function shot(id) {
  const open = await pages()
  const page = id === undefined ? open[0] : open.find((entry) => entry.id === id)
  if (page === undefined) return undefined
  const data = await capture(page.ws)
  return { id: page.id, url: page.url, title: page.title, data }
}

/**
 * Ask one target for a screenshot over its own debugger socket.
 *
 * JPEG rather than PNG because the frame is watched, not kept: at quality 70
 * a 1280x800 page is tens of kilobytes against PNG's hundreds, and the next
 * frame replaces it a second later. `optimizeForSpeed` trades encoding
 * niceties away for the same reason.
 *
 * @param {string} ws - the target's webSocketDebuggerUrl.
 * @returns {Promise<string>} base64 JPEG.
 */
function capture(ws) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(ws)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('the browser did not answer in time'))
    }, SHOT_TIMEOUT_MS)
    const settle = (act) => {
      clearTimeout(timer)
      socket.close()
      act()
    }
    socket.onopen = () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Page.captureScreenshot',
        params: { format: 'jpeg', quality: 70, optimizeForSpeed: true },
      }))
    }
    socket.onmessage = (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.id !== 1) return
      if (message.error !== undefined) settle(() => { reject(new Error(message.error.message)) })
      else settle(() => { resolve(message.result.data) })
    }
    socket.onerror = () => { settle(() => { reject(new Error('could not reach the browser')) }) }
  })
}
