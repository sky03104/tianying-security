// ================================================================
// 天鷹保全 哨表自動產生工具 - Google Apps Script
// 部署方式：
//   1. 開啟「哨表試算表」（GUARD_SS_ID，跟哨表上傳_GAS_v6.gs共用同一份試算表）
//      → 上方選單「擴充功能 → Apps Script」→ 貼上本檔完整程式碼
//   2. 部署 → 新增部署 → 類型「網頁應用程式」
//      執行身分：我（你的帳號）／誰可以存取：任何人
//   3. 複製 /exec 網址，填入 tool_guard_gen.html 的 GUARD_GEN_GAS_URL
//   4. 之後改程式碼一律「管理部署 → 編輯 → 新版本」，不可新增部署（網址會變）
//   5. 不需要 Drive API；只需要試算表存取權限（第一次執行會要求授權）
// ================================================================

// 哨表試算表：與 哨表上傳_GAS_v6.gs 的 GUARD_SS_ID 相同，本檔額外新增「哨點設定」分頁
var GUARD_SS_ID = '1sIcdAhw0mz5iM3F5fulDNPOda2pv-t7xUhT6XXf9X7Q';
var POST_CONFIG_SHEET_NAME = '哨點設定';

// 早/晚班月班表：與 天鷹保全APP_後端_GAS.gs 的 SCHEDULE_SHEETS_ 相同（獨立部署，各自維護一份常數）
var SCHEDULE_SHEETS_ = {
  early: { id: '1l8SoOVDQ4nO6qBkXcNEaBzct6AN82-H_0njbKNQauUQ', sheetName: '早班班表' },
  late:  { id: '1hIbgESfLitqC3W9DuSFGMWEuFZKJFKzK8srorQMuia8', sheetName: '晚班班表' }
};

// 排班代號：出現這些代號代表當天不用排班，回傳月班表時要排除
var OFF_CODES_ = ['休', '排休', '事', '病', '補', '離', '支', '-', '國例', ''];

var WEEKDAY_ZH_ = ['日', '一', '二', '三', '四', '五', '六'];

// ============================
// 入口
// ============================
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (!payload.empId) return respond({ status: 'error', msg: '工號遺失' });
    var action = payload.action;
    if (action === 'getGuardPostConfig')  return respond(getGuardPostConfig());
    if (action === 'saveGuardPostConfig') return respond(saveGuardPostConfig(payload.configs, payload.empId));
    if (action === 'getEmployeeNames')    return respond(getEmployeeNames());
    if (action === 'getMonthlyRoster')    return respond(getMonthlyRoster(payload.year, payload.month, payload.day));
    throw new Error('未知 action: ' + action);
  } catch (err) {
    return respond({ status: 'error', msg: err.message });
  }
}

function doGet(e) {
  return respond({ status: 'ok', msg: '天鷹保全 哨表自動產生 API 正常' });
}

// ============================
// 哨點設定（每位員工適任哨點）
// ============================
function getGuardPostConfigSheet_() {
  var ss = SpreadsheetApp.openById(GUARD_SS_ID);
  var sh = ss.getSheetByName(POST_CONFIG_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(POST_CONFIG_SHEET_NAME);
    sh.getRange(1, 1, 1, 3).setValues([['姓名', '適任哨點', '最後修改']])
      .setFontWeight('bold').setBackground('#1A2340').setFontColor('#D4A800');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 110);
    sh.setColumnWidth(2, 420);
    sh.setColumnWidth(3, 160);
  }
  return sh;
}

function getGuardPostConfig() {
  var sh = getGuardPostConfigSheet_();
  var lastRow = sh.getLastRow();
  var data = {};
  if (lastRow > 1) {
    var values = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      var name = String(values[i][0] || '').trim();
      if (!name) continue;
      var posts = String(values[i][1] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      data[name] = posts;
    }
  }
  return { status: 'ok', msg: '', data: data };
}

// configs: [{ name, posts:[...] }]，整份覆蓋寫入（管理員在前端一次全部勾完再儲存）
// 用 LockService 避免多個幹部同時編輯儲存時互相覆蓋（last-write-wins 的簡單防護）
function saveGuardPostConfig(configs, empId) {
  if (!configs || !configs.length) throw new Error('沒有收到設定資料');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getGuardPostConfigSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, 3).clearContent();
    var modifiedNote = (empId || '未知') + ' ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
    var rows = configs.map(function (c) {
      return [c.name, (c.posts || []).join(','), modifiedNote];
    });
    if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
    return { status: 'ok', msg: '已儲存 ' + rows.length + ' 位員工的哨點設定', data: null };
  } finally {
    lock.releaseLock();
  }
}

