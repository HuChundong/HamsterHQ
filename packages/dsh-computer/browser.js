/**
 * The sandbox's browser, watched from outside.
 *
 * The agent and, in the desktop image, the person both use the Chromium on
 * loopback:9222. These two questions expose only what a watcher needs: which
 * pages are open and one current JPEG. CDP itself never crosses the channel.
 *
 * Pulling frames avoids a socket upgrade through every hop and costs nothing
 * when neither the Browser pane nor a waiting-action card is mounted.
 *
 * @module dsh-computer/browser
 */

const CDP = 'http://127.0.0.1:9222'
const SHOT_TIMEOUT_MS = 8000

/** @returns {Promise<Array<{id: string, url: string, title: string, ws: string}>>} open pages. */
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

/** @returns {Promise<{running: boolean, pages: Array<{id: string, url: string, title: string}>}>} browser state. */
export async function status() {
  try {
    const open = await pages()
    return { running: true, pages: open.map(({ id, url, title }) => ({ id, url, title })) }
  } catch {
    return { running: false, pages: [] }
  }
}

/**
 * @param {string} [id] - target id, or the first page.
 * @returns {Promise<{id: string, url: string, title: string, data: string}|undefined>} one JPEG.
 */
export async function shot(id) {
  const open = await pages()
  const page = id === undefined ? open[0] : open.find((entry) => entry.id === id)
  if (page === undefined) return undefined
  const data = await capture(page.ws)
  return { id: page.id, url: page.url, title: page.title, data }
}

/** @param {string} ws - target debugger socket. @returns {Promise<string>} base64 JPEG. */
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
