/* Runs from the head of noVNC's vnc.html, installed by patch-novnc.sh.
 *
 * The page is opened two ways: inside a frame dsh-computer renders, where the
 * plugin paints the shell's colours in over the frame's document, and in a
 * window of its own, where nothing can reach in. This script serves the
 * second: it reads what dsh-computer put in the URL and applies it before the
 * body is parsed, so a new window opens on the right ground with the right
 * name and no flash of noVNC's own.
 *
 *   bg     the letterbox colour, the shell's layer-1 surface
 *   theme  dark or light, deciding the ink drawn over that ground
 *   title  the tab's name, already in the person's language
 *   connecting  the accessible loading message in that same language
 *
 * The title is held, not just set: noVNC's ui.js writes the tab itself, to
 * "<desktop name> - noVNC" on connect and back to "noVNC" on disconnect, and
 * the tab would read as noVNC's again a second after this ran. Watching the
 * title element and writing the name back is the whole of the hold; setting
 * it to what it already is does not fire the observer again.
 *
 * Classic script rather than a module on purpose: modules are deferred, and
 * this has to run before the first paint.
 */
(function () {
  var root = document.documentElement
  var params
  try {
    params = new URLSearchParams(location.search)
  } catch {
    return
  }
  var bg = params.get('bg')
  if (bg) root.style.setProperty('--hamsterhq-novnc-bg', bg)
  var theme = params.get('theme')
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-hhq-theme', theme)
  // Interactive fires after parsing but before deferred noVNC modules run.
  // DOMContentLoaded would leave the loading label untranslated while those
  // modules are still travelling through the tunnel.
  document.addEventListener('readystatechange', function () {
    var label = document.getElementById('hhq-loading-label')
    if (label && params.get('connecting')) label.textContent = params.get('connecting')
  })
  var title = params.get('title') || 'Computer'
  document.title = title
  var node = document.querySelector('title')
  if (!node) return
  new MutationObserver(function () {
    if (document.title !== title) document.title = title
  }).observe(node, { childList: true, characterData: true, subtree: true })
})()
