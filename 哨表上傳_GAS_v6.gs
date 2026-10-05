// ================================================================
// 天鷹保全 哨表上傳工具 - Google Apps Script v7
// 目標試算表 ID：1sIcdAhw0mz5iM3F5fulDNPOda2pv-t7xUhT6XXf9X7Q
// 部署：執行身分=我、存取=所有人（不需要 Drive API）
// v7（2026-10-05）：支援提前上傳。後天以後的哨表先存進隱藏分頁
//   「_待生效_yyyy-MM-dd」，由主 App 後端每天 08:00 快照完今日哨表後，
//   自動把「明天」那份放進明日哨表（promotePendingPost_）。
//   寫到哪個分頁改由這裡依台北時間判斷，前端傳的 targetSheet 只當參考。
// ================================================================

var GUARD_SS_ID = '1sIcdAhw0mz5iM3F5fulDNPOda2pv-t7xUhT6XXf9X7Q';
var HOLIDAY_API = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/';
var HISTORY_SHEET_NAME = '歷史哨表';
var TODAY_SHEET_NAME    = '今日哨表';
var TOMORROW_SHEET_NAME = '明日哨表';
// 待生效分頁前綴——主 App 後端 POST_PENDING_PREFIX 必須一模一樣
var PENDING_PREFIX = '_待生效_';
var GUARD_TZ = 'Asia/Taipei';
// 主 App 後端每天 08:00 切換完寫的標記（試算表 DeveloperMetadata），值＝切換那天 'yyyy-MM-dd'
var SWITCH_META_KEY = 'postSwitchDate';
// 早/晚班完整哨位表格只到 N 欄（第14欄）；P欄以後是使用者自己在來源
// Excel 用來做下拉選單的選項清單，跟正式哨表無關，不應該寫進試算表
// （2026-07-13 使用者確認：P欄以後只是輔助選單來源，不用寫入）。
var GUARD_MAX_COLS = 14;

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.action === 'guardUpload')   return handleGuardUpload(payload);
    if (payload.action === 'listPending')   return respond({ success: true, pending: listPending_(SpreadsheetApp.openById(GUARD_SS_ID)) });
    if (payload.action === 'deletePending') return handleDeletePending(payload);
    throw new Error('未知 action');
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

function doGet(e) {
  return respond({ success: true, status: 'online' });
}

// ================================================================
// 寫入目標判斷（純函式，node 可單獨測；tool_upload.html 的 gdPlan 同規則）
//   fileStr/todayStr/tomorrowStr：'yyyy-MM-dd'
//   switched：今天 08:00 的「明日→今日」切換做完沒（見 isSwitchedToday_）
//   ・過去日期            → 只存歷史哨表
//   ・今天                → 今日哨表；切換前另寫明日哨表
//                           （切換會用明日哨表蓋今日哨表，不寫會被蓋回舊的）
//   ・明天，切換後         → 明日哨表
//   ・明天，切換前         → 待生效（今天切換完才放進明日哨表，
//                           若直接寫，切換時會被快照成今日哨表，日期就錯了）
//   ・後天以後            → 待生效（生效日前一天 08:00 放進明日哨表）
// ================================================================
function planGuardTargets_(fileStr, todayStr, tomorrowStr, switched) {
  var early = !switched;
  if (fileStr < todayStr) return { sheets: [], pending: false, label: '僅存歷史（過去日期）' };
  if (fileStr === todayStr) {
    return { sheets: early ? [TODAY_SHEET_NAME, TOMORROW_SHEET_NAME] : [TODAY_SHEET_NAME], pending: false, label: TODAY_SHEET_NAME };
  }
  if (fileStr === tomorrowStr && !early) return { sheets: [TOMORROW_SHEET_NAME], pending: false, label: TOMORROW_SHEET_NAME };
  var act = prevDayStr_(fileStr);
  return { sheets: [], pending: true, activateOn: act, label: '待生效（' + shortDate_(act) + ' 08:00 自動放入明日哨表）' };
}

