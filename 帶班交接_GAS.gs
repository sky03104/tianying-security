// ============================
// 帶班幹部交接事項 — 獨立 GAS（天鷹保全）
// 綁定試算表：帶班交接事項（新建）
// 分頁：交接事項（主資料）
// 欄位：A事項ID | B事項內容 | C狀態 | D建立人工號 | E建立人姓名 | F建立時間 | G最後修改人工號 | H最後修改人姓名 | I最後修改時間
// 主鍵：純數字流水號（既有最大ID+1；支援刪除列，故不可用列號產生，否則會重號）
// 權限：組長以上（leader/vicecaptain/captain/executive/admin），前端 index.html DEFAULT_PERMS + 工具內 checkRole() 雙層把關
// ============================

var SHEET_NAME = '交接事項';
var STATUSES = ['未完成', '進行中', '已完成'];
var TZ = 'Asia/Taipei';

function doPost(e) {
  try {
    var action = e.parameter.action || '';
    if (action === 'add')    return addItem(e);
    if (action === 'update') return updateItem(e);
    if (action === 'delete') return deleteItem(e);
    return jsonRes({ status: 'error', msg: '未知動作: ' + action });
  } catch (err) {
    return jsonRes({ status: 'error', msg: err.toString() });
  }
}

function doGet(e) {
  try {
    var action = (e && e.parameter) ? (e.parameter.action || '') : '';
    if (action === 'getAll') return getAll();
    return jsonRes({ status: 'ok', msg: '天鷹保全 帶班交接事項 API 正常 ✓' });
  } catch (err) {
    return jsonRes({ status: 'error', msg: err.toString() });
  }
}

// 取得（或自動建立）交接事項分頁
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 9).setValues([[
      '事項ID', '事項內容', '狀態', '建立人工號', '建立人姓名', '建立時間', '最後修改人工號', '最後修改人姓名', '最後修改時間'
    ]]);
    sheet.getRange('D:D').setNumberFormat('@'); // 工號設純文字，避免開頭 0 被吃掉
    sheet.getRange('G:G').setNumberFormat('@');
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

// 以事項ID找列號（找不到回 -1）
function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// 新增交接事項：狀態預設「未完成」，建立時間伺服器端「送出當下」
function addItem(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var content = String(e.parameter.content || '').trim();
    if (!content) return jsonRes({ status: 'error', msg: '事項內容不可空白' });
    var empId = String(e.parameter.empId || '').trim();
    var name  = String(e.parameter.name || '').trim();

    var sheet = getSheet_();
    var now = new Date();
    var id = nextId_(sheet);
    var row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, 9).setValues([[
      id, content, '未完成', empId, name, now, empId, name, now
    ]]);
    sheet.getRange(row, 4).setNumberFormat('@'); // 建立人工號純文字
    sheet.getRange(row, 7).setNumberFormat('@'); // 最後修改人工號純文字
    sheet.getRange(row, 6).setNumberFormat('yyyy/M/d HH:mm:ss');
    sheet.getRange(row, 9).setNumberFormat('yyyy/M/d HH:mm:ss');
    return jsonRes({ status: 'ok', id: id });
  } finally {
    lock.releaseLock();
  }
}

// 編輯事項：可改內容 and/or 狀態，兩者皆更新「最後修改人/時間」
function updateItem(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var row = findRowById_(sheet, e.parameter.id);
    if (row < 0) return jsonRes({ status: 'error', msg: '找不到該筆事項' });

    var content = e.parameter.content;
    var status  = e.parameter.status;
    if (content !== undefined) {
      content = String(content).trim();
      if (!content) return jsonRes({ status: 'error', msg: '事項內容不可空白' });
      sheet.getRange(row, 2).setValue(content);
    }
    if (status !== undefined) {
      status = String(status).trim();
      if (STATUSES.indexOf(status) === -1) return jsonRes({ status: 'error', msg: '狀態無效: ' + status });
      sheet.getRange(row, 3).setValue(status);
    }

    var empId = String(e.parameter.empId || '').trim();
    var name  = String(e.parameter.name || '').trim();
    var now = new Date();
    sheet.getRange(row, 7, 1, 3).setValues([[empId, name, now]]);
    sheet.getRange(row, 7).setNumberFormat('@');
    sheet.getRange(row, 9).setNumberFormat('yyyy/M/d HH:mm:ss');
    return jsonRes({ status: 'ok' });
  } finally {
    lock.releaseLock();
  }
}

// 刪除事項
function deleteItem(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var row = findRowById_(sheet, e.parameter.id);
    if (row < 0) return jsonRes({ status: 'error', msg: '找不到該筆事項' });
    sheet.deleteRow(row);
    return jsonRes({ status: 'ok' });
  } finally {
    lock.releaseLock();
  }
}

// 讀全部事項，新的在前
function getAll() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var items = [];
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    for (var i = 0; i < data.length; i++) {
      items.push({
        id: data[i][0],
        content: String(data[i][1] || ''),
        status: String(data[i][2] || '未完成'),
        creatorEmpId: String(data[i][3] || ''),
        creatorName: String(data[i][4] || ''),
        createTime: fmtDateTime_(data[i][5]),
        editorEmpId: String(data[i][6] || ''),
        editorName: String(data[i][7] || ''),
        editTime: fmtDateTime_(data[i][8])
      });
    }
  }
  items.reverse();
  return jsonRes({ status: 'ok', items: items });
}

// 判斷是否為日期物件：GAS 某些執行環境 instanceof Date 會誤判 false（跨 realm 問題），
// 一律用 Object.prototype.toString 判斷才可靠
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function fmtDateTime_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'yyyy/M/d HH:mm');
  return String(v || '').trim();
}

function jsonRes(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
