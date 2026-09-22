/** Verify profile ownership across layout migration and image replacement. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, rmSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const root = mkdtempSync(path.join(tmpdir(), 'dsh-profile-'))
try {
  const home = path.join(root, 'tenant')
  const image = path.join(root, 'image')
  const nextImage = path.join(root, 'next-image')
  mkdirSync(home)
  for (const base of [image, nextImage]) {
    const profile = path.join(base, 'profiles/web')
    mkdirSync(path.join(profile, 'node_modules/dsh-model-defaults'), { recursive: true })
    writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
  }
  symlinkSync(path.join(image, 'profiles'), path.join(home, 'profiles'))
  writeFileSync(path.join(home, 'settings.yaml'), 'ui-theme:\n  preference: dark\n')
  execFileSync(process.execPath, ['sandbox/migrate-storage-paths.mjs', home, '/mnt/workspace', '2', '3'])
  execFileSync(process.execPath, ['sandbox/prepare-profile.mjs', home, image], { env: { ...process.env, MODEL_PROVIDER_ID: 'test' } })
  assert.equal(lstatSync(path.join(home, 'profiles')).isSymbolicLink(), false)
  const profile = path.join(home, 'profiles/web')
  const patch = path.join(profile, 'cordis.patch.yml')
  const saved = '- id: ui-theme\n  config:\n    preference: dark\n'
  writeFileSync(patch, saved)
  const manifestPath = path.join(profile, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles.push('tenant-custom')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  mkdirSync(path.join(profile, 'node_modules/tenant-custom'))
  execFileSync(process.execPath, ['sandbox/prepare-profile.mjs', home, nextImage], { env: { ...process.env, MODEL_PROVIDER_ID: '' } })
  assert.equal(readFileSync(patch, 'utf8'), saved)
  assert.equal(readFileSync(path.join(home, 'settings.yaml'), 'utf8'), 'ui-theme:\n  preference: dark\n')
  assert.deepEqual(JSON.parse(readFileSync(manifestPath)).dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'tenant-custom'])
  assert.ok(lstatSync(path.join(profile, 'node_modules/tenant-custom')).isDirectory())
  assert.equal(readlinkSync(path.join(profile, 'node_modules/dsh-model-defaults')), path.join(nextImage, 'profiles/web/node_modules/dsh-model-defaults'))
  const entrypoint = readFileSync('sandbox/entrypoint.sh', 'utf8')
  assert.ok(entrypoint.indexOf('if [ "$LAYOUT_AT" -gt') < entrypoint.indexOf('node /app/sandbox/prepare-profile.mjs'))
  assert.ok(entrypoint.indexOf('if [ "$LAYOUT_AT" -gt') < entrypoint.indexOf('node /app/sandbox/migrate-storage-paths.mjs'))
  assert.ok(!entrypoint.includes('--patch /app/sandbox/cordis.model.patch.yml'))
  console.log('check-profile-storage: legacy link migration, persistent settings, custom bundles and refreshed image modules pass')
} finally {
  rmSync(root, { recursive: true, force: true })
}
