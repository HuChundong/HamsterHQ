/**
 * The sandbox's browser, watched from the panel.
 *
 * The agent drives a headless Chromium inside the sandbox; nothing about
 * that is visible from the conversation but the commands succeeding. This
 * pane is the screen it does not have: about once a second it asks the
 * sandbox for a JPEG of the page and shows it, so a tenant can watch the
 * agent browse the way they watch it write files.
 *
 * Polling, not a stream, and the pane is the reason it is cheap: frames are
 * asked for only while this component is mounted and the document visible.
 * A closed tab costs nothing; a hidden window costs nothing. The channel it
 * asks on is `/browser`, registered by `dsh-sandbox-host` — the plugin that
 * supplies what a remote machine cannot show — and reached the same way its
 * `/files` plane is.
 *
 * The view is read-only on purpose. The CDP port could carry clicks and
 * keystrokes, but a person and an agent sharing one browser's hands is a
 * fight, not a feature; a tenant who wants the page has its URL right here.
 *
 * @module browser-pane
 */

import { NS } from './constants.js'
import { Aside, FoldButton } from './file-view.js'
import { useT } from './i18n.js'
import { icon, turn } from './icons.js'
import { h, React } from './runtime.js'

/** The channel the host half registers; see dsh-sandbox-host/browser.js. */
const CHANNEL = '/browser'

/** How often the list of pages is refreshed. */
const STATUS_EVERY_MS = 3000

/** The pause between one frame arriving and the next being asked for. */
const FRAME_EVERY_MS = 1000

/** The connection service, captured at mount like the locale is. */
let connection

/**
 * Remember the applied context's connection, which is what calls ride.
 * @param {object} value - the shell's connection service.
 */
export function setBrowserPlane(value) {
  connection = value
}

/**
 * One call on the browser channel.
 *
 * Always with a payload, even an empty one: the tunnel's envelope declares
 * the field required, so a call that omitted it was refused at validation
 * and the pane sat on "loading" forever — found by watching the wire, not
 * the code.
 *
 * @param {string} endpoint - `status` or `shot`.
 * @param {object} [payload] - what the endpoint takes.
 * @returns {Promise<object>} the value, unwrapped.
 */
const call = async (endpoint, payload) => {
  const result = await connection.rpc.call(CHANNEL, endpoint, payload ?? {})
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

/**
 * The pane: the current frame, and the open pages beside it.
 * @returns {object} the element.
 */
export function BrowserPane() {
  const t = useT()
  const [state, setState] = React.useState({ asked: false, running: false, pages: [] })
  const [chosen, setChosen] = React.useState(undefined)
  const [frame, setFrame] = React.useState(undefined)
  // Bumped by the refresh control; a dependency of the frame loop, so
  // bumping it starts a fresh loop whose first frame is immediate.
  const [nonce, setNonce] = React.useState(0)

  // Which page is on show: the chosen one while it is still open, the first
  // one otherwise. Derived rather than stored, so a page the agent closes
  // falls back to whatever is still there without an effect to notice it.
  const page = state.pages.find((entry) => entry.id === chosen) ?? state.pages[0]

  // The page list, on a slow clock. It is the cheap question — no image
  // crosses — and it is what flips the pane between its three states.
  React.useEffect(() => {
    let live = true
    let timer
    const look = async () => {
      try {
        const answer = await call('status')
        if (live) setState({ asked: true, running: answer.running, pages: answer.pages })
      } catch {
        // An unanswered status says the sandbox is unreachable, which the
        // frame loop will also notice; the pane keeps its last knowledge.
      }
      if (live) timer = setTimeout(look, STATUS_EVERY_MS)
    }
    void look()
    return () => { live = false; clearTimeout(timer) }
  }, [])

  // The frames, asked for one at a time: the next is scheduled only once
  // this one has arrived, so a slow link gets fewer frames rather than a
  // queue of stale ones. Hidden documents skip the ask but keep the clock.
  const pageId = page?.id
  React.useEffect(() => {
    if (pageId === undefined) { setFrame(undefined); return undefined }
    let live = true
    let timer
    const tick = async () => {
      if (!live) return
      if (document.visibilityState === 'hidden') { timer = setTimeout(tick, FRAME_EVERY_MS); return }
      try {
        const taken = await call('shot', { id: pageId })
        if (live) setFrame(taken)
      } catch {
        // A missed frame is not a state: the page may be navigating, the
        // status loop owns "gone". The last frame stands until the next.
      }
      if (live) timer = setTimeout(tick, FRAME_EVERY_MS)
    }
    void tick()
    return () => { live = false; clearTimeout(timer) }
  }, [pageId, nonce])

  const rows = state.pages.map((entry) => h('div', {
    key: entry.id,
    className: `${NS}-row`,
    role: 'option',
    tabIndex: 0,
    'aria-current': entry.id === page?.id ? 'true' : undefined,
    title: entry.url,
    onClick: () => setChosen(entry.id),
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      setChosen(entry.id)
    },
  },
  h('span', { className: `${NS}-row-icon` }, icon('window', 14)),
  h('span', { className: `${NS}-row-name` }, entry.title || entry.url)))

  /** What the main half shows when there is no frame to show. */
  const empty = () => {
    if (!state.asked) return h('div', { className: `${NS}-placeholder` }, t('loading'))
    if (!state.running) {
      return h('div', { className: `${NS}-placeholder` },
        h('div', null, t('browser.off')),
        h('div', null, t('browser.off.note')))
    }
    return h('div', { className: `${NS}-placeholder` },
      h('div', null, t('browser.none')),
      h('div', null, t('browser.none.note')))
  }

  // The crumbs name what is being looked at, which for a page is its title
  // with the address underneath the pointer. The frame's own words, not the
  // list's: they were read at the same moment as the pixels below them.
  const showing = frame ?? page
  return h('div', { className: `${NS}-file` },
    h('div', { className: `${NS}-crumbs` },
      h('div', { className: `${NS}-crumb-path`, title: showing?.url },
        h('span', { className: `${NS}-crumb-name` }, showing?.title || showing?.url || t('tool.browser'))),
      h('button', {
        type: 'button',
        className: `${NS}-icon-button`,
        title: t('refresh'),
        'aria-label': t('refresh'),
        onClick: (event) => { turn(event.currentTarget); setNonce((n) => n + 1) },
        onAnimationEnd: (event) => { event.currentTarget.removeAttribute('data-turning') },
      }, icon('refresh', 15)),
      h(FoldButton, { kind: 'browser', title: t('browser.list') })),
    h('div', { className: `${NS}-split` },
      h('div', { className: `${NS}-split-main` },
        page === undefined || frame === undefined
          ? empty()
          : h('div', { className: `${NS}-shot-box` },
            h('img', {
              className: `${NS}-shot`,
              src: `data:image/jpeg;base64,${frame.data}`,
              alt: frame.title || frame.url,
            }))),
      h(Aside, { kind: 'browser', title: t('browser.count', { n: String(state.pages.length) }) },
        h('div', { className: `${NS}-scroll` }, rows))))
}
