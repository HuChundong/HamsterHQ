/**
 * The right-hand panel, browser half.
 *
 * Four kinds of thing and nothing else: the workspace's files, a shell in the
 * sandbox, the page the agent is building, and the browser it is reading.
 * Computer (the KDE desktop) opens from the session header, not from this
 * panel's tool list — see `docs/artifact-panel.zh.md` for the product
 * judgement that bounds the list.
 *
 * Everything it shows comes from the sandbox over the gateway's panel routes:
 * `/sandbox/fs/*` to list and change, `/sandbox/raw/*` for bytes, a ticketed
 * `/sandbox/preview/*` for pages that must fetch their own assets, a WebSocket
 * for the terminal, and an event stream for what changed. Nothing here polls
 * for what the workspace can announce; the browser preview is the exception,
 * and `browser-pane.js` says why it earns it.
 *
 * Two structural choices, both forced:
 *
 * The panel does not live in a slot, and it does not live in the app's React
 * tree. The whole-panel seat is `details`, which `ui-layout` occupies, so a
 * plugin cannot take it — leaving a host element of our own on `document.body`
 * as the only place a full-height panel can go.
 *
 * That host gets its OWN React root rather than a portal out of a slot. The
 * portal was tried first and its rendering is fine; its events are not. React
 * 18 attaches its listeners to a root container, and a click inside a body-level
 * host bubbles `body` -> `html` -> `document` without ever passing through
 * `#root`, so nothing in the panel could be clicked — no error, no warning, a
 * button that simply does nothing. Making the host a root container of its own
 * puts the listeners where the clicks are. The cost is that the panel sits
 * outside the app's React context, which it can afford: everything it needs
 * from the theme arrives as CSS custom properties on `body`, not through
 * context.
 *
 * The panel pushes rather than floats: the conversation column narrows and
 * reflows instead of being covered. It is that column and not the whole app
 * that gives up the width, because the app frame decides whether to collapse
 * the tenant's sidebar by watching its own box — see the rule itself.
 *
 * Written against the module loader the shell installs: `require` here is the
 * shell's module table, which is where React and the app's own components come
 * from. `runtime.js` takes that table once and publishes what is in it, so the
 * rest of the package can be ordinary modules that import rather than one
 * closure holding everything the table gave it — which is what this file was,
 * at four thousand lines. The bundler turns them back into the single script
 * the shell loads.
 *
 * What is where:
 *
 * - `runtime.js`       the shell's table, published as bindings
 * - `constants.js`     the names and selectors the panel is addressed by
 * - `styles.js`        the stylesheet, one cascade
 * - `i18n.js`          the dictionary, and the ways a string is asked for
 * - `icons.js`         the glyphs, from the shell's set and from `dsh-icons`
 * - `api.js`           every call the panel makes to the gateway
 * - `store.js`         what is open, which session, and each session's tabs
 * - `tree-store.js`    the workspace tree, held once for the whole panel
 * - `watch.js`         the workspace's own changes, as they happen
 * - `kinds.js`         what kind of file a path is, and what that means
 * - `tabs.js`          tab arithmetic, tested by `check-panel-paths.mjs`
 * - `tab-bar.js`       the strip of tabs, and what stands in for an empty one
 * - `file-tree.js`     the tree's rows
 * - `tree-dialogs.js`  the row menu, and the dialog that takes a name
 * - `file-view.js`     a file on show: its body, its path, the panes beside it
 * - `terminal-pane.js` a shell in the panel
 * - `canvas.js`        the page the agent is building
 * - `browser-pane.js`  the sandbox's browser, watched through dsh-computer
 * - dsh-computer       the interactive desktop rendered into this panel's seat
 * - `tools.js`         the four things a tenant opens for themselves
 *
 * This file is what is left: the panel itself, the toggle in the app's header,
 * the pane that puts a tree beside a file, and the wiring that mounts them.
 */
