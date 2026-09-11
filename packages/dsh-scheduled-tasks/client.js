/**
 * Scheduled tasks, browser half.
 *
 * The shell owns the global Scheduled panel's navigation and selection. This
 * plugin contributes a footer control and managers to the global panel and
 * the cloud computer sidebar. The manager is independent of conversation state.
 * No footer layout or shell DOM ancestry is changed here.
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
    const { Button, Switch, IconPlusOutline16, IconClockOutline16, IconChevronLeftOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** The plugin's client context, kept for the locale service the hook reads. */
    let plugin

    /** This plugin's own dictionary namespace. */
    const NS = 'hamsterhq.schedule'

    /** Everything this plugin says, in both languages. */
    const DICTIONARY = {
      zh: {
        open: '定时任务',
        title: '定时任务',
        empty: '还没有安排任何任务。',
        loading: '加载中…',
        unavailable: '这个部署没有启用定时任务。',
        new: '新建任务',
        edit: '编辑',
        back: '返回',
        enabled: '已启用',
        remove: '删除',
        removing: '确认删除？',
        disabled: '已停用',
        save: '保存',
        saving: '保存中…',
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
        open: 'Scheduled tasks',
        title: 'Scheduled tasks',
        empty: 'Nothing is scheduled yet.',
        loading: 'Loading…',
        unavailable: 'This deployment does not run scheduled tasks.',
        new: 'New task',
        edit: 'Edit',
        back: 'Back',
        enabled: 'Enabled',
        remove: 'Delete',
        removing: 'Delete it?',
        disabled: 'Disabled',
        save: 'Save',
        saving: 'Saving…',
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

    /** Shared manager styling, confined to this plugin's own elements. */
    const CSS = `
      .${U}-panel[data-inline='true'] .${U}-head { margin-bottom: 12px; }
      .${U}-panel[data-inline='true'] .${U}-heading { color: var(--dsw-alias-label-secondary); font-size: 15px; }
      .${U}-panel[data-inline='true'] .${U}-new { color: var(--dsw-alias-label-secondary); }
      .${U}-panel[data-inline='true'] .${U}-item-title { font-size: 14px; font-weight: 500; }
      .${U}-panel[data-inline='true'] .${U}-item-line { font-size: 13px; margin-top: 3px; }
      .${U}-panel[data-inline='true'] .${U}-run { display: none; }

      .${U}-clock { flex: none; color: #008749; }

      .${U}-nav { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px;
        padding: 6px 8px; border: 0; border-radius: 8px; background: transparent;
        color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
      .${U}-nav[data-wide='false'] { justify-content: center; padding: 6px 0; }
      .${U}-nav:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .${U}-nav:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }

      .${U}-panel {
        display: flex; flex: 1; min-width: 0; min-height: 0;
        overflow: hidden; box-sizing: border-box;
        font-family: var(--dsw-font-family);
        color: var(--dsw-alias-label-primary);
      }
      .${U}-panel[data-inline='true'] { padding: 0; overflow: visible; }
      .${U}-panel > .${U}-manager { width: 100%; margin: 0 auto; }
      .${U}-panel[data-inline='true'] .${U}-list { flex: none; overflow: visible; }
      .${U}-manager { display: flex; flex: 1; flex-direction: column; min-height: 0; }
      .${U}-head { display: flex; align-items: center; justify-content: space-between; }

      .${U}-list { flex: 1; min-height: 0; overflow-y: auto; }
      .${U}-item-body { flex: 1; min-width: 0; }
      .${U}-item-title { font-weight: 500; overflow-wrap: anywhere; }
      .${U}-item-title[data-off='true'] { color: var(--dsw-alias-label-secondary); }
      .${U}-item-line {
        margin-top: 3px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px; line-height: 18px;
        overflow-wrap: anywhere;
      }

      .${U}-note { padding: 18px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .${U}-form { display: flex; flex-direction: column; gap: 6px; overflow: visible; }
      .${U}-input, .${U}-area, .${U}-select {
        border: 1px solid var(--dsw-alias-border-l2);
        background: transparent; color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
      }
      .${U}-area { resize: vertical; }
      .${U}-input:focus, .${U}-area:focus, .${U}-select:focus {
        outline: none; border-color: var(--dsw-alias-state-business-primary);
      }
      .${U}-pair { display: flex; gap: 8px; }
      .${U}-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
      .${U}-problem { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
      .${U}-new { flex: none; }

      .${U}-panel { padding: 32px clamp(20px, 5vw, 64px); }
      .${U}-panel > .${U}-manager { max-width: 760px; }
      .${U}-manager { min-width: 0; }
      .${U}-head { flex: none; gap: 12px; min-height: 40px; margin-bottom: 20px; }
      .${U}-heading { flex: 1; font-size: 22px; font-weight: 600; }
      .${U}-toggle { display: inline-flex; align-items: center; gap: 5px; }
      .${U}-back { width: 28px; height: 28px; padding: 0; justify-content: center; flex: none; }
      .${U}-new { border: 0; width: 36px; padding: 0; display: grid; place-items: center; }
      .${U}-list { margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .${U}-item {
        width: 100%; display: flex; flex-direction: row; align-items: center; gap: 14px;
        border: 0; border-radius: 12px; padding: 14px; background: transparent; text-align: left; color: inherit; font: inherit; cursor: pointer; }
      .${U}-item:hover, .${U}-item:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
      .${U}-item:focus-visible, .${U}-back:focus-visible, .${U}-toggle:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: -2px; }
      .${U}-item-body { display: flex; flex-direction: column; gap: 2px; }
      .${U}-item-title { font-size: 15px; }
      .${U}-detail-body { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; }
      .${U}-label { margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .${U}-input, .${U}-select, .${U}-area { width: 100%; min-height: 34px; border-radius: 8px; padding: 7px 10px; font-size: 13px; box-sizing: border-box; }
      .${U}-area { min-height: 120px; line-height: 1.5; }
      .${U}-button[data-danger='true'] { color: var(--dsw-alias-state-error-primary); }
      .${U}-panel[data-inline='true'] .${U}-manager[data-detail='true'] {
        position: absolute; inset: 0; z-index: 3; padding: 0; overflow: hidden; box-sizing: border-box;
        background: var(--dsw-alias-bg-layer-1); }
      .${U}-editor { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
      .${U}-toolbar { display: flex; align-items: center; flex: none; gap: 8px; height: 36px; padding: 0 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
      .${U}-editor-title { flex: 1; min-width: 0; font-size: 12px; font-weight: 500; white-space: nowrap; }
      .${U}-toolbar .${U}-button { flex: none; white-space: nowrap; }
      .${U}-toolbar .${U}-toggle { gap: 5px; padding: 0; font-size: 12px; white-space: nowrap; }
      .${U}-detail-body { padding: 8px 12px 16px; }
      .${U}-form > .${U}-label:first-child { margin-top: 0; }
    `

    /**
     * One call to the gateway's schedule plane.
     *
     * Answers are read as JSON whatever the status, because the gateway sends
     * a coded body for every refusal and the manager presents that code.
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

    const errorCode = (code) => DICTIONARY.en[`error.${code}`] === undefined ? 'generic' : code

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
     * Everything a tenant can do to their schedule.
     *
     * The global panel owns this manager. All task state and mutations stay
     * gateway-backed so the panel remains useful when no sandbox is running.
     *
     * @returns {object} the element.
     */
    const ScheduleManager = ({ inline = false }) => {
      const t = useT()
      const [state, setState] = React.useState({ phase: 'loading', tasks: [] })
      const [editing, setEditing] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
      const [mutating, setMutating] = React.useState(false)
      const [mutationProblem, setMutationProblem] = React.useState(null)
      const live = React.useRef(false)
      const loading = React.useRef(0)
      const mutationPending = React.useRef(false)

      const load = React.useCallback(async () => {
        const request = ++loading.current
        const answer = await call('GET', '/tasks').catch(() => ({ status: 0, value: {} }))
        if (!live.current || request !== loading.current) return
        if (answer.status === 501) {
          setState({ phase: 'unavailable', tasks: [] })
          return
        }
        if (answer.value?.ok !== true) {
          setState({ phase: 'ready', tasks: [], problem: errorCode(answer.value?.code) })
          return
        }
        setState({ phase: 'ready', tasks: answer.value.tasks ?? [] })
      }, [])

      React.useEffect(() => {
        live.current = true
        void load()
        return () => { live.current = false; loading.current++ }
      }, [load])

      const mutate = async (method, task, body, onSuccess) => {
        if (mutationPending.current) return
        mutationPending.current = true
        setMutating(true)
        setMutationProblem(null)
        const answer = await call(method, `/tasks/${task.id}`, body).catch(() => ({ value: {} }))
        mutationPending.current = false
        if (!live.current) return
        setMutating(false)
        if (answer.value?.ok !== true) {
          setMutationProblem(errorCode(answer.value?.code))
          return
        }
        onSuccess()
        await load()
      }

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
        await mutate('PATCH', task, { enabled: !task.enabled }, () => {
          setEditing(current => current?.id === task.id ? { ...current, enabled: !task.enabled } : current)
        })
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
        await mutate('DELETE', task, undefined, () => setEditing(null))
      }

      const back = () => { setEditing(null); setConfirming(null); setMutationProblem(null) }
      return React.createElement('div', { className: `${U}-manager`, 'data-detail': String(editing !== null) },
        editing === null ? React.createElement('div', { className: `${U}-head` },
          React.createElement('div', { className: `${U}-heading`, role: 'heading', 'aria-level': 2 }, t('title')),
          state.phase === 'ready' ? React.createElement(Button, {
            type: 'button', variant: 'ghost', size: 'sm', className: `${U}-new`, title: t('new'), 'aria-label': t('new'),
            onClick: () => setEditing({}),
          }, React.createElement(IconPlusOutline16, { size: 20 })) : null) : null,
        editing !== null ? React.createElement(Form, { key: editing.id ?? 'new', task: editing.id ? editing : null,
          confirming: confirming === editing.id, mutating, mutationProblem, onToggle: () => { void toggle(editing) },
          onRemove: () => { void remove(editing) }, onCancel: back, onSaved: () => { back(); void load() } })
          : state.phase === 'loading' ? React.createElement('div', { className: `${U}-note` }, t('loading'))
            : state.phase === 'unavailable' ? React.createElement('div', { className: `${U}-note` }, t('unavailable'))
              : state.tasks.length === 0 ? React.createElement('div', { className: `${U}-note` }, t('empty'))
                : React.createElement('div', { className: `${U}-list` }, state.tasks.map(task =>
                  React.createElement('button', { key: task.id, type: 'button', className: `${U}-item`, onClick: () => setEditing(task) },
                    React.createElement(IconClockOutline16, { size: 20, className: `${U}-clock` }),
                    React.createElement('span', { className: `${U}-item-body` },
                      React.createElement('span', { className: `${U}-item-title`, 'data-off': String(!task.enabled) }, task.title),
                      React.createElement('span', { className: `${U}-item-line` }, summarize(task)),
                      !inline ? React.createElement('span', { className: `${U}-item-line ${U}-run` },
                        task.enabled ? `${t('next')} ${task.nextRunAt === null ? t('never') : when(task.nextRunAt)}` : t('disabled')) : null)))),
        state.problem === undefined ? null : React.createElement('div', { className: `${U}-problem` }, t(`error.${state.problem}`)))
    }

    /**
     * Writing one task.
     *
     * Nothing here validates a rule. The scheduler owns what a legal schedule
     * is — including what this account's shortest interval is, which this
     * browser is deliberately not told — so the form's job is to send a shape
     * and to word whichever code comes back.
     *
     * @param {{task: object|null, confirming: boolean, mutating: boolean, mutationProblem: string|null, onToggle: () => void, onRemove: () => void, onCancel: () => void, onSaved: () => void}} props - the seat.
     * @returns {object} the element.
     */
    const Form = ({ task, confirming, mutating, mutationProblem, onToggle, onRemove, onCancel, onSaved }) => {
      const t = useT()
      const existing = task ?? {}
      const interval = existing.kind === 'every' ? asInterval(Number(existing.rule?.seconds ?? 3600)) : { size: 1, unit: 'hours' }

      const [title, setTitle] = React.useState(existing.title ?? '')
      const [prompt, setPrompt] = React.useState(existing.prompt ?? '')
      const [kind, setKind] = React.useState(existing.kind ?? 'cron')
      const [at, setAt] = React.useState(() => {
        if (!existing.rule?.at) return ''
        const value = new Date(existing.rule.at)
        return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      })
      const [size, setSize] = React.useState(String(interval.size))
      const [unit, setUnit] = React.useState(interval.unit)
      const [expression, setExpression] = React.useState(existing.rule?.expression ?? '0 9 * * *')
      const [zone, setZone] = React.useState(existing.timeZone ?? localZone())
      const [saving, setSaving] = React.useState(false)
      const [problem, setProblem] = React.useState(null)
      const live = React.useRef(false)
      React.useEffect(() => {
        live.current = true
        return () => { live.current = false }
      }, [])

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
        if (!live.current) return
        setSaving(false)
        if (answer.value?.ok !== true) {
          const code = answer.value?.code
          setProblem(errorCode(code))
          return
        }
        onSaved()
      }

      return React.createElement('form', { className: `${U}-editor`, onSubmit: event => {
        event.preventDefault()
        if (!saving && !mutating) void submit()
      } },
        React.createElement('div', { className: `${U}-toolbar` },
          React.createElement(Button, { type: 'button', variant: 'ghost', size: 'sm', className: `${U}-back`,
            title: t('back'), 'aria-label': t('back'), onClick: onCancel, disabled: saving || mutating },
          React.createElement(IconChevronLeftOutline14, { size: 14 })),
          React.createElement('div', { className: `${U}-editor-title`, role: 'heading', 'aria-level': 2 }, task ? t('edit') : t('new')),
          task ? React.createElement('label', { className: `${U}-toggle` },
            React.createElement(Switch, { checked: Boolean(task.enabled), onChange: onToggle,
              label: task.enabled ? t('enabled') : t('disabled'), disabled: saving || mutating }),
            task.enabled ? t('enabled') : t('disabled')) : null,
          task ? React.createElement(Button, { type: 'button', variant: 'outline', size: 'sm', className: `${U}-button`,
            'data-danger': String(confirming), onClick: onRemove, disabled: saving || mutating },
            confirming ? t('removing') : t('remove')) : null,
          React.createElement(Button, { type: 'submit', variant: 'primary', size: 'sm', className: `${U}-button`, disabled: saving || mutating },
            saving ? t('saving') : t('save'))),
        React.createElement('div', { className: `${U}-detail-body` },
        React.createElement('div', { className: `${U}-form` },
        React.createElement('div', { className: `${U}-label` }, t('field.title')),
        React.createElement('input', {
          className: `${U}-input`, 'aria-label': t('field.title'), value: title, maxLength: 120,
          onChange: (event) => setTitle(event.target.value),
        }),

        React.createElement('div', { className: `${U}-label` }, t('field.prompt')),
        React.createElement('textarea', {
          className: `${U}-area`, 'aria-label': t('field.prompt'), value: prompt, maxLength: 4000,
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

        mutationProblem === null ? null : React.createElement('div', { className: `${U}-problem`, role: 'alert' }, t(`error.${mutationProblem}`)),
        problem === null ? null : React.createElement('div', { className: `${U}-problem` }, t(`error.${problem}`)),

        task?.lastRun ? React.createElement('div', { className: `${U}-note` }, t(`run.${task.lastRun.status}`)) : null,
      )))
    }

    /** Global manager; usable before any conversation has been created. */
    const SchedulePanel = ({ inline = false }) => {
      const t = useT()
      return React.createElement(
        'section',
        { className: `${U}-panel`, 'data-inline': String(inline), 'aria-label': t('title') },
        React.createElement(ScheduleManager, { inline }),
      )
    }

    return {
      inject: ['slots', 'locale', 'layout'],
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

        // Shared by the global panel and the computer sidebar manager.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-scheduled-tasks-style', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'scheduled-tasks: styles')

        // Register both managers and their footer control when scheduling is available.
        ctx.effect(() => {
          let live = true
          const disposers = []
          void call('GET', '/tasks').then((answer) => {
            if (!live || answer.status === 501 || answer.status === 401) return
            disposers.push(ctx.slots.inject('computer.schedule', () => ctx.slots.register(
              { name: 'computer.schedule' }, () => React.createElement(SchedulePanel, { inline: true }),
            )))
            disposers.push(ctx.slots.inject('main', () => ctx.slots.register(
              { name: 'main', key: 'scheduled-tasks' },
              SchedulePanel,
            )))
            disposers.push(ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'scheduled-tasks', order: 50 },
              ({ wide, usePanelInfo }) => {
                const t = useT()
                const active = usePanelInfo(info => info.activePanelId === 'scheduled-tasks')
                return React.createElement('button', { type: 'button', className: `${U}-nav`,
                'data-wide': String(wide), title: t('open'),
                'aria-label': t('open'), 'aria-pressed': active, onClick: () => ctx.layout.selectPanel(active ? null : 'scheduled-tasks') },
              React.createElement(Glyph, { size: 16 }), wide ? t('open') : null) },
            )))
          }).catch(() => {})
          return () => {
            live = false
            for (const dispose of disposers.reverse()) dispose()
          }
        }, 'scheduled-tasks: global panel')
      },
    }
  },
})
