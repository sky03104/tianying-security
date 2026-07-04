// ============================================================================
// 航海日誌 GAS v2.0 - 工作流程追蹤 + 即時航跡系統
// ============================================================================
// 用途：記錄 APP 各工具使用情況，供 brain_map 即時人物可視化
// 試算表名稱：「航海日誌」
// 分頁：「工作日誌」（自動建立）
//
// v2.0 新增（2026-07-02）：
//   - getActive：回傳線上使用者 + 最近事件（CacheService 快取 10 秒）
//     不設閒置逾時，只認 logout/強制登出，呼應「記住我」持久登入
//   - checkKick：APP 輪詢「我有沒有被強制登出」（一次性）
//   - forceLogout：主管從 brain_map 強制登出某工號
//   - 讀取只掃尾端 600 列（不再整表掃描）
//   - cleanupOldRecords 改用整段 deleteRows（快 100 倍）
//   - LockService 防同時寫入
//
// Script Properties（選填）：
//   ADMIN_EMPIDS = 逗號分隔的主管工號（如 "1001,1002"）
//     設定後只有名單內工號能 forceLogout；不設定則不限制（建議要設）
// ============================================================================

// ── 工具 ↔ 節點 ↔ 角色映射 ──────────────────────────────────────────
const WORKFLOW_MAP = {
  'app':        { nodeId: 0,  role: '路飛' },      // 登入/登出（主控台）
  'schedule':   { nodeId: 8,  role: '娜美' },      // 班表查詢
  'work':       { nodeId: 11, role: '索隆' },      // 施工單
  'aiwork':     { nodeId: 11, role: '索隆' },      // 施工單（AI 助手開啟）
  'signin':     { nodeId: 11, role: '索隆' },      // 簽到
  'car':        { nodeId: 11, role: '索隆' },      // 車輛
  'closing':    { nodeId: 6,  role: '羅' },        // 打烊（夜晚甲板）
  'opening':    { nodeId: 5,  role: '香克斯' },    // 開店（日出甲板）
  'report':     { nodeId: 3,  role: '羅賓' },      // 事故報告
  'feedback':   { nodeId: 4,  role: '喬巴' },      // 表揚/反應
  'leave':      { nodeId: 12, role: '山治' },      // 請假
  'upload':     { nodeId: 10, role: '弗蘭奇' },    // 資料上傳
  'aichat':     { nodeId: 29, role: '布魯克' },    // AI 小助手
  'emergency':  { nodeId: 9,  role: '烏索普' },    // 緊急聯絡
  'post':       { nodeId: 7,  role: '甚平' },      // 明日哨表（舵輪室）
  'hailing':    { nodeId: 7,  role: '甚平' },      // 明日哨表（舊名相容）
  'logistics':  { nodeId: 37, role: '佩羅娜' },    // 物流車輛統計（原甚平身兼兩職，2026-07-03改派）
  'handover':   { nodeId: 135,role: '克比' },      // 帶班交接事項（2026-07-03新增，海軍紀律配交班回報）
};
// 2026-07-03 角色重新分配備註：13個前端工具擴編後，路飛/甚平原本各身兼兩職，
// 已改成每工具唯一角色；新增盟友 香克斯/羅/克比/佩羅娜（brain_map.html 圖檔待補）。

// ── 試算表初始化 ─────────────────────────────────────────────────────
function initializeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('工作日誌');

  if (!sheet) {
    sheet = ss.insertSheet('工作日誌', 0);
    sheet.appendRow([
      '時間戳記',      // A
      '工號',          // B
      '使用者名',      // C
      '工具名稱',      // D
      '地盤節點ID',    // E
      '執行者角色',    // F
      '動作類型',      // G
      '狀態',          // H
      '備註'           // I
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 9);
    headerRange.setBackground('#D4A800').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sheet;
}

// ── doPost：logTask / forceLogout ────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'logTask')     return handleLogTask(payload);
    if (action === 'forceLogout') return handleForceLogout(payload);

    return respond('error', '未知 action', null);
  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return respond('error', err.toString(), null);
  }
}

