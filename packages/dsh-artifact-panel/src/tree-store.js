/**
 * The workspace tree, held once for the whole panel.
 *
 * @module tree-store
 */

import { listDir } from './api.js'
import { React } from './runtime.js'

/**
 * The workspace tree, held once for the whole panel.
 *
 * Every file tab shows the tree, and each used to own its own copy: its
 * own expansion, its own loading, its own requests. Switching tabs then
 * threw all of that away and asked the sandbox for the same directories
 * again, so the tree collapsed and flickered on every switch.
 *
 * There is one tree in the product, so there is one tree in the state.
 * What is cached is the SHAPE — which directories are open and what each
 * one contains — and a directory already read is shown immediately while
 * it is read again, so switching is instant without going stale: the agent
 * writes files while the tenant is looking at them.
 */
export const treeStore = (() => {
  // `menu` and `ask` are what is being pointed at and what is being asked,
  // held here rather than in a row because only one of each exists at a
  // time and because both are drawn at the panel's level, where they are
  // not clipped by the column the row lives in.
  let state = Object.freeze({
    dirs: {}, open: {}, filter: '', menu: undefined, ask: undefined,
    // The directory the tree was last taken TO, as opposed to the file
    // that is open in the pane. Clicking a breadcrumb is a move, and a
    // move with nothing to show for it is a control that looks broken:
    // the directory it names is usually already expanded, so opening it
    // again changes nothing anyone can see.
    at: undefined,
  })
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }
  const put = (patch) => { state = Object.freeze({ ...state, ...patch }); emit() }
  const putDir = (path, node) => { put({ dirs: { ...state.dirs, [path]: node } }) }

  const load = (path) => {
    const known = state.dirs[path]
    // Keep showing what is known while asking again. A directory that has
    // never been read shows its loading row; one that has shows its rows.
    putDir(path, { status: known?.entries === undefined ? 'loading' : 'ready', entries: known?.entries })
    listDir(path).then(
      (entries) => putDir(path, { status: 'ready', entries }),
      (error) => putDir(path, { status: 'failed', message: error.message, entries: known?.entries }),
    )
  }

  return {
    read: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Read a directory, from cache first and from the sandbox always. */
    load,
    /** Open or close one directory. */
    toggle: (path) => {
      const open = { ...state.open }
      if (open[path] === true) delete open[path]
      else open[path] = true
      put({ open })
    },
    /**
     * Open every directory on the way to a path, and the path itself when
     * the path IS a directory.
     *
     * `self` is the caller saying which it passed. A file's path names the
     * directories above it and nothing to open at the end; a directory —
     * one clicked in the breadcrumb, one just created — is itself the thing
     * to open, and stopping short of it is stopping one level short of the
     * only level the caller cared about.
     *
     * That distinction used to be made by putting a slash on the end, and
     * `filter(Boolean)` dropped the empty segment before anything could
     * read it. So a breadcrumb click opened only ancestors that the open
     * file had already opened, left `changed` false, and did nothing
     * whatsoever — the control looked dead rather than wrong.
     *
     * Written into the shared state rather than applied while rendering,
     * so a directory revealed this way can still be closed by hand — a
     * render-time override would spring back open under the pointer.
     */
    reveal: (path, self = false) => {
      if (path === undefined) return
      const open = { ...state.open }
      const segments = path.split('/').filter(Boolean)
      const depth = self ? segments.length : segments.length - 1
      let changed = false
      for (let i = 1; i <= depth; i += 1) {
        const ancestor = `/${segments.slice(0, i).join('/')}`
        if (open[ancestor] !== true) { open[ancestor] = true; changed = true }
      }
      // `at` is written whether or not anything opened, and it is written
      // as a NEW object each time so that asking twice for the same
      // directory still moves the tree to it. Without that, a second click
      // on the same crumb is a click that does nothing.
      if (self) put({ open, at: { path } })
      else if (changed) put({ open })
    },
    setFilter: (filter) => put({ filter }),
    openMenu: (menu) => put({ menu }),
    closeMenu: () => put({ menu: undefined }),
    ask: (ask) => put({ menu: undefined, ask }),
    answered: () => put({ ask: undefined }),
  }
})()

/** @returns {object} the tree's shared state. */
export const useTree = () => React.useSyncExternalStore(treeStore.subscribe, treeStore.read)