import terminalCss from '@xterm/xterm/css/xterm.css'
import { basename, insideWorkspace } from './api.js'
import { BrowserPane, setBrowserPlane } from './browser-pane.js'
import { Canvas } from './canvas.js'
import {
  ANCHOR, COMPUTER_PANEL_ANCHOR, DEFAULT_WIDTH, DRAGGING, HEADER_HEIGHT_VAR,
  MAX_FRACTION, MIN_WIDTH, NS, WIDTH_VAR,
} from './constants.js'
import { FileTree } from './file-tree.js'
import { Aside, Crumbs, FileBody, FoldButton } from './file-view.js'
import { DICTIONARY, LOCALE_NS, say, setPlugin, useT } from './i18n.js'
import { icon, turn } from './icons.js'
import { iconFor, viewerFor } from './kinds.js'
import { installPathOpen } from './path-open.js'
import { boot, h, primitives, React, ReactDomClient } from './runtime.js'
import { EMPTY_GROUP, store, useStore } from './store.js'
import { CSS } from './styles.js'
import { EmptyState, Placeholder, TabBar } from './tab-bar.js'
import { TerminalPane } from './terminal-pane.js'
import { AskDialog, RowActions } from './tree-dialogs.js'
import { treeStore } from './tree-store.js'
import { workspaceWatch } from './watch.js'

