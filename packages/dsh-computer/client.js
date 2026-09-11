/**
 * The shared sandbox computer, browser half.
 *
 * It owns three surfaces that are one interaction: the desktop beside the
 * conversation, the handoff card with a live frame of the screen
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
    const { IconRightUpOutline16 } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    let plugin
    let connection

    const NS = 'hamsterhq.computer'
    const P = 'dsh-computer'
    const QUESTION_PREFIX = 'dsh-computer:user-action:'
    const ACTION_COMPLETED = 'completed'
    const ACTION_SKIPPED = 'skipped'
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

    const VNC_REV = '5'

    const DICTIONARY = {
      zh: {
        'panel.title': '云端电脑',
        'panel.open': '新窗口打开',
        'panel.launch': '打开',
        'card.header': '云端电脑',
        'card.badge.waiting': '需要操作',
        'card.badge.finishing': '正在继续',
        'card.badge.completed': '已完成',
        'card.badge.skipped': '已跳过',
        'card.badge.failed': '未能继续',
        'card.title': '请在云端电脑上完成操作',
        'card.instructions': '完成后告诉 agent，它会从当前状态继续。',
        'card.takeover': '接管',
        'card.done': '已完成',
        'card.skip': '跳过',
        'card.answering': '正在把结果交给 agent…',
        'card.answer_failed': '没能提交结果，请再试一次。',
        'screen.loading': '正在读取云端电脑画面…',
        'screen.connecting': '正在连接云端电脑…',
        'screen.off': '暂时读不到云端电脑画面',
        'screen.alt': '云端电脑当前画面',
        'takeover.close': '收起',
        'takeover.hint': '你现在直接操作这台云端电脑，完成后点“已完成”。',
      },
      en: {
        'panel.title': 'Cloud computer',
        'panel.open': 'Open in new window',
        'panel.launch': 'Open',
        'card.header': 'Cloud computer',
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
        'card.answering': 'Returning the result to the agent…',
        'card.answer_failed': 'The result could not be submitted. Try again.',
        'screen.loading': 'Reading the computer screen…',
        'screen.connecting': 'Connecting to the computer…',
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
      .${P}-desktop-link[hidden],
      .${P}-panel[data-maximised='true'] .${P}-schedule { display: none; }

      .${P}-desktop-link { display: block; position: absolute; inset: 0; cursor: pointer; text-decoration: none; }
      .${P}-desktop-link:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 3px; }
      .${P}-launch { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
        display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px;
        background: #111d; color: #fff; font-size: 15px; opacity: 0; transition: opacity 120ms; }
      .${P}-desktop-link:hover .${P}-launch, .${P}-desktop-link:focus-visible .${P}-launch { opacity: 1; }

      .${P}-nav { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px;
        padding: 6px 8px; border: 0; border-radius: 8px; background: transparent;
        color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
      .${P}-nav[data-wide='false'] { justify-content: center; padding: 6px 0; }
      .${P}-nav:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .${P}-nav:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }

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
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
      }

      .${P}-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${P}-panel[data-maximised='false'] { position: relative; overflow: hidden; padding: 12px; box-sizing: border-box; gap: 12px; }
      .${P}-schedule { flex: 1; min-height: 0; overflow: auto; }
      .${P}-desktop {
        position: relative;
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
        width: 100%;
        height: 100%;
      }
      .${P}-frame-host {
        position: relative;
        overflow: hidden;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${P}-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${P}-frame-cover {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 18px;
        pointer-events: none;
      }
      .${P}-frame-cover::before {
        content: '';
        width: 20px;
        height: 20px;
        box-sizing: border-box;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: ${P}-spin 800ms linear infinite;
      }

      @keyframes ${P}-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .${P}-button { transition: none; }
        .${P}-tool[data-state='finishing'] .${P}-badge::before { animation: none; }
        .${P}-frame-cover::before { animation: none; border-right-color: currentColor; border-style: dotted; }
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
      const [frameSrc] = React.useState(computerSrc)

      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [onClose])

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
      h(DesktopFrame, { className: `${P}-takeover-frame`, src: frameSrc })), document.body)
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

    /**
     * The composer, held empty while the card waits.
     *
     * It draws nothing, and the seat is still the point: leaving it vacant
     * gives the question back to the shipped generic composer, which offers
     * the same completed/skipped buttons a second time under the card that
     * already has them. A line of prose here was the first attempt and read
     * as instructions for a card that explains itself.
     */
    function WaitingComposer() {
      return null
    }

    const readPanelBg = () => {
      const value = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1').trim()
      return value || '#1b1b1c'
    }

    /**
     * The page's address, with what it cannot find out for itself.
     *
     * `bg` and `theme` are the shell's ground and ink, read here because the
     * page is noVNC's and knows nothing of the shell's tokens. `title` and
     * `connecting` supply the tab name and loading message in the person's
     * language. The bootstrap paints the theme and title before the body
     * parses, and labels the cover before deferred modules run — see
     * `sandbox/desktop/novnc-hamsterhq.js`. Inside a frame the shell's colours
     * are painted in over the top as they change.
     */
    const computerSrc = () => {
      const bg = encodeURIComponent(readPanelBg())
      const theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
      const title = encodeURIComponent(plugin.locale.bind(NS)('panel.title'))
      const connecting = encodeURIComponent(plugin.locale.bind(NS)('screen.connecting'))
      return `/computer/vnc.html?autoconnect=true&resize=scale&reconnect=true&quality=5&compression=1&path=computer/websockify&v=${VNC_REV}&theme=${theme}&bg=${bg}&title=${title}&connecting=${connecting}`
    }

    const paintNovncTheme = (doc) => {
      if (doc === null || doc === undefined || doc.head === null) return
      const bg = readPanelBg()
      doc.documentElement.style.setProperty('--hamsterhq-novnc-bg', bg)
      doc.documentElement.setAttribute('data-hhq-theme', document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')
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

    /** The shell's theme, as the attributes that change when it does. */
    const observeTheme = (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
      return () => { observer.disconnect() }
    }

    /**
     * Whether the page in a frame has reached the desktop.
     *
     * The page is same-origin, so its document is readable. noVNC keeps one
     * state class on its root — noVNC_connected is the one that matters here —
     * and opens its status element as an error when a connect fails. Recovery
     * dialogs and fatal startup errors also release the cover, so the person
     * can retry or read the failure; so does a document with no noVNC, which
     * is the gateway refusing the request with a page of its own. Until the
     * frame has loaded — and the initial about:blank counts as not loaded —
     * there is nothing to read and the answer is no.
     */
    const desktopSettled = (doc) => {
      if (doc === null || doc === undefined || doc.documentElement === null) return false
      if (doc.URL === 'about:blank' || doc.readyState === 'loading') return false
      if (doc.getElementById('noVNC_container') === null) return true
      if (doc.documentElement.classList.contains('noVNC_connected')) return true
      return doc.querySelector('#noVNC_status.noVNC_status_error.noVNC_open, #noVNC_connect_dlg.noVNC_open, #noVNC_credentials_dlg.noVNC_open, #noVNC_fallback_error.noVNC_open') !== null
    }

    /**
     * A frame on the desktop, and the wait for it.
     *
     * The panel's seat and the takeover both mount noVNC's page in an iframe,
     * and both waited the same way: a layer-coloured blank while the page, its
     * modules, the websocket and the RFB handshake came through the tunnel,
     * which a person read as broken. So one component holds the frame and a
     * cover over it. `desktopSettled` decides when the page can be shown; a
     * persistent observer follows its state through retries and reconnects.
     * The initial read also handles a cached frame loaded before the effect.
     *
     * The page carries a cover of its own for a window opened on it directly;
     * inside a frame it sits under this one and is never seen. The shell's
     * colours are painted in over the page on load and again as the theme
     * turns, so the letterbox stays the panel's surface in both.
     */
    function DesktopFrame({ className, src, preview = false }) {
      const t = useT()
      const frame = React.useRef(null)
      const [settled, setSettled] = React.useState(false)

      React.useEffect(() => {
        const iframe = frame.current
        if (iframe === null) return undefined
        setSettled(false)
        let observer
        const paint = () => {
          try { paintNovncTheme(iframe.contentDocument) } catch { /* the frame is not ready */ }
        }
        const check = () => {
          let doc
          try { doc = iframe.contentDocument } catch { doc = null }
          setSettled(doc === null || desktopSettled(doc))
        }
        const loaded = () => {
          paint()
          observer?.disconnect()
          observer = undefined
          let doc
          try { doc = iframe.contentDocument } catch { doc = null }
          if (doc === null) {
            setSettled(true)
            return
          }
          if (doc.URL === 'about:blank') return
          observer = new MutationObserver(check)
          observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true })
          check()
        }
        iframe.addEventListener('load', loaded)
        const unobserveTheme = observeTheme(paint)
        loaded()
        return () => {
          iframe.removeEventListener('load', loaded)
          observer?.disconnect()
          unobserveTheme()
        }
      }, [src])

      return h('div', { className: `${P}-frame-host ${className}` },
        h('iframe', {
          ref: frame,
          tabIndex: preview ? -1 : undefined,
          className: `${P}-frame`,
          title: t('panel.title'),
          src,
          allow: 'clipboard-read; clipboard-write',
        }),
        settled ? null : h('div', { className: `${P}-frame-cover`, role: 'status', 'aria-live': 'polite' },
          t('screen.connecting')))
    }

    function ComputerPanel({ renderSlot, useTabInfo }) {
      const t = useT()
      const { sidebar } = useTabInfo()
      const fullscreen = sidebar.fullscreen
      const [frameSrc] = React.useState(computerSrc)
      const [, bump] = React.useState(0)

      // The new-window address follows the theme, which changes without a
      // render of this component; the frame's own address is fixed at mount so
      // that a theme change does not reload the desktop.
      React.useEffect(() => observeTheme(() => { bump((n) => n + 1) }), [])
      const href = computerSrc()

      return h('div', { className: `${P}-panel`, 'data-maximised': String(fullscreen) },
        h('div', { className: `${P}-desktop` },
          h(DesktopFrame, { className: `${P}-desktop-frame`, src: frameSrc, preview: !fullscreen }),
          h('a', { className: `${P}-desktop-link`, href, target: '_blank', rel: 'noopener noreferrer',
            'aria-label': t('panel.open'), hidden: fullscreen },
            h('span', { className: `${P}-launch` }, h(IconRightUpOutline16, { size: 18 }), t('panel.launch')))),
        h('div', { className: `${P}-schedule` }, renderSlot('computer.schedule')))
    }

    /** The generated dsh-icons laptop-minimal glyph; no client bundler is needed. */
    function ComputerIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true },
      h('path', { d: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z' }),
      h('path', { d: 'M2 20L22 20' }))
    }

    return {
      inject: ['slots', 'connection', 'locale', 'sidebarRightTabs', 'sidebarRight', 'layout'],
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

        ctx.effect(
          () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'dsh-computer', order: 40 },
            ({ wide }) => {
              const t = useT()
              return h('button', { type: 'button', className: `${P}-nav`, 'data-wide': String(wide),
              title: t('panel.title'), 'aria-label': t('panel.title'),
              onClick: () => {
                const active = ctx.sidebarRight.active()
                if (ctx.sidebarRight.isExpanded() && active?.kind === 'computer') ctx.sidebarRight.close(active.id)
                else if (active !== undefined) ctx.sidebarRight.openTab('computer')
                else ctx.layout.selectPanel('dsh-computer')
              } },
            h(ComputerIcon, { size: 16 }), wide ? t('panel.title') : null)
            },
          )), 'computer: global navigation',
        )
        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register(
            { name: 'main', key: 'dsh-computer' }, () => null,
          )), 'computer: global desktop page',
        )

        // The shell's panel list addresses main keys. Treat that key as a
        // navigation request, then open the computer after the conversation's
        // session seat has remounted. No desktop occupies the central panel.
        function ComputerNavigation({ usePanelInfo, useSessions }) {
          const panel = usePanelInfo(info => info.activePanelId)
          const session = useSessions(state => state.current)
          const pending = React.useRef(false)
          React.useEffect(() => {
            if (panel === 'dsh-computer') {
              pending.current = true
              ctx.layout.selectPanel(null)
              return undefined
            }
            if (panel !== null) { pending.current = false; return undefined }
            if (!pending.current || session === undefined) return undefined
            const frame = requestAnimationFrame(() => {
              ctx.sidebarRight.openTab('computer')
              pending.current = false
            })
            return () => cancelAnimationFrame(frame)
          }, [panel, session])
          return null
        }
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'computer-navigation' }, ComputerNavigation,
        )), 'computer: global navigation controller')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: 'dsh-computer/desktop', kind: 'computer', priority: 'extension',
          title: () => ctx.locale.bind(NS)('panel.title'),
          guide: [{ order: 50, title: () => ctx.locale.bind(NS)('panel.title'),
            icon: () => h(ComputerIcon, { size: 20 }) }],
        }), 'computer: right sidebar type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: 'dsh-computer/desktop',
            children: { 'computer.schedule': { kind: 'single', scope: 'root' } } },
          ComputerPanel,
        )), 'computer: right sidebar desktop')

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
