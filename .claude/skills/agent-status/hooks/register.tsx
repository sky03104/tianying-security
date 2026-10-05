// agent 工作狀態面板：海賊團角色依 agent 正在做的事換人上場跑步
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type { AgentStatusActive, AgentStatusNow, AgentStatusPhase, AgentStatusStep, AgentStatusTodo } from '../types'
import { CAST, bar, elapsed, isTodoTool, labelOf, miniSvg, phaseOf, stageSvg, taskIdFrom, todosFromTodoWrite } from './logic'

const PANE = 'agent-status'
const FAIL_MS = 5000
const OPENED = '已開啟工作狀態面板。'

const nowA = atom({ plugin: 'agent-status', key: 'now' } as const, { phase: 'idle', label: '', since: 0 } as AgentStatusNow)
const activeA = atom({ plugin: 'agent-status', key: 'active' } as const, [] as AgentStatusActive[])
const recentA = atom({ plugin: 'agent-status', key: 'recent' } as const, [] as AgentStatusStep[])
const todosA = atom({ plugin: 'agent-status', key: 'todos' } as const, [] as AgentStatusTodo[])
const turnA = atom({ plugin: 'agent-status', key: 'turnSince' } as const, 0)
const failA = atom({ plugin: 'agent-status', key: 'failUntil' } as const, 0)
const tickA = atom({ plugin: 'agent-status', key: 'tick' } as const, 0)

/** 畫面上要顯示的狀態（失敗動畫優先 5 秒） */
async function 目前狀態($: EngineInterface): Promise<{ phase: AgentStatusPhase; label: string; since: number }> {
  const [now, failUntil, t] = await Promise.all([read($, nowA), read($, failA), $.clock.now()])
  if (t < failUntil) {
    const last = (await read($, recentA)).at(-1)
    return { phase: 'fail', label: last ? `${last.tool}｜${last.label}` : '', since: now.since }
  }
  return now
}

/** 一步結束後，切回還在跑的最新那一步；都沒有就回到「思考中」 */
async function 換下一步($: EngineInterface, active: AgentStatusActive[]): Promise<void> {
  const top = active.at(-1)
  const t = await $.clock.now()
  await update($, nowA, () => (top ? { phase: top.phase, label: top.label, since: top.since } : { phase: 'think', label: '', since: t }))
}

/** 純文字狀態卡：畫不出元件的地方（或模型讀到的那份）用這個 */
async function 文字狀態卡($: EngineInterface): Promise<string> {
  const st = await 目前狀態($)
  const [turnSince, todos, recent, t] = await Promise.all([read($, turnA), read($, todosA), read($, recentA), $.clock.now()])
  const done = todos.filter(x => x.status === 'completed').length
  const 行 = [`**${CAST[st.phase].title}**`]
  if (st.label !== '') 行.push(st.label)
  if (turnSince > 0) 行.push(`⏱ 本輪 ${elapsed(t - turnSince)}`)
  if (todos.length > 0) 行.push(`📋 任務 ${done}/${todos.length} ${bar(done, todos.length)}`)
  for (const r of [...recent].reverse()) 行.push(`${r.isOk ? '✅' : '❌'} ${r.tool}｜${r.label}`)
  return 行.join('\n\n')
}

