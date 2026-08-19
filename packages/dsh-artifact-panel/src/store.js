/**
 * The panel's own state: what is open, which session, and each session's tabs.
 *
 * Held outside React because two React roots need it — the panel's own, and
 * the app's, where the toggle lives: the control belongs in the session
 * header, and a control that moves house when the thing it controls opens is a
 * control nobody can aim at. A store both roots subscribe to is how one piece
 * of state reaches two trees without either owning the other.
 *
 * @module store
 */

import { say } from './i18n.js'
import { React } from './runtime.js'
import { forgetPath } from './tabs.js'

/** The tab group of a session that has none yet. */
export const EMPTY_GROUP = Object.freeze({ tabs: Object.freeze([]), activeId: undefined })

/** What a session with no id at all is filed under — the home screen. */
const NO_SESSION = ''

/**
 * The store itself, and every way the panel changes what it holds.
 */
export const store = (() => {
  let state = Object.freeze({
    open: false,
    header: false,
    session: NO_SESSION,
    groups: {},
    // Shells, kept here rather than in the component that draws them: a
    // terminal is a process, and closing the tab it is drawn in should not
    // be the same gesture as ending it.
    terminals: [],
    activeTerminal: undefined,
    nextTerminal: 1,
    // Which side columns are folded away, by the kind of pane they belong
    // to. Two flags rather than one, because folding the file tree to read
    // a file says nothing about wanting the terminal list gone.
    folded: {},
  })
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }
  const write = (patch) => {
    state = Object.freeze({ ...state, ...patch })
    emit()
  }
  /** Replace the current session's group, leaving every other one alone. */
  const writeGroup = (next) => {
    write({ groups: { ...state.groups, [state.session]: Object.freeze(next) } })
  }
  const group = () => state.groups[state.session] ?? EMPTY_GROUP

  return {
    read: () => state,
    write,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    group,
    /**
     * Follow the app's current session.
     *
     * Tabs belong to a conversation, not to the window: what was opened
     * while reading one session is not what the next one is about. Groups
     * are kept rather than cleared, so going back to a session finds the
     * files that were open in it.
     */
    setSession: (session) => {
      if (state.session === (session ?? NO_SESSION)) return
      write({ session: session ?? NO_SESSION })
    },
    /** Open a tab, or focus the one already showing that thing. */
    openTab: (tab) => {
      const { tabs } = group()
      writeGroup({
        tabs: tabs.some((entry) => entry.id === tab.id) ? tabs : [...tabs, tab],
        activeId: tab.id,
      })
    },
    /**
     * Close one tab, and the panel with it when it was the last.
     *
     * Closing the last tab is how someone says they are done with the
     * panel — there is nothing left in it to look at, and what stayed
     * behind was a half-width empty state they then had to dismiss a
     * second time, with a different control, to get their reading width
     * back. The panel can still be opened onto that empty state
     * deliberately; it is only being left on one that is wrong.
     *
     * One write, not two: `open` and the tab group are the same store, and
     * writing them separately paints a frame of an empty open panel.
     */
    closeTab: (id) => {
      const { tabs, activeId } = group()
      const next = tabs.filter((entry) => entry.id !== id)
      // Focus falls to the neighbour on the left, or the new first tab —
      // the position the eye is already at, rather than the end.
      const index = tabs.findIndex((entry) => entry.id === id)
      const focus = activeId === id ? next[Math.max(0, index - 1)]?.id : activeId
      write({
        groups: { ...state.groups, [state.session]: Object.freeze({ tabs: next, activeId: focus }) },
        ...next.length === 0 ? { open: false } : {},
      })
    },
    /**
     * Drop every tab that is showing something no longer there.
     *
     * A tab is a claim that a file is worth looking at, and a deleted file
     * makes that claim false. Left alone the tab stays on the bar with its
     * name and its icon, and what is under it is an error where the file
     * used to be — the panel insisting on something the workspace has
     * already moved on from.
     *
     * Which tabs those are is decided in `tabs.js`, where it can be asked
     * about directly. What is here is the part that cannot: one write for
     * every group at once, because separate writes paint a frame each, and
     * if the last tab in this session goes, a frame of an open panel with
     * nothing in it.
     *
     * @param {string} path - what was removed.
     */
    forget: (path) => {
      const { groups, changed } = forgetPath(state.groups, path)
      if (!changed) return
      const here = groups[state.session] ?? EMPTY_GROUP
      write({ groups, ...here.tabs.length === 0 ? { open: false } : {} })
    },
    select: (id) => { writeGroup({ ...group(), activeId: id }) },
    /** Start another shell, and show it. */
    addTerminal: () => {
      const id = `t${String(state.nextTerminal)}`
      write({
        terminals: [...state.terminals, { id, name: say()('terminal.n', { n: String(state.nextTerminal) }) }],
        activeTerminal: id,
        nextTerminal: state.nextTerminal + 1,
      })
      return id
    },
    /** End one shell. Its socket closes with it, and so does the process. */
    closeTerminal: (id) => {
      const rest = state.terminals.filter((entry) => entry.id !== id)
      write({
        terminals: rest,
        activeTerminal: state.activeTerminal === id ? rest[rest.length - 1]?.id : state.activeTerminal,
      })
    },
    selectTerminal: (id) => write({ activeTerminal: id }),
    fold: (kind) => write({ folded: { ...state.folded, [kind]: state.folded[kind] !== true } }),
  }
})()

/**
 * Read the shared state in either tree.
 * @returns {{open: boolean, header: boolean}} the current state.
 */
export const useStore = () => React.useSyncExternalStore(store.subscribe, store.read)
