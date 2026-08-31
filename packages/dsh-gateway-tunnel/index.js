/**
 * The tunnel, as a plugin inside the dsh process it serves.
 *
 * It replaces a second Node process that sat beside dsh and reached it over
 * loopback. Two things came from that separation and go away with it: about
 * 40 MB of a second V8 heap per tenant, and — the one that actually cost
 * something — the guesswork about when dsh was ready. An outside process can
 * only probe, and it dialled the gateway too early twice: once before the
 * socket accepted connections, once before the API plane was mounted. The
 * gateway releases held browser requests the moment a tunnel appears, so both
 * reached a person. Injecting `connection` states most of that condition
 * instead of sampling it: the service exists only after
 * `dsh-client-connection` has mounted the `/api` route this forwards to.
 *
 * `sessionController` also has to be active: a mounted Remote route can answer
 * service-unavailable while its business service is still starting. The stream
 * route is mounted separately, so the last step before dialling is still a
 * probe — see waitForDownlinks.
 *
 * Requests cross loopback with a cookie issued by the host's own Connection
 * service. This keeps upstream authentication, body limits and route composition
 * intact; no signing algorithm or in-memory RPC dispatch is reproduced here.
 *
 * @module dsh-gateway-tunnel
 */

import http from 'node:http'
import process from 'node:process'
import WebSocket from 'ws'
import { localSession } from './local-session.js'
import {
  authorityFor,
  chunkBody,
  decodeFrame,
  encodeFrame,
  localPathFor,
  rewriteRequestHeaders,
} from 'dsh-tunnel-protocol'

export const name = 'gateway-tunnel'

/**
 * `connection` is what orders this against the `/api` route: the service is
 * created in the same apply that registers the route, so its presence means
 * the surface this forwards to exists. `typertGateway` gates the plane behind it,
 * which answers 404 until it is mounted. `sessionController` holds the tunnel
 * until session calls can run, not merely until their route accepts requests.
 *
 * `timer` is not an ordering constraint but a correctness one, and it was
 * missing. cordis refuses a service the reading context did not inject, and it
 * refuses it *where it is read* rather than at mount — so the one line that
 * uses `ctx.setTimeout`, the redial after a dropped tunnel, threw where nothing
 * catches it and took the tenant's whole backend down with it. From outside
 * that looked like a sandbox that restarts when the gateway does, which is
 * roughly what one expects, so it survived. `timer` is the composition's second
 * entry, mounted long before this one.
 */
export const inject = ['connection', 'typertGateway', 'sessionController', 'timer']

/** Delay before redialing after the tunnel drops. */
const RECONNECT_DELAY_MS = 1000

/**
 * Mount the tunnel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context, with `connection` and `typertGateway` injected.
 */
