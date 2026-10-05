// 純邏輯：工具 → 角色狀態、標籤文字、任務清單、SVG 舞台（可單獨測試）
import { SPRITES } from './sprites'
import type { AgentStatusPhase, AgentStatusTodo } from '../types'

/** 每個狀態由哪位角色出場、是否原地跑步、標題文字、框線顏色 */
export const CAST: Record<AgentStatusPhase, { sprite: string; isMoving: boolean; title: string; color: string }> = {
  run:   { sprite: 'luffy',   isMoving: true,  title: '🏃 路飛衝刺中：執行指令', color: '#FFD700' },
  read:  { sprite: 'robin',   isMoving: true,  title: '📖 羅賓查資料中',         color: '#818CF8' },
  edit:  { sprite: 'franky',  isMoving: true,  title: '🔨 弗蘭奇改造中：改檔案', color: '#FB923C' },
  agent: { sprite: 'zoro',    isMoving: true,  title: '⚔️ 索隆帶隊：子代理出動', color: '#4ADE80' },
  fail:  { sprite: 'chopper', isMoving: true,  title: '💥 喬巴急救中：剛剛有步驟失敗', color: '#F87171' },
  think: { sprite: 'nami',    isMoving: true,  title: '🧭 娜美看航海圖：思考中', color: '#F0C040' },
  wait:  { sprite: 'usopp',   isMoving: false, title: '❓ 烏索普在等你回覆',     color: '#FB923C' },
  done:  { sprite: 'luffy',   isMoving: false, title: '🎉 任務完成',             color: '#4ADE80' },
  idle:  { sprite: 'nami',    isMoving: false, title: '💤 待命中',               color: '#6B7280' },
}

/** 工具名稱 → 狀態 */
export function phaseOf(tool: string, agentId?: string): AgentStatusPhase {
  if (agentId) return 'agent'
  switch (tool) {
    case 'Read': case 'Grep': case 'Glob': case 'WebFetch': case 'WebSearch':
    case 'ToolSearch': case 'TaskGet': case 'TaskList':
      return 'read'
    case 'Edit': case 'Write': case 'NotebookEdit':
      return 'edit'
    case 'Agent': case 'Workflow': case 'SendMessage':
      return 'agent'
    case 'AskUserQuestion': case 'ExitPlanMode':
      return 'wait'
    default:
      return 'run'
  }
}

/** 任務清單類工具：只更新清單，不換角色 */
export function isTodoTool(tool: string): boolean {
  return tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate'
}

const 截斷 = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const 檔名 = (p: string) => p.split('/').pop() || p

/** 一次工具呼叫的白話說明 */
export function labelOf(input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const tool = String(input['tool'] ?? '')
  let text: string
  switch (tool) {
    case 'Bash': text = s('description') || s('command').split('\n')[0] || ''; break
    case 'Read': text = `讀 ${檔名(s('file_path'))}`; break
    case 'Edit': case 'Write': text = `改 ${檔名(s('file_path'))}`; break
    case 'NotebookEdit': text = `改 ${檔名(s('notebook_path'))}`; break
    case 'Grep': text = `搜尋「${s('pattern')}」`; break
    case 'Glob': text = `找檔案 ${s('pattern')}`; break
    case 'WebSearch': text = `查網路「${s('query')}」`; break
    case 'WebFetch': text = `讀網頁 ${s('url').replace(/^https?:\/\//, '').split('/')[0]}`; break
    case 'Agent': text = s('description') || s('subagent_type') || '子代理'; break
    case 'AskUserQuestion': text = '等你回答問題'; break
    default: text = tool.startsWith('mcp__') ? tool.split('__').slice(1).join('・') : tool
  }
  return 截斷(text || tool)
}

/** 依 TodoWrite 的內容整份換掉清單 */
export function todosFromTodoWrite(todos: ReadonlyArray<{ content: string; status: string; activeForm?: string }>): AgentStatusTodo[] {
  return todos.map((t, i) => ({
    id: `w${i}`,
    title: t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content,
    status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
  }))
}

/** 從 TaskCreate 的回傳文字抓出任務編號（抓不到就用流水號） */
export function taskIdFrom(text: string | undefined, fallback: string): string {
  const m = /#(\d+)/.exec(text ?? '') ?? /\btask[ _-]?(?:id)?[:\s]*([A-Za-z0-9_-]+)/i.exec(text ?? '')
  return m?.[1] ?? fallback
}