// 今天的切換做完沒。觸發器 atHour(8) 實際在 08:00~09:00 間任一分鐘執行，
// 不能只看時鐘，所以讀主 App 後端切換完寫的標記：
//   ・有標記：標記＝今天 → 做完了；10 點還沒標記 → 視為排程沒跑成，照舊系統行為直接寫
//   ・完全沒標記（主 App 後端還沒更新到新版）：退回看時鐘，9 點後視為做完
function isSwitchedToday_(markerStr, todayStr, hour) {
  if (markerStr) return markerStr === todayStr || hour >= 10;
  return hour >= 9;
}
function readSwitchMarker_(ss) {
  try {
    var found = ss.createDeveloperMetadataFinder().withKey(SWITCH_META_KEY).find();
    return found.length ? String(found[0].getValue() || '') : '';
  } catch (e) { return ''; }
}

// 'yyyy-MM-dd' 的前一天（用 UTC 算，不受執行環境時區影響）
function prevDayStr_(dateStr) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] - 1));
  return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
}
function shortDate_(dateStr) {
  var p = dateStr.split('-');
  return (+p[1]) + '/' + (+p[2]);
}

// ================================================================
// 主流程
// ================================================================
function handleGuardUpload(payload) {
  var year        = parseInt(payload.year);
  var month       = parseInt(payload.month);
  var day         = parseInt(payload.day);
  var weekday     = payload.weekday;
  var rows        = payload.rows;
  var styles      = payload.styles;
  var merges      = payload.merges;
  var colWidths   = payload.colWidths;

  if (!rows || !rows.length) throw new Error('未收到資料，請重試');
  if (!year || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) throw new Error('哨表日期無法辨識');

  // 只保留早/晚班表格本身（A~N欄），下拉選單用的輔助欄位不寫進試算表；
  // 補齊成矩形（setValues 要求每列欄數一致）
  rows = padRows_(rows.map(function (row) { return (row || []).slice(0, GUARD_MAX_COLS); }));

  var now      = new Date();
  var fileStr  = year + '-' + p2(month) + '-' + p2(day);
  var todayStr = Utilities.formatDate(now, GUARD_TZ, 'yyyy-MM-dd');
  var tmrStr   = Utilities.formatDate(new Date(now.getTime() + 86400000), GUARD_TZ, 'yyyy-MM-dd');
  var hour     = Number(Utilities.formatDate(now, GUARD_TZ, 'H'));

  var isHoliday = checkIsHoliday(year, month, day);
  var tgtSs = SpreadsheetApp.openById(GUARD_SS_ID);
  var plan  = planGuardTargets_(fileStr, todayStr, tmrStr, isSwitchedToday_(readSwitchMarker_(tgtSs), todayStr, hour));

  // 排哨工具與上傳工具可能同時寫，歷史哨表的「先刪同日期再追加」不能交錯
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    for (var i = 0; i < plan.sheets.length; i++) {
      writeGuardSheet(tgtSs, plan.sheets[i], rows, styles, merges, colWidths);
    }
    if (plan.pending) writePendingSheet_(tgtSs, fileStr, rows);
    else deletePendingSheet_(tgtSs, fileStr); // 之前排過同一天的待生效，已直接寫入就清掉，避免 08:00 再蓋一次舊版
    updateHistorySheet(tgtSs, year, month, day, weekday, isHoliday, rows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return respond({
    success: true,
    targetSheet: plan.label,
    sheets: plan.sheets,
    pending: plan.pending,
    activateOn: plan.activateOn || '',
    isHoliday: isHoliday,
    date: year + '/' + p2(month) + '/' + p2(day) + ' 星期' + weekday
  });
}

// 取消某天的待生效哨表：刪掉待生效分頁＋歷史哨表該日紀錄（不然歷史還留著已取消的排班）
function handleDeletePending(payload) {
  var dateStr = String(payload.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('日期格式錯誤');
  var ss = SpreadsheetApp.openById(GUARD_SS_ID);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!deletePendingSheet_(ss, dateStr)) throw new Error('找不到 ' + dateStr + ' 的待生效哨表（可能已生效）');
    deleteHistoryRows_(ss.getSheetByName(HISTORY_SHEET_NAME), dateStr.replace(/-/g, '/'));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return respond({ success: true, pending: listPending_(ss) });
}

// ================================================================
// 待生效分頁（隱藏，一天一個，生效後由主 App 後端刪除）
// ================================================================
function writePendingSheet_(ss, dateStr, rows) {
  var name = PENDING_PREFIX + dateStr;
  var sh = ss.getSheetByName(name);
  if (sh) sh.clear();
  else { sh = ss.insertSheet(name); sh.hideSheet(); }
  var rng = sh.getRange(1, 1, rows.length, rows[0].length);
  // 先設純文字：原樣存起來，生效時讀出來寫進明日哨表才會跟直接上傳一模一樣
  rng.setNumberFormat('@');
  rng.setValues(rows);
}

function deletePendingSheet_(ss, dateStr) {
  var sh = ss.getSheetByName(PENDING_PREFIX + dateStr);
  if (!sh) return false;
  ss.deleteSheet(sh);
  return true;
}

function listPending_(ss) {
  var out = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf(PENDING_PREFIX) !== 0) continue;
    var d = name.slice(PENDING_PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    out.push({ date: d, activateOn: prevDayStr_(d) });
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return out;
}

function padRows_(rows) {
  var w = 1;
  for (var i = 0; i < rows.length; i++) if (rows[i].length > w) w = rows[i].length;
  return rows.map(function (r) {
    var c = r.slice();
    while (c.length < w) c.push('');
    return c;
  });
}

// ================================================================
// 寫入今日/明日哨表（只寫值，完全不動格式）
// ================================================================
function writeGuardSheet(tgtSs, sheetName, rows, styles, merges, colWidths) {
  var tgt = tgtSs.getSheetByName(sheetName);
  if (!tgt) {
    // 分頁不存在才新建（請在試算表手動設定好格式後再使用）
    tgt = tgtSs.insertSheet(sheetName);
  }

  var numRows = rows.length;
  var numCols = rows[0] ? rows[0].length : 1;

  // 僅寫入值，框線/顏色/合併格/欄寬全部不動
  tgt.getRange(1, 1, numRows, numCols).setValues(rows);
}

// ================================================================
// 歷史哨表（單一分頁，所有日期集中存放，純文字便於 App 查詢）
// 格式：日期 | 星期 | 假日 | 班別 | 哨位 | 姓名 | 時間
// ================================================================
function updateHistorySheet(tgtSs, year, month, day, weekday, isHoliday, rows) {
  var dateStr = year + '/' + p2(month) + '/' + p2(day);
  var hist = tgtSs.getSheetByName(HISTORY_SHEET_NAME);

  // 建立分頁（若不存在）
  if (!hist) {
    hist = tgtSs.insertSheet(HISTORY_SHEET_NAME);
    hist.getRange(1, 1, 1, 7).setValues([['日期', '星期', '假日', '班別', '哨位', '姓名', '時間']])
      .setFontWeight('bold').setBackground('#1A2340').setFontColor('#D4A800');
    hist.setFrozenRows(1);
    hist.setColumnWidth(1, 100); hist.setColumnWidth(2, 60);
    hist.setColumnWidth(3, 60);  hist.setColumnWidth(4, 90);
    hist.setColumnWidth(5, 130); hist.setColumnWidth(6, 90);
    hist.setColumnWidth(7, 110);
    // 強制整欄格式為純文字（避免日期自動轉換）
    hist.getRange('A:A').setNumberFormat('@');
  }

  // 刪除該日期的舊記錄（避免重複）
  deleteHistoryRows_(hist, dateStr);

  // 解析人員
  var records = [];
  var maxRow = rows.length;
  var holidayText = isHoliday ? '假日' : '平日';

  // 帶隊幹部（C3, L3 或 I3）
  if (rows[2]) {
    var el = pName(rows[2][2]);
    var nl = pName(rows[2][11]) || pName(rows[2][8]);
    if (el) records.push([dateStr, weekday, holidayText, '早班', '帶隊幹部', el.name, el.time]);
    if (nl) records.push([dateStr, weekday, holidayText, '晚班', '帶隊幹部', nl.name, nl.time]);
  }

  // 各哨位（列4起）
  for (var r = 3; r < maxRow; r++) {
    var row = rows[r];
    if (!row) continue;
    var ep = cText(row[1]); var ep2 = pName(row[2]);
    var eep = cText(row[4]); var eep2 = pName(row[5]);
    var np = cText(row[8]); var np2 = pName(row[9]);
    var nep = cText(row[12]); var nep2 = pName(row[13]);
    if (ep && ep2)   records.push([dateStr, weekday, holidayText, '早班', ep, ep2.name, ep2.time]);
    if (eep && eep2) records.push([dateStr, weekday, holidayText, '早班(增派)', eep, eep2.name, eep2.time]);
    if (np && np2)   records.push([dateStr, weekday, holidayText, '晚班', np, np2.name, np2.time]);
    if (nep && nep2) records.push([dateStr, weekday, holidayText, '晚班(增派)', nep, nep2.name, nep2.time]);
  }

  // 去重
  var seen = {}, filtered = [];
  for (var i = 0; i < records.length; i++) {
    if (!records[i][5]) continue;
    var key = records[i].join('|');
    if (!seen[key]) { seen[key] = true; filtered.push(records[i]); }
  }

  if (!filtered.length) return dateStr;

  // 追加到末尾
  var insertRow = hist.getLastRow() + 1;
  var dataRange = hist.getRange(insertRow, 1, filtered.length, 7);
  dataRange.setValues(filtered);
  // 強制 A 欄為純文字，避免日期被 Sheets 轉換
  hist.getRange(insertRow, 1, filtered.length, 1).setNumberFormat('@');

  // 上色
  for (var j = 0; j < filtered.length; j++) {
    var band = filtered[j][3];
    var rng  = hist.getRange(insertRow + j, 1, 1, 7);
    if      (band === '早班')       rng.setBackground('#E8F4FF').setFontColor('#1a1a2e');
    else if (band === '早班(增派)') rng.setBackground('#D0EAFF').setFontColor('#003366');
    else if (band === '晚班')       rng.setBackground('#1A1F2E').setFontColor('#D1D5DB');
    else if (band === '晚班(增派)') rng.setBackground('#0F1520').setFontColor('#A5B4FC');
  }

  return dateStr;
}

// 刪除歷史哨表中某日期（'yyyy/MM/dd'）的全部紀錄
function deleteHistoryRows_(hist, dateStr) {
  if (!hist) return;
  var lastRow = hist.getLastRow();
  if (lastRow <= 1) return;
  // 一次讀取所有 A 欄，避免多次讀取；用 displayValues 確保讀取到文字格式
  var dateCol = hist.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var toDelete = [];
  for (var i = dateCol.length - 1; i >= 0; i--) {
    if (String(dateCol[i][0]).trim() === dateStr) toDelete.push(i + 2); // 1-indexed，從第2列開始
  }
  // 從大到小刪（避免行號偏移）
  toDelete.sort(function(a, b){ return b - a; });
  for (var d = 0; d < toDelete.length; d++) hist.deleteRow(toDelete[d]);
}

// ================================================================
// 假日判定
// ================================================================
function checkIsHoliday(year, month, day) {
  try {
    var res = UrlFetchApp.fetch(HOLIDAY_API + year + '.json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return false;
    var data    = JSON.parse(res.getContentText());
    var dateStr = '' + year + p2(month) + p2(day);
    for (var i = 0; i < data.length; i++) {
      if (data[i].date === dateStr)
        return data[i].isHoliday === true || data[i].isHoliday === 'true';
    }
    return false;
  } catch(e) { return false; }
}

// ================================================================
// 工具函式
// ================================================================
function buildMatrix(rows, cols, val) {
  var arr = [];
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c = 0; c < cols; c++) row.push(val);
    arr.push(row);
  }
  return arr;
}

function p2(n)    { return n < 10 ? '0'+n : String(n); }
function cText(v) { return v ? String(v).replace(/\n/g,' ').replace(/\s+/g,' ').trim() : ''; }
function pName(v) {
  if (!v || !String(v).trim()) return null;
  var s = String(v).trim();
  if (s.indexOf('人員:')>-1 || s.indexOf('帶隊幹部 :')>-1 ||
      s==='早班' || s==='晚班' || s==='姓名' || s==='哨位') return null;
  var lines = s.split('\n');
  var name  = lines[0].replace(/^\s*帶隊幹部\s*[:：]\s*/,'').trim();
  var time  = lines.length > 1 ? lines[1].trim() : '';
  if (!name || name.length < 2) return null;
  return { name: name, time: time };
}
function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// node 測試用（GAS 環境沒有 module，不影響執行）
if (typeof module !== 'undefined') module.exports = { planGuardTargets_: planGuardTargets_, isSwitchedToday_: isSwitchedToday_, prevDayStr_: prevDayStr_, padRows_: padRows_ };
