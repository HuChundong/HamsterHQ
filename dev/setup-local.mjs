/** Write a fresh local deployment environment without copying model credentials. */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'
import process from 'node:process'
import { hashPassword } from '../admin/auth.js'
const source = resolve(process.argv[2] || '.env')
const output = resolve(process.argv[3] || '/tmp/dsh-sidebar.env')
if (source === output) throw new Error('Use a separate output environment file')
const env = parseEnv(readFileSync(source, 'utf8'))
const project = process.env.LOCAL_PROJECT_NAME ?? `dsh-acceptance-${randomBytes(6).toString('hex')}`
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project))
  throw new Error('LOCAL_PROJECT_NAME must be a valid Compose project name')
const password = randomBytes(24).toString('hex')
const secret = () => randomBytes(32).toString('hex')
const local = {
  SESSION_SECRET: secret(),
  POSTGRES_PASSWORD: secret(),
  ADMIN_SESSION_SECRET: secret(),
  INTERNAL_SHARED_SECRET: secret(),
  ADMIN_PASSWORD_HASH: await hashPassword(password),
  RESEND_API_KEY: 'development-mailbox',
  EMAIL_API_URL: 'http://mailbox:8025/emails',
  GATEWAY_ADMINS: 'delivered+sidebar-admin@resend.dev',
  REGISTRATION: 'invite',
  GATEWAY_PORT: '127.0.0.1:18090',
  GATEWAY_TLS_PORT: '18443',
  TLS_BIND: '127.0.0.1',
  SANDBOX_RUNTIME: 'docker',
  SANDBOX_IDLE_TTL_MS: '3600000',
  COMPOSE_PROJECT_NAME: project,
  COMPOSE_NETWORK: `${project}_hamsterhq-net`,
  MODEL_SOURCE_ENV: source,
  MODEL_API_KEY: 'local-proxy-placeholder',
  MODEL_BASE_URL: 'http://model-proxy:8098/v1',
}
for (const key of [
  'MODEL_PROVIDER_ID',
  'MODEL_PROVIDER_NAME',
  'MODEL_API',
  'MODEL_ID',
  'MODEL_NAME',
  'MODEL_COMPAT',
  'MODEL_INPUT',
  'MODEL_REASONING_EFFORTS',
  'MODEL_DEFAULT_EFFORT',
  'DEPLOYMENT_TZ',
]) {
  if (env[key]) local[key] = env[key]
}
const quote = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
const created = []
try {
  writeFileSync(
    output,
    Object.entries(local)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join('\n') + '\n',
    { mode: 0o600, flag: 'wx' },
  )
  created.push(output)
  writeFileSync(`${output}.admin-password`, password, { mode: 0o600, flag: 'wx' })
} catch (error) {
  // Remove only files this invocation created; never overwrite an existing
  // password file or leave a new environment without its matching password.
  for (const path of created) unlinkSync(path)
  throw error
}
console.log(
  `Created ${output} and ${output}.admin-password; model credential remains only in the source file`,
)