/** 毫秒 → 「1:05」「1:02:03」 */
export function elapsed(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 任務進度條「▰▰▰▱▱」 */
export function bar(done: number, total: number, width = 10): string {
  if (total <= 0) return ''
  const n = Math.round((done / total) * width)
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}

/** 一個角色的跑步序列幀（SMIL 逐格切換） */
function spriteSvg(name: string, x: number, y: number, scale: number, isMoving: boolean, dur = 0.66): string {
  const sp = SPRITES[name]
  if (!sp) return ''
  const w = sp.w, h = sp.h
  const steps = Array.from({ length: sp.n }, (_, i) => `${-i * w} 0`).join(';')
  const anim = isMoving
    ? `<animateTransform attributeName="transform" type="translate" values="${steps}" calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/>`
    : ''
  return `<svg x="${x}" y="${y}" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" overflow="hidden">`
    + `<image href="data:image/png;base64,${sp.b64}" width="${w * sp.n}" height="${h}" style="image-rendering:pixelated">${anim}</image></svg>`
}

/** 各狀態的特效（SMIL 動畫） */
function effects(phase: AgentStatusPhase, cx: number, W: number): string {
  const 浮動 = (txt: string, x: number, y: number, size = 22) =>
    `<text x="${x}" y="${y}" font-size="${size}">${txt}<animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="1.2s" repeatCount="indefinite"/></text>`
  switch (phase) {
    case 'run':
      // 速度線
      return [0, 1, 2].map(i =>
        `<line x1="${cx - 70}" y1="${50 + i * 14}" x2="${cx - 40}" y2="${50 + i * 14}" stroke="#FFD700" stroke-width="2" stroke-linecap="round" opacity="0">`
        + `<animate attributeName="opacity" values="0;.8;0" dur=".5s" begin="${i * 0.15}s" repeatCount="indefinite"/>`
        + `<animateTransform attributeName="transform" type="translate" values="0 0;-30 0" dur=".5s" begin="${i * 0.15}s" repeatCount="indefinite"/></line>`).join('')
    case 'read':
      return 浮動('🔍', cx + 50, 40)
    case 'edit':
      return `<text x="${cx + 48}" y="44" font-size="22">🔨<animateTransform attributeName="transform" type="rotate" values="0 ${cx + 60} 36;-30 ${cx + 60} 36;0 ${cx + 60} 36" dur=".4s" repeatCount="indefinite"/></text>`
        + `<text x="${cx + 70}" y="60" font-size="12" fill="#FFD700">✦<animate attributeName="opacity" values="0;1;0" dur=".4s" repeatCount="indefinite"/></text>`
    case 'fail':
      return `<text x="${cx + 44}" y="44" font-size="26">💥<animate attributeName="opacity" values="1;.3;1" dur=".6s" repeatCount="indefinite"/></text>`
    case 'think':
      return 浮動('💭', cx + 46, 38)
    case 'wait':
      return `<text x="${cx + 40}" y="36" font-size="26" fill="#FB923C" font-weight="bold">？<animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur=".8s" repeatCount="indefinite"/></text>`
    case 'done':
      return Array.from({ length: 12 }, (_, i) => {
        const x = 20 + ((i * 53) % (W - 40))
        const c = ['#FFD700', '#4ADE80', '#818CF8', '#F87171'][i % 4]
        return `<rect x="${x}" y="-10" width="5" height="8" fill="${c}"><animateTransform attributeName="transform" type="translate" values="0 0;${(i % 3) * 6 - 6} 130" dur="${1.4 + (i % 5) * 0.2}s" begin="${(i % 6) * 0.25}s" repeatCount="indefinite"/></rect>`
      }).join('') + `<text x="${cx + 44}" y="40" font-size="24">🎉</text>`
    case 'idle':
      return ['z', 'Z', 'Z'].map((z, i) =>
        `<text x="${cx + 36 + i * 10}" y="${44 - i * 10}" font-size="${12 + i * 4}" fill="#9CA3AF" opacity="0">${z}`
        + `<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="${i * 0.6}s" repeatCount="indefinite"/></text>`).join('')
    default:
      return ''
  }
}

/** 面板的動畫舞台 */
export function stageSvg(phase: AgentStatusPhase, W = 320, H = 120): string {
  const cast = CAST[phase]
  const sp = SPRITES[cast.sprite]
  const scale = phase === 'run' || phase === 'done' ? 0.9 : 1
  const cw = (sp?.w ?? 60) * scale, ch = (sp?.h ?? 80) * scale
  const cx = W / 2
  const ground = H - 14
  // 地面虛線往左捲動＝角色在前進
  const groundAnim = cast.isMoving
    ? `<animate attributeName="stroke-dashoffset" values="0;24" dur=".35s" repeatCount="indefinite"/>`
    : ''
  // 失敗時角色左右抖動
  const shake = phase === 'fail'
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;-3 0;3 0;0 0" dur=".25s" repeatCount="indefinite"/>`
    : ''
  // 子代理：索隆後面跟一隻小喬巴
  const buddy = phase === 'agent' ? spriteSvg('chopper', cx - cw / 2 - 52, ground - 48, 0.6, true, 0.5) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Microsoft JhengHei','Noto Sans TC',sans-serif">`
    + `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="#0D0F14" stroke="${cast.color}" stroke-opacity=".7" stroke-width="2">`
    + (phase === 'fail' ? `<animate attributeName="stroke-opacity" values=".9;.2;.9" dur=".8s" repeatCount="indefinite"/>` : '')
    + `</rect>`
    + `<line x1="12" y1="${ground}" x2="${W - 12}" y2="${ground}" stroke="${cast.color}" stroke-opacity=".45" stroke-width="2" stroke-dasharray="10 14">${groundAnim}</line>`
    + buddy
    + `<g>${shake}${spriteSvg(cast.sprite, cx - cw / 2, ground - ch, scale, cast.isMoving)}</g>`
    + effects(phase, cx, W)
    + `</svg>`
}

/** 狀態條用的小角色 */
export function miniSvg(phase: AgentStatusPhase, H = 40): string {
  const cast = CAST[phase]
  const sp = SPRITES[cast.sprite]
  const scale = H / (sp?.h ?? 80)
  const W = Math.round((sp?.w ?? 60) * scale)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + spriteSvg(cast.sprite, 0, 0, scale, cast.isMoving) + `</svg>`
}
