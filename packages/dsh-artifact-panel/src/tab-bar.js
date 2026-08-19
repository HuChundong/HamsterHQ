/**
 * The strip of tabs above the panel, and what stands in when there are none.
 *
 * @module tab-bar
 */

import { NS } from './constants.js'
import { useT } from './i18n.js'
import { icon } from './icons.js'
import { h, React } from './runtime.js'
import { TOOLS } from './tools.js'
/**
 * The tab bar: the open tabs, then the control that closes the panel.
 * @param {object} props - tabs, the active id, and the three gestures.
 * @returns {object} the element.
 */
export function TabBar({ tabs, activeId, onSelect, onClose, onNew, onOpen, onCollapse, onMaximise, maximised }) {
  const t = useT()
  const strip = React.useRef(null)
  // The `+` menu: the button it hangs from, and where it landed once it
  // had been measured.
  const plus = React.useRef(null)
  const menu = React.useRef(null)
  const [listing, setListing] = React.useState(false)
  const [place, setPlace] = React.useState(undefined)

  // Keep the tab in play in view. Opening a file when the strip is already
  // full otherwise puts the new tab off the end, so the one thing that
  // just happened is the one thing that cannot be seen.
  //
  // The scroll is computed rather than left to `scrollIntoView`, which
  // decides for itself which ancestor to move and was observed moving
  // none of them: the strip stayed at 46px of a possible 433 with the new
  // tab well off its right edge. This moves the one box that scrolls, by
  // the smallest amount that brings the tab inside it.
  React.useEffect(() => {
    const box = strip.current
    const active = box?.querySelector('[aria-selected="true"]')
    if (box === null || box === undefined || active === null || active === undefined) return
    // Measured as rectangles rather than through `offsetLeft`, which is
    // relative to the nearest POSITIONED ancestor — here the panel, which
    // is fixed, not the strip. That offset by the strip's own padding is
    // enough to leave the tab a few pixels short of visible.
    const box_ = box.getBoundingClientRect()
    const it = active.getBoundingClientRect()
    if (it.left < box_.left) box.scrollLeft += it.left - box_.left
    else if (it.right > box_.right) box.scrollLeft += it.right - box_.right
  }, [activeId, tabs.length])

  // A wheel over the strip scrolls it sideways.
  //
  // A mouse has one wheel and it reports on `deltaY`; a strip that only
  // answers `deltaX` is a strip only a trackpad can move, which leaves the
  // tabs past the edge reachable by dragging alone. Both axes are taken
  // and the larger wins, so a trackpad's sideways gesture still arrives as
  // itself rather than being added to the same number twice.
  //
  // Attached here rather than as `onWheel`, and this is the whole reason
  // for the effect: React registers wheel handlers on its root as PASSIVE,
  // so `preventDefault` inside one does nothing but log a warning — the
  // strip would scroll sideways AND the conversation behind it would scroll
  // away underneath. A native listener with `passive: false` is the only
  // form that can hold the page still.
  //
  // The default is only refused when this strip can actually take the
  // scroll: with every tab already in view, a wheel over the row belongs
  // to whatever is behind it.
  React.useEffect(() => {
    const box = strip.current
    if (box === null || box === undefined) return undefined
    /** @param {WheelEvent} event - the wheel. */
    const onWheel = (event) => {
      const over = box.scrollWidth - box.clientWidth
      if (over <= 0) return
      const by = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (by === 0) return
      const before = box.scrollLeft
      box.scrollLeft += by
      // Only when it moved: at either end the row has nothing left to
      // give, and holding the page still there makes the panel feel stuck.
      if (box.scrollLeft !== before) event.preventDefault()
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => { box.removeEventListener('wheel', onWheel) }
  }, [])

  // The menu closes to anything that is not itself, the way the tree's
  // does: a pointer elsewhere, Escape, or the panel being resized under
  // it. Capture, so the click that closes it does not also land on
  // whatever was underneath.
  React.useEffect(() => {
    if (!listing) return undefined
    const away = (event) => {
      if (menu.current?.contains(event.target) === true) return
      if (plus.current?.contains(event.target) === true) return
      setListing(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setListing(false) }
    const shut = () => { setListing(false) }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', shut)
    }
  }, [listing])

  // Measured after it is drawn, because where it fits depends on how wide
  // it turned out to be. Hung from the button's RIGHT edge rather than its
  // left: the panel is the window's right-hand column, and a menu that
  // grows rightward from a control near that edge grows off the screen.
  React.useLayoutEffect(() => {
    if (!listing || menu.current === null || plus.current === null) { setPlace(undefined); return }
    const button = plus.current.getBoundingClientRect()
    const box = menu.current.getBoundingClientRect()
    setPlace({
      left: Math.max(8, Math.min(button.right - box.width, window.innerWidth - box.width - 8)),
      top: button.bottom + 6,
    })
  }, [listing, tabs.length])

  // The bar is always drawn, because the controls that close and widen the
  // panel live in it and have to be reachable with nothing open. Its rule
  // is not: with no tabs there is nothing above the line to divide from
  // what is below it.
  return h('div', { className: `${NS}-tabbar`, 'data-empty': tabs.length === 0 ? '' : undefined },
    h('div', { className: `${NS}-tabs`, role: 'tablist', ref: strip }, tabs.map((tab) => h('div', {
      key: tab.id,
      role: 'tab',
      tabIndex: 0,
      'aria-selected': tab.id === activeId,
      className: `${NS}-tab`,
      onClick: () => onSelect(tab.id),
      // The middle button closes the tab, which is what a middle button
      // does to a tab everywhere else it exists — and the one gesture that
      // closes several in a row without the pointer having to find a 16px
      // target each time.
      //
      // `onAuxClick` rather than a button test inside `onClick`: React
      // routes the non-primary buttons there, and a middle press never
      // reaches the click handler at all. The mousedown is refused
      // separately because middle-press is the browser's autoscroll
      // gesture, which otherwise starts on the tab strip and leaves the
      // page in scroll mode after the tab has gone.
      onMouseDown: (event) => { if (event.button === 1) event.preventDefault() },
      onAuxClick: (event) => {
        if (event.button !== 1) return
        event.preventDefault()
        onClose(tab.id)
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(tab.id)
        }
      },
    },
    h('span', { className: `${NS}-tab-icon` }, icon(tab.icon ?? 'file', 14)),
    h('span', { className: `${NS}-tab-label` }, tab.label ?? t(`tool.${tab.id}`)),
    // Rendered on every tab, shown by CSS under the pointer. Rendering it
    // only for the active tab was the first attempt and it does not answer
    // the requirement: hovering any other tab found no element to reveal.
    // Showing it costs no reflow: it is positioned rather than laid out,
    // so no tab changes width when the pointer arrives or leaves.
    h('span', {
      className: `${NS}-tab-close`,
      role: 'button',
      'aria-label': t('tab.close', { name: tab.label ?? t(`tool.${tab.id}`) }),
      onClick: (event) => {
        event.stopPropagation()
        onClose(tab.id)
      },
    }, icon('close', 12))))),
    // The way to a tool, kept against the tabs because that is what it
    // adds to: after the last one, and at the head of the row when there
    // are none. Drawn whether or not anything is open, which is what makes
    // the row permanent — a bar whose controls come and go is a bar you
    // have to look for before you can use it.
    h('button', {
      ref: plus,
      type: 'button',
      className: `${NS}-icon-button`,
      title: t('panel.open'),
      'aria-label': t('panel.open'),
      'aria-pressed': activeId === undefined,
      'aria-haspopup': tabs.length === 0 ? undefined : 'menu',
      'aria-expanded': tabs.length === 0 ? undefined : listing,
      // With nothing open the panel is already showing the chooser, so the
      // `+` only has to make sure it is what is on screen. With something
      // open, sending the panel to the chooser would take the tab away to
      // ask a question — the tenant would lose sight of what they were
      // reading in order to add something beside it. So the choice comes
      // to them instead, as a menu hanging off the control they pressed,
      // and whatever is open stays open behind it.
      onClick: () => { if (tabs.length === 0) onNew(); else setListing((open) => !open) },
    }, icon('new')),
    // Drawn beside the button rather than inside it: `overflow` on the tab
    // strip would clip it, and the row's own stacking context would put it
    // under the panel's chrome.
    !listing || tabs.length === 0 ? null : h('div', {
      ref: menu,
      role: 'menu',
      className: `${NS}-menu`,
      style: {
        left: `${String(place?.left ?? 0)}px`,
        top: `${String(place?.top ?? 0)}px`,
        // Placed on the second pass; drawn where it will land rather than
        // at the corner and then moved, which reads as a jump.
        visibility: place === undefined ? 'hidden' : undefined,
      },
    }, TOOLS.map((tool) => h('button', {
      key: tool.id,
      type: 'button',
      role: 'menuitem',
      className: `${NS}-menu-item ${NS}-menu-tool`,
      // Opening what is already open is focusing it, which is what the
      // chooser has always done — so there is nothing to disable here.
      onClick: () => { setListing(false); onOpen(tool) },
    }, h('span', null, icon(tool.icon, 15)), h('span', null, t(`tool.${tool.id}`))))),
    // What is about the panel rather than about one tab sits at its far
    // edge, so the row reads as tabs on one side and panel controls on the
    // other.
    h('span', { className: `${NS}-spacer` }),
    // Widen to everything but the tenant's own sidebar.
    h('button', {
      type: 'button',
      className: `${NS}-icon-button`,
      title: t(maximised ? 'panel.restore' : 'panel.expand'),
      'aria-label': t(maximised ? 'panel.restore' : 'panel.expand'),
      'aria-pressed': maximised,
      onClick: onMaximise,
    }, icon(maximised ? 'shrink' : 'expand')),
    // The same control as the one in the session header, by the same
    // class and the same glyph — not a second control that also closes the
    // panel. It is here rather than there because that is where it is
    // needed once the panel is open.
    h('button', {
      type: 'button',
      className: `${NS}-toggle`,
      title: t('panel.collapse'),
      'aria-label': t('panel.collapse'),
      onClick: onCollapse,
    }, icon('panel')),
  )
}

