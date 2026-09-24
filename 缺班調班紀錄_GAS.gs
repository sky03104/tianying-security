// ============================
// 缺班時數/調補班紀錄 — 獨立 GAS（天鷹保全）
// 綁定試算表：缺班調班紀錄（新建，見部署說明）
// 分頁：紀錄（主資料，找不到會自動建立）
// 欄位：A ID | B 日期 | C 工號 | D 姓名 | E 時數(可正可負) | F 原因 | G 備註
//       | H 登記人工號 | I 登記人姓名 | J 登記時間
// 主鍵：純數字流水號（既有最大ID+1；支援刪除列，故不可用列號產生，否則會重號）
// 權限：組長以上（leader/vicecaptain/captain/executive/admin），前端 index.html
//       DEFAULT_PERMS + tool_shift_adjust.html 前端把關 + 本檔每個 action 再驗一次
//       token+角色（2026-07-26：緊急聯絡清單/事故與表揚兩支 GAS 都補過同樣的教訓，
//       這支從一開始就照同標準做，不要等出事才補；2026-09-09：咖哩開放組長/副隊長）
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

// 主 App（天鷹保全APP_後端_GAS.gs）部署網址：本機驗證還沒設定好時的備援驗證管道
var MAIN_APP_GAS_URL_ = 'https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec';
// 主 App 的試算表（「帳號管理」分頁在這裡），本機驗證時用來查角色／停用狀態
var MAIN_APP_SHEET_ID_ = '1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU';

// 允許使用本工具的角色：組長以上（2026-09-09：咖哩開放給組長/副隊長，原本只有隊長以上）
var CAPTAIN_PLUS_ROLES_ = ['leader', 'vicecaptain', 'captain', 'executive', 'admin'];

// 驗證通過的結果快取幾秒（同一張通行證 5 分鐘內不用重驗；停用帳號最慢 5 分鐘後失效）
var AUTH_CACHE_SEC_ = 300;

/* ══════════════════════════════════════════════════════════════
   通行證驗證（2026-09-24 改版）
   舊版：每一次讀取／新增／修改都用 UrlFetchApp 去「問」主 App 的 GAS。
     ① 慢：等於每次都要多等一支 GAS 冷啟動＋讀帳號表，讀清單動輒多好幾秒
     ② 會誤判：主 App 那邊只要逾時／忙碌／回傳格式不對，這邊一律當成「登入已失效」，
        咖哩回報「有時候跳權限錯誤或未登入」就是這個
   新版：
     ① 本機驗證：跟事故與表揚 GAS 同一套（HMAC 簽章＋直接讀主 App 試算表的「帳號管理」），
        不再多打一支 GAS。需要把主 App 的 SESSION_SECRET 複製到本專案的指令碼屬性（見檔尾 forceAuth 說明）；
        沒設定時自動退回舊的「問主 App」方式，並且伺服器錯誤會重試一次
     ② 通過的結果快取 5 分鐘
     ③ 分清楚「通行證真的失效」跟「伺服器暫時出錯」，錯誤訊息不同，後者不叫人重新登入
   ══════════════════════════════════════════════════════════════ */
var lastAuthErr_ = '';  // 'INVALID'｜'SERVER'｜'ROLE'，給 authFailRes_() 產生對應訊息

function authCacheKey_(token) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token));
  return 'auth_' + Utilities.base64EncodeWebSafe(digest);
}

/** 位元組陣列轉16進位字串，需跟主App的 bytesToHex_ 逐位元組一致，簽章才對得起來 */
function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    out += (v.length === 1 ? '0' + v : v);
  }
  return out;
}

/** 本機驗證。回傳 { user } 或 { err:'INVALID'|'SERVER' }；沒設定 SESSION_SECRET 時回 null（交給備援） */
function verifyLocal_(token) {
  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  if (!secret) return null;

  var parts = String(token).split('.');
  if (parts.length !== 2) return { err: 'INVALID' };
  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (e) { return { err: 'INVALID' }; }
  if (bytesToHex_(Utilities.computeHmacSha256Signature(payload, secret)) !== parts[1]) return { err: 'INVALID' };

  var seg = payload.split('|');
  if (seg.length !== 2) return { err: 'INVALID' };
  var empId = seg[0], expireMs = Number(seg[1]);
  if (!empId || !expireMs || new Date().getTime() > expireMs) return { err: 'INVALID' };

  try {
    var sh = SpreadsheetApp.openById(MAIN_APP_SHEET_ID_).getSheetByName('帳號管理');
    if (!sh) return { err: 'SERVER' };
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]).trim() !== String(empId).trim()) continue;
      if (String(data[r][5] || 'active') === 'inactive') return { err: 'INVALID' };
      return { user: { empId: String(empId).trim(), name: String(data[r][1]), role: String(data[r][3]) } };
    }
    return { err: 'INVALID' };
  } catch (e) {
    return { err: 'SERVER' };
  }
}

