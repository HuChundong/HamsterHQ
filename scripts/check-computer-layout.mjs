/**
 * Computer also docks beside a conversation; Scheduled is embedded through a
 * declared plugin slot. Global pages remain reachable without a conversation.
 * The shell owns their navigation; no plugin may restore the old footer DOM
 * walk or require the removed artifact-panel mounting seat.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '..')
const problems = []
for (const [name, id] of [['dsh-computer', 'dsh-computer'], ['dsh-scheduled-tasks', 'scheduled-tasks']]) {
  const source = readFileSync(resolve(root, 'packages', name, 'client.js'), 'utf8')
  try {
    assert.doesNotMatch(source, /stackFooterColumn|SCHEDULE_PANEL_ANCHOR|PANEL_ANCHOR/)
    assert.doesNotMatch(source, /name: 'sidebar\.panellist'/)
    for (const status of name === 'dsh-scheduled-tasks' ? [200, 401, 501] : [200]) {
      let plugin
      let released = 0
      const registrations = []
      const types = []
      const cleanups = []
      const noop = () => {}
      const pendingRef = { current: false }
      const effects = []
      const frames = []
      const opened = []
      const selectedPanels = []
      const react = {
        createElement: noop,
        useRef: () => pendingRef,
        useEffect: callback => { effects.push(callback) },
      }
      vm.runInNewContext(source, {
        window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => react) } } },
        fetch: async () => ({ status, json: async () => ({ ok: true, tasks: [] }) }),
        requestAnimationFrame: callback => { frames.push(callback); return frames.length },
        cancelAnimationFrame: noop,
      })
      plugin.apply({
        connection: {},
        layout: { selectPanel: panel => { selectedPanels.push(panel) } },
        sidebarRight: { openTab: kind => { opened.push(kind) } },
        sidebarRightTabs: { register: definition => { types.push(definition); return noop } },
        locale: { bind: () => key => key },
        effect: (setup, label) => {
          if (!/global|right sidebar/.test(label)) return noop
          const cleanup = setup(); cleanups.push(cleanup); return cleanup
        },
        slots: {
          inject: (_name, setup) => setup(),
          register: (options, Body) => { registrations.push({ options, Body }); return () => { released++ } },
        },
      })
      await new Promise(resolve => setTimeout(resolve, 0))
      if (status === 200) {
        const navigation = registrations.find(entry => entry.options.name === 'sidebar.footer.action')
        const main = registrations.find(entry => entry.options.name === 'main')
        assert.equal(navigation?.options.id, id)
        assert.equal(main?.options.key, id)
        assert(navigation.options.order < 100, 'navigation must precede sandbox status')
        assert.equal(typeof navigation.Body, 'function')
        assert.equal(typeof main.Body, 'function')
        if (name === 'dsh-computer') {
          assert.equal(types[0]?.kind, 'computer')
          assert.equal(typeof types[0]?.guide?.[0]?.title(), 'string')
          const desktop = registrations.find(entry => entry.options.name === 'sidebar.right.pane.tab')
          assert.equal(desktop?.options.key, types[0]?.id)
          assert.equal(desktop?.options.children?.['computer.schedule']?.kind, 'single')
          assert.equal(typeof desktop?.Body, 'function')
          const controller = registrations.find(entry => entry.options.id === 'computer-navigation')
          assert.equal(typeof controller?.Body, 'function')
          // The published SessionListState has no current field. A retained
          // background row must not hide the row owned by the main view.
          const sessions = { byId: {
            background: { id: 'background', retainedBy: { mainView: 0 } },
            conversation: { id: 'conversation', retainedBy: { mainView: 1 } },
          } }
          const renderNavigation = panel => {
            controller.Body({
              usePanelInfo: select => select({ activePanelId: panel }),
              useSessions: select => select(sessions),
            })
            for (const effect of effects.splice(0)) effect()
            for (const frame of frames.splice(0)) frame()
          }
          renderNavigation('dsh-computer')
          assert.deepEqual(selectedPanels, [null], 'Computer returns to the conversation seat')
          assert.deepEqual(opened, [], 'opening waits for the conversation seat to remount')
          renderNavigation(null)
          assert.deepEqual(opened, ['computer'], 'the main-view retained session opens Computer from an empty sidebar')
          renderNavigation(null)
          assert.deepEqual(opened, ['computer'], 'a settled navigation request does not open a second tab')
        } else {
          assert.equal(typeof registrations.find(entry => entry.options.name === 'computer.schedule')?.Body, 'function')
        }
      } else assert.equal(registrations.length, 0, `HTTP ${status} must hide the schedule entry`)
      for (const cleanup of cleanups.reverse()) cleanup?.()
      assert.equal(released, registrations.length)
    }
  } catch (error) { problems.push(`${name}: ${error.message}`) }
}
const styles = readFileSync(resolve(root, 'packages/dsh-artifact-panel/src/styles.js'), 'utf8')
try {
  assert.doesNotMatch(styles, /margin-right:\s*var\(--dsh|data-slot=['"]sidebar|nth-child\(2\)/)
} catch (error) { problems.push(`artifact layout: ${error.message}`) }
if (problems.length) {
  console.error('check-computer-layout: global pages no longer agree with shell-owned navigation')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log('check-computer-layout: global pages and docked computer register content and inline schedule without footer DOM changes')