// ============================
// 員工名單（早/晚班月班表姓名欄，B欄，去重合併）
// ============================
function getEmployeeNames() {
  var names = {};
  ['early', 'late'].forEach(function (key) {
    var cfg = SCHEDULE_SHEETS_[key];
    var ss = SpreadsheetApp.openById(cfg.id);
    var sh = ss.getSheetByName(cfg.sheetName) || ss.getSheets()[0];
    var data = sh.getDataRange().getValues();
    for (var r = 0; r < data.length; r++) {
      var name = String(data[r][1] || '').trim();
      if (name && name !== '姓名' && name !== '日期') names[name] = true; // 跳過表頭列
    }
  });
  var list = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
  return { status: 'ok', msg: '', data: list };
}

function getDaysInMonth_(year, month) {
  return new Date(year, month, 0).getDate();
}

// ============================
// 當日在職名單（排除休假代號），供哨表自動分配使用
// 讀取邏輯照抄 天鷹保全APP_後端_GAS.gs 的 readEmployeeShiftsFromSheet_：
//   姓名在 data[r][1]，班別代號在 data[r][2+day-1]
//
// 2026-11-22 跨月修正：原本只看「幾號」、永遠讀線上班表，查下個月的日期會
// 拿到「這個月同一號」的代號，整份排錯人卻不會有任何提示。改成依 Z1 的月份
// 標記（班表管理 GAS 寫入，格式 yyyy/MM）找對應月份：
//   ① 線上班表就是那個月 → 讀線上
//   ② 否則找「{分頁名}_待生效」，月份對得上 → 讀待生效
//   ③ 都對不上 → 該班回傳空名單，data.missing=true，前端整天留空
// 例外：線上班表 Z1 是空的（還沒被新版班表管理寫過），且查的是本月 → 沿用線上（維持舊行為）
// 回應多帶 ymChecked:true，讓前端分辨「新版 GAS 已檢查過月份」還是「舊版沒檢查」。
// ============================
function getMonthlyRoster(year, month, day) {
  year = parseInt(year); month = parseInt(month); day = parseInt(day);
  if (!year || !month || !day) throw new Error('year/month/day 參數缺失');
  var maxDay = getDaysInMonth_(year, month);
  if (day < 1 || day > maxDay) throw new Error('日期超出範圍：' + year + '年' + month + '月只有' + maxDay + '天');

  var ym = year + '/' + (month < 10 ? '0' + month : String(month));
  var result = { early: [], late: [], missing: false, missingShifts: [], sources: {} };
  ['early', 'late'].forEach(function (key) {
    var cfg = SCHEDULE_SHEETS_[key];
    var ss = SpreadsheetApp.openById(cfg.id);
    var picked = pickRosterSheet_(ss, cfg.sheetName, ym);
    if (!picked) { result.missingShifts.push(key); return; }
    result.sources[key] = picked.source;
    var data = picked.sheet.getDataRange().getValues();
    var colIdx = 2 + day - 1; // data[r][2+day-1]
    for (var r = 0; r < data.length; r++) {
      var name = String(data[r][1] || '').trim();
      if (!name || name === '姓名' || name === '日期') continue; // 跳過表頭列
      var code = String(data[r][colIdx] || '').trim();
      if (!code || OFF_CODES_.indexOf(code) !== -1) continue;
      result[key].push({ name: name, code: code });
    }
  });
  // 咖哩 2026-11-22 決定：只要有一班找不到該月班表，整天都留空（不產生半份哨表）
  if (result.missingShifts.length) {
    result.missing = true;
    result.early = [];
    result.late = [];
  }

  var weekdayIdx = new Date(year, month - 1, day).getDay();
  return {
    status: 'ok',
    msg: result.missing ? (month + '月班表尚未上傳（線上與待生效都不是' + month + '月）' ) : '',
    data: result,
    ymChecked: true,
    weekday: WEEKDAY_ZH_[weekdayIdx]
  };
}

// 依月份挑分頁：線上 → 待生效 → 找不到回傳 null
function pickRosterSheet_(ss, sheetName, ym) {
  var live = ss.getSheetByName(sheetName) || ss.getSheets()[0];
  var liveYm = sheetYm_(live);
  if (liveYm === ym) return { sheet: live, source: 'live' };
  var staging = ss.getSheetByName(sheetName + '_待生效');
  if (staging && sheetYm_(staging) === ym) return { sheet: staging, source: 'staging' };
  if (!liveYm && ym === Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM')) return { sheet: live, source: 'live' };
  return null;
}

// 讀 Z1 月份標記，統一成 yyyy/MM（若被試算表自動轉成日期也能讀）
function sheetYm_(sh) {
  var v = sh.getRange('Z1').getValue();
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/MM');
  return String(v || '').trim();
}

// ============================
// 工具函式
// ============================
function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
