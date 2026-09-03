/**
 * What this panel says, in both languages, and how a string is asked for.
 *
 * Its own dictionary namespace rather than the shell's, so a key added here
 * cannot collide with one upstream adds and a deployment that drops this
 * plugin takes its strings with it.
 *
 * The context is set once, when the plugin is applied, because the locale
 * service lives on it and it does not exist before then. Everything that reads
 * a string reads it inside a render or a handler, which is after that.
 *
 * @module i18n
 */

import { React } from './runtime.js'

/**
 * Remember the applied context, which is what a string is read through.
 * @param {object} ctx - the applied plugin context.
 */
export function setPlugin(ctx) {
  plugin = ctx
}

/**
 * This plugin's own dictionary namespace; see `dsh-sandbox-host` for why.
 *
 * `LOCALE_NS`, not `NS`: this file already had an `NS`, and it is the CSS
 * class prefix.
 */
export const LOCALE_NS = 'hamsterhq.panel'

/** The plugin context, captured at mount, for the callers that are not components. */
let plugin

/**
 * Translate, and re-render when the language changes.
 * @returns {(key: string, params?: object) => string} the translator.
 */
export const useT = () => {
  React.useSyncExternalStore(
    (notify) => plugin.locale.subscribe(notify),
    () => plugin.locale.getSnapshot(),
  )
  return plugin.locale.bind(LOCALE_NS)
}

/** Translate outside a component. */
export const say = () => plugin.locale.bind(LOCALE_NS)

/**
 * What to show for a problem the server reported: a code, worded here.
 * See `dsh-tenant-account` for why the server does not word it itself.
 * @param {(key: string, params?: object) => string} t - the translator.
 * @param {unknown} problem - whatever the server put in `error`.
 * @param {string} fallback - the key to use when the code is unknown.
 * @param {object} [values] - what the fallback's own wording interpolates.
 * @returns {string} what to show.
 */
export const fromServer = (t, problem, fallback, values) => {
  const code = typeof problem === 'string' ? problem : problem?.code
  if (typeof code !== 'string') return t(fallback, values)
  const key = `error.${code}`
  const said = t(key, problem?.params)
  return said === key ? t(fallback, values) : said
}

