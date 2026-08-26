/**
 * Where a tenant lands when their machine is up and their backend is not.
 *
 * The failure this exists for looks, from the application, exactly like a
 * sandbox that will not start — and it is nothing of the kind. The machine is
 * running, envd is answering, the files are mounted, a shell is one call away.
 * What died is dsh, usually because of something on the tenant's own volume:
 * one stray bracket in `/mnt/dsh/cordis.patch.yml` is enough, and a tenant hit
 * exactly that. Before this page, the answer was a rebuild loop that destroyed
 * the machine, took the log with it, and came back to the same file.
 *
 * So the page is served by the gateway rather than by the application, for the
 * obvious reason: the application is what is broken. It is deliberately made
 * of things that were already true when the backend was down —
 *
 * - `/recovery/log` reads the backend's own log through envd,
 * - `/sandbox/fs/*` lists and edits the machine's files through envd,
 * - `/sandbox/pty` opens a shell through envd,
 *
 * — none of which pass through a tunnel or a dsh process. The page adds a
 * frame around them, not a mechanism.
 *
 * The order on screen is the order the work happens in: read what broke, fix
 * it where it is, then start the backend. The two destructive ways out are
 * last and look it.
 *
 * @module recovery-page
 */

import { svg } from 'dsh-icons'

import { asset } from './page-assets.js'
import {
  BRAND_CSS,
  documentHead,
  escapeHtml,
  FIELD_CSS,
  GROUND_CSS,
  GROUND_HTML,
  GROUND_SCRIPT,
  langToggle,
  PAGE_CSS,
  PALETTE_CSS,
  submitCss,
  THEME_TOGGLE,
  TOAST_CSS,
  WORDMARK,
} from './page-chrome.js'

/** Every string on the page, in both languages, as the other pages carry them. */
const TABLE = {
  'title': { zh: '沙箱需要修复', en: 'Your sandbox needs a hand' },
  'lede': {
    zh: '机器还在，跑在里面的后端没起来。',
    en: 'The machine is up. The backend inside it is not.',
  },
  'log.title': { zh: '后端最后说了什么', en: 'What the backend said last' },
  'log.empty': { zh: '日志是空的。', en: 'The log is empty.' },
  'log.refresh': { zh: '重新读取', en: 'Read it again' },
  'files.title': { zh: '文件', en: 'Files' },
  'files.save': { zh: '保存', en: 'Save' },
  'files.delete': { zh: '删除', en: 'Delete' },
  'files.saved': { zh: '已保存', en: 'Saved' },
  'files.deleted': { zh: '已删除', en: 'Deleted' },
  'files.binary': { zh: '二进制文件，不在这里编辑。', en: 'A binary file, not edited here.' },
  'files.up': { zh: '上一层', en: 'Up' },
  'files.none': { zh: '选一个文件', en: 'Choose a file' },
  'files.empty': { zh: '空目录', en: 'Empty' },
  'terminal.title': { zh: '终端', en: 'Terminal' },
  'terminal.lost': { zh: '连接断了，正在重连…', en: 'Disconnected — reconnecting…' },
  'start.title': { zh: '重新启动', en: 'Start it again' },
  'start.hint': {
    zh: '两种都不动你的文件。重启沙箱换一台新机器，按模板自己的方式启动。',
    en: 'Neither touches your files. Restarting takes a fresh machine and boots it the way the template says.',
  },
  'restart.action': { zh: '重启沙箱', en: 'Restart the sandbox' },
  'start.action': { zh: '只启动后端', en: 'Only start the backend' },
  'last.title': { zh: '最后的办法', en: 'Last resort' },
  'wipe.hint': {
    zh: '连同卷一起删除，无法恢复。',
    en: 'Deletes the volume with it. There is no way back.',
  },
  'wipe.action': { zh: '清空全部数据', en: 'Erase everything' },
  'wipe.confirm': {
    zh: '这会删除这台机器上你的全部数据，无法撤销。确定要继续吗？',
    en: 'This deletes all of your data on this machine and cannot be undone. Continue?',
  },
  'wipe.acknowledge': { zh: '我明白数据会全部消失', en: 'I understand everything will be gone' },
  'wipe.cancel': { zh: '取消', en: 'Cancel' },
  'working': { zh: '正在处理…', en: 'Working…' },
  'failed': { zh: '没有成功，请看终端里的报错。', en: 'That did not work — the terminal will say why.' },
  'back': { zh: '返回应用', en: 'Back to the application' },
}