/** 狀態卡畫面（側邊面板與對話內狀態卡共用） */
async function 狀態卡($: EngineInterface, els: Elements[RenderSurface]): Promise<RenderElement> {
  const { Box, Text } = els
  await read($, tickA) // 讀 tick 讓計時器能觸發重畫
  const st = await 目前狀態($)
  const [turnSince, todos, recent, active, t] = await Promise.all([
    read($, turnA), read($, todosA), read($, recentA), read($, activeA), $.clock.now(),
  ])
  const cast = CAST[st.phase]
  const done = todos.filter(x => x.status === 'completed').length
  const doing = todos.find(x => x.status === 'in_progress')
  const 計時 = turnSince > 0
    ? `本步 ${elapsed(t - st.since)}｜本輪 ${elapsed(t - turnSince)}${active.length > 1 ? `｜同時 ${active.length} 件` : ''}`
    : ''

  return (
    <Box flexDirection="column">
      {'Svg' in els && (
        <els.Svg key="stage" source={stageSvg(st.phase)} alt={cast.title} width={320} height={120} isInteractive={true} />
      )}
      <Text key="title" bold color={cast.color}>{cast.title}</Text>
      {st.label !== '' && <Text key="label" wrap="truncate-end">{st.label}</Text>}
      {計時 !== '' && <Text key="time" dimColor>⏱ {計時}</Text>}
      {todos.length > 0 && (
        <Box key="todos" flexDirection="column" marginTop={1}>
          <Text bold color="#FFD700">📋 任務 {done}/{todos.length} {bar(done, todos.length)}</Text>
          {doing && <Text color="#FFD700" wrap="truncate-end">▶ {doing.title}</Text>}
          {todos.slice(0, 10).map(x => (
            <Text key={`t${x.id}`} dimColor={x.status === 'completed'} wrap="truncate-end">
              {x.status === 'completed' ? '✅' : x.status === 'in_progress' ? '🏃' : '⬜'} {x.title}
            </Text>
          ))}
        </Box>
      )}
      {recent.length > 0 && (
        <Box key="recent" flexDirection="column" marginTop={1}>
          <Text bold dimColor>🕘 最近步驟</Text>
          {[...recent].reverse().map((r, i) => (
            <Text key={`r${i}`} color={r.isOk ? undefined : '#F87171'} wrap="truncate-end">
              {r.isOk ? '✅' : '❌'} {r.tool}｜{r.label}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agent-status', description: '開啟 agent 工作狀態面板（海賊團動畫）' })
    void $.ui.open({ id: PANE, title: '⚓ 工作狀態' })
    // 有在跑或失敗動畫還沒結束時每秒重畫，讓經過時間會跳；待命時不重畫
    $.clock.every(1000, () => {
      void (async () => {
        const [turnSince, failUntil, t] = await Promise.all([read($, turnA), read($, failA), $.clock.now()])
        if (turnSince > 0 || t < failUntil + 1000) await update($, tickA, n => n + 1)
      })()
    })
    return next(e)
  })

  // 能停靠側邊面板的介面（終端機全螢幕）開面板；手機／網頁不支援面板，改在對話裡印狀態卡
  on('command.run', { command: 'agent-status' }, async ($, e) => {
    if (e.presentation?.isFullscreen === true) {
      await $.ui.open({ id: PANE, title: '⚓ 工作狀態', focus: true })
      return { text: OPENED }
    }
    return { text: await 文字狀態卡($) }
  })

  on('turn.start', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, turnA, () => t)
    await update($, activeA, () => [])
    await update($, nowA, () => ({ phase: 'think', label: '', since: t }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)

    // 任務清單類：只更新清單
    if (e.tool === 'TodoWrite') {
      await update($, todosA, () => todosFromTodoWrite(e.todos))
      return next(e)
    }
    if (e.tool === 'TaskUpdate') {
      const { taskId, status, subject, activeForm } = e
      await update($, todosA, list =>
        status === 'deleted'
          ? list.filter(x => x.id !== taskId)
          : list.map(x => (x.id !== taskId ? x : {
              ...x,
              status: status ?? x.status,
              title: (status === 'in_progress' && activeForm) || subject || x.title,
            })))
      return next(e)
    }
    if (e.tool === 'TaskCreate') {
      const subject = e.subject
      const ran = await next(e)
      const fallback = String((await read($, todosA)).length + 1)
      const id = taskIdFrom(ran.text, fallback)
      await update($, todosA, list => [...list.filter(x => x.id !== id), { id, title: subject, status: 'pending' as const }])
      return ran
    }
    if (isTodoTool(tool)) return next(e)

    const id = e.tool_use_id ?? `${tool}-${await $.clock.now()}`
    const label = (e.agentId ? '子代理｜' : '') + labelOf(e as unknown as Record<string, unknown>)
    const item: AgentStatusActive = { id, phase: phaseOf(tool, e.agentId), label, since: await $.clock.now() }
    await update($, activeA, list => [...list, item])
    await update($, nowA, () => ({ phase: item.phase, label: item.label, since: item.since }))

    let isOk = false
    try {
      const ran = await next(e)
      isOk = ran.deny === undefined && ran.isError !== true
      return ran
    } finally {
      await update($, recentA, list => [...list, { tool, label, isOk }].slice(-6))
      if (!isOk) {
        const t = await $.clock.now()
        await update($, failA, () => t + FAIL_MS)
      }
      const rest = await update($, activeA, list => list.filter(x => x.id !== id))
      await 換下一步($, Array.isArray(rest) ? rest : await read($, activeA))
    }
  })

  on('turn.complete', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, turnA, () => 0)
    await update($, activeA, () => [])
    await update($, nowA, () => ({ phase: 'done', label: '等你下一步指令', since: t }))
    return next(e)
  })

  // 側邊面板：大舞台＋任務清單＋最近步驟
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => 狀態卡($, $.ui.resolve(e)))

  // 對話內狀態卡：/agent-status 的輸出列直接畫成會即時更新的狀態卡（手機／網頁看這個）
  on('ui.render', { component: 'CommandOutput', props: { command: 'agent-status' } }, async ($, e, next) => {
    if (e.props.isErrored || e.props.text === OPENED) return next(e)
    return 狀態卡($, $.ui.resolve(e))
  })

  // 輸入框上方狀態條：小角色＋一行字（手機一定看得到）
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tickA)
    const st = await 目前狀態($)
    if (e.props.hasSurvey || st.phase === 'idle') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [turnSince, todos, t] = await Promise.all([read($, turnA), read($, todosA), $.clock.now()])
    const cast = CAST[st.phase]
    const done = todos.filter(x => x.status === 'completed').length
    const 字 = [
      cast.title,
      st.label,
      turnSince > 0 ? elapsed(t - turnSince) : '',
      todos.length > 0 ? `任務 ${done}/${todos.length}` : '',
    ].filter(Boolean).join('｜')

    return (
      <Box flexDirection="row" alignItems="center">
        {'Svg' in els && (
          <els.Svg key="mini" source={miniSvg(st.phase)} alt={cast.title} height={40} isInteractive={true} />
        )}
        <Text key="line" color={cast.color} wrap="truncate-end"> {字}</Text>
      </Box>
    )
  })
}
