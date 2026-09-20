/**
 * File selection must call the official tab resource action, and every custom
 * type must have a body registered under its type id. Exercising the served
 * plugin catches a registration that loads but leaves an empty docking tab.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Apply the actual bundled plugin to recording versions of the shell services. */
export async function checkArtifactPanelOpen(plugin) {
  const types = []
  const bodies = []
  const cleanups = []
  let released = 0
  const dictionaries = new Map()
  const noop = () => {}
  const ctx = {
    connection: {},
    locale: {
      register: (namespace, dictionary) => { dictionaries.set(namespace, dictionary); return noop },
      subscribe: () => noop, getSnapshot: () => ({}),
      bind: namespace => key => {
        assert(key in dictionaries.get(namespace).en, `missing English dictionary key ${key}`)
        assert(key in dictionaries.get(namespace).zh, `missing Chinese dictionary key ${key}`)
        return dictionaries.get(namespace).en[key]
      },
    },
    sidebarRight: { split: pane => { assert.equal(pane, 'files-pane'); return 'preview-pane' } },
    sidebarRightTabs: { register: type => { types.push(type); return () => { released++ } } },
    slots: {
      inject: (_name, setup) => setup(),
      register: (options, Body) => { bodies.push({ options, Body }); return () => { released++ } },
    },
    effect: setup => { const cleanup = setup(); cleanups.push(cleanup); return cleanup },
  }
  for (const service of ['sidebarRightTabs', 'sidebarRight', 'slots']) assert(plugin.inject.includes(service))
  assert(!plugin.inject.includes('remote.session'), 'file opens must not replace session Remote methods')
  plugin.apply(ctx)
  assert.deepEqual(types.map(type => type.kind), ['files', 'canvas', 'file'],
    'Browser and Terminal must remain owned by the official shell')
  for (const type of types) {
    assert.equal(type.priority, 'extension')
    if (type.guide !== undefined) {
      assert(Array.isArray(type.guide), 'the official registry maps guide as an array')
      assert(type.guide.every(entry => typeof entry.title === 'function'))
      for (const entry of type.guide) assert.equal(typeof entry.title(), 'string')
    }
    assert.equal(typeof type.title('dsh-resource://file/session/session-check/example.zip'), 'string')
    const body = bodies.find(entry => entry.options.key === type.id && entry.options.name === 'sidebar.right.pane.tab')
    assert(body, `type ${type.id} has no matching body`)
    assert.equal(body.options.name, 'sidebar.right.pane.tab')
  }
  const opened = []
  const files = bodies.find(entry => entry.options.key?.endsWith('/files'))
  const rendered = files.Body({ sessionId: 'session-check', useSessions: selector => selector({ byId: { 'session-check': { cwd: '/mnt/workspace' } } }), useTabInfo: () => ({ panel: { id: 'files-pane' }, tab: { actions: { openResource: address => opened.push(address) } } }) })
  // The error boundary contains the content frame, which holds the actual
  // Files component. Invoke it, then exercise the tree's public onOpen prop.
  const component = rendered.children[0].children[0]
  const tree = component.type(component.props)
  const findTree = node => typeof node?.props?.onOpen === 'function' ? node : node?.children?.flat().map(findTree).find(Boolean)
  const fileTree = findTree(tree)
  assert(fileTree, 'files body must connect its tree to an open action')
  fileTree.props.onOpen({ path: '/mnt/workspace/report.md' })
  assert.equal(opened.length, 1)
  assert.equal(typeof opened[0], 'string')
  assert.equal(opened[0], 'dsh-resource://file/session/session-check/report.md')
  const file = types.find(type => type.kind === 'file')
  assert(file.patterns.includes('dsh-resource://file/**'))
  assert(file.canOpen('dsh-resource://file/session/session-check/report.md'), 'main-panel resources must use the owned file surface')
  for (const cleanup of cleanups.reverse()) cleanup?.()
  assert.equal(released, types.length + bodies.length, 'disposing the plugin must release all type and body registrations')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    execFileSync(process.execPath, [new URL('./check-plugin-load.mjs', import.meta.url).pathname], { stdio: 'inherit' })
  } catch (error) { process.exit(error.status ?? 1) }
  console.log('check-panel-open: custom docking types have bodies and file selection uses the official resource action')
}