/** What the page is drawn with, beyond the chrome every page here shares. */
const RECOVERY_CSS = `
  /* Centred, with the same top clearance the sign-in page keeps: the theme and
     language buttons are fixed in the corner, and without it they sit on top of
     the mark. Written here rather than inherited because PAGE_CSS gives main
     nothing but the flex box it lives in — every page places its own. */
  main {
    flex: 1;
    width: 100%;
    max-width: 62rem;
    margin: 0 auto;
    padding: 4.5rem 1.5rem 3rem;
  }
  @media (max-width: 40rem) { main { padding: 4.5rem 1rem 2rem; } }

  /* The mark, drawn the way the sign-in page draws it — the hamster beside the
     wordmark, both a link home. BRAND_CSS styles the letters and expects to
     find them inside .brand; without the class they arrive as unstyled text,
     which is what a person reads as "the logo is gone". */
  .brand {
    display: inline-flex;
    align-items: center;
    gap: .5rem;
    margin-bottom: 1.75rem;
    text-decoration: none;
  }
  .brand img { height: 26px; width: auto; display: block; }
  .card {
    width: 100%;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-card);
    background: var(--panel);
  }
  .card h2 { margin: 0 0 .35rem; font-size: 1rem; }
  .card p.hint { margin: 0 0 .9rem; color: var(--muted); font-size: .8125rem; }
  .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  .row .grow { flex: 1; min-width: 0; }

  /* The log and the editor are the same surface: a monospace box that scrolls
     on its own so the page does not grow with what is in them. */
  pre.sheet, textarea.sheet {
    width: 100%;
    max-height: 18rem;
    overflow: auto;
    margin: 0;
    padding: .75rem .875rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-field);
    background: var(--sunken);
    color: var(--fg);
    font-family: var(--mono);
    font-size: .8125rem;
    line-height: 1.55;
    white-space: pre;
    tab-size: 2;
  }
  textarea.sheet { min-height: 12rem; resize: vertical; white-space: pre; }

  /* The tree, drawn as the panel's own tree is drawn — a row is an inset
     rounded rectangle rather than a band across the column, because a
     full-bleed highlight reads as a highlight of the panel and this one has to
     read as a selection of the file. The measurements are the panel's: a 28px
     row, an 8px gap between the mark and the name it belongs to. */
  /* The path and the list are one box, and the box is what lines up with the
     editor beside it. Written above the border, the path pushed this column
     down by its own height and the two panes started at different places. */
  .tree-pane {
    display: flex;
    flex-direction: column;
    height: 24rem;
    overflow: hidden;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-field);
    background: var(--sunken);
  }
  .tree {
    flex: 1;
    overflow: auto;
    padding: 6px 0;
  }
  .tree button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: calc(100% - 12px);
    height: 28px;
    margin: 0 6px;
    padding: 0 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
    line-height: 28px;
    text-align: left;
    cursor: pointer;
  }
  .tree button:hover, .tree button:focus-visible { background: var(--surface); outline: none; }
  .tree button[aria-current="true"] { background: var(--surface); font-weight: 500; }
  /* The glyph keeps its own box so names line up whether or not the row above
     was a directory, and it is quieter than the name: the name is what is being
     read, the mark only says which kind. */
  .tree .kind {
    display: inline-flex;
    flex: none;
    width: 16px;
    color: var(--faint);
  }
  .tree .kind svg { width: 16px; height: 16px; }
  /* Up is the same chevron the harness draws, turned over. One glyph, two
     directions, rather than an arrow borrowed from somewhere else. */
  .tree .kind .turn { transform: rotate(180deg); }
  .tree .grow { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .tree .size { flex: none; color: var(--faint); font-size: .75rem; font-variant-numeric: tabular-nums; }
  .tree .note { padding: .25rem .75rem; color: var(--faint); font-size: .75rem; }
  .where {
    margin: 0;
    padding: .45rem .75rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--muted);
    font-family: var(--mono);
    font-size: .75rem;
    word-break: break-all;
  }

  /* The right pane says what it is waiting for rather than showing an empty
     box with two buttons under it — an editor with nothing in it and a Save
     beside it is an invitation to save nothing over something. */
  /* A display rule beats the hidden attribute, and both the note and the
     button row have one — so the placeholder stayed on screen under the file
     it was telling you to open. Stated once, for everything on this page. */
  [hidden] { display: none !important; }
  .editing { display: flex; flex-direction: column; gap: .6rem; height: 24rem; }
  .editing textarea.sheet { flex: 1; max-height: none; }
  .empty-note {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 12rem;
    border: 1px dashed var(--line-soft);
    border-radius: var(--radius-field);
    color: var(--faint);
    font-size: .8125rem;
    text-align: center;
  }

  .panes { display: grid; grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); gap: 1rem; align-items: stretch; }
  @media (max-width: 52rem) { .panes { grid-template-columns: minmax(0, 1fr); } }

  #terminal { height: 22rem; border-radius: var(--radius-field); overflow: hidden; background: #1b1b1c; }

  a.act { display: inline-flex; align-items: center; text-decoration: none; }
  button.act, a.act {
    height: 2.25rem;
    padding: 0 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-pill);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
    cursor: pointer;
  }
  button.act:hover, a.act:hover { border-color: var(--line-strong); }
  button.act.primary { border-color: var(--ink); background: var(--ink); color: var(--on-ink); }
  button.act.danger { border-color: var(--danger); color: var(--danger); }
  button.act.danger:hover { background: var(--danger); color: #fff; }
  button.act[disabled] { opacity: .55; cursor: default; }
  .said { margin-left: .25rem; color: var(--muted); font-size: .8125rem; }

  dialog {
    max-width: min(90vw, 26rem);
    padding: 1.25rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    background: var(--bg);
    color: var(--fg);
  }
  dialog::backdrop { background: rgb(0 0 0 / 35%); }
  dialog p { margin: 0 0 .75rem; }
  dialog label { display: flex; gap: .5rem; align-items: flex-start; margin-bottom: 1rem; font-size: .8125rem; }
`

