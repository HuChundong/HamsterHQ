/**
 * The canvas: whatever page the agent wrote last, shown as it is written.
 *
 * @module canvas
 */

import { basename, mintTicket, newestPage, previewUrl } from './api.js'
import { NS } from './constants.js'
import { useT } from './i18n.js'
import { icon, turn } from './icons.js'
import { h, React } from './runtime.js'
import { workspaceWatch } from './watch.js'
/**
 * The canvas: the page the agent is making, as it is being made.
 *
 * Not a browser. A browser would mean reverse-proxying whatever server the
 * agent started — a wildcard certificate, absolute-path rewriting,
 * WebSocket forwarding, an egress boundary — all of it in service of a dev
 * server. What a canvas shows is a file, which this panel can already
 * serve, so the whole of that machinery is not built rather than built
 * carefully.
 *
 * It FOLLOWS: the workspace says when something changed, and if what
 * changed was a page the canvas looks again. That is a deliberate
 * exception to the rule that nothing here moves without a click, and it is
 * bounded to this tab — opening the canvas is the tenant saying "show me
 * what you are making". It still never opens the panel by itself, and
 * never touches another tab.
 *
 * It used to ask every two seconds instead. The events cost nothing when
 * nothing happens, and arrive at once when something does.
 *
 * @returns {object} the element.
 */
export function Canvas() {
  const t = useT()
  const [page, setPage] = React.useState({ status: 'loading' })
  const [ticket, setTicket] = React.useState(undefined)

  const look = React.useCallback(async () => {
    try {
      const found = await newestPage()
      setPage(found === undefined ? { status: 'empty' } : { status: 'ready', ...found })
    } catch (error) {
      setPage({ status: 'failed', message: error.message })
    }
  }, [])

  React.useEffect(() => { void look() }, [look])

  // Only a page is worth looking again for: the agent writing a Python file
  // does not change what is on this canvas.
  React.useEffect(() => workspaceWatch.subscribe((change) => {
    if (change.stale === true || /\.html?$/i.test(change.path)) void look()
  }), [look])

  // One ticket for the tab, not one per reload: it outlives several
  // rewrites of the page it is showing.
  React.useEffect(() => {
    let live = true
    mintTicket().then(
      (value) => { if (live) setTicket(value) },
      () => { if (live) setTicket(undefined) },
    )
    return () => { live = false }
  }, [])

  if (page.status === 'loading') return h('div', { className: `${NS}-placeholder` }, t('canvas.looking'))
  if (page.status === 'failed') return h('div', { className: `${NS}-placeholder` }, page.message)
  if (page.status === 'empty') {
    return h('div', { className: `${NS}-placeholder` },
      h('div', null, t('canvas.none')),
      h('div', null, t('canvas.none.note')))
  }
  if (ticket === undefined) return h('div', { className: `${NS}-placeholder` }, t('preview.preparing'))

  return h('div', { className: `${NS}-file` },
    h('div', { className: `${NS}-crumbs` },
      h('div', { className: `${NS}-crumb-path`, title: page.path },
        h('span', { className: `${NS}-crumb-name` }, page.path)),
      h('button', {
        type: 'button',
        className: `${NS}-icon-button`,
        title: t('reload'),
        'aria-label': t('reload'),
        // Bumping the modified stamp remounts the frame below, which is a
        // fresh fetch: the route answers `no-store`.
        onClick: (event) => {
          turn(event.currentTarget)
          setPage((current) => ({ ...current, modified: Date.now() / 1000 }))
        },
        onAnimationEnd: (event) => { event.currentTarget.removeAttribute('data-turning') },
      }, icon('refresh', 15))),
    // Keyed by path AND by write time, so a rewritten page is a new frame
    // rather than a stale one. The URL itself stays clean, which is what
    // keeps the page's own relative assets resolving.
    h('iframe', {
      key: `${page.path}:${String(page.modified)}`,
      className: `${NS}-frame`,
      src: previewUrl(ticket, page.path),
      sandbox: 'allow-scripts allow-popups allow-downloads allow-modals',
      title: basename(page.path),
    }),
  )
}
