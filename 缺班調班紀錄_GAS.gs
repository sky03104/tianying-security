// ============================
// 缺班時數/調補班紀錄 — 獨立 GAS（天鷹保全）
// 綁定試算表：缺班調班紀錄（新建，見部署說明）
// 分頁：紀錄（主資料，找不到會自動建立）
// 欄位：A ID | B 日期 | C 工號 | D 姓名 | E 時數(可正可負) | F 原因 | G 備註
//       | H 登記人工號 | I 登記人姓名 | J 登記時間
// 主鍵：純數字流水號（既有最大ID+1；支援刪除列，故不可用列號產生，否則會重號）
// 權限：隊長以上（captain/executive/admin），前端 index.html DEFAULT_PERMS +
//       tool_shift_adjust.html 前端把關 + 本檔每個 action 再驗一次 token+角色
//       （2026-07-26：緊急聯絡清單/事故與表揚兩支 GAS 都補過同樣的教訓，
//       這支從一開始就照同標準做，不要等出事才補）
//
// ── 部署 ──────────────────────────────────────────────────────
// 1. Google Drive 新建一份空白試算表，複製它的 ID
//    （網址 https://docs.google.com/spreadsheets/d/【這一段】/edit）
// 2. 把下面 SPREADSHEET_ID 換成剛剛複製的 ID
// 3. 部署 → 新增部署 → 類型「網路應用程式」，執行身分「我」，存取權限「所有人」
// 4. 複製部署網址，填入 tool_shift_adjust.html 的 SHIFT_GAS_URL 變數
// 5. 之後改動：部署 → 管理部署作業 → 編輯(鉛筆) → 版本「新版本」
//    （不要「新增部署」，網址會變，前端全斷）
// ============================

var SPREADSHEET_ID = '請填入試算表ID'; // ← 部署前務必替換
var SHEET_NAME = '紀錄';
var TZ = 'Asia/Taipei';

// 主 App（天鷹保全APP_後端_GAS.gs）部署網址，用來驗證登入通行證
var MAIN_APP_GAS_URL_ = 'https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec';

// 允許使用本工具的角色：隊長以上
var CAPTAIN_PLUS_ROLES_ = ['captain', 'executive', 'admin'];

/**
 * 驗證通行證，通過回傳 { empId, name, role, ... }，不通過回傳 null。
 * 通行證由主 App 登入時發放，這裡沒有簽章金鑰，直接請主 App 幫忙確認
 * （跟緊急聯絡清單/事故與表揚兩支 GAS 同做法）。
 */
function verifyAuthToken_(token) {
  if (!token) return null;
  try {
    var res = UrlFetchApp.fetch(MAIN_APP_GAS_URL_, {
      method: 'post',
      payload: { action: 'verifySession', data: JSON.stringify({ token: token }) },
      muteHttpExceptions: true
    });
    var d = JSON.parse(res.getContentText());
    if (d.status !== 'ok' || !d.user || !d.user.empId) return null;
    return d.user;
  } catch (err) {
    return null;
  }
}

// 驗證通行證＋角色需隊長以上，通過回傳使用者物件，不通過回傳 null（呼叫端自行包錯誤訊息）
function requireCaptainPlus_(token) {
  var user = verifyAuthToken_(token);
  if (!user) return null;
  if (CAPTAIN_PLUS_ROLES_.indexOf(user.role) === -1) return null;
  return user;
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || '';
    var d = {};
    try { d = JSON.parse(p.data || '{}'); } catch (err) { d = {}; }

    if (action === 'addRecord') return addRecord(d, p.token);
    if (action === 'updateRecord') return updateRecord(d, p.token);
    if (action === 'deleteRecord') return deleteRecord(d, p.token);
    return jsonRes({ status: 'error', msg: '未知動作: ' + action });
  } catch (err) {
    return jsonRes({ status: 'error', msg: err.toString() });
  }
}

function doGet(e) {
  try {
    var action = (e && e.parameter) ? (e.parameter.action || '') : '';
    if (action === 'getRecords') return getRecords(e.parameter.token);
    return jsonRes({ status: 'ok', msg: '天鷹保全 缺班時數/調補班紀錄 API 正常 ✓' });
  } catch (err) {
    return jsonRes({ status: 'error', msg: err.toString() });
  }
}

// 取得（或自動建立）紀錄分頁
function getSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 10).setValues([[
      'ID', '日期', '工號', '姓名', '時數', '原因', '備註', '登記人工號', '登記人姓名', '登記時間'
    ]]);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('C:C').setNumberFormat('@'); // 工號設純文字，避免開頭 0 被吃掉
    sheet.getRange('H:H').setNumberFormat('@');
  }
  return sheet;
}

