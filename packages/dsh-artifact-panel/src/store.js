/** Per-tool view preferences. DSH alone owns the docking layout and tabs. */
import { React } from './runtime.js'

export const store = (() => {
  let state = Object.freeze({ folded: {} })
  const listeners = new Set()
  return {
    read: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    fold: (kind) => {
      state = Object.freeze({ folded: { ...state.folded, [kind]: state.folded[kind] !== true } })
      for (const listener of listeners) listener()
    },
  }
})()
export const useStore = () => React.useSyncExternalStore(store.subscribe, store.read)
