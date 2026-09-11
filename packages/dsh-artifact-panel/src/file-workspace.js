/** Track owned resource tabs; file data and change events belong to our gateway. */
import { stillThere } from './api.js'
import { workspaceWatch } from './watch.js'

const tabs = new Map()
let stopWatching
const observers = new Set()
let timer
let generation = 0

export const fileWorkspace = {
  observe() {
    const observer = {}
    observers.add(observer)
    stopWatching ??= workspaceWatch.subscribe(() => {
      window.clearTimeout(timer)
      const current = ++generation
      timer = window.setTimeout(async () => {
        for (const [signal, held] of tabs) {
          const exists = await stillThere(held.path)
          if (generation !== current) return
          if (!exists && tabs.get(signal) === held && !signal.aborted) held.close()
        }
      }, 150)
    })
    return () => {
      if (!observers.delete(observer) || observers.size > 0) return
      generation++
      stopWatching?.(); stopWatching = undefined
      window.clearTimeout(timer)
    }
  },
  track(tab, path) {
    if (tab.signal.aborted) return
    if (tabs.get(tab.signal)?.path === path) return
    const fresh = !tabs.has(tab.signal)
    tabs.set(tab.signal, { path, close: tab.actions.close })
    if (fresh) tab.signal.addEventListener('abort', () => tabs.delete(tab.signal), { once: true })
  },
  removed(path) {
    for (const held of tabs.values()) {
      if (held.path === path || held.path.startsWith(`${path}/`)) held.close()
    }
  },
  clear() {
    generation++; tabs.clear(); observers.clear()
    stopWatching?.(); stopWatching = undefined
    window.clearTimeout(timer)
  },
}
