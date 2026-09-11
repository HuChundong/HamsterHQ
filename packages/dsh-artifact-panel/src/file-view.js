import { basename, insideWorkspace, mintTicket, previewUrl, rawUrl, stillThere } from './api.js'
import { fileWorkspace } from './file-workspace.js'
import { workspaceWatch } from './watch.js'
import { grammarFor, viewerFor } from './kinds.js'
import { treeStore } from './tree-store.js'
import { NS, ROOT } from './constants.js'
import { useT } from './i18n.js'
import { icon } from './icons.js'
import { h, React, primitives } from './runtime.js'
import { store, useStore } from './store.js'

export function Aside({ kind, title, children }) {
  const { folded } = useStore()
  // Folded means gone, not narrowed. A strip was the first version and it
  // kept 36px of nothing; the control that brings the column back lives in
  // the pane's own title row, so there is nothing left for a strip to do.
  if (folded[kind] === true) return null

  return h('div', { className: `${NS}-split-aside` },
    h('div', { className: `${NS}-aside-head` }, h('span', { className: `${NS}-aside-title` }, title)),
    children)
}

/**
 * The control that folds a pane's side column, for the pane's title row.
 * @param {object} props - which column it folds.
 * @returns {object} the element.
 */
export function FoldButton({ kind, title }) {
  const t = useT()
  const { folded } = useStore()
  const closed = folded[kind] === true
  return h('button', {
    type: 'button',
    className: `${NS}-icon-button`,
    'aria-pressed': !closed,
    title: t(closed ? 'expand' : 'collapse', { title }),
    'aria-label': t(closed ? 'expand' : 'collapse', { title }),
    onClick: () => store.fold(kind),
  }, icon('aside'))
}

/* A list, not a panel. The first version of this control used the same
   panel outline the panel's own toggle uses, so the two levels looked like
   one control drawn twice — and they do different things: one folds the
   side list, the other closes the whole panel. */

/** Each directory is a real tree target, including paths with spaces. */
export function FileCrumbs({ path }) {
  if (path !== ROOT && !insideWorkspace(path)) return h('span', { className: `${NS}-crumb-path`, title: path }, path)
  const relative = insideWorkspace(path) ? path.slice(ROOT.length + 1).split('/') : []
  return h('nav', { className: `${NS}-crumb-path`, 'data-workspace-breadcrumbs': '' },
    h('button', { type: 'button', className: `${NS}-crumb`, onClick: () => treeStore.reveal(ROOT, true) }, ROOT),
    relative.map((name, index) => h(React.Fragment, { key: index },
      h('span', { className: `${NS}-crumb-sep` }, '/'),
      index === relative.length - 1 ? h('span', { className: `${NS}-crumb-name` }, name)
        : h('button', { type: 'button', className: `${NS}-crumb`,
          onClick: () => treeStore.reveal(`${ROOT}/${relative.slice(0, index + 1).join('/')}`, true),
        }, name))))
}

