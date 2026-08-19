/**
 * What kind of file a path is, and what that means for showing it.
 *
 * Named rather than sniffed, in one place rather than three: the pane asks
 * what to draw with, the highlighter asks which grammar, and the tree and the
 * tab ask which mark. Those three answers are the same fact about a file, so
 * they are decided here together and stay consistent with each other.
 *
 * @module kinds
 */

import { basename } from './api.js'

/**
 * Extensions whose bytes are not text and have no viewer here.
 *
 * Everything used to fall through to the text viewer, which fetched the
 * bytes, decoded them as UTF-8 and painted whatever came out — so opening a
 * zip filled the pane with mojibake. That is worse than a refusal: it looks
 * like a broken file rather than a viewer that was never written, and it
 * costs the whole download to say nothing.
 *
 * Named rather than sniffed. Reading the first bytes to guess would be a
 * round trip to answer a question the extension already answers for every
 * file anyone actually opens, and a wrong guess about a text file is a
 * pane that refuses something it could have shown.
 */
const OPAQUE = new Set([
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z', 'jar', 'war',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv',
  'so', 'dylib', 'dll', 'exe', 'bin', 'o', 'a', 'class', 'wasm',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'db', 'sqlite', 'sqlite3', 'parquet',
])

export function viewerFor(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico'].includes(ext)) return 'image'
  if (['html', 'htm'].includes(ext)) return 'html'
  if (['md', 'markdown'].includes(ext)) return 'markdown'
  if (OPAQUE.has(ext)) return 'opaque'
  return 'text'
}

/**
 * The grammar name to highlight a file under.
 *
 * Mapped from the extension rather than passed through, because a fence
 * info string and a file extension only sometimes agree — `.py` is
 * `python`, `.yml` is `yaml`. An unmapped extension is handed over as-is:
 * shiki either knows it or renders plain, and both are better than
 * deciding here that it cannot be highlighted.
 *
 * @param {string} path - the file's path.
 * @returns {string} a grammar hint.
 */
/**
 * What each extension is highlighted as.
 *
 * Out here rather than inside `grammarFor`, because two questions read it:
 * which grammar to colour a file with, and whether the thing is code at
 * all. The second cannot be answered from the first's return — a lookup
 * that misses answers with the extension itself, and several entries
 * (`go`, `c`, `json`) answer with it too.
 */
const GRAMMARS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
  yml: 'yaml', yaml: 'yaml', json: 'json', toml: 'toml', ini: 'ini',
  css: 'css', scss: 'scss', less: 'less', html: 'html', xml: 'xml',
  sql: 'sql', php: 'php', swift: 'swift', kt: 'kotlin', lua: 'lua',
  dockerfile: 'dockerfile', makefile: 'makefile',
}

export function grammarFor(path) {
  const name = basename(path).toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return GRAMMARS[ext] ?? ext
}

/**
 * Kinds a viewer does not distinguish but a reader scanning a tree does.
 *
 * Everything here opens as text or does not open at all, so `viewerFor`
 * has no reason to tell them apart — but a column of thirty identical
 * pages is a column nobody can scan, and the extension is already on the
 * row saying which is which. The icon is the same fact, read faster.
 *
 * Keyed by extension rather than by the grammar name, because the grammar
 * table answers "how is this highlighted" and several of these have no
 * grammar at all.
 */
const KIND_BY_EXTENSION = {
  json: 'data', yml: 'data', yaml: 'data', toml: 'data', ini: 'data', env: 'data',
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive',
  xz: 'archive', rar: 'archive', '7z': 'archive',
  // No pdf: the set this half comes from has no honest mark for one, and a
  // page with a badge that says something else is worse than the plain
  // page. The panel cannot open one either, so nothing is lost by it
  // looking like every other file it cannot open.
  csv: 'table', tsv: 'table', xls: 'table', xlsx: 'table',
  mp3: 'media', wav: 'media', ogg: 'media', flac: 'media',
  mp4: 'media', webm: 'media', mov: 'media', mkv: 'media',
}

export function iconFor(path) {
  const kind = viewerFor(path)
  if (kind === 'image') return 'image'
  if (kind === 'html') return 'browser'
  if (kind === 'markdown') return 'markdown'
  const name = basename(path).toLowerCase()
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  const byExtension = KIND_BY_EXTENSION[extension]
  if (byExtension !== undefined) return byExtension
  // Code when the grammar table knows the extension, and a plain page
  // otherwise. The test used to be whether `grammarFor` answered with the
  // name it was given, which made every unfamiliar extension code — a
  // `.log` and a `.bak` wore the same icon as a `.rs` — and every
  // extensionless file plain, which made `Makefile` and `Dockerfile`
  // documents. Both are the wrong way round, and neither showed while
  // only the tab read this.
  return GRAMMARS[extension === '' ? name : extension] === undefined ? 'file' : 'code'
}
