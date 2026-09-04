/**
 * The corrections this deployment owes the system prompt.
 *
 * DSH is written for a person sitting at the machine that runs it. Two of its
 * shipped sections say so out loud: `app:web-surface` hands the agent
 * http://127.0.0.1:3080 as the address the user is looking at, and
 * `harness:source` calls /app a checkout to inspect and extend. Here both are
 * false and expensively so — the browser is on another machine behind the
 * gateway, so a loopback URL reaches nobody, and /app is published build
 * output baked into an image, so a patch there dies with the sandbox. An agent
 * that believes either one spends a turn offering the user a link they cannot
 * open, or editing a harness nothing will ever load.
 *
 * Configuration cannot fix this. A section's text belongs to whoever
 * registered it, `section()` is additive — a duplicate name inside one layer
 * throws — and `system-prompt.config.persona` set from `cordis.patch.yml` is
 * shadowed by the agent preset's own persona row, which mounts in a nearer
 * scope. The one seam that can rewrite text somebody else wrote is the
 * `system-prompt/assemble` waterfall, which is what this plugin listens on.
 *
 * Two properties of that seam are load-bearing. A plugin mounted from
 * `cordis.patch.yml` carries no scope tag, and an untagged listener is
 * dispatched for every scope including an agent preset's — so this reaches the
 * agent sessions a tenant actually runs. And a persona row declaring
 * `complete: true` makes the registry restore that persona as the sole section
 * AFTER the waterfall, discarding everything here; the shipped `minimal`
 * preset does exactly that, which is harmless only because it discards the
 * wrong text along with the correction.
 *
 * The listener runs on every model step, so it stays a Map lookup over a dozen
 * names and returns constant text: a prompt that differs between steps is a
 * prompt that cannot reuse the KV cache.
 *
 * @module dsh-deployment-prompt
 */

export const name = 'deployment-prompt'
export const inject = ['systemPrompt']

/**
 * This deployment's own facts, in its own namespace.
 *
 * Not `deployment:persona`: that name belongs to the prompt registry, which
 * registers it unconditionally, and a second registration in the same layer
 * throws. Order 1 puts this immediately after the persona at 0 and before
 * everything a tool contributes.
 */
const SANDBOX_SECTION = 'hamsterhq:sandbox'
const SANDBOX_ORDER = 1

const SANDBOX_TEXT = `This machine is a sandbox belonging to the user, not the user's own computer. Its filesystem is not theirs: nothing here is visible to them by path, and naming a path is not delivering a file.

/mnt/workspace is the only durable location. Everything outside it — /root, /tmp and /app included — is discarded when this sandbox is reclaimed. Anything the user is meant to keep or receive is written into /mnt/workspace.

The user reaches this backend through this deployment's gateway, from a browser on another machine.`

/**
 * The upstream sections this deployment contradicts, and what they say here.
 *
 * A Map rather than an object literal, because the key is a section name from
 * the assembly: an object lookup would answer for `constructor` and every
 * other prototype member.
 *
 * These names are not a versioned API — they are string constants in
 * `dsh-web-app` and `dsh-app-boot`. `scripts/check-deployment-prompt.mjs`
 * holds this table to the plugin, and `scripts/check-images.sh` holds the
 * names to the installed harness, so a DSH_VERSION bump that renames one fails
 * a build rather than silently restoring the sentence about 127.0.0.1.
 */
const REPLACEMENTS = new Map([
  ['app:web-surface', `You are interacting with the user through a web interface served by this deployment's gateway, on a machine you cannot reach. The browser is not on this host. No address that resolves inside this sandbox is an address the user can open: never hand them a loopback or private-network URL, and do not treat $DSH_WEB_URL as where they are — it is this sandbox's own loopback and reaches nobody.

When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean that interface. The browser provides no implicit DOM, route, or screenshot context.

That interface is not built from anything in this filesystem. Its shell and its plugin bundles are built into a separate image elsewhere and served by a separate web server; there is no checkout, no pnpm workspace, and no dev watcher here. A request to change it is a change to another repository, not something you can build from here — say so rather than looking for a frontend source tree.

A server you start binds inside this sandbox and the user cannot open it. Start one only if asked, use a managed background job, and say plainly that reaching it would need the deployment to expose it.`],
  ['harness:source', `/app holds this deployment's installed harness — published build output, not a checkout. It is baked into the image: anything written there is discarded when this sandbox is reclaimed, and it reaches no other tenant. Do not patch, extend, or work around the harness from there. Read it only to understand behaviour you are debugging. The working directory is a separate value; use pwd rather than inferring it from this path.`],
])

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  ctx.systemPrompt.section({ name: SANDBOX_SECTION, order: SANDBOX_ORDER, text: SANDBOX_TEXT })

  // Warned once per name rather than once per step. A missing name is a
  // permanent condition — upstream renamed a section — and the listener runs
  // on every model step, so the per-step line would bury the one that matters.
  const warned = new Set()

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    // Downstream first, then rewrite, so this plugin's text is what the model
    // reads no matter what else listens. Awaiting `next()` is also what keeps
    // the chain intact: a listener that returns without it drops every other
    // listener's contribution, including the model-selection variables the
    // agent plane composes here.
    const assembled = await next()

    const found = new Set()
    const sections = assembled.sections.map((section) => {
      const text = REPLACEMENTS.get(section.name)
      if (text === undefined) return section
      found.add(section.name)
      return { ...section, text }
    })

    for (const missing of REPLACEMENTS.keys()) {
      if (found.has(missing) || warned.has(missing)) continue
      warned.add(missing)
      // Never thrown. A prompt wording change upstream must not take every
      // session in the deployment down with it; the build gate is what catches
      // this before a tenant does.
      ctx.logger?.warn?.(`deployment-prompt: no ${missing} section in this assembly — the harness renamed it, and its uncorrected text is what the model now reads`)
    }

    return { ...assembled, sections }
  })
}
