/**
 * The workspace tree, as rows on screen.
 *
 * What a row can be ASKED to do — the menu, and the dialog that takes a name —
 * is `tree-dialogs.js`, because both are drawn at the panel's level rather than
 * inside the row: a menu drawn in a scrolling column is clipped by it.
 *
 * @module file-tree
 */

import { NS, ROOT } from './constants.js'
import { useT } from './i18n.js'
import { icon } from './icons.js'
import { iconFor } from './kinds.js'
import { h, React } from './runtime.js'
import { treeStore, useTree } from './tree-store.js'
import { workspaceWatch } from './watch.js'
/**
 * The row's own control: one button that opens the menu.
 *
 * One button rather than the two it replaced. Two icons on a row that is
 * mostly a name reads as a row of controls with a label attached, and the
 * menu is where a second action would have gone anyway.
 *
 * @param {object} props - the entry the menu is about.
 * @returns {object} the element.
 */
export function RowMenu({ entry }) {
  const t = useT()
  return h('span', { className: `${NS}-row-menu` },
    h('button', {
      type: 'button',
      className: `${NS}-row-action`,
      title: t('more'),
      'aria-label': t('more.of', { name: entry.name }),
      'aria-haspopup': 'menu',
      onClick: (event) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        treeStore.openMenu({ entry, x: rect.left, y: rect.bottom + 4 })
      },
    }, icon('more', 14)),
  )
}

/**
 * One directory's children, loaded when it is first opened.
 *
 * A level at a time rather than a whole tree: a workspace can hold a
 * `node_modules`, and reading it to draw one row would cost the tenant's
 * sandbox real work for something nobody asked to see.
 *
 * Recursion carries `depth` only to indent — the shape of the tree is the
 * component nesting itself, so there is no flattened model to keep in step
 * with what is on screen.
 *
 * @param {object} props - the directory, how deep it sits, and what to do with a file.
 * @returns {object|null} the rows.
 */
/**
 * Scroll a row into view once the tree has been taken to it.
 *
 * A callback ref rather than an effect, because the row does not exist
 * until the branch holding it has expanded — which happens in the same
 * render that asks for it. `block: 'nearest'` so a row already on screen
 * does not jump.
 *
 * @param {Element|null} node - the row, or null as it unmounts.
 */
export const taken = (node) => { node?.scrollIntoView({ block: 'nearest' }) }

