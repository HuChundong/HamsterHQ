/**
 * The sandbox desktop, interactive through noVNC.
 *
 * Desktop images run KDE Plasma X11 behind TigerVNC; the gateway exposes noVNC under
 * `/computer/` (session-authenticated, tunnelled to loopback :6080). This pane
 * embeds that page — clicks and keys reach the sandbox — unlike the watch-only
 * Browser tab that polls CDP JPEGs on light sandboxes.
 *
 * noVNC's own page is a stock grey letterbox (`#313131`). It does not see the
 * shell's theme tokens. The iframe is same-origin, so this module paints the
 * letterbox from `--dsw-alias-bg-layer-1` and repaints when the shell flips
 * `data-ds-dark-theme` — the same approach the terminal pane takes for xterm.
 * The RFB session is not reloaded on a theme flip; only the letterbox is.
 *
 * @module computer-pane
 */

import { NS } from './constants.js'
import { useT } from './i18n.js'
import { h, React } from './runtime.js'

/** Cache-bust for the hide-chrome + theme cuts on vnc.html. */
const VNC_REV = '3'

/**
 * The shell's panel ground — what the letterbox around the desktop should be.
 * @returns {string} a CSS colour.
 */
const readPanelBg = () => {
  const value = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1').trim()
  return value || '#1b1b1c'
}

/**
 * noVNC URL for the current theme. `bg` lets a new-window open match without
 * an opener (noopener); the iframe path also gets a live paint below.
 * @returns {string} the path + query.
 */
const computerSrc = () => {
  const bg = encodeURIComponent(readPanelBg())
  const theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
  return `/computer/vnc.html?autoconnect=true&resize=scale&reconnect=true&path=computer/websockify&v=${VNC_REV}&theme=${theme}&bg=${bg}`
}

/**
 * Paint noVNC's letterbox to match the shell. Idempotent.
 * @param {Document | null | undefined} doc - the iframe (or popup) document.
 */
const paintNovncTheme = (doc) => {
  if (doc === null || doc === undefined || doc.head === null) return
  const bg = readPanelBg()
  doc.documentElement.style.setProperty('--hamsterhq-novnc-bg', bg)
  let style = doc.getElementById('hhq-novnc-theme')
  if (style === null) {
    style = doc.createElement('style')
    style.id = 'hhq-novnc-theme'
    doc.head.appendChild(style)
  }
  // Stock noVNC sets #noVNC_container to #313131 and a decorative radius.
  style.textContent = `
    html, body, #noVNC_container {
      background-color: ${bg} !important;
      background-image: none !important;
    }
    #noVNC_container {
      border-radius: 0 !important;
    }
  `
}

/**
 * Interactive desktop: an iframe onto the gateway's `/computer/` plane.
 * @returns {object} the element.
 */
export function ComputerPane() {
  const t = useT()
  const frame = React.useRef(null)
  // Iframe src is fixed for the life of this mount so a theme flip does not
  // tear down the RFB session. The "open in new window" href tracks theme.
  const [frameSrc] = React.useState(computerSrc)
  const [href, setHref] = React.useState(computerSrc)

  React.useEffect(() => {
    const iframe = frame.current
    if (iframe === null) return undefined

    const paint = () => {
      setHref(computerSrc())
      try {
        paintNovncTheme(iframe.contentDocument)
      } catch {
        // Document not ready yet.
      }
    }

    iframe.addEventListener('load', paint)
    paint()

    const observer = new MutationObserver(paint)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme', 'class', 'style'],
    })
    return () => {
      iframe.removeEventListener('load', paint)
      observer.disconnect()
    }
  }, [])

  return h('div', { className: `${NS}-computer` },
    h('div', { className: `${NS}-computer-bar` },
      h('span', { className: `${NS}-crumb-name` }, t('tool.computer')),
      h('a', {
        className: `${NS}-computer-open`,
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, t('computer.open'))),
    h('iframe', {
      ref: frame,
      className: `${NS}-computer-frame`,
      title: t('tool.computer'),
      src: frameSrc,
      allow: 'clipboard-read; clipboard-write',
    }))
}
