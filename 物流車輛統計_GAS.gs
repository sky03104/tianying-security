// ============================
// 物流車輛統計 — 獨立 GAS（天鷹保全）
// 綁定試算表：物流車輛統計（新建）
// 分頁：物流車輛紀錄
// 欄位：A紀錄ID | B日期 | C時間 | D分類 | E數量 | F登記人工號 | G登記人姓名 | H建立時間
// 主鍵：純數字流水號（既有最大ID+1；支援刪除列，故不可用列號產生，否則會重號）
// ============================

var SHEET_NAME = '物流車輛紀錄';
var CATEGORIES = ['1.9噸', '3.5噸', '8噸以上'];
var TZ = 'Asia/Taipei';

function doPost(e) {
  try {
    var action = e.parameter.action || '';
    if (action === 'add')         return addRecord(e);
    if (action === 'update')      return updateRecord(e);
    if (action === 'delete')      return deleteRecord(e);
    if (action === 'exportMonth') return exportMonth(e);
    return jsonRes({ status: 'error', msg: '未知動作: ' + action });
  } catch (err) {
    return jsonRes({ status: 'error', msg: err.toString() });
  }
}

function doGet(e) {
  try {
    var action = (e && e.parameter) ? (e.parameter.action || '') : '';
    if (action === 'getDay')   return getDay(e);
    if (action === 'getMonth') return getMonth(e);
    return jsonRes({ status: 'ok', msg: '天鷹保全 物流車輛統計 API 正常 ✓' });
  } catch (err) {
    return jsonRes({ status: 'error', msg: err.toString() });
  }
}

// 取得（或自動建立）紀錄分頁
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 8).setValues([[
      '紀錄ID', '日期', '時間', '分類', '數量', '登記人工號', '登記人姓名', '建立時間'
    ]]);
    sheet.getRange('F:F').setNumberFormat('@'); // 工號設純文字，避免開頭 0 被吃掉
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

// 以紀錄ID找列號（找不到回 -1）
function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// 新增登記：登記時間一律伺服器端「送出當下」
function addRecord(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var category = String(e.parameter.category || '').trim();
    if (CATEGORIES.indexOf(category) === -1) {
      return jsonRes({ status: 'error', msg: '分類無效: ' + category });
    }
    var count = parseInt(e.parameter.count, 10);
    if (isNaN(count) || count < 1 || count > 999) {
      return jsonRes({ status: 'error', msg: '數量無效（需 1~999）' });
    }
    var empId = String(e.parameter.empId || '').trim();
    var name  = String(e.parameter.name || '').trim();

    var sheet = getSheet_();
    var now = new Date();
    var id = nextId_(sheet);
    var row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, 8).setValues([[
      id,
      Utilities.formatDate(now, TZ, 'yyyy/M/d'),
      Utilities.formatDate(now, TZ, 'HH:mm:ss'),
      category,
      count,
      empId,
      name,
      now
    ]]);
    sheet.getRange(row, 6).setNumberFormat('@');                    // 工號純文字（保留開頭 0）
    sheet.getRange(row, 8).setNumberFormat('yyyy/M/d HH:mm:ss');
    return jsonRes({ status: 'ok', id: id });
  } finally {
    lock.releaseLock();
  }
}

// 修改數量
function updateRecord(e) {
  var sheet = getSheet_();
  var row = findRowById_(sheet, e.parameter.id);
  if (row < 0) return jsonRes({ status: 'error', msg: '找不到該筆紀錄' });
  var count = parseInt(e.parameter.count, 10);
  if (isNaN(count) || count < 1 || count > 999) {
    return jsonRes({ status: 'error', msg: '數量無效（需 1~999）' });
  }
  sheet.getRange(row, 5).setValue(count);
  return jsonRes({ status: 'ok' });
}

// 刪除紀錄
function deleteRecord(e) {
  var sheet = getSheet_();
  var row = findRowById_(sheet, e.parameter.id);
  if (row < 0) return jsonRes({ status: 'error', msg: '找不到該筆紀錄' });
  sheet.deleteRow(row);
  return jsonRes({ status: 'ok' });
}

