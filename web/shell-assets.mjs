/** Static addressing for the shell's query-addressed, published combo scripts. */
import { createHash } from 'node:crypto'

/** @param {string} html - the document the harness served. @returns {object} its boot graph. */
export function bootGraph(html) {
  const match = /(?:window\.__DSH_BOOT__|globalThis\[(?:"|')__DSH_BOOT__(?:"|')\])\s*=\s*(\{.*?\})<\/script>/s.exec(html)
  if (match === null) throw new Error('shell: no boot manifest in the served index.html')
  return JSON.parse(match[1].replaceAll('\\u003c', '<'))
}

/**
 * Resolve published references exactly as the root-mounted shell does.
 * The served document keeps upstream's base href="./"; at /app (no trailing
 * slash) that is the site root. A source map instead resolves against its
 * owning script, including upstream's query-only combo map references.
 * @param {string} reference - published asset or source-map reference.
 * @param {string} [parent] - owning script URL, otherwise the document root.
 * @returns {string} canonical request URI, including the complete query.
 */
export function assetUrl(reference, parent = '/') {
  const origin = 'http://dsh.invalid'
  const url = new URL(reference, new URL(parent, `${origin}/`))
  if (url.origin !== origin || !url.pathname.startsWith('/plugins/') || url.hash) {
    throw new Error('shell: asset is outside /plugins/')
  }
  return url.pathname + url.search
}

/**
 * Preserve each complete URL as an independent file; combo queries name bytes.
 * @param {string} url - the exact upstream asset URL.
 * @returns {string} path below nginx's document root.
 */
export function assetPath(url) {
  url = assetUrl(url)
  if (url.startsWith('/plugins/??')) {
    const hash = createHash('sha256').update(url).digest('hex')
    return `/plugins/combos/${hash}.${url.includes('/client.js.map') ? 'map' : 'js'}`
  }
  return url.split('?')[0]
}

/** @param {object} graph - the upstream graph. @returns {object[]} entries and initial batches. */
export function shellAssets(graph) {
  return [...graph.entries, ...graph.batches ?? []]
}

/**
 * Discover package-local lazy imports in a published entry or sibling chunk.
 * The host serves these outside combos, using the owning entry's revision.
 * @param {object} entry - owning boot graph entry.
 * @param {string} source - published JavaScript response.
 * @returns {string[]} revision-addressed sibling requests.
 */
export function lazyAssets(entry, source) {
  const requests = [...source.matchAll(/\brequire\.async\(\s*(["'])(\.\/client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js)\1\s*\)/g)]
  if (requests.length === 0) return []
  const prefix = `/plugins/??${entry.id}/client.js&rev=`
  const url = assetUrl(entry.url)
  if (!url.startsWith(prefix)) throw new Error(`shell: cannot resolve lazy chunks for ${entry.id}`)
  const revision = url.slice(prefix.length)
  return [...new Set(requests.map((match) => `/plugins/${entry.id}/${match[2].slice(2)}?rev=${revision}`))]
}

/** @param {object} graph - boot graph. @param {string} id - package name. @returns {string[]} all served copies. */
export function moduleAssets(graph, id) {
  const entry = graph.entries.find((row) => row.id === id)
  if (entry === undefined) throw new Error(`shell: missing ${id}`)
  return [...new Set([
    assetPath(entry.url),
    ...graph.batches?.filter((row) => row.entries.includes(id)).map((row) => assetPath(row.url)) ?? [],
    `/plugins/${id}/client.js`,
  ])]
}

/** @param {Iterable<string>} urls - combo URLs. @returns {string} exact-match nginx map. */
export function comboMap(urls) {
  const rows = []
  for (const url of new Set([...urls].map((url) => assetUrl(url)))) {
    if (!url.startsWith('/plugins/??')) continue
    if (/[\s"\\$;]/.test(url)) throw new Error('shell: combo URL cannot be quoted safely in nginx')
    rows.push(`  "${url}" "${assetPath(url)}";`)
  }
  // Upstream partitions combos below its URL limit; a long resource list is
  // a long exact key, so the default nginx hash bucket is too small.
  return `map_hash_bucket_size 16384;\nmap $request_uri $dsh_combo_asset {\n  default /missing-dsh-combo;\n${rows.join('\n')}\n}\n`
}
