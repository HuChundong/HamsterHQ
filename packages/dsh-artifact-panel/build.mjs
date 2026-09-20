/**
 * Bundle the panel's browser half.
 *
 * Bundle the file and canvas modules with their workspace-path helper.
 *
 * What is NOT bundled is anything the shell already provides. The source calls
 * `require('react')` and friends, but that `require` is the parameter of the
 * factory `__ModuleLoader__.load` hands in — a local binding, not the
 * CommonJS one — so the bundler leaves it alone, and React stays the shell's
 * single copy rather than a second one shipped in here.
 *
 * Output is `lib/client.js`, which `package.json` names as the client entry.
 * It is not committed: it is derived, and the thing to read is `src/`.
 *
 * Run: npm run build
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const here = path.dirname(fileURLToPath(import.meta.url))

const result = await build({
  entryPoints: [path.join(here, 'src/client.js')],
  outfile: path.join(here, 'lib/client.js'),
  bundle: true,
  // An IIFE, because the client registry evaluates this file as a script and
  // the file's own job is to call `__ModuleLoader__.load` once.
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  // Readable in a browser's sources pane. This is a panel, not a hot path, and
  // being able to read what is running is worth more than the bytes.
  minify: false,
  legalComments: 'inline',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})

if (result.errors.length > 0) process.exit(1)