export const DICTIONARY = {
  zh: {
    'terminal.n': '终端 {n}',
    terminal: '终端',

    'tool.files': '文件',
    'tool.files.note': '浏览这台沙箱里的工作区',
    'tool.terminal': '终端',
    'tool.terminal.note': '在沙箱里开一个 shell',
    'tool.canvas': '画布',
    'tool.canvas.note': '看 agent 正在做的页面',
    'tool.browser': '浏览器',
    'tool.browser.note': '看 agent 正在浏览的网页',
    'tool.computer': '电脑',
    'tool.computer.note': '通过桌面直接操作沙箱',
    'computer.launch': '打开电脑',

    'tab.close': '关闭 {name}',
    'panel.open': '打开工具',
    'panel.expand': '占满',
    'panel.restore': '恢复宽度',
    'panel.collapse': '收起侧边栏',
    'panel.reveal': '打开侧边栏',

    'empty.opened': '已打开',
    'stub.title': '「{name}」还没有接上',
    'stub.note': '这一步只有界面，没有数据。',

    more: '更多',
    'more.of': '{name} 的操作',
    loading: '读取中…',
    'tree.empty': '空目录',
    'tree.nomatch': '没有匹配的文件',
    'filter.placeholder': '筛选文件…',
    'filter.label': '筛选文件',

    'preview.preparing': '准备预览…',
    'preview.opaque': '暂不支持预览。',
    copy: '复制',
    copied: '已复制',
    'copy.text': '复制内容',
    'copied.text': '已复制内容',
    'copy.path': '复制路径',
    'copied.path': '已复制路径',

    expand: '展开{title}',
    collapse: '收起{title}',

    'terminal.end': '结束',
    'terminal.end.of': '结束 {name}',
    'terminal.new': '新建会话',
    'terminal.list': '会话列表',
    'terminal.count': '{n} 个会话',
    'terminal.unreachable': '连不上终端。',
    'terminal.over': '这个会话已经结束了。关掉这个标签再开一个。',

    preview: '预览',
    source: '源码',
    refresh: '刷新',
    'files.tree': '文件树',
    'files.aside': '文件',
    'files.pick': '从右边选一个文件',

    'canvas.looking': '看看有什么…',
    'canvas.none': '还没有页面',
    'canvas.none.note': '让 agent 在工作区里写一个 .html，这里会自己出现。',
    reload: '重新加载',

    'browser.off': '沙箱里没有浏览器在运行',
    'browser.off.note': '这台沙箱没有带浏览器，或者它已经退出了。',
    'browser.none': '还没有打开的网页',
    'browser.none.note': '让 agent 打开一个网页，这里会跟着显示。',
    'browser.list': '页面列表',
    'browser.count': '{n} 个页面',

    'menu.create': '新建文件',
    'menu.mkdir': '新建文件夹',
    'menu.rename': '重命名',
    'menu.delete': '删除',

    'ask.delete': '删除',
    'ask.rename': '重命名',
    'ask.mkdir': '新建文件夹',
    'ask.create': '新建文件',
    'ask.delete.directory': '确定删除目录「{name}」及其全部内容？此操作不可撤销。',
    'ask.delete.file': '确定删除文件「{name}」？此操作不可撤销。',
    'ask.name.folder': '文件夹名称',
    'ask.name.file': '文件名称',
    'ask.name.new': '新的名称',
    'ask.noslash': '名称里不能有 /',
    'ask.cancel': '取消',
    'ask.busy': '处理中…',
    'ask.confirm': '确定',

    'crashed': '侧边栏出错了',

    // Keyed by the codes the gateway sends; anything else falls back to
    // the plain wording beside it.
    'error.read': '读取失败（{status}）',
    'error.act': '操作失败（{status}）',
    'error.preview': '无法预览这个文件',
    'error.sandbox.not_ready': '沙箱还没准备好，请稍后再试。',
    'error.sandbox.silent': '沙箱没有回应。',
    'error.file.unreadable': '读不到这个文件。',
  },
  en: {
    'terminal.n': 'Terminal {n}',
    terminal: 'Terminal',

    'tool.files': 'Files',
    'tool.files.note': 'Browse the workspace on this sandbox',
    'tool.terminal': 'Terminal',
    'tool.terminal.note': 'Open a shell in the sandbox',
    'tool.canvas': 'Canvas',
    'tool.canvas.note': 'See the page the agent is building',
    'tool.browser': 'Browser',
    'tool.browser.note': 'Watch the page the agent is browsing',
    'tool.computer': 'Computer',
    'tool.computer.note': 'Operate the sandbox desktop directly',
    'computer.launch': 'Open computer',

    'tab.close': 'Close {name}',
    'panel.open': 'Open a tool',
    'panel.expand': 'Fill the window',
    'panel.restore': 'Restore the width',
    'panel.collapse': 'Collapse the panel',
    'panel.reveal': 'Open the panel',

    'empty.opened': 'open',
    'stub.title': '“{name}” is not wired up yet',
    'stub.note': 'This step is the interface only; there is no data behind it.',

    more: 'More',
    'more.of': 'Actions for {name}',
    loading: 'Reading…',
    'tree.empty': 'Empty directory',
    'tree.nomatch': 'No file matches',
    'filter.placeholder': 'Filter files…',
    'filter.label': 'Filter files',

    'preview.preparing': 'Preparing the preview…',
    'preview.opaque': 'Preview is not supported yet.',
    copy: 'Copy',
    copied: 'Copied',
    'copy.text': 'Copy the contents',
    'copied.text': 'Contents copied',
    'copy.path': 'Copy the path',
    'copied.path': 'Path copied',

    expand: 'Show {title}',
    collapse: 'Hide {title}',

    'terminal.end': 'End',
    'terminal.end.of': 'End {name}',
    'terminal.new': 'New session',
    'terminal.list': 'Sessions',
    'terminal.count': '{n} sessions',
    'terminal.unreachable': 'Could not reach the terminal.',
    'terminal.over': 'This session has ended. Close the tab and open another.',

    preview: 'Preview',
    source: 'Source',
    refresh: 'Refresh',
    'files.tree': 'File tree',
    'files.aside': 'Files',
    'files.pick': 'Choose a file on the right',

    'canvas.looking': 'Looking for one…',
    'canvas.none': 'No page yet',
    'canvas.none.note': 'Ask the agent to write a .html in the workspace and it appears here by itself.',
    reload: 'Reload',

    'browser.off': 'No browser is running in the sandbox',
    'browser.off.note': 'This sandbox carries no browser, or it has exited.',
    'browser.none': 'No page is open yet',
    'browser.none.note': 'Ask the agent to open a page and it shows up here as it browses.',
    'browser.list': 'Pages',
    'browser.count': '{n} pages',

    'menu.create': 'New file',
    'menu.mkdir': 'New folder',
    'menu.rename': 'Rename',
    'menu.delete': 'Delete',

    'ask.delete': 'Delete',
    'ask.rename': 'Rename',
    'ask.mkdir': 'New folder',
    'ask.create': 'New file',
    'ask.delete.directory': 'Delete the directory “{name}” and everything in it? This cannot be undone.',
    'ask.delete.file': 'Delete the file “{name}”? This cannot be undone.',
    'ask.name.folder': 'Folder name',
    'ask.name.file': 'File name',
    'ask.name.new': 'New name',
    'ask.noslash': 'A name cannot contain /',
    'ask.cancel': 'Cancel',
    'ask.busy': 'Working…',
    'ask.confirm': 'OK',

    'crashed': 'The panel hit an error',

    'error.read': 'Could not read it ({status})',
    'error.act': 'That did not work ({status})',
    'error.preview': 'This file cannot be previewed',
    'error.sandbox.not_ready': 'The sandbox is not ready yet. Try again shortly.',
    'error.sandbox.silent': 'The sandbox did not answer.',
    'error.file.unreadable': 'That file could not be read.',
  },
}