/** 備援：問主 App。回傳 { user } 或 { err:'INVALID'|'SERVER' } */
function verifyRemote_(token) {
  try {
    var res = UrlFetchApp.fetch(MAIN_APP_GAS_URL_, {
      method: 'post',
      payload: { action: 'verifySession', data: JSON.stringify({ token: token }) },
      muteHttpExceptions: true
    });
    var d = JSON.parse(res.getContentText());
    if (d.status === 'ok' && d.user && d.user.empId) return { user: d.user };
    // 主 App 新版會回 code；舊版只回「登入已失效」字樣
    if (d.code === 'INVALID' || (!d.code && /登入已失效/.test(d.msg || ''))) return { err: 'INVALID' };
    return { err: 'SERVER' };
  } catch (err) {
    return { err: 'SERVER' };   // 逾時／回傳不是 JSON（例如 Google 的錯誤頁）
  }
}

/** 驗證通行證，通過回傳 { empId, name, role, ... }，不通過回傳 null（原因記在 lastAuthErr_） */
function verifyAuthToken_(token) {
  lastAuthErr_ = 'INVALID';
  if (!token) return null;

  var cache = CacheService.getScriptCache();
  var key = authCacheKey_(token);
  var hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  var r = verifyLocal_(token);
  if (r === null) {
    r = verifyRemote_(token);
    if (r.err === 'SERVER') { Utilities.sleep(800); r = verifyRemote_(token); } // 伺服器錯誤重試一次
  }
  if (!r.user) { lastAuthErr_ = r.err; return null; }

  try { cache.put(key, JSON.stringify(r.user), AUTH_CACHE_SEC_); } catch (e) {}
  return r.user;
}

// 驗證通行證＋角色需組長以上，通過回傳使用者物件，不通過回傳 null（呼叫端用 authFailRes_() 回錯誤）
function requireCaptainPlus_(token) {
  var user = verifyAuthToken_(token);
  if (!user) return null;
  if (CAPTAIN_PLUS_ROLES_.indexOf(user.role) === -1) { lastAuthErr_ = 'ROLE'; return null; }
  return user;
}

// 依失敗原因回不同訊息；code 給前端判斷要顯示「重新登入」還是「稍後再試」
function authFailRes_() {
  if (lastAuthErr_ === 'SERVER') {
    return jsonRes({ status: 'error', code: 'SERVER', msg: '伺服器暫時忙碌，無法確認登入狀態，請稍後再試（不用重新登入）' });
  }
  if (lastAuthErr_ === 'ROLE') {
    return jsonRes({ status: 'error', code: 'ROLE', msg: '權限不足：本工具僅限組長以上使用' });
  }
  return jsonRes({ status: 'error', code: 'INVALID', msg: '登入已失效，請回天鷹保全 App 重新登入' });
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
  if (!user) return authFailRes_();

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
  if (!user) return authFailRes_();

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
  if (!user) return authFailRes_();

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
  if (!user) return authFailRes_();

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

// ====== 部署後手動執行一次：觸發授權＋檢查本機驗證設定 ======
// ⚠ 本機驗證需要跟主 App 同一把 SESSION_SECRET：
//   1. 開主App「天鷹保全APP_後端_GAS」專案 → 專案設定 → 指令碼屬性 → 複製 SESSION_SECRET 的值
//   2. 開本專案 → 專案設定 → 指令碼屬性 → 新增同名 SESSION_SECRET，貼上同一個值
//   沒設定也能用（自動退回「問主 App」的舊方式），只是比較慢。
function forceAuth() {
  SpreadsheetApp.openById(SPREADSHEET_ID);
  SpreadsheetApp.openById(MAIN_APP_SHEET_ID_).getSheetByName('帳號管理');
  try { UrlFetchApp.fetch(MAIN_APP_GAS_URL_, { muteHttpExceptions: true }); } catch (e) {}
  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  console.log(secret ? 'SESSION_SECRET 已設定：走本機驗證（快）' : '⚠ 尚未設定 SESSION_SECRET：走備援驗證（問主 App，較慢）');
}