// ── 記錄工作活動 ─────────────────────────────────────────────────────
function handleLogTask(payload) {
  const { tool, empId, userName, actionType, status } = payload;

  if (!tool || !empId || !userName || !actionType) {
    return respond('error', '缺少必填欄位', null);
  }

  const workflow = WORKFLOW_MAP[tool];
  if (!workflow) {
    return respond('error', '未知工具: ' + tool, null);
  }

  appendLogRow_(empId, userName, tool, workflow, actionType, status || '已完成', '');

  const taskId = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '_' + empId + '_' + tool;
  return respond('ok', '活動記錄已儲存', { taskId: taskId });
}

// ── 強制登出：主管把某工號加入踢人名單 ───────────────────────────────
function handleForceLogout(payload) {
  const { targetEmpId, targetName, operatorEmpId, operatorName } = payload;
  if (!targetEmpId || !operatorEmpId) {
    return respond('error', '缺少 targetEmpId 或 operatorEmpId', null);
  }

  // 主管名單驗證（有設定 ADMIN_EMPIDS 才強制）
  const props = PropertiesService.getScriptProperties();
  const adminIds = (props.getProperty('ADMIN_EMPIDS') || '').split(',').map(function(s){ return s.trim(); }).filter(String);
  if (adminIds.length > 0 && adminIds.indexOf(String(operatorEmpId)) === -1) {
    return respond('error', '無強制登出權限（工號不在 ADMIN_EMPIDS 名單）', null);
  }

  // 加入踢人名單
  const kickList = JSON.parse(props.getProperty('KICK_LIST') || '{}');
  kickList[String(targetEmpId)] = Date.now();
  props.setProperty('KICK_LIST', JSON.stringify(kickList));

  // 寫一筆登出日誌（人物立即從地圖消失）＋備註留操作者（稽核）
  appendLogRow_(targetEmpId, targetName || '未知', 'app', WORKFLOW_MAP['app'], 'logout', '強制登出',
    '操作者: ' + operatorName + '(' + operatorEmpId + ')');

  // 清掉活躍名單快取，讓 brain_map 下次輪詢立即看到變化
  CacheService.getScriptCache().remove('active_v1');

  return respond('ok', '已加入強制登出名單，對方 APP 最慢 1 分鐘內登出', null);
}

// ── doGet：recent / getActive / checkKick ───────────────────────────
function doGet(e) {
  try {
    const mode = e.parameter.mode || 'recent';

    if (mode === 'getActive') return handleGetActive(e);
    if (mode === 'checkKick') return handleCheckKick(e);

    // ── 舊有 recent / nodeId / role 查詢 ──
    const records = readRecentRows_(600);

    let filtered = records;
    if (mode === 'recent') {
      const hours = parseInt(e.parameter.hours) || 24;
      const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
      filtered = records.filter(function(r){ return new Date(r.timestamp).getTime() > cutoffTime; });
    } else if (mode === 'nodeId') {
      const nodeId = parseInt(e.parameter.id);
      filtered = records.filter(function(r){ return r.nodeId === nodeId; });
    } else if (mode === 'role') {
      const role = e.parameter.role;
      filtered = records.filter(function(r){ return r.role === role; });
    }

    filtered.reverse(); // 最新在前
    return respond('ok', '找到 ' + filtered.length + ' 筆記錄', filtered);

  } catch (err) {
    Logger.log('doGet error: ' + err.toString());
    return respond('error', err.toString(), null);
  }
}

// ── 線上使用者 + 最近事件（brain_map 每 10 秒輪詢）────────────────────
// 注意：不設閒置逾時。是否顯示為「線上」只看最後一筆事件是不是 logout，
// 呼應登入頁「記住我」= 持久登入 —— 只要沒按登出、沒被強制登出，
// 就算閒置再久也該一直算在線上，不能被自動判離線。
function handleGetActive(e) {
  // CacheService 快取 10 秒：多個觀看者共用同一份答案，不重複翻試算表
  const cache = CacheService.getScriptCache();
  const cached = cache.get('active_v1');
  if (cached) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }

  const records = readRecentRows_(600); // 時間舊→新排列，不做時間篩選

  // 每個工號取「最後一筆事件」；最後一筆是 logout 就視為離線
  const latest = {};
  records.forEach(function(r){ latest[String(r.empId)] = r; });

  const users = [];
  Object.keys(latest).forEach(function(empId){
    const r = latest[empId];
    if (r.actionType === 'logout') return; // 已登出，不顯示
    users.push({
      empId: empId, userName: r.userName, tool: r.tool,
      nodeId: r.nodeId, actionType: r.actionType,
      status: r.status, timestamp: r.timestamp
    });
  });

  const body = JSON.stringify({
    status: 'ok', msg: '線上 ' + users.length + ' 人',
    data: { users: users, events: records },
    timestamp: new Date().toISOString()
  });
  cache.put('active_v1', body, 10); // 快取 10 秒
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// ── 被踢檢查（APP 每 60 秒輪詢，一次性）──────────────────────────────
function handleCheckKick(e) {
  const empId = String(e.parameter.empId || '');
  if (!empId) return respond('error', '缺少 empId', null);

  const props = PropertiesService.getScriptProperties();
  const kickList = JSON.parse(props.getProperty('KICK_LIST') || '{}');

  if (kickList[empId]) {
    delete kickList[empId]; // 一次性：送達即移除
    props.setProperty('KICK_LIST', JSON.stringify(kickList));
    return respond('ok', '你已被管理員登出', { kicked: true });
  }
  return respond('ok', '', { kicked: false });
}

