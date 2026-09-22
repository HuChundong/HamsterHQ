/** Keep tenant configuration persistent while refreshing image-owned packages. */
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, rmSync, symlinkSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [home, imageHome] = process.argv.slice(2)
if (!home || !imageHome || path.resolve(home) === path.resolve(imageHome)) throw new Error('prepare-profile requires distinct tenant and image homes')
const profile = path.join(home, 'profiles', 'web')
const image = path.join(imageHome, 'profiles', 'web')
if (lstatSync(path.join(home, 'profiles'), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('profile layout migration must run first')
mkdirSync(profile, { recursive: true })
const manifestPath = path.join(profile, 'package.json')
const manifest = lstatSync(manifestPath, { throwIfNoEntry: false })
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : JSON.parse(readFileSync(path.join(image, 'package.json'), 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
const bundles = manifest.dsh.profile.bundles ?? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const defaults = 'dsh-model-defaults'
manifest.dsh.profile.bundles = bundles.filter(name => name !== defaults)
if (process.env.MODEL_PROVIDER_ID) {
  const selected = manifest.dsh.profile.bundles
  const afterWeb = selected.indexOf('@deepseek-ai/dsh-web-app') + 1
  selected.splice(afterWeb || selected.length, 0, defaults)
}
const temporary = `${manifestPath}.preparing`
writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
renameSync(temporary, manifestPath)
// Retain upstream's package-manager policy without overwriting tenant edits.
const workspace = path.join(profile, 'pnpm-workspace.yaml')
const imageWorkspace = path.join(image, 'pnpm-workspace.yaml')
if (!lstatSync(workspace, { throwIfNoEntry: false }) && lstatSync(imageWorkspace, { throwIfNoEntry: false })) {
  copyFileSync(imageWorkspace, workspace)
}
const patch = path.join(profile, 'cordis.patch.yml')
if (!lstatSync(patch, { throwIfNoEntry: false })) writeFileSync(patch, '[]\n', { mode: 0o600 })

// Link individual image-owned packages, retaining tenant-installed packages.
const modules = path.join(profile, 'node_modules')
if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(modules)
mkdirSync(modules, { recursive: true })
for (const entry of readdirSync(path.join(image, 'node_modules'), { withFileTypes: true })) {
  if (entry.name.startsWith('.')) continue
  const names = entry.name.startsWith('@')
    ? readdirSync(path.join(image, 'node_modules', entry.name)).map(name => `${entry.name}/${name}`)
    : [entry.name]
  for (const name of names) {
    if (name === defaults) continue
    const destination = path.join(modules, name)
    mkdirSync(path.dirname(destination), { recursive: true })
    rmSync(destination, { force: true, recursive: true })
    symlinkSync(path.join(image, 'node_modules', name), destination)
  }
}

// Materialize only deployment metadata, never the credential value. Keeping the
// inherited config plain avoids merging an upstream __jsExpr wrapper into form edits.
const { modelDefaults } = await import(pathToFileURL(path.join(image, 'node_modules', defaults, 'index.js')))
const generated = path.join(modules, defaults)
if (lstatSync(generated, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(generated)
mkdirSync(generated, { recursive: true })
writeFileSync(path.join(generated, 'package.json'), `${JSON.stringify({
  name: defaults, version: '1.0.0', private: true, dsh: { bundle: { patch: './cordis.patch.yml' } },
})}\n`, { mode: 0o600 })
const generatedPatch = path.join(generated, 'cordis.patch.yml')
writeFileSync(`${generatedPatch}.preparing`, `${JSON.stringify(modelDefaults(process.env), null, 2)}\n`, { mode: 0o600 })
renameSync(`${generatedPatch}.preparing`, generatedPatch)
