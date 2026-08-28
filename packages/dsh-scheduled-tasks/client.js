/**
 * Scheduled tasks, browser half.
 *
 * One control in the sidebar's foot and one dialog behind it. The control sits
 * where it does because of what the shell actually offers: the sidebar
 * declares five child slots, and four of them — the two brand seats, the
 * workspace region and the settings seat — are `single` and already taken.
 * `sidebar.footer.action` is the one list slot, which is what a second
 * registration needs. There is no seat between the New Session button and the
 * session list, so a control there would mean either taking the region slot
 * and re-rendering the session list ourselves, or patching the harness. Both
 * are the thing the root AGENTS.md forbids, so this asks upstream for a seat
 * instead and sits at the foot meanwhile, above the sandbox row. The shell
 * lays the footer.action list out in a row; SlotOutlet is display:contents, so
 * a CSS column on the wrong ancestor is a no-op. The control walks to the real
 * flex row and columns it, and each seat claims a full line.
 *
 * The foot control is drawn as a quiet row beside the sandbox status — not as
 * a second New Session elevated button. Theme colours come from verified
 * --dsw-alias tokens (the same set dsh-sandbox-host and dsh-tenant-account
 * consume); no Theme API override and no harness CSS-module class names.
 *
 * It reads the gateway rather than the sandbox, at `/schedule`. That is not
 * for tidiness: a tenant asking why last night's task did not happen is asking
 * exactly when their machine is not running, and a list served through the
 * sandbox would be unreachable in the one moment it is most wanted.
 *
 * Written against the module loader the shell installs rather than built from
 * the workspace: `require` here is the shell's module table, which is where
 * React comes from. Nothing in this file resolves through node_modules, so the
 * package needs no build step — and no sibling package can be imported, which
 * is why the one glyph below is path data rather than a call into
 * `dsh-icons`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-scheduled-tasks',
  factory: (require) => {
    const React = require('react')
    const ReactDom = require('react-dom')

    /** The plugin's client context, kept for the locale service the hook reads. */
    let plugin

    /** This plugin's own dictionary namespace. */
    const NS = 'hamsterhq.schedule'

    /** Everything this plugin says, in both languages. */
    const DICTIONARY = {
      zh: {
        open: '已安排',
        title: '任务安排',
        what: '到点时会自动唤醒你的沙箱，在一个全新的会话里执行下面的提示词。新会话不带上下文，所以提示词要能独立读懂。',
        empty: '还没有安排任何任务。',
        loading: '加载中…',
        unavailable: '这个部署没有启用定时任务。',
        new: '新建任务',
        edit: '编辑',
        remove: '删除',
        removing: '确认删除？',
        enable: '启用',
        disable: '停用',
        disabled: '已停用',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        close: '关闭',
        next: '下次',
        never: '不再运行',
        'field.title': '名称',
        'field.prompt': '提示词',
        'field.kind': '重复方式',
        'field.at': '时间',
        'field.every': '间隔',
        'field.expression': 'cron 表达式',
        'field.zone': '时区',
        'kind.at': '一次',
        'kind.every': '固定间隔',
        'kind.cron': '按日历',
        'unit.minutes': '分钟',
        'unit.hours': '小时',
        'unit.days': '天',
        'hint.prompt': '写成不依赖当前对话也能执行的一句话。',
        'hint.cron': '五个字段：分 时 日 月 周。例如 0 9 * * 1-5 表示工作日早上九点。',
        'rule.at': '一次',
        'rule.every': '每 %s',
        'rule.cron': '%s（%s）',
        'run.ok': '上次成功',
        'run.failed': '上次失败',
        'run.lost': '上次错过',
        'run.running': '正在运行',
        'error.invalid_title': '名称不能为空。',
        'error.invalid_prompt': '提示词不能为空。',
        'error.invalid_rule': '这个时间规则读不出来。',
        'error.invalid_kind': '重复方式无效。',
        'error.invalid_time_zone': '时区无效。',
        'error.not_future': '时间必须在将来。',
        'error.frequency_too_high': '比你的套餐允许的最短间隔还密。',
        'error.unreachable_rule': '这个表达式匹配不到任何时间。',
        'error.too_many_tasks': '任务数量已达上限。',
        'error.scheduler_unreachable': '调度服务没有响应，稍后再试。',
        'error.generic': '没能保存，请再试一次。',
      },
      en: {
        open: 'Scheduled',
        title: 'Scheduled tasks',
        what: 'Each of these wakes your sandbox when it is due and runs the prompt in a brand new conversation. That conversation has no context, so write the prompt to stand on its own.',
        empty: 'Nothing is scheduled yet.',
        loading: 'Loading…',
        unavailable: 'This deployment does not run scheduled tasks.',
        new: 'New task',
        edit: 'Edit',
        remove: 'Delete',
        removing: 'Delete it?',
        enable: 'Enable',
        disable: 'Disable',
        disabled: 'Disabled',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        close: 'Close',
        next: 'Next',
        never: 'Not again',
        'field.title': 'Name',
        'field.prompt': 'Prompt',
        'field.kind': 'Repeats',
        'field.at': 'Time',
        'field.every': 'Interval',
        'field.expression': 'Cron expression',
        'field.zone': 'Time zone',
        'kind.at': 'Once',
        'kind.every': 'Fixed interval',
        'kind.cron': 'Calendar rule',
        'unit.minutes': 'minutes',
        'unit.hours': 'hours',
        'unit.days': 'days',
        'hint.prompt': 'Write it so it can be carried out without this conversation.',
        'hint.cron': 'Five fields: minute hour day month weekday. 0 9 * * 1-5 is nine in the morning on weekdays.',
        'rule.at': 'Once',
        'rule.every': 'Every %s',
        'rule.cron': '%s (%s)',
        'run.ok': 'Last run succeeded',
        'run.failed': 'Last run failed',
        'run.lost': 'Last run was missed',
        'run.running': 'Running now',
        'error.invalid_title': 'A name is required.',
        'error.invalid_prompt': 'A prompt is required.',
        'error.invalid_rule': 'That schedule could not be read.',
        'error.invalid_kind': 'That is not a kind of schedule.',
        'error.invalid_time_zone': 'That time zone is not one this browser knows.',
        'error.not_future': 'That time has already passed.',
        'error.frequency_too_high': 'That is more often than your plan allows.',
        'error.unreachable_rule': 'That expression matches no time at all.',
        'error.too_many_tasks': 'You are holding as many tasks as your plan allows.',
        'error.scheduler_unreachable': 'The scheduler is not answering. Try again shortly.',
        'error.generic': 'That could not be saved. Try again.',
      },
    }

    /**
     * Re-render this component whenever the chosen language changes.
     *
     * The same shape `dsh-tenant-account` uses: the store is subscribed to for
     * the re-render and the bound table is returned for the reading.
     *
     * @returns {(key: string) => string} the bound dictionary.
     */
    const useT = () => {
      React.useSyncExternalStore(
        (notify) => plugin.locale.subscribe(notify),
        () => plugin.locale.getSnapshot(),
      )
      return plugin.locale.bind(NS)
    }

    /** Class prefix, scoped so nothing here can reach another plugin's markup. */
    const U = 'dsh-scheduled-tasks'

    /**
     * The one glyph, copied rather than imported.
     *
     * The shell reads this file as source with `require` bound to its own
     * table, so `dsh-icons` cannot be resolved and there is no build step that
     * could inline it. `scripts/check-icons.mjs` holds these bytes equal to
     * `packages/dsh-icons/extracted.js`, which is the only thing that keeps a
     * copy honest.
     */
    const DRAWN = {
      schedule: {
        viewBox: '0 0 24 24',
        paths: [
          'M16 14v2.2l1.6 1',
          'M16 2v3',
          'M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338',
          'M3 9h5.859',
          'M8 2v3',
          'M10 16a6 6 0 1 0 12 0a6 6 0 1 0 -12 0',
        ],
        stroke: { width: 2, linecap: 'round', linejoin: 'round' },
      },
    }

    /**
     * The glyph, painted the way Lucide draws it.
     *
     * Stroked and not filled: upstream expands its own strokes into shapes,
     * Lucide ships the strokes, and a renderer that guessed would fill this one
     * into a blot.
     *
     * @param {{size?: number}} props - the edge in pixels.
     * @returns {object} the element.
     */
    const Glyph = ({ size = 16 }) => {
      const glyph = DRAWN.schedule
      return React.createElement(
        'svg',
        {
          width: size, height: size, viewBox: glyph.viewBox, fill: 'none',
          stroke: 'currentColor',
          strokeWidth: glyph.stroke.width,
          strokeLinecap: glyph.stroke.linecap,
          strokeLinejoin: glyph.stroke.linejoin,
          'aria-hidden': 'true',
        },
        glyph.paths.map((d, index) => React.createElement('path', { key: index, d })),
      )
    }

    /**
     * Footer seat and dialog chrome, restated against verified alias tokens.
     *
     * The open control matches the sandbox status row (quiet wash, not an
     * elevated New Session card). Dialog colours and buttons match the
     * tenant-account profile dialog. Collapsed rail: 36px icon only.
     * (No backticks in this CSS: the file is a template literal.)
     */
    const CSS = `
      /* SlotOutlet wraps list seats in display:contents, so seats participate
         in footerActions flex layout as siblings. A CSS :has on the contents
         wrapper cannot set flex-direction (no box). useStackFooterColumn walks
         past contents ancestors and columns the real flex row. This mark only
         claims a full row once that parent is a column. */
      [data-dsh-footer-stack] {
        display: block;
        box-sizing: border-box;
        width: 100%;
        flex: none;
        align-self: stretch;
      }
      .${U}-open {
        display: flex; align-items: center; gap: 8px;
        box-sizing: border-box; width: 100%; margin: 0 0 4px; padding: 8px;
        border: none; border-radius: 12px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 13px; font-weight: 500; line-height: 18px;
        text-align: left; cursor: pointer;
      }
      .${U}-open:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .${U}-open[data-wide='false'] {
        width: 36px; height: 36px; margin: 0 0 4px; padding: 0; gap: 0;
        justify-content: center;
      }
      .${U}-open-icon {
        flex: none; display: inline-flex; align-items: center; justify-content: center;
        color: var(--dsw-alias-label-tertiary);
      }
      .${U}-open-label {
        min-width: 0; white-space: nowrap; overflow: hidden;
        color: var(--dsw-alias-label-secondary);
      }

      .${U}-mask {
        position: fixed; inset: 0; z-index: 1100;
        display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-1);
      }
      .${U}-dialog {
        display: flex; flex-direction: column;
        width: min(560px, calc(100vw - 32px));
        max-height: min(640px, calc(100vh - 64px));
        padding: 18px 20px 14px; box-sizing: border-box;
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: var(--dsw-shadow-lv3);
        font-family: var(--dsw-font-family);
        color: var(--dsw-alias-label-primary);
      }
      .${U}-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
      .${U}-heading { font-size: 15px; font-weight: 500; }
      .${U}-dismiss {
        flex: none; width: 28px; height: 28px; padding: 0;
        border: none; border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-tertiary);
        font-family: var(--dsw-font-family); font-size: 18px; line-height: 1;
        cursor: pointer;
      }
      .${U}-dismiss:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      .${U}-what {
        margin: 4px 0 14px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px; line-height: 18px;
      }
      .${U}-list { flex: 1; min-height: 0; overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
      .${U}-item {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 10px 0;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .${U}-item-body { flex: 1; min-width: 0; }
      .${U}-item-title { font-size: 13px; font-weight: 500; }
      .${U}-item-title[data-off='true'] { color: var(--dsw-alias-label-secondary); }
      .${U}-item-line {
        margin-top: 3px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px; line-height: 18px;
        overflow-wrap: anywhere;
      }
      .${U}-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
      .${U}-dot[data-state='ok'] { background: var(--dsw-alias-state-success-primary); }
      .${U}-dot[data-state='failed'] { background: var(--dsw-alias-state-error-primary); }
      .${U}-dot[data-state='lost'] { background: var(--dsw-alias-state-warn-label); }
      .${U}-dot[data-state='running'] { background: var(--dsw-alias-state-business-primary); }
      .${U}-item-actions { display: flex; flex: none; gap: 6px; }
      .${U}-quiet {
        padding: 0 8px; height: 26px;
        border: 1px solid transparent; border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-secondary);
        font-family: var(--dsw-font-family); font-size: 12px; cursor: pointer;
      }
      .${U}-quiet:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .${U}-quiet[data-danger='true'] { color: var(--dsw-alias-state-error-primary); }
      .${U}-note { padding: 18px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .${U}-form { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
      .${U}-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .${U}-input, .${U}-area, .${U}-select {
        width: 100%; box-sizing: border-box; padding: 7px 10px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family); font-size: 13px;
      }
      .${U}-area { min-height: 84px; resize: vertical; line-height: 20px; }
      .${U}-input:focus, .${U}-area:focus, .${U}-select:focus {
        outline: none; border-color: var(--dsw-alias-state-business-primary);
      }
      .${U}-pair { display: flex; gap: 8px; }
      .${U}-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
      .${U}-problem { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
      .${U}-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      .${U}-button {
        height: 32px; padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
        background: transparent; color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family); font-size: 13px; cursor: pointer;
      }
      .${U}-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .${U}-button[data-primary='true'] {
        border-color: transparent;
        background: var(--dsw-alias-button-primary-fill);
        color: var(--dsw-alias-label-primary-foreground);
      }
      .${U}-button:disabled { opacity: .55; cursor: default; }
    `

    /**
     * One call to the gateway's schedule plane.
     *
     * Answers are read as JSON whatever the status, because the gateway sends
     * a coded body for every refusal and the code is what the dialog words.
     *
     * @param {string} method - the HTTP method.
     * @param {string} path - the path under /schedule.
     * @param {object} [body] - the payload.
     * @returns {Promise<{status: number, value: object}>} the answer.
     */
    const call = async (method, path, body) => {
      const init = { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }
      if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(body ?? {})
      const response = await fetch(`/schedule${path}`, init)
      const value = await response.json().catch(() => ({}))
      return { status: response.status, value }
    }

    /** The zone this browser is in, which is the only sensible default for a calendar rule. */
    const localZone = () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      } catch {
        return 'UTC'
      }
    }

    /**
     * An instant, in the reader's own locale and zone.
     *
     * @param {string | null} iso - the instant.
     * @returns {string} something to show, or an empty string.
     */
    const when = (iso) => {
      if (typeof iso !== 'string') return ''
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return ''
      return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }

    /**
     * An interval in seconds, as a number and a unit.
     *
     * Chosen by what divides evenly, largest first, so 3600 reads as one hour
     * rather than sixty minutes.
     *
     * @param {number} seconds - the interval.
     * @returns {{size: number, unit: string}} the parts.
     */
    const asInterval = (seconds) => {
      if (seconds % 86_400 === 0) return { size: seconds / 86_400, unit: 'days' }
      if (seconds % 3600 === 0) return { size: seconds / 3600, unit: 'hours' }
      return { size: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' }
    }

    /** Seconds in one of the units the form offers. */
    const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86_400 }

    /**
     * Fill the placeholders in a dictionary line.
     *
     * The lines carry `%s` rather than being assembled from fragments: the
     * order of the parts differs between the two languages, and concatenation
     * is how that turns into a sentence nobody wrote.
     *
     * @param {string} pattern - the line.
     * @param {string[]} parts - what to put in it, in order.
     * @returns {string} the filled line.
     */
    const fill = (pattern, parts) => {
      let index = 0
      return pattern.replaceAll('%s', () => parts[index++] ?? '')
    }

    /**
     * The dialog, and everything a tenant can do to their schedule.
     *
     * @param {{onClose: () => void}} props - how to dismiss it.
     * @returns {object} the element.
     */
    const Dialog = ({ onClose }) => {
      const t = useT()
      const [state, setState] = React.useState({ phase: 'loading', tasks: [] })
      const [editing, setEditing] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)

      const load = React.useCallback(async () => {
        const answer = await call('GET', '/tasks').catch(() => ({ status: 0, value: {} }))
        if (answer.status === 501) {
          setState({ phase: 'unavailable', tasks: [] })
          return
        }
        if (answer.value?.ok !== true) {
          setState({ phase: 'ready', tasks: [], problem: answer.value?.code ?? 'generic' })
          return
        }
        setState({ phase: 'ready', tasks: answer.value.tasks ?? [] })
      }, [])

      React.useEffect(() => { void load() }, [load])

      // Escape closes, because a dialog that can only be dismissed by finding
      // its button is a dialog that traps whoever opened it by accident.
      React.useEffect(() => {
        /**
         * @param {KeyboardEvent} event - the key.
         */
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [onClose])

      /**
       * Say what a task's rule is, in words.
       * @param {object} task - the task.
       * @returns {string} the description.
       */
      const summarize = (task) => {
        if (task.kind === 'at') return `${t('rule.at')} · ${when(task.rule?.at)}`
        if (task.kind === 'every') {
          const { size, unit } = asInterval(Number(task.rule?.seconds ?? 0))
          return fill(t('rule.every'), [`${size} ${t(`unit.${unit}`)}`])
        }
        return fill(t('rule.cron'), [String(task.rule?.expression ?? ''), task.timeZone])
      }

      /**
       * Enable or disable one task.
       * @param {object} task - the task.
       */
      const toggle = async (task) => {
        await call('PATCH', `/tasks/${task.id}`, { enabled: !task.enabled }).catch(() => {})
        await load()
      }

      /**
       * Delete one task, on the second press.
       * @param {object} task - the task.
       */
      const remove = async (task) => {
        if (confirming !== task.id) {
          setConfirming(task.id)
          return
        }
        setConfirming(null)
        await call('DELETE', `/tasks/${task.id}`).catch(() => {})
        await load()
      }

      const body = editing !== null
        ? React.createElement(Form, {
          task: editing.id === undefined ? null : editing,
          onCancel: () => setEditing(null),
          onSaved: () => { setEditing(null); void load() },
        })
        : React.createElement(
          React.Fragment,
          null,
          React.createElement('div', { className: `${U}-what` }, t('what')),
          state.phase === 'loading'
            ? React.createElement('div', { className: `${U}-note` }, t('loading'))
            : state.phase === 'unavailable'
              ? React.createElement('div', { className: `${U}-note` }, t('unavailable'))
              : state.tasks.length === 0
                ? React.createElement('div', { className: `${U}-note` }, t('empty'))
                : React.createElement(
                  'div',
                  { className: `${U}-list` },
                  state.tasks.map((task) => React.createElement(
                    'div',
                    { key: task.id, className: `${U}-item` },
                    React.createElement(
                      'div',
                      { className: `${U}-item-body` },
                      React.createElement('div', { className: `${U}-item-title`, 'data-off': String(!task.enabled) }, task.title),
                      React.createElement('div', { className: `${U}-item-line` }, summarize(task)),
                      React.createElement(
                        'div',
                        { className: `${U}-item-line` },
                        task.lastRun === null
                          ? null
                          : React.createElement('span', { className: `${U}-dot`, 'data-state': task.lastRun.status }),
                        task.enabled
                          ? `${t('next')} ${task.nextRunAt === null ? t('never') : when(task.nextRunAt)}`
                          : t('disabled'),
                        task.lastRun === null ? null : ` · ${t(`run.${task.lastRun.status}`)}`,
                      ),
                    ),
                    React.createElement(
                      'div',
                      { className: `${U}-item-actions` },
                      React.createElement('button', {
                        type: 'button', className: `${U}-quiet`, onClick: () => { void toggle(task) },
                      }, task.enabled ? t('disable') : t('enable')),
                      React.createElement('button', {
                        type: 'button', className: `${U}-quiet`, onClick: () => setEditing(task),
                      }, t('edit')),
                      React.createElement('button', {
                        type: 'button', className: `${U}-quiet`, 'data-danger': String(confirming === task.id),
                        onClick: () => { void remove(task) },
                      }, confirming === task.id ? t('removing') : t('remove')),
                    ),
                  )),
                ),
          state.problem === undefined
            ? null
            : React.createElement('div', { className: `${U}-problem` }, t(`error.${state.problem}`)),
          React.createElement(
            'div',
            { className: `${U}-actions` },
            React.createElement('button', {
              type: 'button', className: `${U}-button`, onClick: onClose,
            }, t('close')),
            state.phase === 'unavailable'
              ? null
              : React.createElement('button', {
                type: 'button', className: `${U}-button`, 'data-primary': 'true',
                onClick: () => setEditing({}),
              }, t('new')),
          ),
        )

      return ReactDom.createPortal(
        React.createElement(
          'div',
          {
            className: `${U}-mask`,
            // Only a press that both started and ended on the backdrop
            // dismisses: a drag that began inside the dialog and released
            // outside it is somebody selecting text, not somebody leaving.
            onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
          },
          React.createElement(
            'div',
            { className: `${U}-dialog`, role: 'dialog', 'aria-modal': 'true' },
            React.createElement(
              'div',
              { className: `${U}-head` },
              React.createElement('div', { className: `${U}-heading` }, t('title')),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: `${U}-dismiss`,
                  title: t('close'),
                  'aria-label': t('close'),
                  onClick: onClose,
                },
                '\u00d7',
              ),
            ),
            body,
          ),
        ),
        document.body,
      )
    }

    /**
     * Writing one task.
     *
     * Nothing here validates a rule. The scheduler owns what a legal schedule
     * is — including what this account's shortest interval is, which this
     * browser is deliberately not told — so the form's job is to send a shape
     * and to word whichever code comes back.
     *
     * @param {{task: object|null, onCancel: () => void, onSaved: () => void}} props - the seat.
     * @returns {object} the element.
     */
    const Form = ({ task, onCancel, onSaved }) => {
      const t = useT()
      const existing = task ?? {}
      const interval = existing.kind === 'every' ? asInterval(Number(existing.rule?.seconds ?? 3600)) : { size: 1, unit: 'hours' }

      const [title, setTitle] = React.useState(existing.title ?? '')
      const [prompt, setPrompt] = React.useState(existing.prompt ?? '')
      const [kind, setKind] = React.useState(existing.kind ?? 'cron')
      const [at, setAt] = React.useState('')
      const [size, setSize] = React.useState(String(interval.size))
      const [unit, setUnit] = React.useState(interval.unit)
      const [expression, setExpression] = React.useState(existing.rule?.expression ?? '0 9 * * *')
      const [zone, setZone] = React.useState(existing.timeZone ?? localZone())
      const [saving, setSaving] = React.useState(false)
      const [problem, setProblem] = React.useState(null)

      /**
       * The offset this browser is at, as the `at` field has to carry one.
       *
       * A local wall-clock reading is not an instant, and the scheduler
       * refuses one without an offset rather than guessing a zone. The picker
       * gives local time, so the offset is added here where it is known.
       *
       * @param {string} local - what the datetime-local input holds.
       * @returns {string} an RFC 3339 instant.
       */
      const withOffset = (local) => {
        const chosen = new Date(local)
        if (Number.isNaN(chosen.getTime())) return local
        return chosen.toISOString()
      }

      const submit = async () => {
        setSaving(true)
        setProblem(null)
        const rule = kind === 'at'
          ? { at: withOffset(at) }
          : kind === 'every'
            ? { seconds: Math.max(1, Number(size) || 0) * UNIT_SECONDS[unit] }
            : { expression }
        const payload = { task: { title, prompt, kind, rule, timeZone: zone } }
        const answer = task === null
          ? await call('POST', '/tasks', payload).catch(() => ({ value: {} }))
          : await call('PATCH', `/tasks/${task.id}`, payload).catch(() => ({ value: {} }))
        setSaving(false)
        if (answer.value?.ok !== true) {
          const code = answer.value?.code
          setProblem(DICTIONARY.en[`error.${code}`] === undefined ? 'generic' : code)
          return
        }
        onSaved()
      }

      return React.createElement(
        'div',
        { className: `${U}-form` },
        React.createElement('div', { className: `${U}-label` }, t('field.title')),
        React.createElement('input', {
          className: `${U}-input`, value: title, maxLength: 120,
          onChange: (event) => setTitle(event.target.value),
        }),

        React.createElement('div', { className: `${U}-label` }, t('field.prompt')),
        React.createElement('textarea', {
          className: `${U}-area`, value: prompt, maxLength: 4000,
          onChange: (event) => setPrompt(event.target.value),
        }),
        React.createElement('div', { className: `${U}-hint` }, t('hint.prompt')),

        React.createElement('div', { className: `${U}-label` }, t('field.kind')),
        React.createElement(
          'select',
          { className: `${U}-select`, value: kind, onChange: (event) => setKind(event.target.value) },
          React.createElement('option', { value: 'cron' }, t('kind.cron')),
          React.createElement('option', { value: 'every' }, t('kind.every')),
          React.createElement('option', { value: 'at' }, t('kind.at')),
        ),

        kind === 'at'
          ? React.createElement(
            React.Fragment,
            null,
            React.createElement('div', { className: `${U}-label` }, t('field.at')),
            React.createElement('input', {
              className: `${U}-input`, type: 'datetime-local', value: at,
              onChange: (event) => setAt(event.target.value),
            }),
          )
          : null,

        kind === 'every'
          ? React.createElement(
            React.Fragment,
            null,
            React.createElement('div', { className: `${U}-label` }, t('field.every')),
            React.createElement(
              'div',
              { className: `${U}-pair` },
              React.createElement('input', {
                className: `${U}-input`, type: 'number', min: '1', value: size,
                onChange: (event) => setSize(event.target.value),
              }),
              React.createElement(
                'select',
                { className: `${U}-select`, value: unit, onChange: (event) => setUnit(event.target.value) },
                React.createElement('option', { value: 'minutes' }, t('unit.minutes')),
                React.createElement('option', { value: 'hours' }, t('unit.hours')),
                React.createElement('option', { value: 'days' }, t('unit.days')),
              ),
            ),
          )
          : null,

        kind === 'cron'
          ? React.createElement(
            React.Fragment,
            null,
            React.createElement('div', { className: `${U}-label` }, t('field.expression')),
            React.createElement('input', {
              className: `${U}-input`, value: expression, spellCheck: false,
              onChange: (event) => setExpression(event.target.value),
            }),
            React.createElement('div', { className: `${U}-hint` }, t('hint.cron')),
            React.createElement('div', { className: `${U}-label` }, t('field.zone')),
            React.createElement('input', {
              className: `${U}-input`, value: zone, spellCheck: false,
              onChange: (event) => setZone(event.target.value),
            }),
          )
          : null,

        problem === null ? null : React.createElement('div', { className: `${U}-problem` }, t(`error.${problem}`)),

        React.createElement(
          'div',
          { className: `${U}-actions` },
          React.createElement('button', {
            type: 'button', className: `${U}-button`, onClick: onCancel, disabled: saving,
          }, t('cancel')),
          React.createElement('button', {
            type: 'button', className: `${U}-button`, 'data-primary': 'true', disabled: saving,
            onClick: () => { void submit() },
          }, saving ? t('saving') : t('save')),
        ),
      )
    }

    /**
     * Column the real footerActions flex row.
     *
     * SlotOutlet is display:contents, so this mark's DOM parent is that
     * invisible wrapper; walking past contents ancestors reaches the shell
     * row that actually lays scheduled-tasks beside the sandbox status.
     *
     * @param {HTMLElement | null} mark - the data-dsh-footer-stack node.
     * @returns {() => void} restore the previous inline styles.
     */
    const stackFooterColumn = (mark) => {
      if (mark === null) return () => {}
      let el = mark.parentElement
      while (el !== null) {
        const shown = window.getComputedStyle(el)
        if (shown.display === 'contents') {
          el = el.parentElement
          continue
        }
        if (shown.display === 'flex' || shown.display === 'inline-flex') {
          const previous = {
            flexDirection: el.style.flexDirection,
            alignItems: el.style.alignItems,
            width: el.style.width,
          }
          el.style.flexDirection = 'column'
          el.style.alignItems = 'stretch'
          el.style.width = '100%'
          return () => {
            el.style.flexDirection = previous.flexDirection
            el.style.alignItems = previous.alignItems
            el.style.width = previous.width
          }
        }
        el = el.parentElement
      }
      return () => {}
    }

    /**
     * The sidebar seat.
     *
     * It renders nothing at all until the gateway has said this deployment has
     * a scheduler. A control that opens a dialog reading "not available here"
     * is worse than no control: it advertises a feature by failing at it, in
     * the one place a tenant looks most often.
     *
     * @param {{wide?: boolean}} props - the sidebar's own share; false on the collapsed rail.
     * @returns {object | null} the element.
     */
    const SidebarButton = ({ wide }) => {
      const t = useT()
      const [open, setOpen] = React.useState(false)
      const [available, setAvailable] = React.useState(null)
      const stackRef = React.useRef(null)

      React.useEffect(() => {
        let live = true
        void call('GET', '/tasks')
          .then((answer) => { if (live) setAvailable(answer.status !== 501 && answer.status !== 401) })
          .catch(() => { if (live) setAvailable(false) })
        return () => { live = false }
      }, [])

      // After mount: the slot anchor is display:contents, so only a walk up the
      // live tree reaches the flex row that still lays seats horizontally.
      React.useLayoutEffect(() => {
        if (available !== true) return undefined
        return stackFooterColumn(stackRef.current)
      }, [available])

      if (available !== true) return null

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { 'data-dsh-footer-stack': '', ref: stackRef },
          React.createElement('style', null, CSS),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${U}-open`,
              'data-wide': String(wide !== false),
              title: t('open'),
              onClick: () => setOpen(true),
            },
            React.createElement(
              'span',
              { className: `${U}-open-icon` },
              React.createElement(Glyph, { size: wide === false ? 18 : 16 }),
            ),
            wide === false ? null : React.createElement('span', { className: `${U}-open-label` }, t('open')),
          ),
        ),
        open ? React.createElement(Dialog, { onClose: () => setOpen(false) }) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the sidebar control.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        plugin = ctx

        ctx.effect(
          () => ctx.locale.register(NS, DICTIONARY),
          'scheduled-tasks: dictionaries',
        )

        // `sidebar.footer.action` is a list slot sorted by `order`, and
        // `dsh-sandbox-host` holds 100 with the sandbox row. Below that number
        // is first in the list; stackFooterColumn turns the shell's row into a
        // column so each seat takes a full line. A control the tenant presses
        // sits over a readout they only glance at.
        ctx.effect(
          () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'scheduled-tasks', order: 50 },
            SidebarButton,
          )),
          'scheduled-tasks: sidebar control',
        )
      },
    }
  },
})
