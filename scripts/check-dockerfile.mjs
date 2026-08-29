#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
const lock = JSON.parse(readFileSync(join(root, 'sandbox/dsh-package-lock.json'), 'utf8'))
const panelPatch = readFileSync(join(root, 'sandbox/desktop/kde/default-panel-launchers.patch'), 'utf8')
const desktopHealth = readFileSync(join(root, 'sandbox/desktop-health.mjs'), 'utf8')
const templateWarm = readFileSync(join(root, 'sandbox/template-warm.sh'), 'utf8')
const problems = []

const check = (condition, message) => {
  if (!condition) problems.push(message)
}

check(
  /^# syntax=docker\/dockerfile:1@sha256:[a-f0-9]{64}$/m.test(dockerfile),
  'Dockerfile must pin the BuildKit frontend by digest',
)

const pinned = dockerfile.match(/^ARG DSH_VERSION=(\S+)$/m)?.[1]
check(Boolean(pinned), 'Dockerfile must pin ARG DSH_VERSION')

for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-web-frontend']) {
  const resolved = lock.packages?.[`node_modules/${name}`]?.version
  check(resolved === pinned, `sandbox/dsh-package-lock.json resolves ${name}@${resolved}, expected ${pinned}`)
}

for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!entry.resolved) continue
  check(
    entry.resolved.startsWith('https://registry.npmjs.org/'),
    `sandbox/dsh-package-lock.json ${path} is pinned to a non-portable registry: ${entry.resolved}`,
  )
}

const required = [
  'FROM node:24.19.0-bookworm-slim AS sandbox-runtime',
  'FROM sandbox-runtime AS sandbox-contract',
  'FROM sandbox-contract AS sandbox-compose',
  'FROM sandbox-compose AS sandbox',
  'FROM sandbox-contract AS desktop-system',
  'FROM desktop-system AS desktop',
  'COPY --link --from=sandbox-compose /app/ /app/',
  'COPY --link --from=sandbox-compose /root/.dsh/ /root/.dsh/',
  'npm ci --omit=dev --no-audit --no-fund',
]
for (const line of required) check(dockerfile.includes(line), `Dockerfile is missing cache boundary: ${line}`)

check(
  panelPatch.includes('tasks.writeConfig("launchers", [')
    && panelPatch.includes('applications:org.kde.konsole.desktop')
    && !panelPatch.includes('+tasks.writeConfig("launchers", "applications:org.kde.discover.desktop'),
  'the default panel must replace Discover with Konsole using a launcher list',
)

check(!dockerfile.includes('FROM sandbox AS desktop'), 'desktop must not inherit the DSH payload before KDE is installed')

for (const signal of ['plasmashell', 'kwin_x11', 'theme-state', 'DESKTOP_HEALTH_SETTLE_MS']) {
  check(desktopHealth.includes(signal), `desktop template health must wait for ${signal}`)
}
check(
  desktopHealth.includes("processRunning('Xvnc')") && !desktopHealth.includes('listening(5900)'),
  'desktop template health must not poison Xvnc with bare TCP probes',
)
check(
  templateWarm.includes('rm -f "$HOME/.config/dsh-desktop/theme-state"'),
  'desktop template warm-up must clear the visible-readiness marker before boot',
)

const desktopStart = readFileSync(join(root, 'sandbox/start-desktop.sh'), 'utf8')
check(
  desktopStart.includes('pgrep -u desktop -x Xvnc')
    && desktopStart.includes('xdpyinfo')
    && !desktopStart.includes('port_open 5900')
    && !desktopStart.includes('chrome-launch'),
  'desktop startup must use process/X11 readiness instead of a bare VNC connection',
)

const chromeLaunch = readFileSync(join(root, 'sandbox/desktop/chrome-launch.sh'), 'utf8')
const lazyBrowser = readFileSync(join(root, 'sandbox/desktop/start-desktop-browser.sh'), 'utf8')
check(
  chromeLaunch.includes('${CHROME_PROFILE_DIR:-/mnt/browser-profile}')
    && chromeLaunch.includes('${CHROME_CACHE_DIR:-/tmp/desktop-chrome-cache}')
    && lazyBrowser.includes('start-desktop-browser: Chrome did not expose CDP'),
  'desktop Chrome must start on demand with persistent profile and ephemeral cache',
)

const systemStart = dockerfile.indexOf('FROM sandbox-contract AS desktop-system')
const finalStart = dockerfile.indexOf('FROM desktop-system AS desktop')
check(systemStart >= 0 && finalStart > systemStart, 'desktop-system must precede the final desktop stage')
if (systemStart >= 0 && finalStart > systemStart) {
  const instructions = dockerfile
    .slice(systemStart, finalStart)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  check(!instructions.includes('sandbox-compose'), 'desktop-system instructions must remain independent of sandbox-compose')
}

if (problems.length) {
  for (const problem of problems) console.error(`check-dockerfile: ${problem}`)
  process.exit(1)
}

console.log('check-dockerfile: harness lock and desktop cache boundaries agree')