// 讀單日：?action=getDay&date=YYYY-MM-DD → 逐筆 + 各分類合計
function getDay(e) {
  var key = dateKey_(e.parameter.date);
  if (!key) return jsonRes({ status: 'error', msg: '日期格式無效（需 YYYY-MM-DD）' });
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var rows = [];
  var totals = { '1.9噸': 0, '3.5噸': 0, '8噸以上': 0 };
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var i = 0; i < data.length; i++) {
      if (fmtDateVal_(data[i][1]) !== key) continue;
      var cat = String(data[i][3]);
      var cnt = parseInt(data[i][4], 10) || 0;
      rows.push({
        id: data[i][0],
        time: fmtTimeVal_(data[i][2]).substring(0, 5),
        category: cat,
        count: cnt,
        empId: String(data[i][5] || ''),
        name: String(data[i][6] || '')
      });
      if (totals.hasOwnProperty(cat)) totals[cat] += cnt;
    }
  }
  rows.reverse(); // 新的在前
  return jsonRes({ status: 'ok', date: key, rows: rows, totals: totals });
}

// 讀整月：?action=getMonth&month=YYYY-MM → 每日 × 三分類彙總
function getMonth(e) {
  var m = monthParts_(e.parameter.month);
  if (!m) return jsonRes({ status: 'error', msg: '月份格式無效（需 YYYY-MM）' });
  var agg = aggregateMonth_(m.year, m.month);
  return jsonRes({ status: 'ok', month: e.parameter.month, days: agg.days, totals: agg.totals });
}

// 產生試算表月統計分頁：action=exportMonth&month=YYYY-MM
function exportMonth(e) {
  var m = monthParts_(e.parameter.month);
  if (!m) return jsonRes({ status: 'error', msg: '月份格式無效（需 YYYY-MM）' });
  var agg = aggregateMonth_(m.year, m.month);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = e.parameter.month + ' 月統計';
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) sheet.clear(); else sheet = ss.insertSheet(sheetName);

  var out = [['日期', '1.9噸', '3.5噸', '8噸以上', '合計']];
  for (var i = 0; i < agg.days.length; i++) {
    var d = agg.days[i];
    out.push([m.month + '/' + d.day, d.t19, d.t35, d.t80, d.sum]);
  }
  out.push(['合計', agg.totals.t19, agg.totals.t35, agg.totals.t80, agg.totals.sum]);
  sheet.getRange(1, 1, out.length, 5).setValues(out);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  sheet.getRange(out.length, 1, 1, 5).setFontWeight('bold');
  return jsonRes({ status: 'ok', sheetName: sheetName });
}

// 整月彙總（含沒資料的日子，補 0 方便交報表）
function aggregateMonth_(year, month) {
  var daysInMonth = new Date(year, month, 0).getDate();
  var map = {};
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var prefix = year + '/' + month + '/';
    for (var i = 0; i < data.length; i++) {
      var dstr = fmtDateVal_(data[i][1]);
      if (dstr.indexOf(prefix) !== 0) continue;
      var day = parseInt(dstr.split('/')[2], 10);
      if (isNaN(day)) continue;
      if (!map[day]) map[day] = { t19: 0, t35: 0, t80: 0 };
      var cat = String(data[i][3]);
      var cnt = parseInt(data[i][4], 10) || 0;
      if (cat === '1.9噸') map[day].t19 += cnt;
      else if (cat === '3.5噸') map[day].t35 += cnt;
      else if (cat === '8噸以上') map[day].t80 += cnt;
    }
  }
  var days = [];
  var totals = { t19: 0, t35: 0, t80: 0, sum: 0 };
  for (var d = 1; d <= daysInMonth; d++) {
    var v = map[d] || { t19: 0, t35: 0, t80: 0 };
    var sum = v.t19 + v.t35 + v.t80;
    days.push({ day: d, t19: v.t19, t35: v.t35, t80: v.t80, sum: sum });
    totals.t19 += v.t19; totals.t35 += v.t35; totals.t80 += v.t80; totals.sum += sum;
  }
  return { days: days, totals: totals };
}

// ── 工具函數 ──

// 'YYYY-MM-DD' → 'yyyy/M/d'（與試算表儲存格式一致）
function dateKey_(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return '';
  var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
  return y + '/' + m + '/' + d;
}

// 'YYYY-MM' → {year, month}
function monthParts_(s) {
  var p = String(s || '').split('-');
  if (p.length !== 2) return null;
  var y = parseInt(p[0], 10), m = parseInt(p[1], 10);
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

// B欄日期：可能是 Date 或字串，統一成 'yyyy/M/d'
function fmtDateVal_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy/M/d');
  return String(v || '').trim();
}

// C欄時間：可能是 Date 或字串，統一成 'HH:mm:ss'
function fmtTimeVal_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm:ss');
  return String(v || '').trim();
}

function jsonRes(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
