/**
 * A shell in the panel, on the tenant's own machine.
 *
 * @module terminal-pane
 */

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

import { NS } from './constants.js'
import { Aside, FoldButton } from './file-view.js'
import { say, useT } from './i18n.js'
import { icon } from './icons.js'
import { h, React } from './runtime.js'
import { store, useStore } from './store.js'
/**
 * Every shell that is open, and the one on show.
 *
 * All of them stay mounted. A terminal is a live process at the far end of
 * a socket, and unmounting the one you are not looking at would end it —
 * so the others are hidden rather than taken down, and switching back
 * finds the same session with its scrollback where it was left.
 *
 * @returns {object} the element.
 */
export function TerminalPane() {
  const t = useT()
  const { terminals, activeTerminal } = useStore()

  // One shell to begin with: opening the terminal tab is a request for a
  // terminal, not for a list of none.
  React.useEffect(() => {
    if (terminals.length === 0) store.addTerminal()
  }, [terminals.length])

  // Built as named pieces rather than one nested call: the shells, the
  // list beside them, and the way to start another.
  const screens = terminals.map((entry) => h('div', {
    key: entry.id,
    className: `${NS}-console-slot`,
    // Hidden, not unmounted. See above.
    style: { display: entry.id === activeTerminal ? 'block' : 'none' },
  }, h(Console, null)))

  const rows = terminals.map((entry) => h('div', {
    key: entry.id,
    className: `${NS}-row`,
    role: 'option',
    tabIndex: 0,
    'aria-current': entry.id === activeTerminal ? 'true' : undefined,
    onClick: () => store.selectTerminal(entry.id),
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      store.selectTerminal(entry.id)
    },
  },
  // No twisty, and none reserved: nothing in this list opens.
  h('span', { className: `${NS}-row-icon` }, icon('terminal', 14)),
  h('span', { className: `${NS}-row-name` }, entry.name),
  h('span', { className: `${NS}-row-menu` },
    h('button', {
      type: 'button',
      className: `${NS}-row-action`,
      title: t('terminal.end'),
      'aria-label': t('terminal.end.of', { name: entry.name }),
      onClick: (event) => { event.stopPropagation(); store.closeTerminal(entry.id) },
    }, icon('close', 12)))))

  const showing = terminals.find((entry) => entry.id === activeTerminal)

  return h('div', { className: `${NS}-file` },
    // The same row the file pane has, holding the same kinds of thing:
    // where you are on the left, and what can be done about it on the
    // right. A terminal's "where" is which session is on screen.
    h('div', { className: `${NS}-crumbs` },
      h('div', { className: `${NS}-crumb-path` },
        h('span', { className: `${NS}-crumb-name` }, showing?.name ?? t('terminal'))),
      h('button', {
        type: 'button',
        className: `${NS}-icon-button`,
        title: t('terminal.new'),
        'aria-label': t('terminal.new'),
        onClick: () => { store.addTerminal() },
      }, icon('new', 15)),
      h(FoldButton, { kind: 'terminal', title: t('terminal.list') })),
    h('div', { className: `${NS}-split` },
      h('div', { className: `${NS}-split-main` }, screens),
      h(Aside, { kind: 'terminal', title: t('terminal.count', { n: String(terminals.length) }) },
        h('div', { className: `${NS}-scroll` }, rows))))
}

/**
 * A shell in the tenant's sandbox.
 *
 * The renderer is xterm, bundled into this package rather than taken from
 * the shell's module table, which does not carry it. What it is given is a
 * WebSocket that carries base64 in both directions: output as it arrives,
 * keystrokes as they are typed, and the terminal's measured size whenever
 * it changes.
 *
 * The socket IS the session. Leaving the tab kills the shell rather than
 * leaving one running that nothing can see — a terminal that outlives its
 * window is a process nobody can stop.
 *
 * @returns {object} the element.
 */
export function Console() {
  const t = useT()
  const host = React.useRef(null)
  const [state, setState] = React.useState({ status: 'opening' })

  React.useEffect(() => {
    const node = host.current
    if (node === null) return undefined

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      // Reads the theme rather than restating it, so the terminal is the
      // same dark or light the rest of the panel is.
      theme: (() => {
        const read = (name) => getComputedStyle(document.body).getPropertyValue(name).trim()
        return {
          background: read('--dsw-alias-bg-layer-1') || '#1b1b1c',
          foreground: read('--dsw-alias-label-primary') || '#e6e6e6',
          cursor: read('--dsw-alias-label-primary') || '#e6e6e6',
        }
      })(),
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(node)

    /**
     * Fit the terminal to its box, if the box has one yet.
     *
     * Guarded, and this is not defensive dressing: fitting a container
     * that has not been laid out divides by a zero cell count and throws.
     * The first version fitted straight after `open`, above the line that
     * opens the socket — so on the frame where the panel had just been
     * created, the terminal rendered and then never connected to
     * anything, with no error anywhere to say why.
     */
    const refit = () => {
      try {
        fit.fit()
        return true
      } catch {
        return false
      }
    }

    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sandbox/pty`)
    const send = (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }

    const encoder = new TextEncoder()
    const typed = term.onData((data) => {
      const bytes = encoder.encode(data)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      send({ type: 'in', data: btoa(binary) })
    })

    socket.addEventListener('open', () => {
      // Fitted once the browser has laid the panel out, not during the
      // effect that created it.
      requestAnimationFrame(() => {
        refit()
        send({ type: 'size', cols: term.cols, rows: term.rows })
      })
    })
    socket.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.type === 'out') {
        const binary = atob(message.data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        term.write(bytes)
        return
      }
      if (message.type === 'ready') { setState({ status: 'open' }); return }
      if (message.type === 'error') { setState({ status: 'failed', message: message.message }); return }
      if (message.type === 'exit') setState({ status: 'closed' })
    })
    socket.addEventListener('close', () => { setState((current) => (current.status === 'failed' ? current : { status: 'closed' })) })
    socket.addEventListener('error', () => { setState({ status: 'failed', message: say()('terminal.unreachable') }) })

    // The pty has to be told the size, or a full-screen program draws to
    // the wrong one. Observed rather than listened for on the window: the
    // panel is resized by dragging its edge, which the window never hears
    // about.
    // Next frame, not inside the callback. `refit` resizes the terminal,
    // which resizes the very node being observed, and a mutation made
    // during delivery is what produces the loop warning. A frame later the
    // observation cycle has finished and the resize is an ordinary one.
    let pending
    const observer = new ResizeObserver(() => {
      if (pending !== undefined) return
      pending = requestAnimationFrame(() => {
        pending = undefined
        if (!refit()) return
        send({ type: 'size', cols: term.cols, rows: term.rows })
      })
    })
    observer.observe(node)

    return () => {
      if (pending !== undefined) cancelAnimationFrame(pending)
      observer.disconnect()
      typed.dispose()
      socket.close()
      term.dispose()
    }
  }, [])

  return h('div', { className: `${NS}-console` },
    h('div', { className: `${NS}-console-screen`, ref: host }),
    state.status === 'open' || state.status === 'opening'
      ? null
      : h('div', { className: `${NS}-console-note` },
        state.status === 'failed' ? state.message : t('terminal.over')),
  )
}