export function Branch({ path, depth, onOpen, activePath, at }) {
  const t = useT()
  const tree = useTree()
  const node = tree.dirs[path]

  // Read once when this branch appears. It is not re-read on a timer or
  // on every draw any more: the workspace says when it changed.
  React.useEffect(() => { treeStore.load(path) }, [path])

  // And re-read exactly the directory a change happened in — not the whole
  // tree, and not this branch unless the change was in it.
  React.useEffect(() => workspaceWatch.subscribe((change) => {
    // `stale` means the change is unknown rather than elsewhere, so this
    // branch re-reads instead of deciding it was not about it.
    if (change.stale === true) { treeStore.load(path); return }
    const parent = change.path.slice(0, change.path.lastIndexOf('/')) || ROOT
    if (parent === path) treeStore.load(path)
  }), [path])

  const indent = { paddingLeft: `${String(depth * 14 + 12)}px` }
  if (node?.entries === undefined) {
    if (node?.status === 'failed') return h('div', { className: `${NS}-tree-note`, style: indent }, node.message)
    return h('div', { className: `${NS}-tree-note`, style: indent }, t('loading'))
  }

  // The filter narrows what is already loaded. Directories are kept
  // whatever they are called, because what is being looked for may be
  // inside one — and this cannot know without reading it, which is exactly
  // the work the tree loads lazily to avoid.
  const needle = tree.filter.trim().toLowerCase()
  const matching = needle === ''
    ? node.entries
    : node.entries.filter((entry) => entry.directory || entry.name.toLowerCase().includes(needle))

  if (matching.length === 0) {
    return h('div', { className: `${NS}-tree-note`, style: indent }, t(needle === '' ? 'tree.empty' : 'tree.nomatch'))
  }

  // Directories first, then by name, folded case — the order a person
  // expects rather than the order the filesystem happened to answer in.
  const entries = [...matching].sort((a, b) => (
    a.directory === b.directory
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : (a.directory ? -1 : 1)
  ))

  return h(React.Fragment, null, entries.map((entry) => {
    // Open because someone opened it, or because a filter is narrowing the
    // tree — the point of typing is to see what matches, not to then go
    // looking for it. Revealing writes to the shared state instead of
    // overriding here, so a revealed directory can still be closed.
    const expanded = tree.open[entry.path] === true || (needle !== '' && entry.directory)
    return h(React.Fragment, { key: entry.path },
      // A row rather than a button, because it CONTAINS buttons and a
      // button inside a button is not a thing HTML has. The role and the
      // key handling are what a button would have given for free.
      h('div', {
        className: `${NS}-row`,
        role: 'treeitem',
        tabIndex: 0,
        // Brought into view when the tree is taken here — see `TakenTo`.
        ref: entry.path === at?.path ? taken : undefined,
        'aria-expanded': entry.directory ? expanded : undefined,
        style: { paddingLeft: `${String(depth * 14 + 8)}px` },
        // The open file, or the directory a breadcrumb just named. Both are
        // "where you are", and the tree is the one place that can say so.
        'aria-current': entry.path === activePath || entry.path === at?.path ? 'true' : undefined,
        title: entry.path,
        onClick: () => {
          if (entry.directory) treeStore.toggle(entry.path)
          else onOpen(entry)
        },
        onKeyDown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (entry.directory) treeStore.toggle(entry.path)
          else onOpen(entry)
        },
        // The browser's own menu is refused here, because everything on it
        // is about a web page — reload, view source, save image — and none
        // of it is about the file this row names.
        onContextMenu: (event) => {
          event.preventDefault()
          treeStore.openMenu({ entry, x: event.clientX, y: event.clientY })
        },
      },
      entry.directory
        ? h('span', {
          className: `${NS}-row-twisty`,
          // Rotated rather than swapped for a second glyph: one icon, one
          // state, and the turn reads as the thing opening.
          style: { transform: expanded ? 'rotate(90deg)' : 'none' },
        }, icon('chevron', 12))
        // Nothing at all for a file, rather than an empty box the width of
        // the control it does not have.
        //
        // The column was there so that every name in a listing began on
        // one vertical line, which is the usual argument for it — and it
        // is an argument that holds where directories are most of what is
        // listed. A workspace is the other case: a tenant's tree is files
        // with the odd folder in it, so the reserved column mostly held
        // nothing, and it held nothing at the very left edge, where it
        // read as the whole tree having been nudged off its own margin.
        //
        // What it costs is that a folder's name sits 18px right of a
        // file's at the same depth. That is the folder wearing a control,
        // which is a true thing about it — and the indent that says which
        // folder a file is IN is the depth padding, which is untouched.
        : null,
      // A file wears its kind; a directory wears its chevron and nothing
      // else.
      //
      // The folder glyph was beside that chevron and said the same thing
      // twice — a mark that means "this contains things" next to a control
      // that only exists on things that contain things. Two marks for one
      // fact is also two marks the eye has to skip before the name, on the
      // rows where the name matters most.
      //
      // For a file the call is the same one the tab makes, so a file wears
      // one icon in this deployment rather than one here and another on
      // the tab it opens. Every file was `file` before, which is the icon
      // for "nothing is known about this" shown for everything that was
      // known.
      entry.directory ? null : h('span', { className: `${NS}-row-icon` },
        icon(iconFor(entry.path), 14)),
      h('span', { className: `${NS}-row-name` }, entry.name),
      h(RowMenu, { entry })),
      expanded ? h(Branch, { path: entry.path, depth: depth + 1, onOpen, activePath, at }) : null)
  }))
}

/**
 * The workspace, as a tree, with a box to narrow it.
 *
 * The box filters rather than searches, and is labelled so. Searching
 * would mean walking the tenant's whole workspace in their sandbox on
 * every keystroke; this narrows what has already been read, which is what
 * someone scanning a directory they are looking at actually wants.
 *
 * Everything it shows — what is open, what was read, what is typed — lives
 * in `treeStore`, not here, because the same tree appears in every file
 * tab and they are one tree.
 *
 * @param {object} props - what to do when a file is chosen, and which one is showing.
 * @returns {object} the element.
 */
export function FileTree({ onOpen, activePath }) {
  const t = useT()
  const tree = useTree()
  // Where the tree was last taken, which is a breadcrumb's whole effect.
  const at = tree.at
  return h(React.Fragment, null,
    h('div', { className: `${NS}-filter` }, h('input', {
      type: 'search',
      value: tree.filter,
      placeholder: t('filter.placeholder'),
      'aria-label': t('filter.label'),
      onChange: (event) => treeStore.setFilter(event.target.value),
    })),
    // The empty space below the rows is still the workspace, so pointing
    // at it offers what can be made in the workspace. Only when the click
    // landed on nothing: a row handles its own, and this would otherwise
    // replace the menu it just opened.
    h('div', {
      className: `${NS}-scroll`,
      onContextMenu: (event) => {
        if (event.defaultPrevented) return
        event.preventDefault()
        treeStore.openMenu({ entry: undefined, x: event.clientX, y: event.clientY })
      },
    },
      h('div', { className: `${NS}-tree` },
        h(Branch, { path: ROOT, depth: 0, onOpen, activePath, at }))),
  )
}
