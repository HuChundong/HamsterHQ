/**
 * Route the harness's native path-open Remote into the browser artifact panel.
 *
 * The generated Remote namespace exposes each method as a configurable getter,
 * so assigning to it is not a reliable wrap: strict code throws and loose code
 * silently leaves the getter in place. Replacing the descriptor is deliberate,
 * and restoring the exact descriptor keeps the generated transport intact.
 *
 * @param {object} sessionRemote - The generated ctx.remote.session namespace.
 * @param {(path: string) => void} open - Open one absolute sandbox path locally.
 * @returns {() => void} restore the Remote method when this plugin is disposed.
 */
export function installPathOpen(sessionRemote, open) {
  const key = 'openWorkspacePath'
  const descriptor = Object.getOwnPropertyDescriptor(sessionRemote, key)
  const original = sessionRemote[key]
  if (typeof original !== 'function') {
    throw new Error('artifact-panel: session.openWorkspacePath is unavailable')
  }

  const wrapped = (request, ...rest) => {
    const path = request?.path
    if (typeof path === 'string' && path.startsWith('/')) {
      open(path)
      // Match SessionOpenWorkspacePathValue inside the RemoteResult envelope
      // that ui-chat consumes after calling this generated client method.
      return Promise.resolve({ ok: true, value: { opened: true } })
    }
    return original(request, ...rest)
  }

  Object.defineProperty(sessionRemote, key, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value: wrapped,
  })

  return () => {
    // Do not tear down a newer wrapper installed after this one.
    if (sessionRemote[key] !== wrapped) return
    if (descriptor === undefined) Reflect.deleteProperty(sessionRemote, key)
    else Object.defineProperty(sessionRemote, key, descriptor)
  }
}