/**
 * What an open panel with no tabs shows.
 * @param {object} props - the opener for a chosen tool.
 * @returns {object} the element.
 */
export function EmptyState({ onOpen, open }) {
  const t = useT()
  return h('div', { className: `${NS}-empty` },
    h('div', { className: `${NS}-choices` },
      TOOLS.map((tool) => h('button', {
        key: tool.id,
        type: 'button',
        className: `${NS}-choice`,
        // The sentence the card used to carry as a third line. Kept, and
        // kept where a sentence belongs on a control this small — it still
        // says what the tool is for, and it still says when the tool is
        // already open, which reads as a state rather than as a disabled
        // control: the click works either way, it just focuses what is
        // there.
        title: open.some((tab) => tab.id === tool.id) ? t('empty.opened') : t(`tool.${tool.id}.note`),
        onClick: () => onOpen(tool),
      },
      h('span', { className: `${NS}-choice-icon` }, icon(tool.icon, 18)),
      h('span', null, t(`tool.${tool.id}`))))),
  )
}

/**
 * The body of a tab that has no data plane yet.
 * @param {object} props - the tab being stood in for.
 * @returns {object} the element.
 */
export function Placeholder({ tab }) {
  const t = useT()
  return h('div', { className: `${NS}-placeholder` },
    h('div', null, t('stub.title', { name: tab.label ?? t(`tool.${tab.id}`) })),
    h('div', null, t('stub.note')),
  )
}
