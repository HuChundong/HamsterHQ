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
    zh: '机器是好的，跑在里面的后端没起来。下面是它自己的日志、你的文件，以及一个终端——多数情况下改一个文件就能修好。',
    en: 'The machine is fine; the backend inside it did not start. Below are its own log, your files, and a terminal — most of the time one file is all that needs changing.',
  },
  'log.title': { zh: '后端最后说了什么', en: 'What the backend said last' },
  'log.empty': { zh: '日志是空的——后端可能还没来得及写。', en: 'The log is empty — the backend may not have got that far.' },
  'log.refresh': { zh: '重新读取', en: 'Read it again' },
  'files.title': { zh: '机器上的文件', en: 'The files on the machine' },
  'files.hint': {
    zh: '整台机器都可以看和改。出问题最多的是 /mnt/dsh 下的配置。',
    en: 'The whole machine can be read and changed. Configuration under /mnt/dsh is what usually breaks a boot.',
  },
  'files.save': { zh: '保存', en: 'Save' },
  'files.delete': { zh: '删除', en: 'Delete' },
  'files.saved': { zh: '已保存', en: 'Saved' },
  'files.deleted': { zh: '已删除', en: 'Deleted' },
  'files.binary': { zh: '这是二进制文件，不在这里编辑。', en: 'A binary file, not edited here.' },
  'files.up': { zh: '上一层', en: 'Up' },
  'terminal.title': { zh: '终端', en: 'Terminal' },
  'terminal.hint': {
    zh: '就在这台机器上，以 root 身份。它不经过后端，所以后端死着也能用。',
    en: 'On this machine, as root. It does not go through the backend, which is why it works while the backend is down.',
  },
  'start.title': { zh: '改完之后', en: 'When you have fixed it' },
  'start.hint': { zh: '重新启动后端。数据一律不动。', en: 'Start the backend again. Nothing is touched.' },
  'start.action': { zh: '启动后端', en: 'Start the backend' },
  'start.working': { zh: '正在启动…', en: 'Starting…' },
  'start.ok': { zh: '起来了，正在回到应用…', en: 'It is up. Going back to the application…' },
  'start.failed': { zh: '还是没起来——再看一次日志。', en: 'Still down — read the log again.' },
  'last.title': { zh: '最后的办法', en: 'Last resorts' },
  'rebuild.hint': {
    zh: '换一台新机器。你的文件和历史都在卷上，会跟着回来。',
    en: 'Take a fresh machine. Your files and history are on the volume and come back with it.',
  },
  'rebuild.action': { zh: '重建沙箱', en: 'Rebuild the sandbox' },
  'wipe.hint': {
    zh: '连同卷一起删除：文件、会话历史、配置，全部消失，且无法恢复。',
    en: 'Delete the volume with it: files, session history, configuration — all of it, with no way back.',
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
  main { max-width: 62rem; }
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

  .tree { max-height: 18rem; overflow: auto; border: 1px solid var(--line-soft); border-radius: var(--radius-field); }
  .tree button {
    display: flex;
    gap: .5rem;
    width: 100%;
    padding: .3rem .75rem;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
    text-align: left;
    cursor: pointer;
  }
  .tree button:hover { background: var(--surface); }
  .tree button[aria-current="true"] { background: var(--surface); font-weight: 500; }
  .tree .kind { width: 1.25rem; color: var(--faint); }
  .tree .size { margin-left: auto; color: var(--faint); font-variant-numeric: tabular-nums; }
  .where { margin: 0 0 .5rem; color: var(--muted); font-family: var(--mono); font-size: .75rem; word-break: break-all; }

  .panes { display: grid; grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); gap: 1rem; }
  @media (max-width: 52rem) { .panes { grid-template-columns: minmax(0, 1fr); } }

  #terminal { height: 22rem; border-radius: var(--radius-field); overflow: hidden; background: #1b1b1c; }

  button.act {
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
  button.act:hover { border-color: var(--line-strong); }
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
    <p style="margin:0 0 1.25rem">${WORDMARK}</p>
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
      <h2 data-t="files.title">机器上的文件</h2>
      <p class="hint" data-t="files.hint">${escapeHtml(TABLE['files.hint'].zh)}</p>
      <div class="panes">
        <div>
          <p class="where" id="where">/mnt</p>
          <div class="tree" id="tree"></div>
        </div>
        <div>
          <textarea class="sheet" id="editor" spellcheck="false" aria-label="file"></textarea>
          <div class="row" style="margin-top:.6rem">
            <button class="act primary" id="save" data-t="files.save" disabled>保存</button>
            <button class="act danger" id="delete" data-t="files.delete" disabled>删除</button>
            <span class="said" id="file-said"></span>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 data-t="terminal.title">终端</h2>
      <p class="hint" data-t="terminal.hint">${escapeHtml(TABLE['terminal.hint'].zh)}</p>
      <div id="terminal"></div>
    </section>

    <section class="card">
      <h2 data-t="start.title">改完之后</h2>
      <p class="hint" data-t="start.hint">${escapeHtml(TABLE['start.hint'].zh)}</p>
      <div class="row">
        <button class="act primary" id="start" data-t="start.action">启动后端</button>
        <span class="said" id="start-said"></span>
      </div>
    </section>

    <section class="card">
      <h2 data-t="last.title">最后的办法</h2>
      <p class="hint" data-t="rebuild.hint">${escapeHtml(TABLE['rebuild.hint'].zh)}</p>
      <div class="row" style="margin-bottom:1.25rem">
        <button class="act" id="rebuild" data-t="rebuild.action">重建沙箱</button>
        <span class="said" id="rebuild-said"></span>
      </div>
      <p class="hint" data-t="wipe.hint">${escapeHtml(TABLE['wipe.hint'].zh)}</p>
      <div class="row">
        <button class="act danger" id="wipe" data-t="wipe.action">清空全部数据</button>
        <span class="said" id="wipe-said"></span>
      </div>
    </section>

    <p style="margin:1.5rem 0 0"><a href="/app" data-t="back">返回应用</a></p>
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
  let at = '/mnt', open = undefined

  const list = async (path) => {
    const response = await fetch('/sandbox/fs/list?path=' + encodeURIComponent(path), { credentials: 'same-origin' })
    if (!response.ok) return
    const body = await response.json()
    at = body.path
    where.textContent = at
    tree.replaceChildren()
    if (at !== '/') {
      const up = document.createElement('button')
      up.innerHTML = '<span class="kind">↑</span><span>' + dshText('files.up') + '</span>'
      up.addEventListener('click', () => list(at.slice(0, at.lastIndexOf('/')) || '/'))
      tree.append(up)
    }
    for (const entry of body.entries) {
      const row = document.createElement('button')
      const size = entry.directory ? '' : String(entry.size ?? '')
      row.innerHTML = '<span class="kind">' + (entry.directory ? '▸' : '·') + '</span>'
        + '<span class="grow">' + entry.name.replace(/[<&]/g, (c) => c === '<' ? '&lt;' : '&amp;') + '</span>'
        + '<span class="size">' + size + '</span>'
      row.addEventListener('click', () => entry.directory ? list(entry.path) : show(entry.path))
      tree.append(row)
    }
  }

  const show = async (path) => {
    fileSaid.textContent = ''
    const response = await fetch('/sandbox/raw/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/'),
      { credentials: 'same-origin' })
    const bytes = await response.arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    // A file with a NUL in it is not one to edit in a textarea; saying so
    // beats handing back mojibake and writing it out again.
    if (text.includes('\\u0000')) { editor.value = dshText('files.binary'); open = undefined; }
    else { editor.value = text; open = path }
    save.disabled = open === undefined
    remove.disabled = open === undefined
    for (const node of tree.querySelectorAll('button')) node.removeAttribute('aria-current')
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
  const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/sandbox/pty')
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
    if (frame.type === 'ready') { socket.send(JSON.stringify({ type: 'size', cols: term.cols, rows: term.rows })); return }
    if (frame.type === 'exit' || frame.type === 'error') term.write('\r\n[' + (frame.message ?? 'exit ' + frame.code) + ']\r\n')
  })
  term.onData((data) => {
    if (socket.readyState !== WebSocket.OPEN) return
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

  $('start').addEventListener('click', async () => {
    const said = $('start-said')
    said.textContent = dshText('start.working')
    if (await act($('start'), said, '/recovery/backend')) {
      said.textContent = dshText('start.ok')
      setTimeout(() => { location.href = '/app' }, 1500)
    } else {
      said.textContent = dshText('start.failed')
      readLog()
    }
  })

  $('rebuild').addEventListener('click', async () => {
    if (await act($('rebuild'), $('rebuild-said'), '/recovery/rebuild')) location.href = '/app'
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