/** Copy the complete authenticated file, never just a preview's loaded pages. */
export function FileActions({ path, menu = false, dismiss }) {
  const t = useT()
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const copy = async (text) => {
    setBusy(true)
    setMessage('')
    try {
      let value = path
      if (text) {
        const response = await fetch(rawUrl(path), { credentials: 'same-origin' })
        if (!response.ok) throw new Error(t('error.read', { status: String(response.status) }))
        value = await response.text()
      }
      await navigator.clipboard.writeText(value)
      setMessage(t(text ? 'copied.text' : 'copied.path'))
      dismiss?.()
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  const button = (text) => h('button', { type: 'button', role: menu ? 'menuitem' : undefined,
    className: `${NS}-${menu ? 'menu-item' : 'icon-button'}`, disabled: busy,
    title: t(text ? 'copy.text' : 'copy.path'), 'aria-label': t(text ? 'copy.text' : 'copy.path'),
    onClick: () => { void copy(text) },
  }, menu ? t(text ? 'copy.text' : 'copy.path') : icon(text ? 'copy-text' : 'copy', 15))
  return h(React.Fragment, null, button(false),
    ['text', 'markdown', 'html'].includes(viewerFor(path)) ? button(true) : null,
    message === '' ? null : h('span', { role: 'status', className: `${NS}-copy-status` }, message))
}


export function FileBody({ path, source }) {
  const t = useT()
  const kind = viewerFor(path)
  const wants = kind === 'text' || kind === 'markdown'
  const [text, setText] = React.useState({ status: 'loading' })
  const [ticket, setTicket] = React.useState({ status: 'loading' })

  /**
   * Bumped whenever what is on screen might no longer be the file.
   *
   * Everything below keys off the path, and a path does not change when
   * its contents do — so an agent rewriting the open file, or a person
   * pressing refresh, changed nothing here. The frame was the visible
   * case, because a browser will not re-fetch a src it already has, but
   * text and images were just as stale and quieter about it.
   *
   * `stale` means the sandbox knows something moved without knowing what,
   * which is also what the refresh control sends.
   */
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => workspaceWatch.subscribe((change) => {
    if (change.stale === true || change.path === path) setRevision((n) => n + 1)
  }), [path])

  /**
   * The two viewers that would not otherwise notice.
   *
   * Text and markdown fetch their own bytes and hear a 404 for
   * themselves. An image and an HTML page hand a URL to the browser and
   * never learn what came back — a deleted image becomes a broken-image
   * glyph and a deleted page becomes the gateway's own 404 rendered
   * inside the frame, both of them under a tab still bearing the file's
   * name.
   */
  React.useEffect(() => {
    if (kind !== 'image' && kind !== 'html') return undefined
    let live = true
    stillThere(path).then((there) => { if (live && !there) fileWorkspace.removed(path) })
    return () => { live = false }
  }, [path, kind, revision])

  React.useEffect(() => {
    if (kind !== 'html') return undefined
    let live = true
    setTicket({ status: 'loading' })
    // Reminted rather than reused: a ticket lasts minutes and a tab can be
    // open for hours, so refreshing an old one with a stale ticket would
    // load a page whose every asset 401s.
    mintTicket().then(
      (value) => { if (live) setTicket({ status: 'ready', value }) },
      (error) => { if (live) setTicket({ status: 'failed', message: error.message }) },
    )
    return () => { live = false }
  }, [path, kind, revision])

  React.useEffect(() => {
    if (!wants) return undefined
    let live = true
    setText({ status: 'loading' })
    fetch(rawUrl(path), { credentials: 'same-origin' }).then(
      async (response) => {
        const body = await response.text()
        if (!live) return
        if (!response.ok) {
          // Gone, rather than unreadable. The tab is about a file, and
          // there is no longer one — so it closes instead of standing
          // there explaining that what it is named after is missing.
          if (response.status === 404) { fileWorkspace.removed(path); return }
          let message = t('error.read', { status: String(response.status) })
          try { message = JSON.parse(body).error ?? message } catch { /* not JSON; keep the status */ }
          setText({ status: 'failed', message })
          return
        }
        setText({ status: 'ready', body })
      },
    ).catch((error) => { if (live) setText({ status: 'failed', message: error.message }) })
    return () => { live = false }
  }, [path, wants, revision])

  // Said, rather than shown as whatever the bytes decode to. Nothing is
  // fetched for one of these: the answer does not depend on the contents,
  // and downloading a hundred megabytes of video to report that it cannot
  // be played is the cost of the old behaviour without the mojibake.
  if (path.toLowerCase().endsWith('.pdf')) return h('iframe', { key: revision, className: `${NS}-frame`, src: rawUrl(path), title: basename(path) })
  if (kind === 'opaque') {
    return h('div', { className: `${NS}-placeholder` }, h('p', null, t('preview.opaque')), h('a', { href: rawUrl(path), download: basename(path) }, t('download')))
  }
  if (kind === 'image') {
    return h('div', { className: `${NS}-media` },
      h('img', { key: `${path}:${String(revision)}`, className: `${NS}-image`, src: rawUrl(path), alt: basename(path) }))
  }
  if (kind === 'html') {
    if (ticket.status === 'loading') return h('div', { className: `${NS}-placeholder` }, t('preview.preparing'))
    if (ticket.status === 'failed') return h('div', { className: `${NS}-placeholder` }, ticket.message)
    // `sandbox` without `allow-same-origin`, so the previewed page gets an
    // opaque origin and cannot read the session it was fetched with. The
    // gateway sends the same restriction as a header, which holds even if
    // the page is opened outside this frame. That opacity is also why the
    // URL carries a ticket: an opaque origin sends no cookies, so without
    // one the page would load and every asset in it would 401.
    // Keyed by revision as well as path, which is what actually reloads
    // it: React reuses an iframe whose src is unchanged, and the src has
    // to stay unchanged so the page's own relative assets keep resolving.
    return h('iframe', {
      key: `${path}:${String(revision)}`,
      className: `${NS}-frame`,
      src: previewUrl(ticket.value, path),
      sandbox: 'allow-scripts allow-popups allow-downloads allow-modals',
      title: basename(path),
    })
  }
  if (text.status === 'loading') return h('div', { className: `${NS}-placeholder` }, t('loading'))
  if (text.status === 'failed') return h('div', { className: `${NS}-placeholder` }, text.message)

  // Markdown, rendered, unless its source was asked for.
  if (kind === 'markdown' && !source && primitives.MarkdownText !== undefined) {
    return h('div', { className: `${NS}-markdown` }, h(primitives.MarkdownText, {
      text: text.body,
      // The component is cordis-free and takes its copy through props;
      // omitting these leaves a code block's copy button unlabelled.
      labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') },
    }))
  }
  if (primitives.CodeBlock !== undefined) {
    return h('div', { className: `${NS}-code` }, h(primitives.CodeBlock, {
      code: text.body,
      lang: kind === 'markdown' ? 'markdown' : grammarFor(path),
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
    }))
  }
  // No primitives in this shell: the file is still readable, just plain.
  return h('pre', { className: `${NS}-text` }, text.body)
}
