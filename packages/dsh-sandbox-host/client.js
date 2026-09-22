/**
 * The sandbox adaptation layer, browser half.
 *
 * The sandbox status and configuration-document views. Conversation attachments
 * use the harness's own upload service, draft cards, and input controls.
 *
 * One file, deliberately: the client-module registry serves a plugin's `client`
 * export verbatim — nothing resolves through node_modules and there is no build
 * step — so a second file would be a second module the shell never fetches.
 * `require` here is the shell's own module table, which is where React comes
 * from.
 */

window.__ModuleLoader__.load({
  id: 'dsh-sandbox-host',
  factory: (require) => {
    const React = require('react')

    /**
     * The shell's own icon set.
     *
     * `?? {}` and a `try`, because the module table answers `undefined` for an
     * id it does not carry and every use below is a property read — which on
     * `undefined` is a TypeError during render, and a render error takes the
     * seat down. A missing glyph should cost the glyph, not the settings page.
     */
    let primitives = {}
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}
    } catch (error) {
      console.warn('[dsh-sandbox-host] ui-primitives did not load; rows render without glyphs', error)
    }

    /**
     * The one glyph this plugin draws itself.
     *
     * The configuration row's glyph is the harness's own,
     * required above. A sandbox is not in that set — `ArchiveOutline20` is a
     * lidded box and means archive — so this comes from
     * `packages/dsh-icons`, drawn to the same rules: a 16 grid, a 1.3 stroke
     * expanded to a filled outline, `currentColor`.
     *
     * Inlined rather than imported: this file is read as source by the shell's
     * module loader — require here is the shell's table, not Node's — so there
     * is no build step to resolve a sibling package through.
     * scripts/check-icons.mjs holds these bytes to the dsh-icons originals.
     */
    const SANDBOX_GLYPH = {
      viewBox: '0 0 24 24',
      paths: [
        'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
        'm3.3 7 8.7 5 8.7-5',
        'M12 22V12',
      ],
      stroke: { width: 2, linecap: 'round', linejoin: 'round' },
    }

    /** Which glyph each nav row wears, by the name the call sites use. */
    const GLYPHS = {
      configuration: primitives.IconListPenOutlineMedium,
      sandbox: SANDBOX_GLYPH,
    }

    /**
     * One glyph, whichever half it comes from.
     *
     * @param {object} props - `name`, and an optional `size`.
     * @returns {object | null} the icon, or null when nothing carries that name.
     */
    const Glyph = ({ name, size = 16 }) => {
      const glyph = GLYPHS[name]
      if (glyph === undefined) return null
      if (typeof glyph === 'function') return React.createElement(glyph, { size })
      // Painted the way it was drawn, and sized by its own box: the harness's
      // glyphs are filled outlines on a 16 grid, the extracted half is strokes
      // on a 24. Filling a stroke turns a drawing into a blot, and a 24-box
      // glyph forced through a 16 viewBox is a quarter of a drawing.
      const paint = glyph.stroke === undefined
        ? { fill: 'currentColor', fillRule: 'evenodd' }
        : {
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: glyph.stroke.width,
            strokeLinecap: glyph.stroke.linecap,
            strokeLinejoin: glyph.stroke.linejoin,
          }
      return React.createElement('svg', {
        width: size, height: size, viewBox: glyph.viewBox, fill: 'none',
        style: { flex: 'none' }, 'aria-hidden': true,
      }, ...glyph.paths.map((d, at) => React.createElement('path', { key: at, d, transform: glyph.transform, ...paint })))
    }

    // ---------------------------------------------------------------- wire --

    /** The channel the host half owns. One path segment; see its module note. */
    const CHANNEL = '/files'

    /** Marks a nav label that brought its own glyph. */
    const NAV_GLYPH = 'dsh-settings-nav-glyph'

    /** Hides the panel's fallback gear on any cell whose label brought one. */
    const NAV_GLYPH_CSS = `
      button:has(> span > .${NAV_GLYPH}) > svg { display: none; }
    `

    /**
     * A settings-nav label that carries its own glyph.
     *
     * The panel picks its nav icon from a hardcoded list of three section ids
     * and gives everything else the same gear, and its registration contract
     * has no icon field — but `resolveSlotLabel` is `typeof x === 'function' ?
     * x() : x`, so a label is passed through verbatim and may be a node. The
     * glyph therefore rides in on the label, inside the span the panel renders
     * it into.
     *
     * The rule that hides the fallback gear is mounted separately rather than
     * from inside this label: a style tag here would put its CSS into the nav
     * cell's `textContent`, which is the cell's accessible name — a screen
     * reader would read the stylesheet out. It is written structurally — a
     * button whose label holds our marker, hide the svg that is its own direct
     * child — so it names no content-hashed class and survives the panel's
     * styles being rebuilt. If upstream ever changes that shape the worst case
     * is two glyphs, not a broken page.
     *
     * @param {string} d - the path data for a 16px glyph.
     * @param {string} text - the section name.
     * @returns {object} the label node.
     */
    /**
     * A settings nav row: a glyph, and the section's name in the current
     * language.
     *
     * A component rather than an element, because this is built once when the
     * section registers and then held in the registration for as long as the
     * plugin lives. An element would hold whichever language was active at
     * registration and keep showing it; a component re-renders when the
     * language changes, like everything else here.
     *
     * `data-dsh-section` identifies the section independently of its
     * translated visible label.
     */
    const NavLabel = ({ name, section }) => {
      const t = useT()
      return React.createElement(
        'span',
        {
          className: NAV_GLYPH,
          'data-dsh-section': section,
          style: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
        },
        React.createElement(Glyph, { name }),
        t(section),
      )
    }

    /** The registration's `label`: an element, and this one keeps rendering. */
    const navLabel = (name, section) => React.createElement(NavLabel, { name, section })


    /**
     * The plugin context, captured at mount.
     *
     * Shared by the settings pages and labels registered by this plugin.
     */
    let plugin

    /**
     * Translate, and re-render this component when the language changes.
     *
     * Subscribing here rather than taking the `t` the slot machinery hands a
     * slot's root component: most of what this plugin says is said several
     * levels below a root, and one of the things it says is a settings section
     * LABEL — which is an element built once at registration, so nothing would
     * ever ask it to render again. A component that subscribes for itself does
     * not care how far from a slot it sits, or whether it is inside one.
     *
     * `getSnapshot`/`subscribe` are the locale service's own pair, so this is
     * the same signal the shell's own rows re-render on.
     *
     * @returns {(key: string, params?: object) => string} the translator.
     */
    const useT = () => {
      React.useSyncExternalStore(
        (notify) => plugin.locale.subscribe(notify),
        () => plugin.locale.getSnapshot(),
      )
      return plugin.locale.bind(NS)
    }

    /**
     * One call on the file channel, with the envelope's error thrown.
     * @param {string} endpoint - channel-relative endpoint.
     * @param {object} payload - the request payload.
     * @returns {Promise<object>} the value the host returned.
     */
    const call = async (endpoint, payload) => {
      const result = await plugin.connection.rpc.call(CHANNEL, endpoint, payload)
      if (result.ok) return result.value
      throw new Error(result.error.message)
    }

    /**
     * This plugin's own dictionary namespace.
     *
     * Its own, because a namespace is the unit `locale.register` refuses to
     * collide on: two plugins registering the same one is an error rather than
     * a silent last-writer-wins, and that is worth having.
     */
    const NS = 'hamsterhq.sandbox'

    /**
     * Everything this plugin says, in both languages.
     *
     * Chinese first because this deployment's audience is, and English beside
     * it because the shell offers a language switch and a plugin that ignores
     * it is a plugin that half-translates the window. `{name}` holes are filled
     * by the locale service.
     */
    const DICTIONARY = {
      zh: {

        sandbox: '沙箱',
        configuration: '配置文件',

        'status.running': '运行中',
        'status.starting': '连接中',
        'status.reconnecting': '重连中',
        'status.claiming': '申请中',
        'status.unknown': '未知',

        memory: '内存',
        disk: '磁盘',

        // Inside the ring, which is 20px across. The full word fits in
        // Chinese at two characters and does not in English, so the ring
        // takes the short form and the settings page keeps the word.
        'ring.memory': '内存',
        'ring.disk': '磁盘',
        measuring: '正在测量',
        'cpu.measuring': 'CPU：正在测量',
        'cpu.title': 'CPU {percent}%',
        'cpu.title.cores': 'CPU {percent}%（{cores} 核）',
        'cpu.value': '{percent}%',
        'cpu.value.cores': '{cores} 核 · {percent}%',
        'memory.title': '内存 {value}',
        'disk.title': '磁盘 {value}',

        'row.id': '标识',
        'row.version': '版本',
        'row.status': '状态',
        'row.usage': '用量',
        'version.unknown': '未知',
        'version.stale': '部署已是 {current}。Restart 后升级到该版本。',
        'version.current': '与当前部署一致',
        yours: '这台机器只属于你：会话、工作区与文件都不与其他用户共享。闲置一段时间后它会被回收，下次打开时重新创建。',

        'config.reading': '读取中…',
        'config.unreadable': '无法读取配置文件：{message}',
        'config.where': '你的后端运行在沙箱里，这个文件在那台机器上，不在你的电脑上——所以它在这里显示，而不是被打开。',
        'config.empty': '（空）',
        copy: '复制',
        download: '下载',
      },
      en: {

        sandbox: 'Sandbox',
        configuration: 'Configuration',

        'status.running': 'Running',
        'status.starting': 'Connecting',
        'status.reconnecting': 'Reconnecting',
        'status.claiming': 'Requesting',
        'status.unknown': 'Unknown',

        memory: 'Memory',
        disk: 'Disk',

        // The rings are a readout rather than a sentence, so their labels are
        // set as abbreviations — and as the same two the front door's picture
        // of this sidebar shows. They read `RAM` and `Disk` here while that
        // picture read `MEM` and `DISK`, which made the still a still of a
        // product that does not exist. `memory` and `disk` above keep their
        // whole words: those label rows, where there is room to say it.
        'ring.memory': 'MEM',
        'ring.disk': 'DISK',
        measuring: 'measuring',
        'cpu.measuring': 'CPU: measuring',
        'cpu.title': 'CPU {percent}%',
        'cpu.title.cores': 'CPU {percent}% ({cores} cores)',
        'cpu.value': '{percent}%',
        'cpu.value.cores': '{cores} cores · {percent}%',
        'memory.title': 'Memory {value}',
        'disk.title': 'Disk {value}',

        'row.id': 'ID',
        'row.version': 'Version',
        'row.status': 'State',
        'row.usage': 'Usage',
        'version.unknown': 'Unknown',
        'version.stale': 'Deployment is on {current}. Restart to upgrade.',
        'version.current': 'Matches the current deployment',
        yours: 'This machine is yours alone: its sessions, workspace and files are shared with nobody. It is reclaimed after a period of inactivity and built again the next time you open it.',

        'config.reading': 'Reading…',
        'config.unreadable': 'Could not read the configuration file: {message}',
        'config.where': 'Your backend runs in the sandbox, and this file is on that machine rather than on yours — which is why it is shown here instead of opened.',
        'config.empty': '(empty)',
        copy: 'Copy',
        download: 'Download',
      },
    }


    // --------------------------------------------------------------- style --

    /** Classes the rules below are scoped to; nothing else in the page uses them. */
    const P = 'dsh-sandbox-host'

    /**
     * Built from the theme tokens on body, not from a hashed CSS-module class
     * name, so both themes follow and this file does not name any private class.
     */
    /**
     * How long the arc takes to reach a new reading.
     *
     * Short, and nothing to do with how often readings arrive. Pacing it to the
     * sampler's five seconds was the previous attempt and it was worse than
     * either thing it was trying to balance: an arc interpolating across the
     * whole interval is never showing the current reading, only travelling
     * towards it, so the ring disagreed with the number under the pointer for
     * seconds at a time. That is the lag, and no amount of smoothness pays for
     * it.
     *
     * Parking between readings is not a fault to design around. The value
     * genuinely does not change between samples, and a still arc says so.
     *
     * Declared HERE, above the stylesheet, because `STYLE` interpolates it at
     * module scope. Further down it was in the temporal dead zone by the time
     * that template ran, and the plugin failed to import at all.
     */
    const ARC_MS = 420

    const STYLE = `
      .${P}-document {
        margin: 0; padding: 12px 14px; max-height: 420px; overflow: auto;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-border-l1, rgb(0 0 0 / 4%));
        color: var(--dsw-alias-label-primary, inherit);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px; line-height: 1.6; white-space: pre;
      }
      .${P}-button {
        display: inline-flex; align-items: center; height: 32px; padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-button-elevated-fill, #fff);
        color: var(--dsw-alias-label-primary, inherit);
        font-family: inherit; font-size: 13px; cursor: pointer;
      }
      .${P}-button:hover { background: var(--dsw-alias-button-floating-hover, rgb(241 243 245)); }
      .${P}-sandbox-compact { display:flex; height:28px; width:100%; border:0; background:transparent; cursor:pointer; align-items:center; justify-content:center; }
      .${P}-sandbox {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; width: 100%; box-sizing: border-box;
        padding: 8px; border: 0; border-radius: 12px; cursor: pointer; text-align: start; color: inherit; font: inherit;
        background: transparent;
        transition: background 120ms ease;
      }
      /* The wash the shell uses for its own hoverable rows, not a solid fill.
          The account row directly below this one is inside the shell's Settings
          button and hovers with that wash; a solid fill here made two rows in
          one column light up at visibly different strengths. Solid tokens are
          also a trap on this palette — ghost-active-fill and elevated-fill are
          the same colour in dark, so a fill can silently equal its own
          background. An overlay cannot. */
      .${P}-sandbox:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
      .${P}-sandbox-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .${P}-sandbox-title { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); line-height: 16px; }
      .${P}-sandbox-state {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 13px; color: var(--dsw-alias-label-secondary, #61666b); line-height: 18px;
      }
      .${P}-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
      .${P}-rings { display: inline-flex; gap: 6px; flex: none; }
      .${P}-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; }
      .${P}-ring-label, .${P}-ring-value {
        position: absolute; line-height: 1;
        transition: opacity 120ms ease;
      }
      .${P}-ring-label { font-size: 8px; color: var(--dsw-alias-label-tertiary, #81858c); }
      /* The number the ring is drawing, for a pointer that stops on it. The
         arc says roughly; this says exactly, without spending a row of the
         sidebar on three figures nobody is reading most of the time.

         Smaller than the label because it has to hold four characters inside a
         20px opening, and tabular so the last digit does not step sideways as
         the value changes under the pointer. */
      .${P}-ring-value {
        font-size: 8px; font-variant-numeric: tabular-nums; opacity: 0;
        color: var(--dsw-alias-label-primary, #1a1a1a);
      }
      .${P}-ring:hover .${P}-ring-label { opacity: 0; }
      .${P}-ring:hover .${P}-ring-value { opacity: 1; }

      /* The arc moves to each new reading and then holds it.

         ease-out, which is the part the first version got wrong. It used
         ease — ease-in-OUT — whose slow start reads as hesitation: the
         reading lands, and for the first fraction of a second nothing appears
         to happen. Starting at full speed and decelerating into place reads as
         a response.

         Short enough that the ring and the number shown on hover are never
         meaningfully apart, which is the whole reason not to stretch this. */
      .${P}-ring-arc { transition: stroke-dashoffset ${String(ARC_MS)}ms ease-out, stroke 300ms ease; }
      @media (prefers-reduced-motion: reduce) {
        .${P}-ring-label, .${P}-ring-value, .${P}-ring-arc { transition: none; }
      }
    `

    /** The stylesheet, mounted by whichever of our seats renders first. */
    const Style = () => React.createElement('style', null, STYLE)

    // --------------------------------------------------------- sandbox bar --

    /** How often the footer asks the sandbox how it is doing. */

    /**
     * Ring geometry matches the landing page's gauges — 32px across with a
     * 2px band — so the status bar is glanced at rather than read.
     */
    const RING = { size: 32, r: 14, width: 2 }
    const CIRCUMFERENCE = 2 * Math.PI * RING.r

    /**
     * One metric as a ring.
     *
     * Two circles: the track, and an arc drawn with `stroke-dasharray` — the
     * usual way to draw a fraction of a circle without a path calculation. It
     * starts at twelve o'clock because a gauge that starts at three reads as
     * broken to everyone who has seen any other gauge.
     *
     * @param {object} props - label, fraction (0..1 or null), and the title.
     * @returns {object} the ring.
     */
    const Ring = ({ label, value, title }) => {
      const known = typeof value === 'number' && Number.isFinite(value)
      const shown = known ? Math.min(1, Math.max(0, value)) : 0
      // Green until it is worth noticing, then amber, then red. The thresholds
      // are where a person would want to act, not evenly spaced.
      const stroke = !known
        ? 'var(--dsw-alias-border-l2, rgb(0 0 0 / 12%))'
        : shown >= 0.9 ? 'var(--dsw-alias-state-error-primary, #ec1313)'
          : shown >= 0.7 ? 'var(--dsw-alias-state-warn-label, #dd8629)'
            : 'var(--dsw-alias-state-success-primary, #22c55e)'
      return React.createElement(
        'span',
        { className: `${P}-ring`, title },
        React.createElement(
          'svg',
          { width: RING.size, height: RING.size, viewBox: `0 0 ${String(RING.size)} ${String(RING.size)}`, 'aria-hidden': true },
          React.createElement('circle', {
            cx: RING.size / 2, cy: RING.size / 2, r: RING.r, fill: 'none',
            stroke: 'var(--dsw-alias-border-l1, rgb(0 0 0 / 4%))', strokeWidth: RING.width,
          }),
          // Always in the tree, even before there is anything to show. An arc
          // that appears when the first reading does appears already drawn —
          // mounting is not a change, so there is nothing for the transition to
          // run on. Present from the start at zero length, it grows into the
          // first reading, which is what a gauge coming to life should look
          // like. Hidden rather than absent while unknown, because a
          // zero-length dash under a round cap still paints a dot.
          React.createElement('circle', {
            className: `${P}-ring-arc`,
            cx: RING.size / 2, cy: RING.size / 2, r: RING.r, fill: 'none',
            stroke, strokeWidth: RING.width, strokeLinecap: 'round',
            strokeOpacity: known ? 1 : 0,
            strokeDasharray: CIRCUMFERENCE,
            strokeDashoffset: CIRCUMFERENCE * (1 - shown),
            transform: `rotate(-90 ${String(RING.size / 2)} ${String(RING.size / 2)})`,
          }),
        ),
        React.createElement('span', { className: `${P}-ring-label` }, label),
        // Derived from the same fraction the arc is drawn from, so the number
        // under the pointer cannot disagree with the ring around it.
        known && React.createElement(
          'span',
          { className: `${P}-ring-value` },
          `${String(Math.round(shown * 100))}%`,
        ),
      )
    }

    /**
     * Subscribe to the sandbox's own numbers.
     *
     * The stream carries metrics and a liveness bit, but the bar must not wait
     * on that bit arriving in order. The tunnel dials after the API plane is
     * up, SSE can blip, and a quiet `ok: false` used to leave the row on
     * "connecting" until some later push — while the machine was already
     * usable. So this hook owns the probe: while the sandbox is not running it
     * closes and reopens `/sandbox/stats` on an exponential backoff, and only
     * resets that backoff when a frame says `ok: true`.
     *
     * @returns {{status: string, stats: object|null}} the reading, as the bar draws it.
     */
    const useSandboxStats = () => {
      // What is true before the first reading arrives, and it is not "unknown".
      //
      // Nothing is unknown here: this row is drawn by a page that has just
      // been served to a signed-in tenant, and a tenant with a page has a
      // sandbox being made for them — the gateway asks for one on the way in,
      // and the first `/sandbox/stats` frame is a machine answering, not the
      // question being put. Cold, that took a while, and the wait was spent
      // showing a grey dot beside "Unknown": the deployment's own status bar
      // saying it had no idea what was happening, on the one screen where
      // somebody is waiting to find out.
      //
      // It is a third state rather than "starting" because they are not the
      // same wait and the difference is the tenant's: `claiming` is nobody's
      // machine yet, `starting` is theirs and coming up. `unknown` stays in
      // the dictionary — the stats rows below still use it for a number that
      // genuinely is not known.
      const [state, setState] = React.useState({ status: 'claiming', stats: null })

      React.useEffect(() => {
        const BASE_MS = 1000
        const MAX_MS = 15000
        let source
        let timer
        let delay = BASE_MS
        let stopped = false
        let wasConnected = false

        const clearTimer = () => {
          if (timer === undefined) return
          clearTimeout(timer)
          timer = undefined
        }

        const closeSource = () => {
          if (source === undefined) return
          source.removeEventListener('message', onMessage)
          source.removeEventListener('error', onError)
          source.close()
          source = undefined
        }

        /** Re-open the stream after backoff — a fresh attach re-resolves. */
        const scheduleReopen = () => {
          if (stopped || timer !== undefined) return
          const wait = delay
          delay = Math.min(delay * 2, MAX_MS)
          timer = setTimeout(() => {
            timer = undefined
            open()
          }, wait)
        }

        const onMessage = (event) => {
          let reading
          try { reading = JSON.parse(event.data) } catch { return }
          // The gateway has looked and the machine is up with nothing serving
          // on it. That is not a wait, and nothing in this shell can end it —
          // the shell IS the thing that died. The recovery page is served by
          // the gateway for exactly this moment, so go there rather than
          // retrying a backend that is not coming back on its own.
          //
          // A whole-page navigation, not a route change: everything on this
          // screen is drawn by the process that is gone.
          if (reading.recover === true) {
            window.location.assign('/recovery')
            return
          }
          if (reading.ok === true) {
            wasConnected = true
            delay = BASE_MS
            clearTimer()
            setState({ status: 'running', stats: reading.stats ?? null })
            return
          }
          setState((current) => ({ status: wasConnected ? 'reconnecting' : 'starting', stats: current.stats }))
          // Do not sit on this generation waiting for a dial-in push: probe
          // again on a backoff. The open stream may still deliver `ok: true`
          // first, which cancels the timer above.
          scheduleReopen()
        }

        const onError = () => {
          // A reconnecting EventSource is not evidence of a live tunnel.
          // Let native retries continue, but immediately invalidate the label.
          setState((current) => ({ status: wasConnected ? 'reconnecting' : 'starting', stats: current.stats }))
          if (source !== undefined && source.readyState !== EventSource.CLOSED) return
          closeSource()
          scheduleReopen()
        }

        const open = () => {
          if (stopped) return
          clearTimer()
          closeSource()
          source = new EventSource('/sandbox/stats')
          source.addEventListener('message', onMessage)
          source.addEventListener('error', onError)
        }

        open()
        return () => {
          stopped = true
          clearTimer()
          closeSource()
        }
      }, [])

      return state
    }

    /**
     * The dot a state wears.
     *
     * Both waits are amber, because both are the same news to the person
     * reading them: not yet, and nothing to do. Grey is kept for a state this
     * bar can no longer reach — it says "no reading", and the two waits are
     * readings.
     *
     * @param {string} status - the state.
     * @returns {string} the colour.
     */
    const statusDot = (status) => (status === 'running'
      ? 'var(--dsw-alias-state-success-primary, #22c55e)'
      : status === 'starting' || status === 'claiming' || status === 'reconnecting'
        ? 'var(--dsw-alias-state-warn-label, #dd8629)'
        : 'var(--dsw-alias-border-l2, rgb(0 0 0 / 25%))')

    /**
     * The dictionary key a state is said with.
     *
     * A table rather than a chain of conditionals, because there are two
     * places that draw this state and a chain in each is how they came to
     * disagree about a third one.
     *
     * @param {string} status - the state.
     * @returns {string} the key.
     */
    const statusKey = (status) => (['running', 'starting', 'claiming', 'reconnecting'].includes(status)
      ? `status.${status}`
      : 'status.unknown')

    const SandboxStatus = ({ wide }) => {
      const t = useT()
      const { status, stats } = useSandboxStats()

      const pct = (part) => (part && part.totalBytes > 0 ? part.usedBytes / part.totalBytes : null)
      const gb = (bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
      const asText = (part) => (part ? `${gb(part.usedBytes)} / ${gb(part.totalBytes)}` : t('status.unknown'))

      const openSettings = () => document.dispatchEvent(new CustomEvent('dsh-settings-open', { detail: { section: 'sandbox' } }))

      if (!wide) return React.createElement('button', {
        type: 'button', onClick: openSettings, 'aria-haspopup': 'dialog',
        className: `${P}-sandbox-compact`,
        title: `${t('sandbox')}: ${t(statusKey(status))}`, 'aria-label': `${t('sandbox')}: ${t(statusKey(status))}`,
      }, React.createElement(Style), React.createElement(Glyph, { name: 'sandbox', size: 16 }))

      return React.createElement(
        'button',
        { type: 'button', onClick: openSettings, 'aria-haspopup': 'dialog', className: `${P}-sandbox`, 'aria-label': t('sandbox') },
        React.createElement(Style),
        React.createElement(
          'span',
          { className: `${P}-sandbox-text` },
          React.createElement('span', { className: `${P}-sandbox-title` }, t('sandbox')),
          React.createElement('span', { className: `${P}-sandbox-state`, role: 'status', 'aria-live': 'polite', 'data-status': status },
            React.createElement('span', { className: `${P}-dot`, 'aria-hidden': true, style: { background: statusDot(status) } }),
            t(statusKey(status))),
        ),
        React.createElement(
          'span',
          { className: `${P}-rings` },
          React.createElement(Ring, {
            label: 'CPU',
            value: stats?.cpu ?? null,
            title: stats?.cpu === null || stats?.cpu === undefined
              ? t('cpu.measuring')
              : t(stats.cores ? 'cpu.title.cores' : 'cpu.title', {
                percent: String(Math.round(stats.cpu * 100)),
                cores: String(stats.cores ?? ''),
              }),
          }),
          React.createElement(Ring, {
            label: t('ring.memory'), value: pct(stats?.memory), title: t('memory.title', { value: asText(stats?.memory) }),
          }),
          React.createElement(Ring, {
            label: t('ring.disk'), value: pct(stats?.disk), title: t('disk.title', { value: asText(stats?.disk) }),
          }),
        ),
      )
    }

    // ------------------------------------------------------------- settings --

    /**
     * The sandbox, in the settings panel.
     *
     * The sidebar row says whether the machine is alive in the corner of a
     * person's eye; this says what it actually is, at a size where the figures
     * can be read rather than inferred from the fill of a 16px ring. Pressing
     * that row is what opens this panel.
     *
     * Belongs to this plugin rather than to `dsh-tenant-account` by the same
     * test as everything else here: take the gateway away and a person running
     * dsh remotely still has a sandbox, still fills its disk, and still wants
     * to know which of the two it is.
     *
     * @returns {object} the section.
     */
    const SandboxSection = () => {
      const t = useT()
      // The gateway supplies pushed readings to both the sidebar and this page.
      const state = useSandboxStats()

      const { status, stats } = state
      const secondary = { color: 'var(--dsw-alias-label-tertiary, #81858c)', fontSize: '13px' }
      const heading = { margin: '0 0 2px', fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary, #4c5157)' }

      const gb = (bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
      const ratio = (part) => (part && part.totalBytes > 0 ? part.usedBytes / part.totalBytes : null)

      /**
       * One measured figure: what it is, how much of it, and a bar.
       *
       * The bar is the same fact as the number beside it, not extra
       * information — it exists so that "nearly full" is legible without
       * reading two numbers and dividing them.
       *
       * @param {object} props - `label`, `value` text, and `fill` in 0..1 or null.
       * @returns {object} the row.
       */
      const Meter = ({ label, value, fill }) => React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' } },
          React.createElement('span', { style: { fontSize: '13px' } }, label),
          React.createElement(
            'span',
            { style: { ...secondary, fontVariantNumeric: 'tabular-nums' } },
            value,
          ),
        ),
        React.createElement(
          'div',
          {
            style: {
              height: '4px', borderRadius: '999px', overflow: 'hidden',
              background: 'var(--dsw-alias-border-l1, rgb(0 0 0 / 6%))',
            },
          },
          React.createElement('div', {
            style: {
              // Null reads as an empty track rather than a zero-width fill,
              // which is the same pixels and a different claim; the figure
              // beside it already says the measurement is not in yet.
              width: `${String(Math.round((fill ?? 0) * 100))}%`,
              height: '100%',
              borderRadius: '999px',
              background: 'var(--dsw-alias-label-primary, #1a1a1a)',
              transition: 'width .4s ease',
            },
          }),
        ),
      )

      const row = (title, body) => React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        React.createElement('div', { style: heading }, title),
        body,
      )

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '32rem' } },
        row(t('row.id'), React.createElement(
          'code',
          { style: { ...secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
          stats?.id ?? t('status.unknown'),
        )),
        row(t('row.version'), React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          React.createElement(
            'code',
            {
              style: { ...secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
              title: stats?.currentVersion
                ? `deployment ${stats.currentVersion}`
                : undefined,
            },
            stats?.version ?? t('version.unknown'),
          ),
          stats?.version
            && stats?.currentVersion
            && stats.version !== stats.currentVersion
            ? React.createElement(
              'span',
              { style: { ...secondary, fontSize: '12px' } },
              t('version.stale', { current: stats.currentVersion }),
            )
            : (stats?.version
              && stats?.currentVersion
              && stats.version === stats.currentVersion
              ? React.createElement(
                'span',
                { style: { ...secondary, fontSize: '12px' } },
                t('version.current'),
              )
              : null),
        )),
        row(t('row.status'), React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' } },
          React.createElement('span', {
            style: {
              width: '6px', height: '6px', borderRadius: '50%',
              background: statusDot(status),
            },
          }),
          t(statusKey(status)),
          // Beside the state, because anything that acts on the machine is
          // answering the state. Empty here: ending a sandbox is the gateway's
          // to offer, and this plugin has no gateway to ask.
          React.createElement('span', { className: `${P}-status-extra`, style: { marginLeft: 'auto' } }),
        )),
        row(t('row.usage'), React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '6px' } },
          React.createElement(Meter, {
            label: 'CPU',
            value: stats?.cpu === null || stats?.cpu === undefined
              ? t('measuring')
              : t(stats.cores ? 'cpu.value.cores' : 'cpu.value', {
                percent: String(Math.round(stats.cpu * 100)),
                cores: String(stats.cores ?? ''),
              }),
            fill: stats?.cpu ?? null,
          }),
          React.createElement(Meter, {
            label: t('memory'),
            value: stats?.memory ? `${gb(stats.memory.usedBytes)} / ${gb(stats.memory.totalBytes)}` : t('status.unknown'),
            fill: ratio(stats?.memory),
          }),
          React.createElement(Meter, {
            label: t('disk'),
            value: stats?.disk ? `${gb(stats.disk.usedBytes)} / ${gb(stats.disk.totalBytes)}` : t('status.unknown'),
            fill: ratio(stats?.disk),
          }),
        )),
        React.createElement(
          'p',
          { style: { ...secondary, margin: 0 } },
          t('yours'),
        ),
        // A seat for whatever else a deployment has to say about this machine.
        //
        // Empty here, and this plugin never fills it: what goes in is the
        // tenant's own environment, which needs a gateway, an account and a
        // database — none of which exist when this plugin is used on its own.
        // A deployment that has them portals into this; one that does not gets
        // an empty div and a page that still reads correctly.
        React.createElement('div', { className: `${P}-page-extra` }),
      )
    }

    /**
     * The configuration document, read rather than opened.
     *
     * A page rather than a header button, because the gesture changed. The
     * shipped control hands a path to the host desktop; there is no desktop
     * here, so what a person can actually be given is the document itself —
     * and a document does not fit in the header's action row.
     *
     * Read-only on purpose. Everything the file holds is editable in the
     * sections beside this one, and an editor here would be a second, weaker
     * way to write the same values — one with no schema behind it.
     *
     * @returns {object} the page.
     */
    const ConfigurationSection = () => {
      const t = useT()
      const [state, setState] = React.useState({ status: 'loading' })

      React.useEffect(() => {
        let live = true
        void call('document.read', {})
          .then((value) => { if (live) setState({ status: 'ready', ...value }) })
          .catch((error) => { if (live) setState({ status: 'failed', message: error.message }) })
        return () => { live = false }
      }, [])

      const secondary = { color: 'var(--dsw-alias-label-tertiary, #81858c)', fontSize: '13px' }

      if (state.status === 'loading') {
        return React.createElement('p', { style: secondary }, t('config.reading'))
      }
      if (state.status === 'failed') {
        return React.createElement('p', { style: { ...secondary, color: 'var(--dsw-alias-state-error-primary, #ec1313)' } },
          t('config.unreadable', { message: state.message }))
      }

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '46rem' } },
        React.createElement(Style),
        React.createElement(
          'p',
          { style: { ...secondary, margin: 0 } },
          t('config.where'),
        ),
        React.createElement(
          'code',
          { style: { ...secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
          state.path,
        ),
        React.createElement('pre', { className: `${P}-document` }, state.text === '' ? t('config.empty') : state.text),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '8px' } },
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${P}-button`,
              onClick: () => { void navigator.clipboard?.writeText(state.text) },
            },
            t('copy'),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${P}-button`,
              onClick: () => {
                // Saved from a Blob rather than fetched from a URL: the bytes
                // are already here, and a URL for them would be a second
                // surface for the gateway to authenticate.
                const url = URL.createObjectURL(new Blob([state.text], { type: 'text/plain' }))
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = state.path.split('/').pop() ?? 'settings'
                anchor.click()
                URL.revokeObjectURL(url)
              },
            },
            t('download'),
          ),
        ),
      )
    }

    // --------------------------------------------------------------- mount --

    return {
      inject: ['slots', 'connection', 'locale'],
      /**
       * Register the seats.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        plugin = ctx

        // Registered before any seat, because a seat may render before the
        // effect below it has run and would then show its keys.
        ctx.effect(
          () => ctx.locale.register(NS, DICTIONARY),
          'sandbox-host: dictionaries',
        )

        // Beside the settings control at the sidebar's foot. A list slot, so
        // this adds a row rather than replacing anything.
        ctx.effect(
          () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'sandbox-status', order: 100 },
            SandboxStatus,
          )),
          'sandbox-host: sandbox status row',
        )

        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register(
            {
              name: 'settings.section',
              id: 'configuration',
              order: 890,
              label: navLabel('configuration', 'configuration'),
            },
            ConfigurationSection,
          )),
          'sandbox-host: settings configuration section',
        )

        // Before the configuration page and before the account: what the
        // machine IS comes ahead of what is written on it.
        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register(
            {
              name: 'settings.section',
              id: 'sandbox',
              order: 880,
              // A cube: an isolated unit that is one tenant's, which is what a sandbox
              // is here. The box it replaced read as a storage tray — it said
              // "things are kept in this" where the page says "this is a machine",
              // and every other glyph in that column is a rounded rectangle, so the
              // one shape that is not is also the easiest to pick out.
              label: navLabel('sandbox', 'sandbox'),
            },
            SandboxSection,
          )),
          'sandbox-host: settings sandbox section',
        )

        // The header action seat, left empty because its capability moved to
        // the page above — not because the control was inconvenient.
        //
        // `settings.openDocument` prepares the document and hands the path to
        // the host desktop. dsh knows there is no desktop here (`host.describe`
        // reports `canOpenPath: false`), but this control does not consult that
        // — it gates on `settings.describe().hasDocument`, which reports
        // whether the file EXISTS. It always does, so the button always shows,
        // and every click ends in "Could not open configuration file".
        //
        // That mismatch is upstream's; see the limitation in
        // docs/sandbox-pitfalls.md. What belongs here is a deployment that does
        // not offer a gesture it cannot perform, and does offer the one it can.
        //
        // `priority`, not `order`: order is nav position within a cell, while
        // priority is the cell's shadowing rank — ascending, lowest renders,
        // and a second registration at the same id and priority throws rather
        // than silently winning.
        ctx.effect(
          () => ctx.slots.inject('settings.action', () => ctx.slots.register(
            { name: 'settings.action', id: 'open-document', priority: -1 },
            // Nothing to see, and one thing to say: this seat renders exactly
            // when the settings panel is open, which is when the nav rule has
            // to be in force. It cannot ride in the label — a style tag there
            // lands in the nav cell's accessible name.
            () => React.createElement('style', null, NAV_GLYPH_CSS),
          )),
          'sandbox-host: relocate the open-document action, and carry the nav rule',
        )
      },
    }
  },
})
