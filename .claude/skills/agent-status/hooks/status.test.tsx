import { describe, expect, mock, test } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf } from 'claude-code'

import { bar, elapsed, labelOf, phaseOf, stageSvg, taskIdFrom, todosFromTodoWrite } from './logic'

/** 測試共用：模擬時鐘＋讓 turn.start 有底層回應 */
function 準備(on: On) {
  mock.clock(on, { now: 1_000_000 })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
}

const PANE = { plugin: 'agent-status', component: 'Pane', requestId: 'agent-status', props: {} as unknown as RenderPropsOf['Pane'] } as const

describe('純邏輯', () => {
  test('工具對應角色狀態', async () => {
    expect(phaseOf('Bash')).toBe('run')
    expect(phaseOf('Grep')).toBe('read')
    expect(phaseOf('Edit')).toBe('edit')
    expect(phaseOf('Agent')).toBe('agent')
    expect(phaseOf('AskUserQuestion')).toBe('wait')
    expect(phaseOf('Read', 'sub1')).toBe('agent')
    expect(phaseOf('mcp__github__get_me')).toBe('run')
  })

  test('標籤白話化', async () => {
    expect(labelOf({ tool: 'Bash', command: 'npm test', description: '跑測試' })).toBe('跑測試')
    expect(labelOf({ tool: 'Bash', command: 'git status\ngit log' })).toBe('git status')
    expect(labelOf({ tool: 'Read', file_path: '/a/b/index.html' })).toBe('讀 index.html')
    expect(labelOf({ tool: 'Grep', pattern: 'APP_VERSION' })).toBe('搜尋「APP_VERSION」')
    expect(labelOf({ tool: 'Bash', description: 'x'.repeat(80) }).length).toBe(48)
  })

  test('TodoWrite 轉清單、進度條、計時', async () => {
    const t = todosFromTodoWrite([
      { content: '寫面板', status: 'completed', activeForm: '寫面板中' },
      { content: '跑測試', status: 'in_progress', activeForm: '跑測試中' },
      { content: '推送', status: 'pending', activeForm: '推送中' },
    ])
    expect(t.map(x => x.title)).toEqual(['寫面板', '跑測試中', '推送'])
    expect(bar(1, 3, 6)).toBe('▰▰▱▱▱▱')
    expect(elapsed(497_000)).toBe('8:17')
    expect(elapsed(3_723_000)).toBe('1:02:03')
    expect(taskIdFrom('Task #12 created successfully', 'x')).toBe('12')
    expect(taskIdFrom('', '3')).toBe('3')
  })

  test('每個狀態的 SVG 都在 13 萬字元以內且有動畫', async () => {
    for (const p of ['run', 'read', 'edit', 'agent', 'fail', 'think', 'wait', 'done', 'idle'] as const) {
      const s = stageSvg(p)
      expect(s.length).toBeLessThan(131072)
      expect(s.startsWith('<svg')).toBe(true)
    }
    expect(stageSvg('run')).toContain('animateTransform')
    expect(stageSvg('agent').match(/data:image\/png/g)?.length).toBe(2)
  })
})

describe('面板', () => {
  test('跑指令時路飛上場，顯示指令說明', async ($, on) => {
    準備(on)
    let 面板文字 = ''
    on('tool.call', { tool: 'Bash' }, async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
      面板文字 = (await ui.findAll({ type: 'Text' })).map(x => x.text).join('\n')
      await ui.unmount()
      return { deny: '測試用：不真的執行' }
    })
    await $.turn.start({ text: '幫我跑測試', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: '跑哨表測試' })
    expect(面板文字).toContain('路飛衝刺中')
    expect(面板文字).toContain('跑哨表測試')
  })

  test('失敗後喬巴上場、最近步驟標紅叉；手機與桌面都畫得出來', async ($, on) => {
    準備(on)
    on('tool.call', { tool: 'Bash' }, () => ({ deny: '測試用失敗' }))
    await $.turn.start({ text: '', turnId: 't2' })
    await $.tool.call({ tool: 'Bash', command: 'false', description: '故意失敗' })
    for (const surface of ['mobile', 'desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const all = (await ui.findAll({ type: 'Text' })).map(x => x.text).join('\n')
      expect(all).toContain('喬巴急救中')
      expect(all).toContain('❌ Bash｜故意失敗')
      if (surface !== 'terminal') expect(JSON.stringify(await ui.drawn())).toContain('"type":"Svg"')
      await ui.unmount()
    }
  })

  test('TodoWrite 更新任務進度，完成後顯示任務完成', async ($, on) => {
    準備(on)
    on('tool.call', { tool: 'TodoWrite' }, () => ({ deny: '測試用' }))
    await $.turn.start({ text: '', turnId: 't3' })
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'A', status: 'completed', activeForm: 'A中' },
        { content: 'B', status: 'in_progress', activeForm: 'B中' },
      ],
    })
    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    const all = (await ui.findAll({ type: 'Text' })).map(x => x.text).join('\n')
    expect(all).toContain('任務 1/2')
    expect(all).toContain('▶ B中')
    await ui.unmount()
  })
})

describe('對話內狀態卡（手機／網頁沒有側邊面板）', () => {
  test('/agent-status 在非全螢幕介面回傳狀態卡，輸出列畫成即時狀態卡', async ($, on) => {
    準備(on)
    on('tool.call', { tool: 'Bash' }, () => ({ deny: '測試用失敗' }))
    await $.turn.start({ text: '', turnId: 't4' })
    await $.tool.call({ tool: 'Bash', command: 'false', description: '故意失敗' })
    const ran = await $.command.run({ command: 'agent-status' } as CommandRunInput)
    expect(ran.text).toContain('喬巴急救中')
    expect(ran.text).toContain('❌ Bash｜故意失敗')
    for (const surface of ['mobile', 'desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({
        plugin: 'agent-status', surface, component: 'CommandOutput',
        props: { command: 'agent-status', args: '', text: ran.text ?? '', isErrored: false } as unknown as RenderPropsOf['CommandOutput'],
      })
      const all = (await ui.findAll({ type: 'Text' })).map(x => x.text).join('\n')
      expect(all).toContain('喬巴急救中')
      expect(all).toContain('🕘 最近步驟')
      await ui.unmount()
    }
  })
})