// 主鍵：掃描既有最大ID+1
function nextId_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < ids.length; i++) {
    var n = parseInt(ids[i][0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

// 以 ID 找列號（找不到回 -1）
function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// 新增紀錄
function addRecord(d, token) {
  var user = requireCaptainPlus_(token);
  if (!user) return jsonRes({ status: 'error', msg: '登入已失效或權限不足（僅隊長以上可使用），請重新登入' });

  var date = String(d.date || '').trim();
  var empId = String(d.empId || '').trim();
  var name = String(d.name || '').trim();
  var hours = Number(d.hours);
  var reason = String(d.reason || '').trim();
  var note = String(d.note || '').trim();

  if (!date || !empId || !reason || isNaN(hours) || hours === 0) {
    return jsonRes({ status: 'error', msg: '日期、員工、時數、原因為必填，時數不可為 0' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var id = nextId_(sheet);
    var row = sheet.getLastRow() + 1;
    var now = new Date();
    sheet.getRange(row, 1, 1, 10).setValues([[
      id, date, empId, name, hours, reason, note, user.empId, user.name, now
    ]]);
    sheet.getRange(row, 3).setNumberFormat('@');
    sheet.getRange(row, 8).setNumberFormat('@');
    sheet.getRange(row, 10).setNumberFormat('yyyy/M/d HH:mm:ss');
    return jsonRes({ status: 'ok', id: id });
  } finally {
    lock.releaseLock();
  }
}

// 編輯紀錄：只改內容欄位（日期/工號/姓名/時數/原因/備註），
// 登記人工號/姓名/登記時間（H/I/J）維持原樣，不因編輯而改寫
function updateRecord(d, token) {
  var user = requireCaptainPlus_(token);
  if (!user) return jsonRes({ status: 'error', msg: '登入已失效或權限不足（僅隊長以上可使用），請重新登入' });

  var id = d.id;
  if (id === undefined || id === null || String(id).trim() === '') {
    return jsonRes({ status: 'error', msg: '缺少 id' });
  }

  var date = String(d.date || '').trim();
  var empId = String(d.empId || '').trim();
  var name = String(d.name || '').trim();
  var hours = Number(d.hours);
  var reason = String(d.reason || '').trim();
  var note = String(d.note || '').trim();

  if (!date || !empId || !reason || isNaN(hours) || hours === 0) {
    return jsonRes({ status: 'error', msg: '日期、員工、時數、原因為必填，時數不可為 0' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var row = findRowById_(sheet, id);
    if (row < 0) return jsonRes({ status: 'error', msg: '找不到該筆紀錄' });
    sheet.getRange(row, 2, 1, 6).setValues([[date, empId, name, hours, reason, note]]);
    sheet.getRange(row, 3).setNumberFormat('@');
    return jsonRes({ status: 'ok' });
  } finally {
    lock.releaseLock();
  }
}

// 刪除紀錄
function deleteRecord(d, token) {
  var user = requireCaptainPlus_(token);
  if (!user) return jsonRes({ status: 'error', msg: '登入已失效或權限不足（僅隊長以上可使用），請重新登入' });

  var id = d.id;
  if (id === undefined || id === null || String(id).trim() === '') {
    return jsonRes({ status: 'error', msg: '缺少 id' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var row = findRowById_(sheet, id);
    if (row < 0) return jsonRes({ status: 'error', msg: '找不到該筆紀錄' });
    sheet.deleteRow(row);
    return jsonRes({ status: 'ok' });
  } finally {
    lock.releaseLock();
  }
}

// 讀取全部紀錄（前端自行依月份篩選、彙總）
function getRecords(token) {
  var user = requireCaptainPlus_(token);
  if (!user) return jsonRes({ status: 'error', msg: '登入已失效或權限不足（僅隊長以上可使用），請重新登入' });

  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var records = [];
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      records.push({
        id: row[0],
        date: fmtDate_(row[1]),
        empId: String(row[2] || ''),
        name: String(row[3] || ''),
        hours: Number(row[4]) || 0,
        reason: String(row[5] || ''),
        note: String(row[6] || ''),
        createdByEmpId: String(row[7] || ''),
        createdByName: String(row[8] || ''),
        createdAt: fmtDateTime_(row[9])
      });
    }
  }
  return jsonRes({ status: 'ok', records: records });
}

// 判斷是否為日期物件：GAS 某些執行環境 instanceof Date 會誤判 false（跨 realm 問題），
// 一律用 Object.prototype.toString 判斷才可靠
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function fmtDate_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').trim();
}

function fmtDateTime_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'yyyy/M/d HH:mm');
  return String(v || '').trim();
}

function jsonRes(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
