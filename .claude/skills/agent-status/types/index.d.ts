// agent-status 的狀態契約：面板與狀態條讀取的值

/** agent 目前在做什麼（決定哪位角色出場） */
export type AgentStatusPhase =
  | 'idle'   // 待命
  | 'think'  // 模型思考中（沒有工具在跑）
  | 'run'    // 執行指令
  | 'read'   // 讀檔／搜尋／查網路
  | 'edit'   // 改檔
  | 'agent'  // 子代理出動
  | 'fail'   // 剛剛有步驟失敗
  | 'wait'   // 等使用者回覆
  | 'done'   // 本輪完成

/** 現在這一步 */
export type AgentStatusNow = {
  phase: AgentStatusPhase
  label: string
  /** 這一步開始的時間（毫秒） */
  since: number
}

/** 正在跑的工具呼叫（同時可能有好幾個） */
export type AgentStatusActive = {
  id: string
  phase: AgentStatusPhase
  label: string
  since: number
}

/** 最近完成的一步 */
export type AgentStatusStep = {
  tool: string
  label: string
  isOk: boolean
}

/** 任務清單中的一項 */
export type AgentStatusTodo = {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
}

declare module 'claude-code' {
  interface PluginState {
    'agent-status': {
      now: AgentStatusNow
      active: AgentStatusActive[]
      recent: AgentStatusStep[]
      todos: AgentStatusTodo[]
      /** 本輪開始時間（毫秒），0 代表沒有在跑 */
      turnSince: number
      /** 失敗動畫顯示到這個時間（毫秒） */
      failUntil: number
      /** 每秒遞增，用來重畫經過時間 */
      tick: number
    }
  }
}
