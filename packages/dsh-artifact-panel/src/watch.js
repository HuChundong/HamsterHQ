/**
 * The workspace's own changes, as they happen.
 *
 * @module watch
 */

import { ROOT } from './constants.js'

/**
 * How often the panel re-asks when there is no watch at all.
 *
 * The only timer left in the browser, and it runs only when the gateway
 * has said no watch is possible. While one IS running, the panel holds no
 * timer of its own: inotify can miss things — the kernel queue overflows,
 * and a write through another sandbox's mount is never seen — but noticing
 * that is the SANDBOX's job now. It sweeps its own directories and says
 * `stale` when they moved without an event, so a browser that has nothing
 * to do does nothing, and the gateway is not asked on a schedule by every
 * open tab.
 */
const STALE_INTERVAL_MS = 5000

/**
 * The workspace's own changes, as they happen.
 *
 * One subscription for the whole panel, opened when it mounts. What it
 * replaced is worth naming: the tree used to re-read a directory whenever
 * it was drawn, and the canvas asked every two seconds which page was
 * newest. Both were asking constantly for news that can be volunteered, so
 * a file that changes now reaches the panel in the time it takes to
 * travel.
 *
 * Events arrive quickly and are allowed to be incomplete — inotify drops
 * things. What makes that safe is a sweep, and the sweep runs in the
 * sandbox beside the watcher rather than here: it reports `stale` when the
 * workspace moved without an event, and the panel re-reads then. So this
 * subscription is the only thing the panel runs, and it is idle whenever
 * the workspace is.
 *
 * Listeners register by name so the tree and the canvas can each take what
 * they need without knowing about the other.
 */

export const workspaceWatch = (() => {
  const listeners = new Set()
  let source
  let timer

  /**
   * Tell everyone something happened.
   * @param {object} change - what changed, or a stale marker.
   */
  const announce = (change) => { for (const listener of listeners) listener(change) }

  /**
   * Go back to asking, because nothing is going to tell us.
   *
   * envd cannot watch a network filesystem, and a tenant's workspace is
   * one wherever it is a volume — so in production there are no events to
   * wait for, and a panel that only waits shows a directory that was made
   * five minutes ago as still absent.
   *
   * What is sent is `stale`, not a path: this knows only that the
   * workspace may have moved on, never what moved. Subscribers re-read
   * whatever they are showing.
   */
  /**
   * Look again every so often, whatever the watch is doing.
   *
   * What is sent is `stale`, not a path: this knows only that the
   * workspace may have moved on, never what moved. Subscribers re-read
   * whatever they are showing.
   *
   * @param {number} every - milliseconds between looks.
   */
  const keepAsking = (every) => {
    if (timer !== undefined) window.clearInterval(timer)
    timer = window.setInterval(() => { announce({ stale: true, path: ROOT }) }, every)
  }

  const start = () => {
    if (source !== undefined) return
    source = new EventSource('/sandbox/watch')
    source.addEventListener('message', (event) => {
      let change
      try { change = JSON.parse(event.data) } catch { return }
      // The gateway says so down the stream rather than closing it, so
      // that the browser does not reconnect to a watch that cannot exist.
      // This is the one case that puts a timer back in the browser.
      if (change.watching === false) { keepAsking(STALE_INTERVAL_MS); return }
      // The sandbox swept its own directories and found them moved without
      // an event to match. It does not know what moved, only that
      // something did.
      if (change.stale === true) { announce({ stale: true, path: ROOT }); return }
      const path = `${ROOT}/${String(change.name ?? '')}`
      announce({ ...change, path })
    })
  }

  return {
    /**
     * Hear about changes.
     * @param {(change: {name?: string, type?: string, path: string, stale?: boolean}) => void} listener - called per change.
     * @returns {() => void} stop listening.
     */
    subscribe: (listener) => {
      listeners.add(listener)
      start()
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        source?.close()
        source = undefined
        if (timer !== undefined) {
          window.clearInterval(timer)
          timer = undefined
        }
      }
    },
    /**
     * Look again, now, because a person asked.
     *
     * The same signal the fallback sends on a timer, which is why one
     * control refreshes the tree and the canvas together: neither is being
     * told what changed in either case.
     */
    refresh: () => { announce({ stale: true, path: ROOT }) },
  }
})()
