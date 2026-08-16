/**
 * The lattice this deployment's pages stand on.
 *
 * A grid of points that settles into stillness and pushes away from the
 * cursor, drawn on a canvas behind everything else. It is the ground rather
 * than an effect over one: a page with no motion — a touch screen, a reader
 * who asked for stillness — gets one static frame of the same drawing instead
 * of nothing.
 *
 * ## Why it is a file rather than either page's own code
 *
 * It was written twice: once in the landing page's module and once as a string
 * inside the gateway's page chrome, where every backtick had to be escaped
 * because it sat inside a template literal. The two drifted the way two copies
 * do — one grew a theme observer the other never got, and the other kept a
 * `requestAnimationFrame` handle nothing ever cancelled — and a fix to the
 * physics had to be made twice, in two escaping regimes.
 *
 * So it is one file, in two shapes that are the same bytes. The landing page
 * imports it and its bundler inlines it. The gateway reads it off disk at boot
 * and puts it in a `<script>` — see `index.js` — which is also what removes
 * the escaping: the text is interpolated into the page, never parsed as a
 * template.
 *
 * ## What a page owes it
 *
 * A `<canvas data-ground>` somewhere in the body, and three custom properties
 * on the root: `--grid-line`, `--grid-dot` and `--accent-rgb`. The canvas is
 * found by the attribute and not by an id, because the two pages name theirs
 * differently and their stylesheets are their own.
 *
 * An IIFE and not a module body, because it has to be valid as both: an ES
 * module the landing page imports, and a classic inline script in the
 * gateway's pages.
 */

;(() => {
  const canvas = document.querySelector('canvas[data-ground]')
  const context = canvas && canvas.getContext('2d')
  if (!context) return

  const SPACING = 90        // cell size, CSS pixels
  const REACH = 140         // how far from the cursor a point feels anything
  const PUSH = 30           // peak force, at the cursor itself
  const SPRING = 0.05       // pull back towards rest
  const DAMPING = 0.85
  const GAP = 10            // drawn gap at each end of a segment
  const FRAME = 1000 / 30
  const ASLEEP = 0.01       // below this much motion there is nothing left to draw

  const idle = matchMedia('(hover: none), (pointer: coarse)').matches
    || matchMedia('(prefers-reduced-motion: reduce)').matches

  let ratio = 1, width = 0, height = 0, columns = 0, rows = 0
  let points = []
  let line = 'rgba(16,17,19,.055)', dot = 'rgba(16,17,19,.10)', accent = '10 125 85'
  let sleeping = false, previous = 0, pending = 0
  const cursor = { x: NaN, y: NaN }

  function readTokens() {
    const style = getComputedStyle(document.documentElement)
    line = style.getPropertyValue('--grid-line').trim() || line
    dot = style.getPropertyValue('--grid-dot').trim() || dot
    accent = style.getPropertyValue('--accent-rgb').trim() || accent
  }

  function build() {
    columns = Math.ceil(width / SPACING) + 1
    rows = Math.ceil(height / SPACING) + 1
    // Centred, so the lattice is not pinned to one corner as the window changes.
    const originX = (width - (columns - 1) * SPACING) / 2
    const originY = (height - (rows - 1) * SPACING) / 2
    points = []
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = originX + column * SPACING
        const y = originY + row * SPACING
        points.push({ restX: x, restY: y, x, y, vx: 0, vy: 0 })
      }
    }
  }

  function resize() {
    ratio = Math.min(devicePixelRatio || 1, 2)
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    build()
  }

  function segment(a, b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length < GAP * 2) return
    const ux = dx / length
    const uy = dy / length
    context.moveTo(a.x + GAP * ux, a.y + GAP * uy)
    context.lineTo(b.x - GAP * ux, b.y - GAP * uy)
  }

  /** @returns {number} the fastest point this frame, which is what decides sleep. */
  function draw() {
    const mx = cursor.x
    const my = cursor.y
    const chased = !Number.isNaN(mx)
    let fastest = 0

    for (const point of points) {
      if (chased) {
        const dx = point.x - mx
        const dy = point.y - my
        const distance = Math.hypot(dx, dy)
        if (distance < REACH && distance > 0.1) {
          const force = (1 - distance / REACH) * PUSH * 0.1
          point.vx += (dx / distance) * force
          point.vy += (dy / distance) * force
        }
      }
      point.vx = (point.vx + SPRING * (point.restX - point.x)) * DAMPING
      point.vy = (point.vy + SPRING * (point.restY - point.y)) * DAMPING
      point.x += point.vx
      point.y += point.vy
      const speed = Math.abs(point.vx) + Math.abs(point.vy)
      if (speed > fastest) fastest = speed
    }

    context.clearRect(0, 0, width, height)

    // Every segment in one path: a few hundred strokes a frame is the one thing
    // here that would show up in a profile, and batching makes it one.
    context.strokeStyle = line
    context.lineWidth = 0.5
    context.beginPath()
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns - 1; column++) {
        segment(points[row * columns + column], points[row * columns + column + 1])
      }
    }
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows - 1; row++) {
        segment(points[row * columns + column], points[(row + 1) * columns + column])
      }
    }
    context.stroke()

    // Squares rather than arcs, as upstream draws them: at this size the shape
    // does not read, and `fillRect` skips a path per point.
    context.fillStyle = dot
    for (const point of points) {
      context.fillRect(point.x - 1.8, point.y - 1.8, 3.6, 3.6)
    }

    // A second pass over only what the cursor is near, tinting those points
    // towards the accent as they grow. Overdrawing is what blends the two
    // colours — interpolating them would mean parsing both.
    if (chased) {
      for (const point of points) {
        const near = 1 - Math.hypot(point.x - mx, point.y - my) / REACH
        if (near <= 0) continue
        const half = 1.8 + 2 * near
        context.fillStyle = `rgb(${accent} / ${(0.45 * near).toFixed(3)})`
        context.fillRect(point.x - half, point.y - half, half * 2, half * 2)
      }
    }

    return fastest
  }

  function tick(now) {
    if (now - previous < FRAME) { requestAnimationFrame(tick); return }
    previous = now - (now - previous) % FRAME

    if (canvas.clientWidth !== width || canvas.clientHeight !== height) resize()

    if (draw() < ASLEEP) sleeping = true
    else requestAnimationFrame(tick)
  }

  function wake() {
    if (!sleeping) return
    sleeping = false
    previous = 0
    requestAnimationFrame(tick)
  }

  readTokens()
  resize()

  if (idle) {
    draw()
    addEventListener('resize', () => {
      clearTimeout(pending)
      pending = setTimeout(() => { resize(); draw() }, 150)
    })
  } else {
    requestAnimationFrame(tick)
    addEventListener('mousemove', (event) => {
      const box = canvas.getBoundingClientRect()
      cursor.x = event.clientX - box.left
      cursor.y = event.clientY - box.top
      wake()
    }, { passive: true })
    addEventListener('resize', () => {
      clearTimeout(pending)
      pending = setTimeout(() => { resize(); wake() }, 150)
    })
  }

  // The colours are read once, so the lattice would otherwise keep drawing in
  // the old palette after the theme changed under it. Two ways it can: the
  // system, and this deployment's own toggle, which writes `data-theme` on the
  // root — the landing page has only the first because it has no toggle.
  function repaint() {
    readTokens()
    if (sleeping || idle) draw()
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint)
  new MutationObserver(repaint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})()
