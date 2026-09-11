/**
 * A loading cover must yield to the desktop and to the controls that can get
 * it there. Looking only for a connection or an error leaves the retry button
 * hidden again when an error is dismissed, and hides noVNC's fatal startup
 * diagnostics forever. Run the shipped predicate over those page states.
 *
 * A standalone computer tab also keeps its name when noVNC updates the title,
 * including when the URL was typed by hand and has no title parameter.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname, '..')
const client = readFileSync(resolve(root, 'packages/dsh-computer/client.js'), 'utf8')
const bootstrap = readFileSync(resolve(root, 'sandbox/desktop/novnc-hamsterhq.js'), 'utf8')
const errors = []
const check = (name, test) => {
  try { test() } catch (error) { errors.push(`${name}: ${error.message}`) }
}

const start = client.indexOf('const desktopSettled =')
const end = client.indexOf('\n    }', start) + '\n    }'.length
const settled = runInNewContext(`${client.slice(start, end)}; desktopSettled`)
const element = (classes = '') => ({ classList: { contains: (name) => classes.split(' ').includes(name) } })
const page = ({ state = '', nodes = {}, url = 'https://example.test/computer/vnc.html', readyState = 'complete', novnc = true } = {}) => {
  const elements = { ...(novnc ? { noVNC_container: element() } : {}), ...nodes }
  return {
    URL: url,
    readyState,
    documentElement: element(state),
    getElementById: (id) => elements[id] ?? null,
    querySelector: (selector) => {
      for (const part of selector.split(',')) {
        const [id, ...classes] = part.trim().replace(/^#/, '').split('.')
        const node = elements[id]
        if (node && classes.every((name) => node.classList.contains(name))) return node
      }
      return null
    },
  }
}

for (const state of ['noVNC_loading', 'noVNC_connecting', 'noVNC_reconnecting']) {
  check(`${state} keeps the cover`, () => assert.equal(settled(page({ state })), false))
}
check('connected desktop is visible', () => assert.equal(settled(page({ state: 'noVNC_connected' })), true))
check('gateway error page is visible', () => assert.equal(settled(page({ novnc: false })), true))
check('initial blank document stays covered', () => assert.equal(settled(page({ url: 'about:blank', novnc: false })), false))
check('partially parsed document stays covered', () => assert.equal(settled(page({ readyState: 'loading', novnc: false })), false))
check('connection error is visible', () => assert.equal(settled(page({ nodes: { noVNC_status: element('noVNC_status_error noVNC_open') } })), true))
for (const id of ['noVNC_connect_dlg', 'noVNC_credentials_dlg', 'noVNC_fallback_error']) {
  check(`${id} is visible without an error status`, () => assert.equal(settled(page({ nodes: { [id]: element('noVNC_open') } })), true))
  check(`closed ${id} does not end the wait`, () => assert.equal(settled(page({ nodes: { [id]: element() } })), false))
}

check('a mounted frame follows cached load, reconnect, recovery and cleanup', () => {
  const listeners = new Map()
  const observers = []
  const iframe = {
    contentDocument: page({ state: 'noVNC_connected' }),
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  }
  let visible
  let cleanup
  let themeCleanup = false
  const frameStart = client.indexOf('function DesktopFrame(')
  const frameEnd = client.indexOf('function ComputerPanel(', frameStart)
  const render = runInNewContext(`${client.slice(frameStart, frameEnd)}; DesktopFrame`, {
    P: 'test',
    h: () => null,
    useT: () => (key) => key,
    desktopSettled: settled,
    paintNovncTheme: () => {},
    observeTheme: () => () => { themeCleanup = true },
    React: {
      useRef: () => ({ current: iframe }),
      useState: (initial) => { visible = initial; return [initial, (value) => { visible = value }] },
      useEffect: (callback) => { cleanup = callback() },
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = false; observers.push(this) }
      observe() { this.active = true }
      disconnect() { this.active = false }
    },
  })
  render({ className: 'test-frame', src: '/computer/vnc.html' })
  assert.equal(visible, true, 'an already-loaded cached frame must settle without another load event')
  const mutate = (doc) => {
    iframe.contentDocument = doc
    for (const observer of observers) if (observer.active) observer.callback()
  }
  mutate(page({ state: 'noVNC_reconnecting' }))
  assert.equal(visible, false, 'a dropped session must show the wait again')
  mutate(page({ nodes: { noVNC_connect_dlg: element('noVNC_open') } }))
  assert.equal(visible, true, 'retry controls must be reachable')
  mutate(page({ state: 'noVNC_connecting' }))
  assert.equal(visible, false, 'retrying must restore the wait')
  mutate(page({ state: 'noVNC_connected' }))
  assert.equal(visible, true)
  iframe.contentDocument = null
  listeners.get('load')()
  assert.equal(visible, true, 'an inaccessible redirect must not remain hidden')
  cleanup()
  assert.equal(listeners.size, 0)
  assert.equal(observers.some((observer) => observer.active), false)
  assert.equal(themeCleanup, true)
})

for (const title of ['Computer', '电脑', 'Computer & files']) {
  check(`standalone title remains ${title}`, () => {
    const callbacks = []
    const properties = new Map()
    const attributes = new Map()
    const titleNode = {}
    const events = new Map()
    const label = { textContent: 'Connecting to the computer…' }
    const connecting = title === 'Computer' ? '' : '正在连接电脑… <script>alert(1)</script>'
    const document = {
      title: 'Computer',
      documentElement: {
        style: { setProperty: (key, value) => properties.set(key, value) },
        setAttribute: (key, value) => attributes.set(key, value),
      },
      querySelector: () => titleNode,
      getElementById: (id) => id === 'hhq-loading-label' ? label : null,
      addEventListener: (event, callback) => events.set(event, callback),
    }
    const params = new URLSearchParams({ bg: '#112233', theme: 'dark' })
    if (title !== 'Computer') params.set('title', title)
    if (connecting) params.set('connecting', connecting)
    runInNewContext(bootstrap, {
      document,
      location: { search: `?${params}` },
      URLSearchParams,
      MutationObserver: class {
        constructor(callback) { callbacks.push(callback) }
        observe(node) { assert.equal(node, titleNode) }
      },
    })
    assert.equal(document.title, title)
    assert.equal(properties.get('--hamsterhq-novnc-bg'), '#112233')
    assert.equal(attributes.get('data-hhq-theme'), 'dark')
    events.get('readystatechange')()
    assert.equal(label.textContent, connecting || 'Connecting to the computer…')
    assert.equal(Object.hasOwn(label, 'innerHTML'), false, 'URL labels must render as text, not markup')
    assert.equal(callbacks.length, 1, 'title changes must be observed even without a URL title')
    document.title = 'Remote desktop - noVNC'
    callbacks[0]()
    assert.equal(document.title, title)
    document.title = 'noVNC'
    callbacks[0]()
    assert.equal(document.title, title)
  })
}

if (errors.length) {
  console.error('check-computer-loading: a cover must not hide recovery, and a computer tab must keep its name')
  for (const error of errors) console.error(`  ${error}`)
  process.exit(1)
}
console.log('check-computer-loading: connection waits yield to recovery and standalone titles survive reconnects')
