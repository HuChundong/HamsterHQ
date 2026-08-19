/**
 * What a row in the tree can be asked to do, and the two things that ask.
 *
 * The menu that opens on a row and the dialog that takes a name are drawn at
 * the panel's level rather than inside the row: a row lives in a column with
 * its own scroll and its own clipping, and a menu drawn there is cut off by
 * the first edge it meets.
 *
 * @module tree-dialogs
 */

import { command } from './api.js'
import { NS, ROOT } from './constants.js'
import { useT } from './i18n.js'
import { h, React } from './runtime.js'
import { store } from './store.js'
import { treeStore, useTree } from './tree-store.js'
/**
 * The menu a row opens, wherever it was opened from.
 *
 * Positioned where it was asked for and clamped to the window, so a row
 * near the bottom edge opens upward instead of off-screen. Dismissed by
 * anything that is not itself: a click elsewhere, Escape, or the panel
 * moving under it.
 *
 * @returns {object|null} the menu, or null when nothing is pointing at anything.
 */
export function RowActions() {
  const t = useT()
  const { menu } = useTree()
  const box = React.useRef(null)
  const [place, setPlace] = React.useState(undefined)

  React.useEffect(() => {
    if (menu === undefined) { setPlace(undefined); return undefined }
    const dismiss = (event) => {
      if (box.current?.contains(event.target) === true) return
      treeStore.closeMenu()
    }
    const onKey = (event) => { if (event.key === 'Escape') treeStore.closeMenu() }
    // Capture, so a click anywhere closes this before that click does
    // whatever else it was going to do.
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Measured after it is drawn, because where it fits depends on how big
  // it turned out to be.
  React.useLayoutEffect(() => {
    if (menu === undefined || box.current === null) return
    const rect = box.current.getBoundingClientRect()
    setPlace({
      left: Math.min(menu.x, window.innerWidth - rect.width - 8),
      top: menu.y + rect.height > window.innerHeight - 8 ? menu.y - rect.height - 8 : menu.y,
    })
  }, [menu])

  if (menu === undefined) return null
  const { entry } = menu
  const item = (label, onSelect, danger) => h('button', {
    type: 'button',
    role: 'menuitem',
    className: `${NS}-menu-item`,
    'data-danger': danger === true ? '' : undefined,
    onClick: onSelect,
  }, label)

  // Where a new thing would go: inside the directory that was pointed at,
  // beside the file that was, and in the workspace itself when the pointer
  // was on none of them.
  const into = entry === undefined ? ROOT : entry.directory ? entry.path : entry.path.slice(0, entry.path.lastIndexOf('/')) || ROOT

  return h('div', {
    ref: box,
    role: 'menu',
    className: `${NS}-menu`,
    style: { left: `${String(place?.left ?? menu.x)}px`, top: `${String(place?.top ?? menu.y)}px` },
  },
  item(t('menu.create'), () => treeStore.ask({ kind: 'create', into })),
  item(t('menu.mkdir'), () => treeStore.ask({ kind: 'mkdir', into })),
  // The rest is about a particular thing, so it is there only when the
  // pointer was on one.
  entry === undefined ? null : h(React.Fragment, null,
    h('div', { className: `${NS}-menu-sep` }),
    item(t('menu.rename'), () => treeStore.ask({ kind: 'rename', entry })),
    item(t('menu.delete'), () => treeStore.ask({ kind: 'delete', entry }), true)))
}

/**
 * What the panel asks before it changes something.
 *
 * Ours rather than `prompt` and `confirm`. Those are the platform's, they
 * look like the platform's, and beside an interface built out of this
 * app's own tokens they read as something else breaking in — which is
 * exactly the wrong signal for the one gesture that deletes a tenant's
 * work. This is also the only place in the panel that can say which file,
 * in the deployment's own voice.
 *
 * @returns {object|null} the dialog, or null when nothing is being asked.
 */
export function AskDialog() {
  const t = useT()
  const { ask } = useTree()
  const [value, setValue] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState(undefined)
  const field = React.useRef(null)

  React.useEffect(() => {
    if (ask === undefined) return
    setFailed(undefined)
    setBusy(false)
    setValue(ask.kind === 'rename' ? ask.entry.name : '')
    // Focused on open, and the name selected without its extension, which
    // is the part a rename usually changes.
    window.setTimeout(() => {
      const input = field.current
      if (input === null || input === undefined) return
      input.focus()
      const dot = input.value.lastIndexOf('.')
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
    }, 0)
  }, [ask])

  React.useEffect(() => {
    if (ask === undefined) return undefined
    const onKey = (event) => { if (event.key === 'Escape') treeStore.answered() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [ask])

  if (ask === undefined) return null
  const { kind, entry, into } = ask
  const parent = entry === undefined ? into : entry.path.slice(0, entry.path.lastIndexOf('/')) || ROOT

  const run = async () => {
    setBusy(true)
    setFailed(undefined)
    try {
      if (kind === 'delete') {
        await command('remove', { path: entry.path })
        // Straight away, rather than waiting for the viewer to ask for a
        // file and be told it is not there. This is the one case where
        // exactly what went is already known, so nothing has to be
        // discovered — and a tab that is only closed once its contents
        // fail shows the failure first.
        store.forget(entry.path)
      }
      else if (kind === 'rename') await command('move', { from: entry.path, to: `${parent}/${value.trim()}` })
      else if (kind === 'mkdir') await command('mkdir', { path: `${into}/${value.trim()}` })
      else await command('create', { path: `${into}/${value.trim()}` })
      // Re-read the directory that changed, and open it, so what was just
      // made is visible rather than merely made.
      treeStore.load(kind === 'delete' || kind === 'rename' ? parent : into)
      if (kind === 'mkdir' || kind === 'create') treeStore.reveal(into, true)
      treeStore.answered()
    } catch (error) {
      setFailed(error.message)
      setBusy(false)
    }
  }

  const named = kind !== 'delete'
  const bad = named && (value.trim() === '' || value.includes('/'))

  return h('div', { className: `${NS}-mask`, onPointerDown: (event) => { if (event.target === event.currentTarget) treeStore.answered() } },
    h('div', { className: `${NS}-dialog`, role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: `${NS}-dialog-title` },
        t(`ask.${kind}`)),
      h('div', { className: `${NS}-dialog-body` },
        kind === 'delete'
          ? t(entry.directory ? 'ask.delete.directory' : 'ask.delete.file', { name: entry.name })
          : h('input', {
            ref: field,
            className: `${NS}-dialog-input`,
            value,
            placeholder: t(kind === 'mkdir' ? 'ask.name.folder' : kind === 'create' ? 'ask.name.file' : 'ask.name.new'),
            'aria-label': t(kind === 'mkdir' ? 'ask.name.folder' : kind === 'create' ? 'ask.name.file' : 'ask.name.new'),
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter' && !bad && !busy) void run() },
          })),
      // A name, not a path: a rename that could carry a separator would be
      // a move, and a move to somewhere unnamed is how a file disappears
      // from the tree it was renamed in.
      named && value.includes('/') ? h('div', { className: `${NS}-dialog-note` }, t('ask.noslash')) : null,
      failed === undefined ? null : h('div', { className: `${NS}-dialog-note`, 'data-danger': '' }, failed),
      h('div', { className: `${NS}-dialog-actions` },
        h('button', { type: 'button', className: `${NS}-dialog-button`, onClick: () => treeStore.answered() }, t('ask.cancel')),
        h('button', {
          type: 'button',
          className: `${NS}-dialog-button`,
          'data-primary': '',
          'data-danger': kind === 'delete' ? '' : undefined,
          disabled: busy || bad,
          onClick: () => { void run() },
        }, t(busy ? 'ask.busy' : kind === 'delete' ? 'ask.delete' : 'ask.confirm')))))
}