window.__ModuleLoader__.load({
  id: 'dsh-artifact-panel',
  factory: (require) => {
    boot(require)

    // Required from the shell's module table so a file opened here uses the
    // same MarkdownText and CodeBlock the conversation already renders with,
    // down to the shiki grammars and the copy button. runtime.js reads them,
    // and answers with an empty table where the shell does not carry them —
    // this line only reports which of the two arrived.
    window.__panelBoot = { factory: true, markdown: primitives.MarkdownText !== undefined, code: primitives.CodeBlock !== undefined }
    console.info('[dsh-artifact-panel] markdown:', primitives.MarkdownText !== undefined, 'code:', primitives.CodeBlock !== undefined)


    /**
     * Clamp a width to what the window can spare.
     * @param {number} width - the requested width in px.
     * @returns {number} the width the panel will actually take.
     */
    const clampWidth = (width) => {
      const ceiling = Math.max(MIN_WIDTH, Math.round(window.innerWidth * MAX_FRACTION))
      return Math.min(ceiling, Math.max(MIN_WIDTH, Math.round(width)))
    }



    /**
     * Which viewer a file gets.
     *
     * An internal table, deliberately not a registry: a service other plugins
     * could register into is a public API to keep true forever, and adding a
     * type here is adding a line. The unknown case falls to text rather than
     * to a download, because an unrecognised file in a workspace is almost
     * always text and being shown it beats being asked to save it.
     *
     * @param {string} path - the file's path.
     * @returns {'image'|'html'|'text'} the viewer to use.
     */


    /**
     * The workspace pane: where you are, what you can do with it, and the file
     * beside the tree it was chosen from.
     *
     * One shape whether or not a file is open. The tree tab and a file tab are
     * the same component with and without a `path`, so opening the first file
     * fills the empty half rather than rearranging the pane — and the tree,
     * having never moved, is still where it was for the next choice.
     *
     * @param {object} props - the file if there is one, and what to do when another is chosen.
     * @returns {object} the element.
     */
    function WorkspacePane({ path, onOpen }) {
      const t = useT()
      const [source, setSource] = React.useState(false)
      const [copied, setCopied] = React.useState(undefined)
      // The file's own text, when it has one, so the row above it can offer to
      // copy the thing rather than only its address.
      const [text, setText] = React.useState(undefined)
      const markdown = path !== undefined && viewerFor(path) === 'markdown' && primitives.MarkdownText !== undefined

      React.useEffect(() => { setText(undefined) }, [path])

      /**
       * Put something on the clipboard and say so briefly.
       *
       * `writeText` is the only clipboard route a page has without a
       * permission prompt, and it can still be refused; saying nothing on
       * failure beats an error nobody can act on.
       */
      const copy = (what, value) => {
        navigator.clipboard?.writeText(value).then(
          () => { setCopied(what); window.setTimeout(() => setCopied(undefined), 1500) },
          () => {},
        )
      }

      // Switching to a tab opens the tree to that tab's file, so the tree
      // always shows where you are without being asked.
      // Only what the tree can hold. The tree is a workspace browser, so
      // revealing a path from outside it would walk it into directories it
      // does not list and cannot show — an error row for a file that opened
      // perfectly well.
      React.useEffect(() => {
        if (insideWorkspace(path)) treeStore.reveal(path)
      }, [path])

      return h('div', { className: `${NS}-file` },
        h('div', { className: `${NS}-crumbs` },
          h(Crumbs, { path, onReveal: (target) => treeStore.reveal(target, true) }),
          markdown ? h('div', { className: `${NS}-segments` },
            h('button', {
              type: 'button', className: `${NS}-segment`, 'aria-pressed': !source,
              onClick: () => setSource(false),
            }, t('preview')),
            h('button', {
              type: 'button', className: `${NS}-segment`, 'aria-pressed': source,
              onClick: () => setSource(true),
            }, t('source'))) : null,
          // Both actions live here, on the row that names the file — the view
          // below is the file, not a card with its own controls.
          text === undefined ? null : h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            title: t(copied === 'text' ? 'copied.text' : 'copy.text'),
            'aria-label': t('copy.text'),
            onClick: () => copy('text', text),
          }, icon('copy-text', 15)),
          h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            disabled: path === undefined,
            title: t(copied === 'path' ? 'copied.path' : 'copy.path'),
            'aria-label': t('copy.path'),
            onClick: () => copy('path', path),
          }, icon('copy', 15)),
          // Look again, by hand.
          //
          // It exists because the panel cannot always be told: envd will not
          // watch a network filesystem, which is what a tenant's workspace is
          // wherever it is a volume. There is a fallback on a timer, and this
          // is the same signal without the wait — for the moment after you
          // make a file and want to see it now.
          h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            title: t('refresh'),
            'aria-label': t('refresh'),
            onClick: (event) => { turn(event.currentTarget); workspaceWatch.refresh() },
            onAnimationEnd: (event) => { event.currentTarget.removeAttribute('data-turning') },
          }, icon('refresh', 15)),
          h(FoldButton, { kind: 'files', title: t('files.tree') })),
        h('div', { className: `${NS}-split` },
          h('div', { className: `${NS}-split-main` },
            path === undefined
              ? h('div', { className: `${NS}-placeholder` }, t('files.pick'))
              : h(FileBody, { key: `${path}:${String(source)}`, path, source, onText: setText })),
          h(Aside, { kind: 'files', title: t('files.aside') },
            h(FileTree, { onOpen, activePath: path }))),
      )
    }



    /**
     * The panel's toggle, as it appears in the session header.
     *
     * One home, in both states. The first version put it inside the panel when
     * open and floated it in the corner when closed, which meant the control
     * moved every time it was used — and in the corner it sat on top of the
     * header's own Session log button. Here it is a sibling of that button in
     * the header's utilities, so it has a fixed place and nothing to collide
     * with; the flex row that holds them both does the spacing.
     *
     * Mounting also tells the store a header exists, which is how the panel
     * knows to stop drawing the fallback in the corner, and publishes the
     * header's measured height so the panel's tab bar can match it. Both read
     * the app's own lifecycle rather than watching the DOM for it.
     * @returns {object} the element.
     */
    function Toggle() {
      const t = useT()
      const { open } = useStore()
      const ref = React.useRef(null)

      React.useEffect(() => {
        store.write({ header: true })
        const header = ref.current?.closest('header')
        const root = document.documentElement
        let observer
        if (header !== null && header !== undefined) {
          const publish = () => {
            const height = Math.round(header.getBoundingClientRect().height)
            // Zero is not a height, it is an absence: the app has switched to a
            // view that does not draw this header, and the element is still
            // there measuring nothing. Publishing it collapsed the panel's tab
            // bar to no height at all — the panel stayed open and kept showing
            // the file, while every control in that bar went off the screen,
            // including the only one that could close it.
            //
            // The last real height stands instead. A stale one is off by a few
            // pixels; a zero is a panel with no way out.
            if (height <= 0) return
            const next = `${height}px`
            if (root.style.getPropertyValue(HEADER_HEIGHT_VAR) === next) return
            root.style.setProperty(HEADER_HEIGHT_VAR, next)
          }
          publish()
          observer = new ResizeObserver(publish)
          observer.observe(header)
        }
        return () => {
          observer?.disconnect()
          root.style.removeProperty(HEADER_HEIGHT_VAR)
          store.write({ header: false })
        }
      }, [])

      // A wrapper that lays out as nothing, so the seat still has an element
      // to measure the header from once the button itself is gone. `display:
      // contents` keeps it out of the row's spacing entirely.
      return h('span', { ref, style: { display: 'contents' } },
        // Only while the panel is closed. Open, this control has moved: it is
        // the same button, drawn at the panel's own right edge, which is where
        // the hand already is once the panel is what you are looking at.
        open ? null : h('button', {
          type: 'button',
          className: `${NS}-toggle`,
          title: t('panel.reveal'),
          'aria-label': t('panel.reveal'),
          onClick: () => store.write({ open: true }),
        }, icon('panel')))
    }

    /**
     * Open the sandbox desktop from the session header.
     *
     * Not a TOOLS entry: Computer is a first-class surface beside Session log
     * and the panel toggle, not one more choice in the sidebar empty state.
     * Always drawn (open panel or not) so it does not disappear once the
     * panel is already showing something else.
     * @returns {object} the element.
     */
    function ComputerLaunch() {
      const t = useT()
      const state = useStore()
      const activeId = state.groups[state.session]?.activeId
      const showing = state.open && activeId === 'computer'
      return h('button', {
        type: 'button',
        className: `${NS}-computer-launch`,
        title: t('computer.launch'),
        'aria-label': t('computer.launch'),
        'aria-pressed': showing ? 'true' : 'false',
        onClick: () => {
          store.openTab({ id: 'computer', icon: 'computer' })
          store.write({ open: true })
        },
      }, icon('computer', 15))
    }

    /**
     * Turn the sidebar's footer row into a column, so a seat takes a line.
     *
     * The slot anchor is `display: contents`, so the element this returns is
     * not the box the shell lays out — only a walk up the live tree reaches
     * the flex row that still arranges seats horizontally. `dsh-scheduled-tasks`
     * carries the same walk for the same reason and the two cannot import each
     * other; `check-computer-layout.mjs` holds them equal. Doing it here rather
     * than relying on that plugin matters: it hides its own seat when the
     * gateway serves no schedules, and then nothing else would have columned
     * the row.
     *
     * @param {Element|null} mark - an element inside the seat, after mount.
     * @returns {() => void} restores what it changed.
     */
    const stackFooterColumn = (mark) => {
      if (mark === null) return () => {}
      let el = mark.parentElement
      while (el !== null) {
        const shown = window.getComputedStyle(el)
        if (shown.display === 'contents') {
          el = el.parentElement
          continue
        }
        if (shown.display === 'flex' || shown.display === 'inline-flex') {
          const previous = {
            flexDirection: el.style.flexDirection,
            alignItems: el.style.alignItems,
            width: el.style.width,
          }
          el.style.flexDirection = 'column'
          el.style.alignItems = 'stretch'
          el.style.width = '100%'
          return () => {
            el.style.flexDirection = previous.flexDirection
            el.style.alignItems = previous.alignItems
            el.style.width = previous.width
          }
        }
        el = el.parentElement
      }
      return () => {}
    }

    /**
     * Open the computer from the sidebar, with or without a session.
     *
     * `ComputerLaunch` sits in the session header, and the shell draws no
     * session header until there is a session — so on a new conversation the
     * only way to the desktop disappeared exactly when a tenant was most
     * likely to want a look at it. The sidebar's foot is drawn whatever the
     * conversation is doing, which is what "reachable at any time" needs.
     *
     * Not gated on the sandbox being up. Opening the tab is what starts one,
     * and a control that hides until the machine is warm is a control that is
     * missing the moment it is wanted.
     *
     * @param {{wide?: boolean}} props - false while the sidebar is collapsed.
     * @returns {object} the element.
     */
    function SidebarComputer({ wide }) {
      const t = useT()
      const stackRef = React.useRef(null)

      React.useLayoutEffect(() => stackFooterColumn(stackRef.current), [])

      return h('div', { 'data-dsh-footer-stack': '', ref: stackRef },
        h('button', {
          type: 'button',
          className: `${NS}-computer-open`,
          'data-wide': String(wide !== false),
          title: t('computer.launch'),
          'aria-label': t('computer.launch'),
          onClick: () => {
            store.openTab({ id: 'computer', icon: 'computer' })
            store.write({ open: true })
          },
        },
        h('span', { className: `${NS}-computer-open-icon` }, icon('computer', wide === false ? 18 : 16)),
        wide === false ? null : h('span', { className: `${NS}-computer-open-label` }, t('computer.launch'))))
    }

    /**
     * Layout-owned seat for dsh-computer's independent React root.
     * @param {{maximised: boolean}} props - panel mode forwarded as a DOM fact.
     * @returns {object} the empty seat.
     */
    function ComputerSeat({ maximised }) {
      return h('div', {
        [COMPUTER_PANEL_ANCHOR]: '',
        'data-maximised': String(maximised),
      })
    }

    /**
     * Catches a render failure and says what it was.
     *
     * Without this a thrown render unmounts the whole root, and the panel
     * becomes an empty element on the page: no error visible, nothing to click,
     * nothing in the interface that admits anything happened. A strip naming
     * the failure is worth more than a correct-looking blank.
     */
    class Boundary extends React.Component {
      /**
       * @param {object} props - children to render.
       */
      constructor(props) {
        super(props)
        this.state = { message: undefined }
      }

      /**
       * @param {Error} error - what was thrown.
       * @returns {{message: string}} the state that shows it.
       */
      static getDerivedStateFromError(error) {
        return { message: String(error?.message ?? error) }
      }

      /**
       * @param {Error} error - what was thrown.
       * @param {object} info - React's component stack.
       */
      componentDidCatch(error, info) {
        console.error('[dsh-artifact-panel] render failed:', error, info?.componentStack)
      }

      /** @returns {object} the children, or the failure. */
      render() {
        if (this.state.message === undefined) return this.props.children
        return h('div', { className: `${NS}-crash` },
          // `say()`, not the hook: this is a class component, where hooks are
          // not allowed — and it is the component that runs when everything
          // else has already thrown, so it must not be the thing that throws.
          h('strong', null, say()('crashed')),
          h('span', null, this.state.message))
      }
    }

    /**
     * The panel.
     *
     * Holds the whole of the panel's own state, which is small on purpose:
     * whether it is open, how wide, which tabs exist per session and which one
     * is showing. None of it is persisted — the panel opens at its default
     * width every reload. Where it would live is settled (the plugin's own
     * settings, read before the first mount with a timeout so a stalled
     * settings route cannot keep the panel from appearing); what is not
     * settled is whether a tab list is worth restoring at all, which is a
     * product question and not a plumbing one.
     * @returns {object} the element.
     */
    function Panel() {
      const t = useT()
      const state = useStore()
      const { open, header } = state
      const { tabs, activeId } = state.groups[state.session] ?? EMPTY_GROUP
      const [width, setWidth] = React.useState(DEFAULT_WIDTH)
      // Maximised is a mode, not a width: the width it implies depends on the
      // window and on how wide the tenant has dragged their own sidebar, both
      // of which change under it. Storing the mode and deriving the width each
      // time is what keeps it right after a resize.
      const [maximised, setMaximised] = React.useState(false)

      /**
       * Everything the frame has except the tenant's own sidebar.
       *
       * Measured rather than assumed: the sidebar is draggable between 280 and
       * 420, and it collapses to a 56px rail. Reading the columns is the only
       * answer that stays true through all of that.
       *
       * @returns {number|undefined} the width to take, or undefined when the frame is not there.
       */
      const roomBesideSidebar = React.useCallback(() => {
        const frame = document.querySelector('#root > [data-slot="root"] > div')
        const rail = frame?.children[0]
        if (frame === null || frame === undefined || rail === undefined) return undefined
        return Math.round(frame.getBoundingClientRect().width - rail.getBoundingClientRect().width)
      }, [])

      // Hand the width to the layout. Written on the document element rather
      // than passed down, because the element that gives up the space is
      // `#root` — the app's, not ours.
      React.useEffect(() => {
        const root = document.documentElement
        const apply = () => {
          const taken = maximised ? (roomBesideSidebar() ?? width) : width
          const next = open ? `${String(taken)}px` : '0px'
          // Only when it actually changed. This value is written INTO the box
          // the observer below is watching — it sets the margin that gives the
          // conversation its width — so writing it unconditionally means every
          // notification produces another one. The browser calls that
          // "ResizeObserver loop completed with undelivered notifications",
          // and the second pass is always computing the number it already has.
          if (root.style.getPropertyValue(WIDTH_VAR) === next) return
          root.style.setProperty(WIDTH_VAR, next)
        }
        apply()
        // While maximised the width is the window's, so it has to be recomputed
        // when the window changes — and when the tenant drags their sidebar,
        // which the frame's own resize reports too.
        if (!open || !maximised) return () => { root.style.removeProperty(WIDTH_VAR) }
        const frame = document.querySelector('#root > [data-slot="root"] > div')
        const observer = frame === null ? undefined : new ResizeObserver(apply)
        if (frame !== null) observer?.observe(frame)
        return () => {
          observer?.disconnect()
          root.style.removeProperty(WIDTH_VAR)
        }
      }, [open, width, maximised, roomBesideSidebar])

      // A window narrow enough to violate the ceiling re-clamps the panel
      // rather than letting it eat the conversation.
      React.useEffect(() => {
        const onResize = () => { setWidth((current) => clampWidth(current)) }
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('resize', onResize) }
      }, [])

      /**
       * Open a tab, or focus the one already showing that thing.
       *
       * Deduplicated by id, which for a produced file will be its path: the
       * same file produced in five turns is one tab, not five.
       */
      const openTab = React.useCallback((tab) => {
        store.openTab(tab)
        store.write({ open: true })
      }, [])

      /** Opening a file from the tree, wherever the tree is being shown. */
      const openFile = React.useCallback((entry) => {
        openTab({ id: entry.path, label: entry.name, path: entry.path, icon: iconFor(entry.path) })
      }, [openTab])

      const closeTab = React.useCallback((id) => { store.closeTab(id) }, [])

      // The drag. Pointer capture rather than window listeners, so a pointer
      // that leaves the window mid-drag still delivers its move and release;
      // the body attribute suspends the layout transition so the frame tracks
      // the pointer instead of chasing it.
      const onGripDown = React.useCallback((event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = width
        const target = event.currentTarget
        target.setPointerCapture(event.pointerId)
        document.body.setAttribute(DRAGGING, '')
        const onMove = (move) => { setWidth(clampWidth(startWidth + (startX - move.clientX))) }
        const onUp = () => {
          document.body.removeAttribute(DRAGGING)
          target.removeEventListener('pointermove', onMove)
          target.removeEventListener('pointerup', onUp)
          target.removeEventListener('pointercancel', onUp)
        }
        target.addEventListener('pointermove', onMove)
        target.addEventListener('pointerup', onUp)
        target.addEventListener('pointercancel', onUp)
      }, [width])

      // The toggle's home is the session header. Before a session exists there
      // is no header to live in, so the corner — empty in that state — stands
      // in. Rendered only then, which keeps it off the header's own controls
      // once a session opens.
      //
      // It toggles rather than only opens, and it is drawn in BOTH states. The
      // first version rendered it only while the panel was closed, which on the
      // no-session screen left an open panel with nothing anywhere that could
      // close it.
      const corner = header || open ? null : h('button', {
        type: 'button',
        className: `${NS}-opener`,
        title: t('panel.reveal'),
        'aria-label': t('panel.reveal'),
        onClick: () => store.write({ open: true }),
      }, icon('panel'))

      if (!open) return corner

      const active = tabs.find((tab) => tab.id === activeId)
      return h(React.Fragment, null, corner,
        h('div', {
          className: `${NS}-panel`,
          // Reads the variable rather than the state, so the maximised width —
          // which is derived from the frame — and the pushed-aside column are
          // never two different numbers.
          style: { width: `var(${WIDTH_VAR}, ${String(width)}px)` },
        },
        maximised ? null : h('div', { className: `${NS}-grip`, onPointerDown: onGripDown }),
        h(TabBar, {
          tabs,
          activeId,
          onSelect: (id) => store.select(id),
          onClose: closeTab,
          onNew: () => store.select(undefined),
          onOpen: (tool) => openTab({ id: tool.id, icon: tool.icon }),
          onCollapse: () => store.write({ open: false }),
          onMaximise: () => setMaximised((current) => !current),
          maximised,
        }),
        h('div', { className: `${NS}-body` },
          active === undefined
            ? h(EmptyState, { open: tabs, onOpen: (tool) => openTab({ id: tool.id, icon: tool.icon }) })
            // A tab is either one of the tools or one file. The file's path is
            // its id, which is what makes opening the same file twice open one
            // tab.
            : active.path !== undefined || active.id === 'files'
              ? h(WorkspacePane, { key: active.id, path: active.path, onOpen: openFile })
              : active.id === 'canvas'
                ? h(Canvas, null)
                : active.id === 'terminal'
                  ? h(TerminalPane, null)
                  : active.id === 'computer'
                    ? h(ComputerSeat, { maximised })
                    : active.id === 'browser'
                    ? h(BrowserPane, null)
                    : h(Placeholder, { tab: active })),
        h(RowActions, null),
        h(AskDialog, null),
      ))
    }

    return {
      // `connection` is the RPC channel registry, which the browser-preview
      // pane calls `/browser` through; everything else here goes through the
      // gateway's own panel routes and needs no service for it.
      inject: ['slots', 'sessions', 'locale', 'connection', 'remote', 'remote.session'],

      /**
       * Mount the browser half.
       * @param {object} ctx - the client context, carrying the slot registry.
       */
      apply(ctx) {
        setPlugin(ctx)
        setBrowserPlane(ctx.connection)

        // Before any seat renders, or a seat renders its keys.
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, DICTIONARY),
          'artifact-panel: dictionaries',
        )

        // The styles go in once, beside the panel rather than inside it, so
        // the rule that pushes `#root` survives the panel being closed.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-artifact-panel-style', '')
          // xterm's own rules first: they position the canvas layers and the
          // cursor, and nothing here should have to restate them.
          style.textContent = `${terminalCss}\n${CSS}`
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'artifact-panel: styles')

        // The panel's own root, created and torn down with this effect so a
        // disposal leaves neither a live root nor an orphaned host behind for
        // the next mount to find.
        ctx.effect(() => {
          const host = document.createElement('div')
          host.setAttribute(ANCHOR, '')
          document.body.appendChild(host)
          const root = ReactDomClient.createRoot(host)
          window.__panelBoot.rootMade = true
          try {
            root.render(h(Boundary, null, h(Panel)))
            window.__panelBoot.rendered = true
          } catch (error) {
            window.__panelBoot.renderThrew = String(error && error.message)
            throw error
          }
          return () => {
            // Asynchronously, because unmounting a root from inside a React
            // render or commit is what React refuses; the effect can run in
            // either.
            setTimeout(() => {
              root.unmount()
              host.remove()
            }, 0)
          }
        }, 'artifact-panel: mount the panel')

        // Follow the app's current session, so tabs opened while reading one
        // conversation are the tabs that come back when it is read again.
        ctx.effect(() => {
          const feed = ctx.sessions.list
          const follow = () => { store.setSession(feed.getSnapshot().current) }
          follow()
          return feed.subscribe(follow)
        }, 'artifact-panel: follow the current session')

        // Take over opening a file.
        //
        // `ctx.remote.session.openWorkspacePath` is the one door every file
        // open in the conversation goes through — a path link in a tool row,
        // the produced files at the end of a turn, a file mentioned in prose.
        // ui-chat resolves each against the session cwd before calling it. The
        // default hands the path to the host operating system, which in a
        // remote sandbox means running xdg-open on a machine nobody sits at.
        // Wrapping the one Remote method reroutes all three sources at once.
        ctx.effect(() => installPathOpen(ctx.remote.session, (path) => {
          // Every absolute path, not only the ones under the workspace. The
          // gateway serves any path in the tenant's sandbox; only the tree is
          // workspace-scoped, so an outside path opens without being revealed.
          store.openTab({ id: path, label: basename(path), path, icon: iconFor(path) })
          store.write({ open: true })
        }), 'artifact-panel: open files in the panel')

        // Session log (harness) → Computer → panel toggle. Computer is not a
        // TOOLS entry: higher priority than the sidebar empty-state choices,
        // and always reachable from the header. order 5 sits between Session
        // log (earlier) and the toggle (10).
        ctx.effect(
          () => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'artifact-panel-computer', order: 5 },
            ComputerLaunch,
          )),
          'artifact-panel: Computer in the session header',
        )

        // The same destination from the sidebar's foot, which is drawn whether
        // or not a session exists. `sidebar.footer.action` is a list slot:
        // dsh-sandbox-host holds 100 with the sandbox row and dsh-scheduled-tasks
        // 50, and a lower number is earlier — the Computer sits above both.
        ctx.effect(
          () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'artifact-panel-computer', order: 40 },
            SidebarComputer,
          )),
          'artifact-panel: Computer in the sidebar foot',
        )
        ctx.effect(
          () => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'artifact-panel-toggle', order: 10 },
            Toggle,
          )),
          'artifact-panel: the toggle in the session header',
        )
      },
    }
  },
})
