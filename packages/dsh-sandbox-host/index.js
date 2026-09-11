/**
 * Remote configuration-document access, host half.
 *
 * The browser shows the configuration document because the settings service's
 * native open action targets the sandbox desktop, not the user's computer.
 * Conversation uploads belong to DSH's file-upload service and pass through
 * the existing /api transport. This plugin owns no upload storage or receipts.
 *
 * The retained /files channel carries document.read only. A separate Cordis
 * RPC channel keeps that adaptation outside DSH's own /api interceptor while
 * sharing Connection authentication and the gateway's tenant routing.
 *
 * @module dsh-sandbox-host
 */

import { readFile } from 'node:fs/promises'

export const name = 'sandbox-host'

/**
 * `connection` is the channel registry. `webServer` is what a channel
 * registration binds its route on, and the registry reaches it through the
 * context that read it — this one — so it has to be here even though nothing
 * below names it.
 */
export const inject = ['connection', 'webServer']

/** The retained configuration-document channel. */
const CHANNEL = '/files'

/**
 * A caller error, in the envelope's own vocabulary.
 * @param {string} message - what the caller did.
 * @returns {object} the RPC result.
 */
const badRequest = (message) => ({ ok: false, error: { code: 'bad-request', message, details: { issues: [] } } })

/**
 * A failure that is this side's, in the envelope's own vocabulary.
 * @param {string} message - what went wrong.
 * @returns {object} the RPC result.
 */
const internal = (message) => ({ ok: false, error: { code: 'internal', message, details: {} } })

/**
 * Mount the configuration-document channel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context, with `connection` and `webServer`.
 */
export function apply(ctx) {
  /**
   * The configuration document, prepared the way the control this replaces
   * prepared it.
   *
   * `settings.openDocument` calls `prepareDocument()` before handing the path
   * to the desktop, and that call is what materializes a document nobody has
   * written yet. Reading `documentPath` alone would answer "does not exist" for
   * every tenant who has never changed a setting — true, and useless.
   *
   * @returns {Promise<object>} the RPC result.
   */
  const readDocument = async () => {
    const settings = ctx.get('settings')
    if (settings === undefined) return internal('this composition mounts no settings service')
    const prepared = await settings.prepareDocument?.().catch(() => undefined)
    const documentPath = prepared ?? settings.documentPath
    if (documentPath === undefined) return internal('this settings service is not file-backed')
    const text = await readFile(documentPath, 'utf8').catch(() => undefined)
    return { ok: true, value: { path: documentPath, text: text ?? '', exists: text !== undefined } }
  }

  /**
   * One decoded call on this channel.
   * @param {string} endpoint - channel-relative endpoint.
   * @returns {Promise<object>} the RPC result.
   */
  const dispatch = async (endpoint) => {
    switch (endpoint) {
      case 'document.read':
        return await readDocument()
      default:
        return badRequest(`no such endpoint: ${endpoint}`)
    }
  }

  // Registered against this context, so the route goes away with the plugin.
  // `trusted-host` rather than `loopback`: this is the same fence `/api` itself
  // stands behind, and pinning it to loopback would refuse nothing extra —
  // every request arrives from the tunnel, on loopback, either way.
  ctx.connection.rpc.handle(CHANNEL, async (endpoint) => {
    try {
      return await dispatch(endpoint)
    } catch (error) {
      ctx.logger?.warn?.(`sandbox-host: ${endpoint} failed: ${error.message}`)
      return internal(error.message)
    }
  })

}
