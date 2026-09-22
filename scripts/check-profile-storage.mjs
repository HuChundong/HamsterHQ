/** Verify profile ownership across layout migration and image replacement. */
import assert from 'node:assert/strict'
import { modelDefaults } from '../packages/dsh-model-defaults/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, rmSync, readlinkSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const metadata = {
  MODEL_PROVIDER_ID: 'deployment', MODEL_PROVIDER_NAME: 'Deployment model', MODEL_ID: 'model-id', MODEL_NAME: 'Model name',
  MODEL_BASE_URL: 'https://model.invalid/v1', MODEL_API: 'openai-completions', MODEL_COMPAT: '{"supportsDeveloperRole":false}',
  MODEL_INPUT: 'text, image, ', MODEL_REASONING_EFFORTS: 'low, high, ', MODEL_DEFAULT_EFFORT: 'high',
  MODEL_API_KEY: 'do-not-serialize-verification-secret',
}
const built = JSON.parse(JSON.stringify(modelDefaults(metadata)))
assert.deepEqual(built, [{ id: 'llm-pi-ai', config: { providers: { deployment: {
  api: 'openai-completions', displayName: 'Deployment model', baseURL: 'https://model.invalid/v1', apiKeyEnv: 'MODEL_API_KEY',
  compat: { supportsDeveloperRole: false }, models: [{ id: 'model-id', name: 'Model name', input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high' } }],
} } } }, { id: 'agent-default-model', config: { provider: 'deployment', model: 'model-id', reasoningEffort: 'high' } }])
assert.ok(!JSON.stringify(built).includes(metadata.MODEL_API_KEY))
assert.ok(!JSON.stringify(built).includes('__jsExpr'))
assert.deepEqual(modelDefaults({}), [])
const minimal = modelDefaults({ MODEL_PROVIDER_ID: 'minimal', MODEL_ID: 'id' })
assert.equal(minimal[0].config.providers.minimal.displayName, 'minimal')
assert.equal(minimal[0].config.providers.minimal.models[0].name, 'id')
assert.equal(minimal[0].config.providers.minimal.api, 'openai-completions')
assert.ok(!('compat' in minimal[0].config.providers.minimal))
assert.throws(() => modelDefaults({ MODEL_PROVIDER_ID: 'invalid', MODEL_COMPAT: '{' }))
const root = mkdtempSync(path.join(tmpdir(), 'dsh-profile-'))
try {
  const home = path.join(root, 'tenant')
  const image = path.join(root, 'image')
  const nextImage = path.join(root, 'next-image')
  mkdirSync(home)
  for (const base of [image, nextImage]) {
    const profile = path.join(base, 'profiles/web')
    mkdirSync(path.join(profile, 'node_modules/image-owned'), { recursive: true })
    cpSync('packages/dsh-model-defaults', path.join(profile, 'node_modules/dsh-model-defaults'), { recursive: true })
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
  assert.equal(readlinkSync(path.join(profile, 'node_modules/image-owned')), path.join(nextImage, 'profiles/web/node_modules/image-owned'))
  assert.equal(lstatSync(path.join(profile, 'node_modules/dsh-model-defaults')).isSymbolicLink(), false)
  assert.deepEqual(JSON.parse(readFileSync(path.join(profile, 'node_modules/dsh-model-defaults/cordis.patch.yml'))), [])
  const entrypoint = readFileSync('sandbox/entrypoint.sh', 'utf8')
  assert.ok(entrypoint.indexOf('if [ "$LAYOUT_AT" -gt') < entrypoint.indexOf('node /app/sandbox/prepare-profile.mjs'))
  assert.ok(entrypoint.indexOf('if [ "$LAYOUT_AT" -gt') < entrypoint.indexOf('node /app/sandbox/migrate-storage-paths.mjs'))
  assert.ok(!entrypoint.includes('--patch /app/sandbox/cordis.model.patch.yml'))
  console.log('check-profile-storage: legacy link migration, persistent settings, custom bundles and refreshed image modules pass')
} finally {
  rmSync(root, { recursive: true, force: true })
}
