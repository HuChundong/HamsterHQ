/**
 * The shared sandbox computer, browser half.
 *
 * It owns three surfaces that are one interaction: the desktop rendered into
 * the artifact panel's seat, the handoff card with a live frame of the screen
 * the person is being asked to take over, and the full-window takeover that
 * card opens. The wait itself is still DSH's public user-questions flow; this
 * plugin only gives one marked question a richer presentation and leaves
 * every other question to the shipped composer.
 */
window.__ModuleLoader__.load({
  id: 'dsh-computer',
  factory: (require) => {
    const React = require('react')
    const ReactDom = require('react-dom')
    const ReactDomClient = require('react-dom/client')
    const h = React.createElement

    let plugin
    let connection

    const NS = 'hamsterhq.computer'
    const P = 'dsh-computer'
    const QUESTION_PREFIX = 'dsh-computer:user-action:'
    const ACTION_COMPLETED = 'completed'
    const ACTION_SKIPPED = 'skipped'
    const PANEL_ANCHOR = 'data-dsh-computer-panel'
    const SCHEDULE_PANEL_ANCHOR = 'data-dsh-scheduled-tasks-panel'
    const CHANNEL = '/browser'

    /**
     * The card's frame rate.
     *
     * Slower than the panel's browser pane on purpose: this is a whole
     * 1280x720 desktop rather than one page, and the card exists to show that
     * something is waiting, not to be watched. While the takeover is open the
     * poll stops entirely — the noVNC frame beside it is the live picture.
     */
    const FRAME_EVERY_MS = 2000

    const VNC_REV = '4'

    const DICTIONARY = {
      zh: {
        'panel.title': '电脑',
        'panel.open': '新窗口打开',
        'card.header': '电脑',
        'card.badge.waiting': '需要操作',
        'card.badge.finishing': '正在继续',
        'card.badge.completed': '已完成',
        'card.badge.skipped': '已跳过',
        'card.badge.failed': '未能继续',
        'card.title': '请在电脑上完成操作',
        'card.instructions': '完成后告诉 agent，它会从当前状态继续。',
        'card.takeover': '接管',
        'card.done': '已完成',
        'card.skip': '跳过',
        'card.waiting': '请在上方操作卡片中完成或跳过这一步。',
        'card.answering': '正在把结果交给 agent…',
        'card.answer_failed': '没能提交结果，请再试一次。',
        'screen.loading': '正在读取电脑画面…',
        'screen.off': '暂时读不到电脑画面',
        'screen.alt': '电脑当前画面',
        'takeover.close': '收起',
        'takeover.hint': '你现在直接操作这台电脑，完成后点“已完成”。',
      },
      en: {
        'panel.title': 'Computer',
        'panel.open': 'Open in new window',
        'card.header': 'Computer',
        'card.badge.waiting': 'Action needed',
        'card.badge.finishing': 'Continuing',
        'card.badge.completed': 'Completed',
        'card.badge.skipped': 'Skipped',
        'card.badge.failed': 'Could not continue',
        'card.title': 'Complete an action on the computer',
        'card.instructions': 'Tell the agent when you are done and it will continue from the current state.',
        'card.takeover': 'Take over',
        'card.done': 'Done',
        'card.skip': 'Skip',
        'card.waiting': 'Complete or skip this step in the action card above.',
        'card.answering': 'Returning the result to the agent…',
        'card.answer_failed': 'The result could not be submitted. Try again.',
        'screen.loading': 'Reading the computer screen…',
        'screen.off': 'The computer screen cannot be read right now',
        'screen.alt': 'The computer right now',
        'takeover.close': 'Close',
        'takeover.hint': 'You are operating this computer directly. Choose Done when the action is finished.',
      },
    }

    const useT = () => {
      React.useSyncExternalStore(
        (notify) => plugin.locale.subscribe(notify),
        () => plugin.locale.getSnapshot(),
      )
      return plugin.locale.bind(NS)
    }

    const CSS = `
      .${P}-tool {
        width: min(640px, 100%);
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 18px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        box-shadow: var(--dsw-shadow-lv1);
        font-family: var(--dsw-font-family);
      }
      .${P}-tool-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px 0;
      }
      .${P}-eyebrow {
        font-size: 13px;
        line-height: 20px;
        font-weight: 600;
      }
      .${P}-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 26px;
        padding: 2px 10px;
        border-radius: 999px;
        background: var(--dsw-alias-button-ghost-active-fill);
        color: var(--dsw-alias-state-warn-label);
        font-size: 12px;
        line-height: 18px;
        font-weight: 600;
      }
      .${P}-badge::before {
        content: '';
        width: 7px;
        height: 7px;
        flex: none;
        border-radius: 50%;
        background: currentColor;
      }
      .${P}-tool[data-state='finishing'] .${P}-badge::before {
        width: 10px;
        height: 10px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        background: transparent;
        animation: ${P}-spin 800ms linear infinite;
      }
      .${P}-tool[data-state='completed'] .${P}-badge { color: var(--dsw-alias-state-success-primary); }
      .${P}-tool[data-state='skipped'] .${P}-badge { color: var(--dsw-alias-label-tertiary); }
      .${P}-tool[data-state='failed'] .${P}-badge { color: var(--dsw-alias-state-error-primary); }
      .${P}-copy { padding: 10px 18px 14px; }
      .${P}-title {
        margin: 0;
        font-size: 17px;
        line-height: 25px;
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .${P}-instructions {
        margin: 5px 0 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 20px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .${P}-preview {
        position: relative;
        aspect-ratio: 16 / 9;
        margin: 0 18px;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-button-ghost-active-fill);
        box-sizing: border-box;
        padding: 0;
        width: calc(100% - 36px);
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .${P}-preview:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary);
        outline-offset: 2px;
      }
      .${P}-preview img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${P}-preview-empty {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 18px;
        text-align: center;
      }
      .${P}-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 18px 16px;
      }
      .${P}-button {
        min-height: 38px;
        padding: 0 16px;
        border: 1px solid transparent;
        border-radius: 10px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease, opacity 120ms ease;
      }
      .${P}-button-primary {
        background: var(--dsw-alias-button-primary-fill);
        color: var(--dsw-alias-label-primary-foreground);
      }
      .${P}-button-secondary {
        border-color: var(--dsw-alias-border-l2);
        background: var(--dsw-alias-button-elevated-fill);
        color: var(--dsw-alias-label-primary);
      }
      .${P}-button-quiet {
        margin-left: auto;
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
      }
      .${P}-button:is(:hover, :focus-visible):not(:disabled) {
        background: var(--dsw-alias-interactive-bg-hover-solid);
        color: var(--dsw-alias-label-primary);
      }
      .${P}-button:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary);
        outline-offset: 2px;
      }
      .${P}-button:disabled { cursor: not-allowed; opacity: 0.48; }
      .${P}-feedback {
        min-height: 18px;
        padding: 0 18px 14px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .${P}-feedback[data-error='true'] { color: var(--dsw-alias-state-error-primary); }
      .${P}-composer {
        box-sizing: border-box;
        width: 100%;
        padding: 10px 14px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-button-ghost-active-fill);
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 20px;
        text-align: center;
      }

      .${P}-takeover {
        position: fixed;
        inset: 0;
        z-index: 1100;
        display: flex;
        flex-direction: column;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
      }
      .${P}-takeover-bar {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .${P}-takeover-what {
        flex: 1 1 auto;
        min-width: 0;
      }
      .${P}-takeover-title {
        margin: 0;
        font-size: 14px;
        line-height: 20px;
        font-weight: 650;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .${P}-takeover-hint {
        margin: 1px 0 0;
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 18px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .${P}-takeover-frame {
        display: block;
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
        border: 0;
        background: var(--dsw-alias-bg-layer-1);
      }

      [${PANEL_ANCHOR}] {
        display: block;
        height: 100%;
        min-height: 0;
      }
      .${P}-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${P}-panel[data-maximised='false'] {
        gap: 0;
        overflow-y: auto;
        padding: 12px;
        box-sizing: border-box;
        background: transparent;
      }
      .${P}-panel-bar {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
      }
      .${P}-panel[data-maximised='false'] .${P}-panel-bar {
        padding: 0 2px 8px;
        border-bottom: 0;
      }
      .${P}-panel-open { color: var(--dsw-alias-label-secondary); text-decoration: none; }
      .${P}-panel-open:hover { color: var(--dsw-alias-label-primary); }
      .${P}-desktop {
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
        overflow: hidden;
        box-sizing: border-box;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${P}-panel[data-maximised='false'] .${P}-desktop {
        flex: none;
        aspect-ratio: 1280 / 720;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        box-shadow: var(--dsw-shadow-lv1);
      }
      .${P}-desktop-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${P}-schedule { flex: none; min-height: 0; margin-top: 16px; }

      @keyframes ${P}-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .${P}-button { transition: none; }
        .${P}-tool[data-state='finishing'] .${P}-badge::before { animation: none; }
      }
    `

    const parseArgs = (block) => {
      const raw = 'kind' in block ? block.call?.argsRaw : block.argsRaw
      try {
        const parsed = JSON.parse(raw ?? '')
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    const pendingFor = (pending, callId) => {
      if (pending?.kind !== 'question' || typeof pending.answer !== 'function') return undefined
      const question = pending.questions?.find?.((item) => item?.id === `${QUESTION_PREFIX}${callId}`)
      return question === undefined ? undefined : { pending, question }
    }

    const isComputerPending = (pending) => pending?.kind === 'question'
      && pending.questions?.length === 1
      && typeof pending.questions[0]?.id === 'string'
      && pending.questions[0].id.startsWith(QUESTION_PREFIX)

    const call = async (endpoint, payload) => {
      const result = await connection.rpc.call(CHANNEL, endpoint, payload ?? {})
      if (result.ok) return result.value
      throw new Error(result.error.message)
    }

    /**
     * The screen the person is being asked to take over.
     *
     * The whole desktop, not the agent's browser page. A handoff is raised for
     * whatever stopped the automation — a login form, a KDE dialog, a consent
     * sheet in a window Chrome never opened — and the browser is started
     * lazily, so asking CDP for a page put "the browser has not started" on
     * every card raised before the agent had opened one.
     *
     * It is a button because clicking the picture of the thing you are about
     * to operate is the obvious way in, and the same click Take over makes.
     */
    function ScreenView({ active, onTakeover }) {
      const t = useT()
      const [view, setView] = React.useState({ state: 'loading' })

      React.useEffect(() => {
        if (!active) return undefined
        let live = true
        let timer
        const tick = async () => {
          if (!live) return
          if (document.visibilityState === 'hidden') {
            timer = setTimeout(tick, FRAME_EVERY_MS)
            return
          }
          try {
            const frame = await call('screen')
            if (live) setView(frame.running ? { state: 'frame', data: frame.data } : { state: 'off' })
          } catch {
            if (live) setView((current) => current.state === 'frame' ? current : { state: 'off' })
          }
          if (live) timer = setTimeout(tick, FRAME_EVERY_MS)
        }
        void tick()
        return () => { live = false; clearTimeout(timer) }
      }, [active])

      return h('button', {
        type: 'button',
        className: `${P}-preview`,
        onClick: onTakeover,
        'aria-label': t('card.takeover'),
      },
      view.state === 'frame'
        ? h('img', { src: `data:image/jpeg;base64,${view.data}`, alt: t('screen.alt') })
        : h('span', { className: `${P}-preview-empty`, role: 'status' },
          t(view.state === 'off' ? 'screen.off' : 'screen.loading')))
    }


    /**
     * The takeover: this computer, full window, over the conversation.
     *
     * A person handed a login cannot do it in a 640px card, and the artifact
     * panel is a column beside the conversation rather than a desk. So the
     * same noVNC frame the panel seat renders is mounted over the whole
     * window with one bar across the top, and the answer the agent is waiting
     * for is a button in that bar: the person finishes in the desktop and
     * says so without hunting back down the transcript for the card.
     *
     * The bar's Done and Skip are the card's own, passed in — one wait, one
     * answer, whichever surface the person happens to be looking at. Closing
     * settles nothing: leaving the desktop is not the same as being finished
     * with it, and the card is still there waiting.
     */
    function Takeover({ title, onDone, onSkip, onClose, disabled }) {
      const t = useT()
      const titleId = React.useId()
      const frame = React.useRef(null)

      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [onClose])

      React.useEffect(() => {
        const iframe = frame.current
        if (iframe === null) return undefined
        const paint = () => {
          try { paintNovncTheme(iframe.contentDocument) } catch { /* the frame is not ready */ }
        }
        iframe.addEventListener('load', paint)
        paint()
        return () => { iframe.removeEventListener('load', paint) }
      }, [])

      return ReactDom.createPortal(h('div', {
        className: `${P}-takeover`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      h('div', { className: `${P}-takeover-bar` },
        h('div', { className: `${P}-takeover-what` },
          h('p', { id: titleId, className: `${P}-takeover-title` }, title),
          h('p', { className: `${P}-takeover-hint` }, t('takeover.hint'))),
        h('button', {
          type: 'button',
          className: `${P}-button ${P}-button-primary`,
          disabled,
          onClick: onDone,
        }, t('card.done')),
        h('button', {
          type: 'button',
          className: `${P}-button ${P}-button-secondary`,
          disabled,
          onClick: onSkip,
        }, t('card.skip')),
        h('button', {
          type: 'button',
          className: `${P}-button ${P}-button-quiet`,
          onClick: onClose,
        }, t('takeover.close'))),
      h('iframe', {
        ref: frame,
        className: `${P}-takeover-frame`,
        title: t('panel.title'),
        src: computerSrc(),
        allow: 'clipboard-read; clipboard-write',
      })), document.body)
    }

    function ActionCard({ block, callId, sessionId, useSessionPendingInteraction }) {
      const t = useT()
      const titleId = React.useId()
      const settled = 'kind' in block
      const pending = useSessionPendingInteraction((snapshot) => snapshot?.get(sessionId))
      const owned = pendingFor(pending, callId)
      const args = parseArgs(block)
      const [choice, setChoice] = React.useState(undefined)
      const [failure, setFailure] = React.useState(false)
      const [takeover, setTakeover] = React.useState(false)

      const answer = async (status) => {
        if (owned === undefined || choice !== undefined) return
        setChoice(status)
        setFailure(false)
        try {
          await owned.pending.answer({
            answers: [{ id: owned.question.id, selected: [status] }],
          })
        } catch {
          setChoice(undefined)
          setFailure(true)
        }
      }

      let state = 'waiting'
      if (settled) {
        if (block.isError === true) state = 'failed'
        else {
          const text = JSON.stringify(block.content ?? '')
          state = text.includes('skipped') ? 'skipped' : 'completed'
        }
      } else if (choice !== undefined || (owned === undefined && pending !== undefined)) {
        state = 'finishing'
      }
      const badgeKey = `card.badge.${state}`
      const disabled = owned === undefined || choice !== undefined

      // Nothing keeps a full-window desktop over a conversation whose wait is
      // over, however it ended — answered here, answered from the composer, or
      // the call abandoned with the turn.
      const open = takeover && !settled && choice === undefined
      React.useEffect(() => { if (!open && takeover) setTakeover(false) }, [open, takeover])

      const title = args.title || t('card.title')

      return h(React.Fragment, null,
        h('article', {
          className: `${P}-tool`,
          'data-state': state,
          'aria-labelledby': titleId,
        },
        h('div', { className: `${P}-tool-head` },
          h('span', { className: `${P}-eyebrow` }, t('card.header')),
          h('span', { className: `${P}-badge`, role: 'status', 'aria-live': 'polite' }, t(badgeKey))),
        h('div', { className: `${P}-copy` },
          h('h3', { id: titleId, className: `${P}-title` }, title),
          h('p', { className: `${P}-instructions` }, args.instructions || t('card.instructions'))),
        settled ? null : h(ScreenView, {
          active: !open,
          onTakeover: () => { setTakeover(true) },
        }),
        settled ? null : h('div', { className: `${P}-actions` },
          h('button', {
            type: 'button',
            className: `${P}-button ${P}-button-primary`,
            onClick: () => { setTakeover(true) },
          }, t('card.takeover')),
          h('button', {
            type: 'button',
            className: `${P}-button ${P}-button-secondary`,
            disabled,
            onClick: () => { void answer(ACTION_COMPLETED) },
          }, t('card.done')),
          h('button', {
            type: 'button',
            className: `${P}-button ${P}-button-quiet`,
            disabled,
            onClick: () => { void answer(ACTION_SKIPPED) },
          }, t('card.skip'))),
        settled || (choice === undefined && !failure) ? null : h('div', {
          className: `${P}-feedback`,
          'data-error': String(failure),
          role: 'status',
          'aria-live': 'polite',
        }, failure ? t('card.answer_failed') : t('card.answering'))),
        open ? h(Takeover, {
          title,
          disabled,
          onDone: () => { void answer(ACTION_COMPLETED) },
          onSkip: () => { void answer(ACTION_SKIPPED) },
          onClose: () => { setTakeover(false) },
        }) : null)
    }

    function WaitingComposer() {
      const t = useT()
      return h('div', { className: `${P}-composer`, role: 'status', 'aria-live': 'polite' }, t('card.waiting'))
    }

    const readPanelBg = () => {
      const value = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1').trim()
      return value || '#1b1b1c'
    }

    const computerSrc = () => {
      const bg = encodeURIComponent(readPanelBg())
      const theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
      return `/computer/vnc.html?autoconnect=true&resize=scale&reconnect=true&quality=5&compression=1&path=computer/websockify&v=${VNC_REV}&theme=${theme}&bg=${bg}`
    }

    const paintNovncTheme = (doc) => {
      if (doc === null || doc === undefined || doc.head === null) return
      const bg = readPanelBg()
      doc.documentElement.style.setProperty('--hamsterhq-novnc-bg', bg)
      let style = doc.getElementById('hhq-novnc-theme')
      if (style === null) {
        style = doc.createElement('style')
        style.id = 'hhq-novnc-theme'
        doc.head.appendChild(style)
      }
      style.textContent = `
        html, body, #noVNC_container {
          background-color: ${bg} !important;
          background-image: none !important;
        }
        #noVNC_container { border-radius: 0 !important; }
      `
    }

    function ComputerPanel({ maximised }) {
      const t = useT()
      const frame = React.useRef(null)
      const [frameSrc] = React.useState(computerSrc)
      const [href, setHref] = React.useState(computerSrc)

      React.useEffect(() => {
        const iframe = frame.current
        if (iframe === null) return undefined
        const paint = () => {
          setHref(computerSrc())
          try { paintNovncTheme(iframe.contentDocument) } catch { /* the frame is not ready */ }
        }
        iframe.addEventListener('load', paint)
        paint()
        const observer = new MutationObserver(paint)
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
        return () => {
          iframe.removeEventListener('load', paint)
          observer.disconnect()
        }
      }, [])

      return h('div', { className: `${P}-panel`, 'data-maximised': String(maximised) },
        h('div', { className: `${P}-panel-bar` },
          h('span', null, t('panel.title')),
          h('a', { className: `${P}-panel-open`, href, target: '_blank', rel: 'noopener noreferrer' }, t('panel.open'))),
        h('div', { className: `${P}-desktop` },
          h('iframe', {
            ref: frame,
            className: `${P}-desktop-frame`,
            title: t('panel.title'),
            src: frameSrc,
            allow: 'clipboard-read; clipboard-write',
          })),
        maximised ? null : h('div', { className: `${P}-schedule`, [SCHEDULE_PANEL_ANCHOR]: '' }))
    }

    const mountComputerPanel = () => {
      let node
      let root
      let maximised
      const scan = () => {
        const next = document.querySelector(`[${PANEL_ANCHOR}]`)
        if (next !== node) {
          root?.unmount()
          node = next
          root = next === null ? undefined : ReactDomClient.createRoot(next)
          maximised = undefined
        }
        if (node === null || node === undefined || root === undefined) return
        const nextMaximised = node.getAttribute('data-maximised') === 'true'
        if (nextMaximised === maximised) return
        maximised = nextMaximised
        root.render(h(ComputerPanel, { maximised }))
      }
      scan()
      const observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-maximised'] })
      return () => {
        observer.disconnect()
        root?.unmount()
      }
    }

    return {
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        plugin = ctx
        connection = ctx.connection

        ctx.effect(() => ctx.locale.register(NS, DICTIONARY), 'computer: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-computer-style', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'computer: styles')

        ctx.effect(mountComputerPanel, 'computer: artifact panel seat')

        ctx.effect(
          () => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
            { name: 'tool.call.toolview', key: 'computer_request_user_action' },
            ActionCard,
          )),
          'computer: user-action tool card',
        )

        ctx.effect(
          () => ctx.slots.inject('conversation.composer', () => ctx.slots.register(
            {
              name: 'conversation.composer',
              priority: -100,
              select: ({ pendingInteraction }) => isComputerPending(pendingInteraction) ? pendingInteraction : null,
            },
            WaitingComposer,
          )),
          'computer: hold the composer while the card waits',
        )
      },
    }
  },
})
