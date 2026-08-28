/**
 * Short sandbox version strings derived from Cube template aliases.
 *
 * A deployment stamps sandboxes with a date-shaped version (YYYY-MM-DD or
 * YYYY-MM-DD.N). The Cube alias and CUBE_TEMPLATE_ID are
 * `hamsterhq-sandbox-<version>`; the UI and the SANDBOX_VERSION env show only
 * the trailing part. See docs/cubesandbox.md.
 *
 * @module sandbox-version
 */

/** Prefix every dated template alias carries. */
export const TEMPLATE_ALIAS_PREFIX = 'hamsterhq-sandbox-'

/**
 * The template this deployment creates sandboxes from.
 *
 * Read here rather than only in platform-cube so docker and cube paths share
 * one short-version helper without importing the SDK module.
 */
export const DEPLOYMENT_TEMPLATE =
  process.env.CUBE_TEMPLATE_ID ?? 'hamsterhq-sandbox'

/**
 * Turn a template alias into the short version shown to tenants.
 *
 * @param {string | undefined | null} alias - Cube alias or template id.
 * @returns {string | null} the short version, or null when nothing usable was given.
 */
export function shortVersionFromTemplate(alias) {
  if (alias === undefined || alias === null) return null
  const trimmed = String(alias).trim()
  if (trimmed === '') return null
  if (trimmed.startsWith(TEMPLATE_ALIAS_PREFIX)
      && trimmed.length > TEMPLATE_ALIAS_PREFIX.length) {
    return trimmed.slice(TEMPLATE_ALIAS_PREFIX.length)
  }
  return trimmed
}

/**
 * The short version this deployment would give a sandbox created right now.
 *
 * @returns {string | null} the current deployment version.
 */
export function currentDeploymentVersion() {
  return shortVersionFromTemplate(DEPLOYMENT_TEMPLATE)
}