/**
 * The recovery page.
 *
 * @param {object} state - what this render needs.
 * @param {string} state.email - who is signed in, shown so they know whose machine this is.
 * @param {string} [state.version] - the release this deployment runs.
 * @returns {string} the HTML document.
 */
export function recoveryPage(state) {
  const { email, version } = state
  const release = version === undefined || version === '' ? '' : ` · v${escapeHtml(version)}`

  return `<!doctype html>
<html lang="zh-CN">
<head>
${documentHead({ title: '沙箱需要修复 · HamsterHQ', indexed: false, extra: `<link rel="stylesheet" href="${asset('xterm.css')}">` })}
<style>
${PALETTE_CSS}
${BRAND_CSS}
${GROUND_CSS}
${PAGE_CSS}
${FIELD_CSS}
${submitCss('button[type="submit"]')}
${TOAST_CSS}
${RECOVERY_CSS}
</style>
</head>
<body>
${GROUND_HTML}
${THEME_TOGGLE}
${langToggle(TABLE)}
<main>
  <div style="width:100%">
    <a class="brand" href="/app">
      <img src="${asset('hamster.svg')}" alt="">
      ${WORDMARK}
    </a>
    <h1 style="margin:0 0 .35rem;font-size:1.35rem" data-t="title">沙箱需要修复</h1>
    <p class="hint" style="color:var(--muted);margin:0 0 1.5rem" data-t="lede">${escapeHtml(TABLE.lede.zh)}</p>

    <section class="card">
      <h2 data-t="log.title">后端最后说了什么</h2>
      <p class="hint" style="margin-bottom:.6rem">${escapeHtml(email)}${release}</p>
      <pre class="sheet" id="log">…</pre>
      <div class="row" style="margin-top:.75rem">
        <button class="act" id="log-refresh" data-t="log.refresh">重新读取</button>
      </div>
    </section>

    <section class="card">
      <h2 data-t="files.title">文件</h2>
      <div class="panes">
        <div class="tree-pane">
          <p class="where" id="where">/mnt</p>
          <div class="tree" id="tree"></div>
        </div>
        <div class="editing">
          <p class="empty-note" id="nothing-open" data-t="files.none">选一个文件，就能在这里改它。</p>
          <textarea class="sheet" id="editor" spellcheck="false" aria-label="file" hidden></textarea>
          <div class="row" id="file-actions" hidden>
            <button class="act primary" id="save" data-t="files.save">保存</button>
            <button class="act danger" id="delete" data-t="files.delete">删除</button>
            <span class="said" id="file-said"></span>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 data-t="terminal.title">终端</h2>
      <div id="terminal"></div>
      <p class="hint" id="terminal-lost" data-t="terminal.lost" hidden>连接断了，正在重连…</p>
    </section>

    <section class="card">
      <h2 data-t="start.title">重新启动</h2>
      <p class="hint" data-t="start.hint">${escapeHtml(TABLE['start.hint'].zh)}</p>
      <div class="row">
        <button class="act primary" id="restart" data-t="restart.action">重启沙箱</button>
        <button class="act" id="start" data-t="start.action">只启动后端</button>
        <span class="said" id="start-said"></span>
      </div>
    </section>

    <section class="card">
      <h2 data-t="last.title">最后的办法</h2>
      <p class="hint" data-t="wipe.hint">${escapeHtml(TABLE['wipe.hint'].zh)}</p>
      <div class="row">
        <button class="act danger" id="wipe" data-t="wipe.action">清空全部数据</button>
        <span class="said" id="wipe-said"></span>
      </div>
    </section>

    <div class="row" style="margin-top:1.5rem">
      <a class="act" href="/app" data-t="back">返回应用</a>
    </div>
  </div>
</main>

<dialog id="confirm">
  <p data-t="wipe.confirm">${escapeHtml(TABLE['wipe.confirm'].zh)}</p>
  <label><input type="checkbox" id="acknowledge"> <span data-t="wipe.acknowledge">${escapeHtml(TABLE['wipe.acknowledge'].zh)}</span></label>
  <div class="row" style="justify-content:flex-end">
    <button class="act" id="confirm-cancel" data-t="wipe.cancel">取消</button>
    <button class="act danger" id="confirm-go" data-t="wipe.action" disabled>清空全部数据</button>
  </div>
</dialog>

<script src="${asset('xterm.js')}"></script>
<script>
;(() => {
  // Strings this script produces are asked for by key through dshText, which
  // langToggle leaves for exactly that: they have no element to carry a
  // data-t because they do not exist until something happens. Written out at
  // each call rather than through a local alias, because that literal is also
  // what check-pages reads to know the key is alive.
  //
  // (No backticks in here: this whole block is inside a template literal, and
  // one would end it early.)
  const $ = (id) => document.getElementById(id)

  // ---- the log ----------------------------------------------------------
  const logBox = $('log')
  const readLog = async () => {
    logBox.textContent = dshText('working')
    try {
      const response = await fetch('/recovery/log', { credentials: 'same-origin' })
      const body = await response.json()
      logBox.textContent = (body.log ?? '').trim() || dshText('log.empty')
    } catch { logBox.textContent = dshText('failed') }
    logBox.scrollTop = logBox.scrollHeight
  }
  $('log-refresh').addEventListener('click', readLog)

  // ---- the files --------------------------------------------------------
  //
  // The same routes the panel uses, which answer while the backend is down
  // because they go to envd rather than through a tunnel.
  const tree = $('tree'), where = $('where'), editor = $('editor')
  const save = $('save'), remove = $('delete'), fileSaid = $('file-said')
  const nothingOpen = $('nothing-open'), fileActions = $('file-actions')
  let at = '/mnt', open = undefined

  // The harness's own glyphs, written in rather than fetched: this page has no
  // module table to require them from, and dsh-icons is markup.
  const ICONS = {
    up: '${svg('chevron-down', { size: 16, className: 'turn' })}',
    dir: '${svg('folder-close', { size: 16 })}',
    file: '${svg('file', { size: 16 })}',
  }

  /** Show the editor, or the line that says why there is nothing in it. */
  const editing = (yes) => {
    nothingOpen.hidden = yes
    editor.hidden = !yes
    fileActions.hidden = !yes
  }
  editing(false)

  const list = async (path) => {
    const response = await fetch('/sandbox/fs/list?path=' + encodeURIComponent(path), { credentials: 'same-origin' })
    if (!response.ok) return
    const body = await response.json()
    at = body.path
    where.textContent = at
    tree.replaceChildren()
    if (at !== '/') {
      const up = document.createElement('button')
      up.innerHTML = '<span class="kind">' + ICONS.up + '</span><span class="grow">' + dshText('files.up') + '</span>'
      up.addEventListener('click', () => list(at.slice(0, at.lastIndexOf('/')) || '/'))
      tree.append(up)
    }
    if (body.entries.length === 0) {
      const note = document.createElement('p')
      note.className = 'note'
      note.textContent = dshText('files.empty')
      tree.append(note)
    }
    for (const entry of body.entries) {
      const row = document.createElement('button')
      row.innerHTML = '<span class="kind">' + (entry.directory ? ICONS.dir : ICONS.file) + '</span>'
        + '<span class="grow">' + entry.name.replace(/[<&]/g, (c) => c === '<' ? '&lt;' : '&amp;') + '</span>'
        + '<span class="size">' + (entry.directory ? '' : bytes(entry.size)) + '</span>'
      row.addEventListener('click', () => entry.directory ? list(entry.path) : show(entry.path, row))
      tree.append(row)
    }
  }

  /** A size a person reads, rather than a number of bytes to count digits in. */
  const bytes = (n) => {
    if (typeof n !== 'number') return ''
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB'
  }

  const show = async (path, row) => {
    fileSaid.textContent = ''
    for (const node of tree.querySelectorAll('button')) node.removeAttribute('aria-current')
    if (row !== undefined) row.setAttribute('aria-current', 'true')
    const response = await fetch('/sandbox/raw/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/'),
      { credentials: 'same-origin' })
    const bytes = await response.arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    // A file with a NUL in it is not one to edit in a textarea; saying so
    // beats handing back mojibake and writing it out again.
    if (text.includes('\\u0000')) { editor.value = dshText('files.binary'); open = undefined; }
    else { editor.value = text; open = path }
    editing(true)
    // A binary file is shown as the line that says so, and not edited: leaving
    // Save live over it would write that sentence into the file.
    save.disabled = open === undefined
    remove.disabled = open === undefined
    editor.readOnly = open === undefined
  }

  save.addEventListener('click', async () => {
    if (open === undefined) return
    save.disabled = true
    const response = await fetch('/sandbox/fs/write?path=' + encodeURIComponent(open), {
      method: 'POST', credentials: 'same-origin', body: new Blob([editor.value]),
    })
    fileSaid.textContent = response.ok ? dshText('files.saved') : dshText('failed')
    save.disabled = false
  })

  remove.addEventListener('click', async () => {
    if (open === undefined) return
    const response = await fetch('/sandbox/fs/remove', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: open }),
    })
    fileSaid.textContent = response.ok ? dshText('files.deleted') : dshText('failed')
    if (response.ok) { editor.value = ''; open = undefined; save.disabled = true; remove.disabled = true; list(at) }
  })

  // ---- the terminal -----------------------------------------------------
  const term = new Terminal({
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true,
    theme: { background: '#1b1b1c', foreground: '#e6e6e6' },
  })
  term.open($('terminal'))

  /**
   * Make the shell as wide as the box it is drawn in, and tell it so.
   *
   * Measured rather than guessed, and without the fit addon: one more package
   * for one number is not worth carrying into a page whose whole point is to
   * work when little else does. A monospace cell is measured off a probe in
   * the page's own font, which is the same thing the addon does.
   *
   * The sandbox has to be told as well as the renderer — a shell that thinks
   * it has 80 columns wraps at 80 however wide the window is.
   */
  const fit = () => {
    const probe = document.createElement('span')
    probe.textContent = 'MMMMMMMMMM'
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;'
      + 'font:12px ui-monospace, SFMono-Regular, Menlo, monospace'
    document.body.append(probe)
    const cell = probe.getBoundingClientRect().width / 10
    probe.remove()
    const box = $('terminal').getBoundingClientRect()
    if (cell <= 0 || box.width <= 0) return
    const cols = Math.max(20, Math.floor((box.width - 16) / cell))
    const rows = Math.max(6, Math.floor((box.height - 12) / (12 * 1.2)))
    term.resize(cols, rows)
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'size', cols: cols, rows: rows }))
  }
  window.addEventListener('resize', fit)
  $('terminal').addEventListener('click', () => term.focus())

  // The socket, and how it comes back.
  //
  // A pty ends for reasons that have nothing to do with the tenant: the shell
  // exits, envd drops a long-lived stream, a laptop sleeps, the gateway is
  // restarted under them. Every one of those left a dead black box with
  // "disconnected" written in it, on the one page whose promise is that the
  // machine is still reachable — so the terminal now dials again by itself.
  //
  // Backing off rather than hammering: a machine that is genuinely gone should
  // not be asked ten times a second, and a person watching wants the first
  // retry to be quick.
  let socket
  let attempt = 0
  const lost = $('terminal-lost')

  const connect = () => {
    socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/sandbox/pty')

    // The shell starts on connect; the frames are the ones terminal.js speaks —
    // ready, out, exit, error one way, in and size the other. No handshake of
    // this page's own, so there is one protocol rather than two spellings of it.
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data)
      if (frame.type === 'out') {
        const binary = atob(frame.data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        term.write(bytes)
        return
      }
      if (frame.type === 'ready') {
        attempt = 0
        lost.hidden = true
        fit()
        term.focus()
        return
      }
      // Escaped twice on purpose: this script is written out of a template
      // literal, so an unescaped \\r\\n is a real newline inside a single-quoted
      // string by the time a browser parses it — which is a SyntaxError, and one
      // that takes the whole script with it rather than just this line.
      if (frame.type === 'exit' || frame.type === 'error') term.write('\\r\\n[' + (frame.message ?? 'exit ' + frame.code) + ']\\r\\n')
    })

    socket.addEventListener('close', () => {
      lost.hidden = false
      attempt += 1
      // 0.5s, 1s, 2s, 4s, then every 8s.
      setTimeout(connect, Math.min(8000, 500 * Math.pow(2, attempt - 1)))
    })
  }
  connect()

  term.onData((data) => {
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) return
    // The same encoding the panel's terminal uses: UTF-8 bytes, then base64,
    // because btoa on a multi-byte character throws.
    const bytes = new TextEncoder().encode(data)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    socket.send(JSON.stringify({ type: 'in', data: btoa(binary) }))
  })

  // ---- the three ways out -----------------------------------------------
  const act = async (button, said, url, body) => {
    button.disabled = true
    said.textContent = dshText('working')
    try {
      const response = await fetch(url, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
      })
      if (!response.ok) { said.textContent = dshText('failed'); button.disabled = false; return false }
      return true
    } catch { said.textContent = dshText('failed'); button.disabled = false; return false }
  }

  // Both ways back go to the application and wait there, rather than reporting
  // success here. Whether it worked is not a thing this page can see: the
  // backend answers the gateway, not the browser, and "started" only means the
  // command returned. The application is where a person was going anyway, it
  // shows its own coming-up state, and if the backend dies again its status
  // stream brings them straight back here. One place that decides, instead of
  // two that guess.
  const goBack = () => { location.href = '/app' }

  // Restart is a NEW MACHINE from the current template, keeping the volume, and
  // that is the difference worth having: the machine boots the way its template
  // says to boot. Starting the backend runs a command this gateway spells out,
  // which is one more copy of the sandbox's own start-up to keep in step — it
  // stays because it is the cheap answer when a tenant has just fixed a file
  // and nothing else is wrong.
  $('restart').addEventListener('click', async () => {
    if (await act($('restart'), $('start-said'), '/recovery/rebuild')) goBack()
  })

  $('start').addEventListener('click', async () => {
    if (await act($('start'), $('start-said'), '/recovery/backend')) goBack()
  })

  const dialog = $('confirm'), acknowledge = $('acknowledge'), go = $('confirm-go')
  $('wipe').addEventListener('click', () => { acknowledge.checked = false; go.disabled = true; dialog.showModal() })
  acknowledge.addEventListener('change', () => { go.disabled = !acknowledge.checked })
  $('confirm-cancel').addEventListener('click', () => dialog.close())
  go.addEventListener('click', async () => {
    dialog.close()
    if (await act($('wipe'), $('wipe-said'), '/recovery/wipe', { acknowledged: true })) location.href = '/app'
  })

  readLog()
  list('/mnt')
})()
</script>
${GROUND_SCRIPT}
</body>
</html>`
}
