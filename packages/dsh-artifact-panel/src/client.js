/**
 * Workspace tools contributed to DSH's docking surface. The harness owns
 * geometry, tabs, navigation and session lifetimes; this plugin owns the
 * enhanced file tree, terminal, live canvas and browser observation.
 */
import terminalCss from '@xterm/xterm/css/xterm.css'
import { fileAddressFor, parseFileAddress, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { basename, insideWorkspace } from './api.js'
import { BrowserPane, setBrowserPlane } from './browser-pane.js'
import { Canvas } from './canvas.js'
import { NS, ROOT } from './constants.js'
import { FileTree } from './file-tree.js'
import { fileWorkspace } from './file-workspace.js'
import { Aside, FileActions, FileBody, FileCrumbs, FoldButton } from './file-view.js'
import { iconFor } from './kinds.js'
import { treeStore } from './tree-store.js'
import { DICTIONARY, LOCALE_NS, say, setPlugin, useT } from './i18n.js'
import { icon } from './icons.js'
import { boot, h, React } from './runtime.js'
import { CSS } from './styles.js'
import { disposeTerminalPane, TerminalPane } from './terminal-pane.js'
import { AskDialog, RowActions } from './tree-dialogs.js'
import { workspaceWatch } from './watch.js'

window.__ModuleLoader__.load({
  id: 'dsh-artifact-panel',
  factory: (require) => {
    boot(require)

    /** Errors in one tool must not unmount the surrounding conversation. */
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { message: undefined } }
      static getDerivedStateFromError(error) { return { message: String(error?.message ?? error) } }
      render() {
        if (this.state.message === undefined) return this.props.children
        return h('div', { className: `${NS}-crash` },
          h('strong', null, say()('crashed')), h('span', null, this.state.message))
      }
    }

    /** One owned file surface: gateway-backed preview beside the workspace tree. */
    function Files({ useTabInfo, sessionId, useSessions }) {
      const t = useT()
      const { tab } = useTabInfo()
      const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd)
      const parsed = parseFileAddress(tab.contentId)
      const path = parsed === undefined ? undefined : resolveWorkspacePath(cwd, parsed.path)
      const [source, setSource] = React.useState(false)
      React.useEffect(() => {
        if (path !== undefined && tab.visible && insideWorkspace(path)) treeStore.reveal(path)
      }, [path, tab.visible])
      const onOpen = (entry) => tab.actions.openResource(fileAddressFor(sessionId, cwd, entry.path))
      return h('div', { className: `${NS}-file`, 'data-workspace-files': '', 'data-workspace-file': path },
        h('div', { className: `${NS}-crumbs` },
          h(FileCrumbs, { path: path ?? ROOT }),
          path?.match(/\.(md|markdown)$/i) ? h('div', { className: `${NS}-segments` },
            h('button', { type: 'button', className: `${NS}-segment`, 'aria-pressed': !source, onClick: () => setSource(false) }, t('preview')),
            h('button', { type: 'button', className: `${NS}-segment`, 'aria-pressed': source, onClick: () => setSource(true) }, t('source'))) : null,
          path ? h(FileActions, { path }) : null,
          h('button', { type: 'button', className: `${NS}-icon-button`,
            title: t('refresh'), 'aria-label': t('refresh'), onClick: () => workspaceWatch.refresh() }, icon('refresh', 15)),
          h(FoldButton, { kind: 'files', title: t('files.tree') })),
        h('div', { className: `${NS}-split` },
          h('div', { className: `${NS}-split-main`, 'data-workspace-preview': '' },
            path === undefined ? h('div', { className: `${NS}-placeholder` }, t('files.pick'))
              : h(FileBody, { key: path, path, source })),
          h(Aside, { kind: 'files', title: t('files.aside') }, h(FileTree, { onOpen, activePath: path }))))
    }

    function FileTitle({ useTabInfo, sessionId, useSessions }) {
      React.useEffect(() => fileWorkspace.observe(), [])
      const { tab } = useTabInfo()
      const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd)
      const parsed = parseFileAddress(tab.contentId)
      const path = parsed === undefined ? undefined : resolveWorkspacePath(cwd, parsed.path)
      React.useEffect(() => { if (path !== undefined) fileWorkspace.track(tab, path) }, [tab, path])
      return h(React.Fragment, null, icon(iconFor(path ?? tab.title), 16), tab.title)
    }

    function FileMenu({ tab, dismiss, sessionId, useSessions, sidebarRight }) {
      const t = useT()
      const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd)
      const parsed = parseFileAddress(tab.contentId)
      const path = parsed === undefined ? undefined : resolveWorkspacePath(cwd, parsed.path)
      if (path === undefined) return null
      return h('div', { className: `${NS}-file-menu` },
        insideWorkspace(path) ? h('button', { type: 'button', role: 'menuitem', className: `${NS}-menu-item`,
          onClick: () => { treeStore.reveal(path); sidebarRight.openResource(tab.contentId); dismiss() },
        }, t('file.reveal')) : null,
        h(FileActions, { path, menu: true, dismiss }))
    }

    return {
      inject: ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        setPlugin(ctx)
        setBrowserPlane(ctx.connection)
        ctx.effect(() => () => disposeTerminalPane(), 'artifact-panel: terminal lifetime')
        ctx.effect(() => () => fileWorkspace.clear(), 'artifact-panel: file lifetime cleanup')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title', key: 'dsh-artifact-panel/file',
        }, FileTitle)), 'artifact-panel: file lifetime')
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.menu.item', () => ctx.slots.register({
          name: 'sidebar.right.tab.menu.item', id: 'artifact-panel-file-actions',
        }, (props) => h(FileMenu, { ...props, sidebarRight: ctx.sidebarRight }))), 'artifact-panel: file actions')
        ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTIONARY), 'artifact-panel: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-artifact-panel-style', '')
          style.textContent = `${terminalCss}\n${CSS}`
          document.head.appendChild(style)
          return () => style.remove()
        }, 'artifact-panel: content styles')

        // One dialog host across every files tab, including floating panes.
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'artifact-panel-dialogs' },
          () => h(React.Fragment, null, h(RowActions), h(AskDialog)),
        )), 'artifact-panel: file dialogs')

        const register = (kind, label, Body, extra = {}) => {
          const id = `dsh-artifact-panel/${kind}`
          ctx.effect(() => ctx.sidebarRightTabs.register({
            id, kind, priority: 'extension', title: () => say()(label),
            ...extra,
          }), `artifact-panel: ${kind} type`)
          ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: id },
            (props) => h(Boundary, null, h('div', {
              'data-dsh-artifact-panel': '', 'data-tool': kind,
              className: `${NS}-content`,
            }, h(Body, { ...props, sidebarRight: ctx.sidebarRight }))),
          )), `artifact-panel: ${kind} body`)
        }
        const guide = (label, glyph, order) => ([{
          order, title: () => say()(label), icon: () => icon(glyph, 20),
        }])
        register('files', 'tool.files', Files, { guide: guide('tool.files', 'files', 10) })
        register('terminal', 'tool.terminal', TerminalPane, { guide: guide('tool.terminal', 'terminal', 20) })
        register('canvas', 'tool.canvas', Canvas, { guide: guide('tool.canvas', 'brush', 30) })
        register('browser', 'tool.browser', BrowserPane, { guide: guide('tool.browser', 'window', 40) })
        register('file', 'tool.files', Files, {
          canOpen: (address) => parseFileAddress(address)?.scope === 'session',
          patterns: ['dsh-resource://file/**'],
          title: (address) => basename(parseFileAddress(address)?.path ?? address),
        })

      },
    }
  },
})
