/**
 * What the shell hands this plugin, held where every module can reach it.
 *
 * The panel is loaded by the shell's module registry rather than built from
 * the workspace: `require` is the shell's own module table, and it arrives as
 * the argument of the factory in `client.js`. That makes React a value nothing
 * can import — so it is set here once, at load, and read through the live
 * bindings below.
 *
 * Live bindings and not a frozen copy: `export let` is what lets a module that
 * imported `React` at parse time see the value assigned at load time. Every
 * use is inside a component or a callback, which is after `boot()`.
 *
 * @module runtime
 */

/** The shell's React. Undefined until `boot()`. @type {object} */
export let React

/** The shell's `react-dom/client`, for the panel's own root. @type {object} */
export let ReactDomClient

/**
 * The shell's UI primitives, or an empty table.
 *
 * Guarded because the module table is the shell's, not ours: a deployment that
 * composes a frontend without this package must lose the markdown and code
 * viewers, not the panel — so a missing module leaves the object empty and the
 * viewers fall back to plain text.
 *
 * @type {object}
 */
export let primitives = {}

/**
 * `React.createElement`, as a function rather than a captured reference.
 *
 * A `const h = React.createElement` in another module would capture `undefined`
 * at parse time, because that module is evaluated before the factory runs.
 *
 * @param {...unknown} args - type, props, children.
 * @returns {object} the element.
 */
export const h = (...args) => React.createElement(...args)

/**
 * Take what the shell offers, once, before anything renders.
 *
 * @param {(id: string) => object} require - the shell's module table.
 */
export function boot(require) {
  React = require('react')
  ReactDomClient = require('react-dom/client')
  try {
    // `?? {}` and not just the call: a module table that does not carry this
    // package answers with undefined rather than throwing.
    primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}
  } catch (error) {
    console.warn('[dsh-artifact-panel] ui-primitives did not load; files render as plain text', error)
  }
}