export function apply(ctx) {
  /**
   * Agents currently working, by the identity dsh gives them.
   *
   * A set rather than a flag because a tenant can have several agents at once —
   * a subagent runs beside the one that spawned it — and the sandbox is busy
   * while any of them is.
   * @type {Set<unknown>}
   */
  const busyAgents = new Set()

  /**
   * Tell the gateway whether anything is working in here.
   *
   * This is the half of "idle" that traffic cannot see. A turn that runs for an
   * hour with nobody watching sends nothing through the tunnel — the browser
   * that would have been receiving its output is closed — so on traffic alone
   * the sandbox looks abandoned and is reclaimed with the work inside it.
   *
   * Sent on transitions rather than on a timer, because a timer is traffic and
   * would make every sandbox look busy to the very check this informs.
   */
  const reportActivity = () => { send({ t: 'activity', busy: busyAgents.size > 0 }) }

  // `agent` identifies which one changed; a subagent transitions independently
  // of the agent that spawned it.
  ctx.on('agent/status', ({ agent, status }) => {
    const before = busyAgents.size > 0
    if (status === 'running') busyAgents.add(agent)
    else busyAgents.delete(agent)
    if ((busyAgents.size > 0) !== before) reportActivity()
  })

  // An agent disposed mid-turn never reports going idle, and would otherwise
  // hold the sandbox open for as long as the process lives.
  ctx.on('agent/disposed', ({ agent }) => {
    if (!busyAgents.delete(agent)) return
    if (busyAgents.size === 0) reportActivity()
  })

  const gatewayUrl = process.env.GATEWAY_TUNNEL_URL
  const sandboxId = process.env.SANDBOX_ID
  const token = process.env.SANDBOX_TOKEN
  if (gatewayUrl === undefined || sandboxId === undefined || token === undefined) {
    throw new Error('gateway-tunnel: GATEWAY_TUNNEL_URL, SANDBOX_ID and SANDBOX_TOKEN are required')
  }
  const localAuthority = `127.0.0.1:${ctx.get('webServer').port}`
  let session

  /**
   * Replace the gateway cookie with a session valid only inside this sandbox.
   * noVNC is a different service and must never receive the DSH credential.
   * @param {Record<string, string>} headers - browser request headers.
   * @param {string} authority - local destination.
   * @returns {Record<string, string>} headers for the selected local service.
   */
  const localHeaders = (headers, authority) => {
    const rewritten = rewriteRequestHeaders(headers, authority)
    if (authority === localAuthority) {
      if (session === undefined || session.expiresAt - Date.now() < 60_000) {
        session = localSession(ctx.connection, localAuthority)
      }
      rewritten.cookie = session.cookie
    }
    return rewritten
  }

  /** @type {WebSocket | undefined} */
  let socket
  /** @type {Map<string, import('node:http').ClientRequest>} */
  const requests = new Map()
  /** @type {Map<string, WebSocket>} */
  const sockets = new Map()
  let disposed = false

  /**
   * Send one frame, ignoring sends that race teardown.
   * @param {object} frame - the frame to encode and send.
   */
  const send = (frame) => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(encodeFrame(frame))
  }

  /**
   * Begin one proxied HTTP request against dsh or noVNC.
   * @param {{id: string, method: string, path: string, headers: Record<string, string>}} frame - the opening frame.
   */
  const startHttp = (frame) => {
    const authority = authorityFor(frame.path, localAuthority)
    const path = localPathFor(frame.path)
    const [host, port] = authority.split(':')
    const request = http.request({
      host,
      port: Number(port),
      method: frame.method,
      path,
      headers: localHeaders(frame.headers, authority),
    }, (response) => {
      send({ t: 'httpres', id: frame.id, status: response.statusCode ?? 502, headers: response.headers })
      response.on('data', (chunk) => {
        for (const part of chunkBody(chunk)) send({ t: 'resbody', id: frame.id, chunk: part })
      })
      response.on('end', () => {
        send({ t: 'resend', id: frame.id })
        requests.delete(frame.id)
      })
    })
    request.on('error', (error) => {
      ctx.logger?.warn?.(`gateway-tunnel: ${frame.method} ${frame.path} failed: ${error.message}`)
      // Path travels with the failure so the gateway log names the request,
      // not only the Node errno — "socket hang up" alone is not actionable.
      send({ t: 'reserr', id: frame.id, message: `${frame.method} ${frame.path}: ${error.message}` })
      requests.delete(frame.id)
    })
    requests.set(frame.id, request)
  }

  /**
   * Open one WebSocket against dsh (event downlinks) or noVNC (:6080).
   *
   * `ws` derives Host from the URL and attaches no Origin, which is what the
   * fence wants; carrying the browser's `sec-websocket-*` headers over would
   * override the handshake key `ws` minted and can verify.
   *
   * Binary frames are forwarded (base64 in `wsmsg`) so noVNC/websockify works;
   * dsh's text-only event sockets keep sending `bin: false`.
   *
   * @param {{id: string, path: string, headers: Record<string, string>}} frame - the opening frame.
   */
  const startWebSocket = (frame) => {
    const authority = authorityFor(frame.path, localAuthority)
    const path = localPathFor(frame.path)
    const headers = localHeaders(frame.headers, authority)
    delete headers.host
    for (const key of Object.keys(headers)) {
      if (key.startsWith('sec-websocket-')) delete headers[key]
    }
    const downlink = new WebSocket(`ws://${authority}${path}`, { headers })
    downlink.on('open', () => { send({ t: 'wsopenok', id: frame.id }) })
    downlink.on('message', (data, isBinary) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (isBinary) {
        send({ t: 'wsmsg', id: frame.id, data: buf.toString('base64'), bin: true })
        return
      }
      send({ t: 'wsmsg', id: frame.id, data: buf.toString('utf8'), bin: false })
    })
    downlink.on('close', (code, reason) => {
      send({ t: 'wsclosed', id: frame.id, code, reason: reason.toString('utf8') })
      sockets.delete(frame.id)
    })
    downlink.on('error', (error) => {
      send({ t: 'wsfail', id: frame.id, message: error.message })
      sockets.delete(frame.id)
    })
    sockets.set(frame.id, downlink)
  }

  /**
   * Apply one gateway frame.
   * @param {object} frame - the decoded frame.
   */
  const handle = (frame) => {
    switch (frame.t) {
      case 'http':
        startHttp(frame)
        return
      case 'body':
        requests.get(frame.id)?.write(Buffer.from(frame.chunk, 'base64'))
        return
      case 'end': {
        const request = requests.get(frame.id)
        // A redelivered frame must not end a request that already finished.
        if (request !== undefined && !request.writableEnded) request.end()
        return
      }
      case 'abort':
        requests.get(frame.id)?.destroy()
        requests.delete(frame.id)
        return
      case 'wsopen':
        startWebSocket(frame)
        return
      case 'wsdata': {
        const downlink = sockets.get(frame.id)
        if (downlink === undefined || downlink.readyState !== WebSocket.OPEN) return
        if (frame.bin) {
          downlink.send(Buffer.from(frame.data, 'base64'))
        } else {
          downlink.send(frame.data)
        }
        return
      }
      case 'wsclose':
        sockets.get(frame.id)?.close()
        sockets.delete(frame.id)
        return
      default:
        // Unknown tags are ignored so the gateway can add frame kinds without
        // a lockstep sandbox-image rebuild.
        return
    }
  }

  /** Abandon every local stream this tunnel generation was carrying. */
  const abandon = () => {
    for (const request of requests.values()) request.destroy()
    for (const downlink of sockets.values()) downlink.close()
    requests.clear()
    sockets.clear()
  }

  /** Dial the gateway and serve one tunnel generation, redialing when it ends. */
  const connect = () => {
    if (disposed) return
    const dialed = new WebSocket(gatewayUrl, {
      headers: { 'x-sandbox-token': token, 'x-sandbox-id': sandboxId },
    })
    socket = dialed

    dialed.on('open', () => {
      ctx.logger?.info?.(`gateway-tunnel: connected to ${gatewayUrl} as ${sandboxId}`)
      send({ t: 'hello', sandboxId })
      // Stated on every connection, because the gateway forgets what it knew
      // about a sandbox whose tunnel dropped, and an agent mid-turn when the
      // socket reconnects would otherwise look idle until its next transition.
      send({ t: 'activity', busy: busyAgents.size > 0 })
    })
    dialed.on('message', (raw) => {
      let frame
      try {
        frame = decodeFrame(raw)
      } catch (error) {
        ctx.logger?.error?.(`gateway-tunnel: dropping tunnel — ${error.message}`)
        dialed.close()
        return
      }
      // Contained per frame: this now shares a process with the agent serving
      // this tenant, so an escaping fault would take that down too.
      try {
        handle(frame)
      } catch (error) {
        ctx.logger?.error?.(`gateway-tunnel: frame ${frame.t} failed: ${error.stack ?? error.message}`)
        dialed.close()
      }
    })
    dialed.on('close', () => {
      abandon()
      if (!disposed) ctx.setTimeout(connect, RECONNECT_DELAY_MS)
    })
    // 'error' always precedes 'close', which owns the redial.
    dialed.on('error', (error) => { ctx.logger?.warn?.(`gateway-tunnel: ${error.message}`) })
  }

  /**
   * Resolve once the downlink upgrade routes exist.
   *
   * Service injection waits for the Remote gateway, but its stream carrier
   * mounts independently. Probe an actual authenticated WebSocket upgrade;
   * a plain GET is handled by the unary RPC route in current DSH releases.
   *
   * @returns {Promise<void>} resolves when the Remote downlink is routable.
   */
  const waitForDownlinks = async () => {
    while (!disposed) {
      const ready = await new Promise((resolve) => {
        const probe = new WebSocket(`ws://${localAuthority}/api/remote.mux`, {
          headers: localHeaders({}, localAuthority),
          handshakeTimeout: 5000,
        })
        probe.once('open', () => { probe.close(); resolve(true) })
        probe.once('error', () => { resolve(false) })
        probe.once('close', () => { resolve(false) })
      })
      if (ready) return
      await new Promise((resolve) => { setTimeout(resolve, 250) })
    }
  }

  ctx.effect(() => {
    void waitForDownlinks().then(connect)
    return () => {
      disposed = true
      abandon()
      socket?.close()
    }
  }, 'gateway-tunnel: dial-out connection')
}