// ── 共用：寫一列日誌（LockService 防同時寫入）────────────────────────
function appendLogRow_(empId, userName, tool, workflow, actionType, status, note) {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(3000);
  try {
    const sheet = initializeSheet();
    sheet.appendRow([
      new Date().toISOString(), // A - 時間戳記
      empId,                    // B - 工號
      userName,                 // C - 使用者名
      tool,                     // D - 工具名稱
      workflow.nodeId,          // E - 地盤節點ID
      workflow.role,            // F - 執行者角色
      actionType,               // G - 動作類型（login/logout/open/view/submit…）
      status,                   // H - 狀態
      note || ''                // I - 備註
    ]);
  } finally {
    if (got) lock.releaseLock();
  }
}

// ── 共用：只讀尾端 N 列（避免整表掃描）───────────────────────────────
function readRecentRows_(maxRows) {
  const sheet = initializeSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const startRow = Math.max(2, lastRow - maxRows + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 9).getValues();

  const records = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue; // 跳過空列
    records.push({
      timestamp: data[i][0] instanceof Date ? data[i][0].toISOString() : String(data[i][0]),
      empId: data[i][1],
      userName: data[i][2],
      tool: data[i][3],
      nodeId: parseInt(data[i][4]),
      role: data[i][5],
      actionType: data[i][6],
      status: data[i][7],
      note: data[i][8]
    });
  }
  return records; // 時間舊→新（試算表本身按寫入順序）
}

// ── 清理舊紀錄（每天觸發器執行；只留 30 天）──────────────────────────
function cleanupOldRecords() {
  try {
    const sheet = initializeSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const timestamps = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    // 日誌按時間順序寫入 → 過期的是「開頭連續一段」，一次整段刪除
    let expiredCount = 0;
    for (let i = 0; i < timestamps.length; i++) {
      if (new Date(timestamps[i][0]).getTime() < cutoff) expiredCount++;
      else break;
    }

    if (expiredCount > 0) {
      sheet.deleteRows(2, expiredCount);
      Logger.log('已刪除 ' + expiredCount + ' 筆 30 天前的舊記錄');
    }
  } catch (err) {
    Logger.log('cleanupOldRecords error: ' + err.toString());
  }
}

// ── 統一回應格式 ──────────────────────────────────────────────────────
function respond(status, msg, data) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: status,
      msg: msg,
      data: data || null,
      timestamp: new Date().toISOString()
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ── 測試函數（在 GAS 編輯器手動執行）─────────────────────────────────
function testLogTask() {
  const e = { postData: { contents: JSON.stringify({
    action: 'logTask', tool: 'schedule', empId: '12345',
    userName: '王小明', actionType: 'view', status: '已完成'
  }) } };
  Logger.log(doPost(e).getContent());
}

function testGetActive() {
  const e = { parameter: { mode: 'getActive' } };
  Logger.log(doGet(e).getContent());
}

function testForceLogoutAndKick() {
  const e1 = { postData: { contents: JSON.stringify({
    action: 'forceLogout', targetEmpId: '12345', targetName: '王小明',
    operatorEmpId: '1001', operatorName: '咖哩'
  }) } };
  Logger.log(doPost(e1).getContent());
  const e2 = { parameter: { mode: 'checkKick', empId: '12345' } };
  Logger.log(doGet(e2).getContent()); // 第一次 kicked:true
  Logger.log(doGet(e2).getContent()); // 第二次 kicked:false（一次性）
}
