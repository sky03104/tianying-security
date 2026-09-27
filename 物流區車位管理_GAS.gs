// ============================
// 物流區車位管理 — 獨立 GAS（天鷹保全）
// 綁定試算表：物流區車位管理（新建，見 物流區車位管理_GAS_部署說明.md）
//
// 分頁一「車位」＝車格主檔，一格一列（唯一鍵：車位編號，正規化後比對）
//   A ID | B 車位編號 | C 尺寸(大/中/小) | D 管制中(是/否) | E 管制原因 | F 備註
//   | G 建立時間 | H 最後更新
//
// 分頁二「借用登記」＝目前借用＋預借＋歷史都在這張，靠日期區分（不存狀態欄）：
//   開始日 ≤ 今天 ≤ 結束日 → 借用中；開始日 > 今天 → 預借；結束日 < 今天 → 歷史
//   結束日空白＝長期使用（開始日也可空白），一直算借用中，直到有人編輯或刪除這筆登記
//   A ID | B 車位ID | C 借用單位 | D 借用用途 | E 登記日期 | F 開始日 | G 結束日
//   | H 備註 | I 登記人工號 | J 登記人姓名 | K 建立時間
//   ⚠️ 狀態刻意不存：存了就得有人每天去改，忘了改就會出現「期間早就過了還顯示借用中」。
//
// 分頁三「異動紀錄」＝流水帳，只增不改
//   A ID | B 車位ID | C 車位編號 | D 動作 | E 說明 | F 操作人工號 | G 操作人姓名 | H 時間
//
// 主鍵：純數字流水號（既有最大ID+1），寫入時上 LockService，避免兩人同時新增撞號。
// 日期一律存 yyyy-MM-dd 文字（欄位格式設 @），不讓 Sheets 自動轉成日期物件。
//
// 權限：使用與編輯＝正職以上（fulltime/leader/vicecaptain/captain/executive/admin，不含兼職）；
//   刪除車格＝組長以上。三層把關——index.html DEFAULT_PERMS → tool_parking.html 前端 →
//   本檔每個 action 驗 token+角色（前兩層都在瀏覽器裡改得掉，後端這層才是真的）。
//
// ── 部署 ──（詳見 物流區車位管理_GAS_部署說明.md）
// 1. 新建空白試算表，把 ID 填到下面 SPREADSHEET_ID
// 2. 部署 → 新增部署 → 網路應用程式，執行身分「我」，存取權限「所有人」
// 3. 部署網址填到 tool_parking.html 的 PARKING_GAS_URL
// 4. 指令碼屬性新增 SESSION_SECRET（同主 App），執行一次 forceAuth
// 5. 執行一次 初始匯入（寫入 SEED_SLOTS_／SEED_BOOKINGS_，已有資料會中止）
// 6. 之後改動：部署 → 管理部署作業 → 編輯 → 版本「新版本」（不要新增部署，網址會變）
// ============================

var SPREADSHEET_ID = '請填入試算表ID'; // ← 部署前務必替換
var SHEET_SLOT = '車位';
var SHEET_BOOK = '借用登記';
var SHEET_LOG = '異動紀錄';
var TZ = 'Asia/Taipei';

// 主 App（天鷹保全APP_後端_GAS.gs）部署網址：本機驗證還沒設定好時的備援驗證管道
var MAIN_APP_GAS_URL_ = 'https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec';
// 主 App 的試算表（「帳號管理」分頁在這裡），本機驗證時用來查角色／停用狀態
var MAIN_APP_SHEET_ID_ = '1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU';
// 驗證通過的結果快取幾秒（同一張通行證 5 分鐘內不用重驗；停用帳號最慢 5 分鐘後失效）
var AUTH_CACHE_SEC_ = 300;

// 使用／編輯：正職以上（不含兼職 parttime）；刪除車格：組長以上
var STAFF_PLUS_ROLES_ = ['fulltime', 'leader', 'vicecaptain', 'captain', 'executive', 'admin'];
var LEADER_PLUS_ROLES_ = ['leader', 'vicecaptain', 'captain', 'executive', 'admin'];

var SIZES_ = ['大', '中', '小'];
var SLOT_HEADERS_ = ['ID', '車位編號', '尺寸', '管制中', '管制原因', '備註', '建立時間', '最後更新'];
var BOOK_HEADERS_ = ['ID', '車位ID', '借用單位', '借用用途', '登記日期', '開始日', '結束日', '備註',
                     '登記人工號', '登記人姓名', '建立時間'];
var LOG_HEADERS_ = ['ID', '車位ID', '車位編號', '動作', '說明', '操作人工號', '操作人姓名', '時間'];

// ============================
// 共用
// ============================
function jsonRes_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ══════════════════════════════════════════════════════════════
   通行證驗證（照無線電管理 GAS，2026-09-25 版）
   舊版：每一次讀取／新增／修改都用 UrlFetchApp 去「問」主 App 的 GAS。
     ① 慢：等於每次都要多等一支 GAS 冷啟動＋讀帳號表，讀清單動輒多好幾秒
     ② 會誤判：主 App 那邊只要逾時／忙碌／回傳格式不對，這邊一律當成「登入已失效」，
        讀清單要多等好幾秒
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


function requireRole_(token, roles) {
  var user = verifyAuthToken_(token);
  if (!user) return null;
  if (roles.indexOf(user.role) === -1) { lastAuthErr_ = 'ROLE'; return null; }
  return user;
}

// 依失敗原因回不同訊息；code 給前端判斷要顯示「重新登入」還是「稍後再試」
function authFailRes_(roleMsg) {
  if (lastAuthErr_ === 'SERVER') {
    return jsonRes_({ status: 'error', code: 'SERVER', msg: '伺服器暫時忙碌，無法確認登入狀態，請稍後再試（不用重新登入）' });
  }
  if (lastAuthErr_ === 'ROLE') {
    return jsonRes_({ status: 'error', code: 'ROLE', msg: roleMsg || '權限不足：本工具僅限正職以上使用' });
  }
  return jsonRes_({ status: 'error', code: 'INVALID', msg: '登入已失效，請回天鷹保全 App 重新登入' });
}

// ============================
// 試算表存取
// ============================
function getSheet_(name, headers, widths) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1A2340').setFontColor('#D4A800');
    sh.setFrozenRows(1);
    // 整張設成純文字：日期、車位編號（例如 001）都不讓 Sheets 自動轉型
    sh.getRange(2, 1, sh.getMaxRows() - 1, headers.length).setNumberFormat('@');
    sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat('0'); // A 欄 ID 是數字
    (widths || []).forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
  }
  return sh;
}
function slotSheet_() { return getSheet_(SHEET_SLOT, SLOT_HEADERS_, [[2, 110], [5, 200], [6, 200]]); }
function bookSheet_() { return getSheet_(SHEET_BOOK, BOOK_HEADERS_, [[3, 150], [4, 200], [8, 200]]); }
function logSheet_()  { return getSheet_(SHEET_LOG, LOG_HEADERS_, [[5, 320]]); }

/* 純數字流水號主鍵。
   ⚠️ 一定要用 isFinite 過濾，不能只用 !isNaN——isNaN(Infinity) 是 false，
   Infinity 會被當成合法數字放行，寫回試算表變成 #NUM! 而且永久復發
   （2026-08-08 打烊工具真的踩過，見技術經驗筆記）。 */
function nextId_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var n = Number(vals[i][0]);
    if (!isFinite(n)) continue;
    n = Math.floor(n);
    if (n > 0 && n <= 10000000 && n > max) max = n;
  }
  return max + 1;
}

function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

/* 車位編號正規化後才比對唯一性（去空白＋轉大寫）。
   ⚠️ 規則必須跟 tool_parking.html 的 正規化編號 一模一樣。 */
function normNo_(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase(); }

function readSlots_() {
  var sh = slotSheet_();
  var last = sh.getLastRow();
  var rows = [];
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, SLOT_HEADERS_.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[0] && !r[1]) continue;
      rows.push({
        id: Number(r[0]) || 0, row: i + 2, no: cell_(r[1]), size: cell_(r[2]) || '中',
        control: cell_(r[3]) === '是', controlReason: cell_(r[4]), note: cell_(r[5]),
        createdAt: cell_(r[6]), updatedAt: cell_(r[7])
      });
    }
  }
  return { sheet: sh, rows: rows };
}

function readBookings_() {
  var sh = bookSheet_();
  var last = sh.getLastRow();
  var rows = [];
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, BOOK_HEADERS_.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[0] && !r[1]) continue;
      rows.push({
        id: Number(r[0]) || 0, row: i + 2, slotId: Number(r[1]) || 0,
        unit: cell_(r[2]), purpose: cell_(r[3]), regDate: cell_(r[4]),
        start: cell_(r[5]), end: cell_(r[6]), note: cell_(r[7]),
        byEmpId: cell_(r[8]), byName: cell_(r[9]), createdAt: cell_(r[10])
      });
    }
  }
  return { sheet: sh, rows: rows };
}

function bookingOut_(b) {
  return { id: b.id, slotId: b.slotId, unit: b.unit, purpose: b.purpose, regDate: b.regDate,
           start: b.start, end: b.end, note: b.note, byName: b.byName };
}

// 「近期」的分界：今天往前推 6 個月（台北時間，yyyy-MM-dd）。結束日早於這天的借用算「更早的紀錄」
var HISTORY_MONTHS_ = 6;
function historyCutoff_() {
  var d = new Date();
  d.setMonth(d.getMonth() - HISTORY_MONTHS_);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function findBy_(rows, id) {
  for (var i = 0; i < rows.length; i++) if (rows[i].id === Number(id)) return rows[i];
  return null;
}

// 異動紀錄只增不改，出爭議時要靠它回溯
function writeLog_(slot, action, desc, user) {
  var sh = logSheet_();
  sh.appendRow([nextId_(sh), slot ? slot.id : '', slot ? slot.no : '', action, desc || '',
                user.empId, user.name || '', now_()]);
}

/* ============================
   驗證（純函式，跟前端同一套規則）
   ============================ */
function isDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  var p = s.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

// 兩段期間（含頭含尾）是否重疊：日期字串 yyyy-MM-dd 可以直接比大小。
// 長期使用（結束日空白）視為到永遠；開始日空白（照片上只寫「長期使用」）視為從很久以前開始。
function overlaps_(a, b) {
  var as = a.start || '0000-00-00', ae = a.end || '9999-12-31';
  var bs = b.start || '0000-00-00', be = b.end || '9999-12-31';
  return as <= be && bs <= ae;
}
function 期間文字_(b) {
  if (!b.end) return b.start ? b.start + ' 起長期使用' : '長期使用';
  return b.start + '~' + b.end;
}

/* 檢查一筆登記。回傳錯誤訊息，沒問題回 ''。
   others＝同車位的其他登記（編輯時要排除自己）。 */
function checkBooking_(b, others) {
  if (!b.unit) return '請填寫借用單位';
  if (!b.purpose) return '請填寫借用用途';
  // 長期使用＝結束日空白；此時開始日可空白（只知道長期使用、不知道哪天開始的舊資料）
  if (b.start && !isDate_(b.start)) return '開始日格式不正確';
  if (b.end && !isDate_(b.end)) return '結束日格式不正確';
  if (!b.end && !b.longTerm) return '請選擇結束日，或勾選「長期使用」';
  if (b.end && !b.start) return '請選擇開始日';
  if (b.end && b.end < b.start) return '結束日不能早於開始日';
  if (b.regDate && !isDate_(b.regDate)) return '登記日期格式不正確';
  for (var i = 0; i < others.length; i++) {
    if (overlaps_(b, others[i])) {
      return '這段期間跟「' + others[i].unit + '」（' + 期間文字_(others[i]) + '）重疊，同一個車位同時只能借給一個單位';
    }
  }
  return '';
}

function cleanBooking_(d) {
  return {
    unit: String(d.unit || '').trim(), purpose: String(d.purpose || '').trim(),
    regDate: String(d.regDate || '').trim() || today_(),
    start: String(d.start || '').trim(), end: d.longTerm ? '' : String(d.end || '').trim(),
    longTerm: !!d.longTerm, note: String(d.note || '').trim()
  };
}

// ============================
// 讀取
// ============================
function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';
  var token = (e && e.parameter) ? e.parameter.token : '';

  if (action === 'getAll') {
    var user = requireRole_(token, STAFF_PLUS_ROLES_);
    if (!user) return authFailRes_();
    try {
      var slots = readSlots_().rows.map(function (s) {
        return { id: s.id, no: s.no, size: s.size, control: s.control, controlReason: s.controlReason,
                 note: s.note, updatedAt: s.updatedAt };
      });
      // 2026-09-27：只回「近期」登記——目前借用、預借、長期使用，以及結束在最近 6 個月內的過去借用。
      // 更早的歷史只回每格有幾筆（olderCount），點進車格詳細頁按「載入更早的紀錄」才讀（getHistory）。
      // 登記只會一直增加，這樣累積再多年，打開畫面要傳的資料量都差不多。
      var cutoff = historyCutoff_();
      var books = [], olderCount = {};
      readBookings_().rows.forEach(function (b) {
        if (b.end && b.end < cutoff) { olderCount[b.slotId] = (olderCount[b.slotId] || 0) + 1; return; }
        books.push(bookingOut_(b));
      });
      // today 由伺服器給（台北時間），前端用它判斷狀態，避免手機時區/時間設錯算歪
      return jsonRes_({ status: 'ok', today: today_(), cutoff: cutoff, slots: slots, bookings: books, olderCount: olderCount });
    } catch (err) {
      return jsonRes_({ status: 'error', msg: err.message });
    }
  }

  if (action === 'getHistory') {
    var u3 = requireRole_(token, STAFF_PLUS_ROLES_);
    if (!u3) return authFailRes_();
    try {
      var sid = Number((e.parameter && e.parameter.slotId) || 0);
      var cut = historyCutoff_();
      var old = readBookings_().rows
        .filter(function (b) { return b.slotId === sid && b.end && b.end < cut; })
        .map(bookingOut_)
        .sort(function (a, b) { return a.end > b.end ? -1 : a.end < b.end ? 1 : 0; });
      return jsonRes_({ status: 'ok', slotId: sid, bookings: old });
    } catch (err3) {
      return jsonRes_({ status: 'error', msg: err3.message });
    }
  }

  if (action === 'getLogs') {
    var u2 = requireRole_(token, STAFF_PLUS_ROLES_);
    if (!u2) return authFailRes_();
    try {
      var slotId = Number((e.parameter && e.parameter.slotId) || 0);
      var sh = logSheet_();
      var last = sh.getLastRow();
      if (last < 2) return jsonRes_({ status: 'ok', logs: [] });
      var data = sh.getRange(2, 1, last - 1, LOG_HEADERS_.length).getValues();
      var logs = [];
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        if (!r[0]) continue;
        if (slotId && Number(r[1]) !== slotId) continue;
        logs.push({ id: Number(r[0]), action: cell_(r[3]), desc: cell_(r[4]), byName: cell_(r[6]), at: cell_(r[7]) });
      }
      logs.reverse(); // 新的在前
      return jsonRes_({ status: 'ok', logs: logs.slice(0, 50) });
    } catch (err2) {
      return jsonRes_({ status: 'error', msg: err2.message });
    }
  }

  return jsonRes_({ status: 'ok', msg: '天鷹保全 物流區車位管理 API 正常 ✓' });
}

// ============================
// 寫入
// ============================
function doPost(e) {
  try {
    var action = e.parameter.action || '';
    var token = e.parameter.token || '';
    var data = {};
    try { data = JSON.parse(e.parameter.data || '{}'); } catch (err) { data = {}; }

    // 刪除車格要組長以上，其餘正職以上
    var user = action === 'deleteSlot'
      ? requireRole_(token, LEADER_PLUS_ROLES_)
      : requireRole_(token, STAFF_PLUS_ROLES_);
    if (!user) return authFailRes_(action === 'deleteSlot' ? '權限不足：刪除車格僅限組長以上' : '');

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (action === 'addSlot')       return addSlot_(data, user);
      if (action === 'updateSlot')    return updateSlot_(data, user);
      if (action === 'setControl')    return setControl_(data, user);
      if (action === 'deleteSlot')    return deleteSlot_(data, user);
      if (action === 'addBooking')    return addBooking_(data, user);
      if (action === 'updateBooking') return updateBooking_(data, user);
      if (action === 'deleteBooking') return deleteBooking_(data, user);
      return jsonRes_({ status: 'error', msg: '未知動作: ' + action });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonRes_({ status: 'error', msg: err.message });
  }
}

function addSlot_(d, user) {
  var no = String(d.no || '').trim();
  var size = String(d.size || '').trim();
  if (!no) return jsonRes_({ status: 'error', msg: '請填寫車位編號' });
  if (SIZES_.indexOf(size) === -1) return jsonRes_({ status: 'error', msg: '車格尺寸只能是 大／中／小' });
  var all = readSlots_();
  for (var i = 0; i < all.rows.length; i++) {
    if (normNo_(all.rows[i].no) === normNo_(no)) return jsonRes_({ status: 'error', msg: '車位編號「' + no + '」已經存在' });
  }
  var ts = now_();
  var id = nextId_(all.sheet);
  all.sheet.appendRow([id, no, size, '否', '', String(d.note || '').trim(), ts, ts]);
  writeLog_({ id: id, no: no }, '新增車格', size + '型', user);
  return jsonRes_({ status: 'ok', msg: '已新增車格 ' + no, id: id });
}

function updateSlot_(d, user) {
  var all = readSlots_();
  var s = findBy_(all.rows, d.id);
  if (!s) return jsonRes_({ status: 'error', msg: '找不到這個車格，可能已被刪除，請重新整理' });
  var no = String(d.no || '').trim();
  var size = String(d.size || '').trim();
  // 先驗完再寫，驗不過就整筆不動（不留半寫資料）
  if (!no) return jsonRes_({ status: 'error', msg: '請填寫車位編號' });
  if (SIZES_.indexOf(size) === -1) return jsonRes_({ status: 'error', msg: '車格尺寸只能是 大／中／小' });
  for (var i = 0; i < all.rows.length; i++) {
    var o = all.rows[i];
    if (o.id !== s.id && normNo_(o.no) === normNo_(no)) return jsonRes_({ status: 'error', msg: '車位編號「' + no + '」已經存在' });
  }
  var note = String(d.note || '').trim();
  var changes = [];
  if (s.no !== no) changes.push('編號 ' + s.no + '→' + no);
  if (s.size !== size) changes.push('尺寸 ' + s.size + '→' + size);
  if (s.note !== note) changes.push('備註更新');
  all.sheet.getRange(s.row, 2, 1, 2).setValues([[no, size]]);
  all.sheet.getRange(s.row, 6).setValue(note);
  all.sheet.getRange(s.row, 8).setValue(now_());
  writeLog_({ id: s.id, no: no }, '編輯車格', changes.join('；') || '無變更', user);
  return jsonRes_({ status: 'ok', msg: '已更新車格 ' + no });
}

function setControl_(d, user) {
  var all = readSlots_();
  var s = findBy_(all.rows, d.id);
  if (!s) return jsonRes_({ status: 'error', msg: '找不到這個車格，可能已被刪除，請重新整理' });
  var on = !!d.control;
  var reason = String(d.reason || '').trim();
  if (on && !reason) return jsonRes_({ status: 'error', msg: '請填寫管制原因' });
  all.sheet.getRange(s.row, 4, 1, 2).setValues([[on ? '是' : '否', on ? reason : '']]);
  all.sheet.getRange(s.row, 8).setValue(now_());
  writeLog_(s, on ? '設定管制' : '解除管制', on ? reason : ('原因：' + (s.controlReason || '—')), user);
  return jsonRes_({ status: 'ok', msg: on ? '已設為管制中' : '已解除管制' });
}

function deleteSlot_(d, user) {
  var all = readSlots_();
  var s = findBy_(all.rows, d.id);
  if (!s) return jsonRes_({ status: 'error', msg: '找不到這個車格，可能已被刪除，請重新整理' });
  // 連同這個車格的登記一起刪（由下往上刪，列號才不會跑掉）
  var books = readBookings_();
  var mine = books.rows.filter(function (b) { return b.slotId === s.id; })
    .sort(function (a, b) { return b.row - a.row; });
  mine.forEach(function (b) { books.sheet.deleteRow(b.row); });
  all.sheet.deleteRow(s.row);
  writeLog_(s, '刪除車格', s.size + '型；一併刪除 ' + mine.length + ' 筆登記' +
    (mine.length ? '（' + mine.map(function (b) { return b.unit + ' ' + 期間文字_(b); }).join('、') + '）' : ''), user);
  return jsonRes_({ status: 'ok', msg: '已刪除車格 ' + s.no });
}

function addBooking_(d, user) {
  var slots = readSlots_();
  var s = findBy_(slots.rows, d.slotId);
  if (!s) return jsonRes_({ status: 'error', msg: '找不到這個車格，可能已被刪除，請重新整理' });
  var b = cleanBooking_(d);
  var books = readBookings_();
  var others = books.rows.filter(function (o) { return o.slotId === s.id; });
  var err = checkBooking_(b, others);
  if (err) return jsonRes_({ status: 'error', msg: err, code: 'BOOKING' });
  var id = nextId_(books.sheet);
  books.sheet.appendRow([id, s.id, b.unit, b.purpose, b.regDate, b.start, b.end, b.note,
                         user.empId, user.name || '', now_()]);
  writeLog_(s, b.start > today_() ? '新增預借' : '新增借用', b.unit + '（' + b.purpose + '）' + 期間文字_(b), user);
  return jsonRes_({ status: 'ok', msg: '已登記 ' + b.unit, id: id });
}

function updateBooking_(d, user) {
  var books = readBookings_();
  var old = findBy_(books.rows, d.id);
  if (!old) return jsonRes_({ status: 'error', msg: '找不到這筆登記，可能已被刪除，請重新整理' });
  var s = findBy_(readSlots_().rows, old.slotId);
  var b = cleanBooking_(d);
  var others = books.rows.filter(function (o) { return o.slotId === old.slotId && o.id !== old.id; });
  var err = checkBooking_(b, others);
  if (err) return jsonRes_({ status: 'error', msg: err, code: 'BOOKING' });
  books.sheet.getRange(old.row, 3, 1, 6).setValues([[b.unit, b.purpose, b.regDate, b.start, b.end, b.note]]);
  writeLog_(s || { id: old.slotId, no: '' }, '編輯登記',
    old.unit + ' ' + 期間文字_(old) + ' → ' + b.unit + '（' + b.purpose + '）' + 期間文字_(b), user);
  return jsonRes_({ status: 'ok', msg: '已更新登記' });
}

function deleteBooking_(d, user) {
  var books = readBookings_();
  var old = findBy_(books.rows, d.id);
  if (!old) return jsonRes_({ status: 'error', msg: '找不到這筆登記，可能已被刪除，請重新整理' });
  var s = findBy_(readSlots_().rows, old.slotId);
  books.sheet.deleteRow(old.row);
  writeLog_(s || { id: old.slotId, no: '' }, '刪除登記', old.unit + '（' + old.purpose + '）' + 期間文字_(old), user);
  return jsonRes_({ status: 'ok', msg: '已刪除登記' });
}

// ============================
// 初始資料（咖哩提供的紙本登記表照片整理而來，紙本標「115/7/7更新」）
// ⚠️ 紙本上方「大車格」區兩筆是舊資料不匯入；紙本「小車格」區的 1～6 其實是大車格 1～6（咖哩 2026-09-27 確認）
// B2F 每個車位拆成單一車格，尺寸為小型（咖哩 2026-09-27 確認）
// ============================
// 車格：[車位編號, 尺寸(大/中/小), 備註]
var SEED_SLOTS_ = [
  ['大1', '大', ''],
  ['大2', '大', ''],
  ['大3', '大', ''],
  ['大4', '大', ''],
  ['大5', '大', ''],
  ['大6', '大', ''],
  ['小7', '小', ''],
  ['小8', '小', ''],
  ['小9', '小', ''],
  ['小10', '小', ''],
  ['小11', '小', ''],
  ['小12', '小', ''],
  ['小13', '小', ''],
  ['小14', '小', ''],
  ['小15', '小', ''],
  ['小16', '小', ''],
  ['小17', '小', ''],
  ['小18', '小', ''],
  ['小19', '小', ''],
  ['小20', '小', ''],
  ['小455', '小', ''],
  ['小456', '小', ''],
  ['B2F 865', '小', ''],
  ['B2F 866', '小', ''],
  ['B2F 867', '小', ''],
  ['B2F 856', '小', ''],
  ['B2F 857', '小', ''],
  ['B2F 858', '小', ''],
  ['B2F 862', '小', ''],
  ['B2F 863', '小', ''],
  ['B2F 864', '小', ''],
  ['B2F 868', '小', ''],
  ['B2F 869', '小', ''],
  ['B2F 870', '小', ''],
  ['B2F 871', '小', ''],
  ['B2F 872', '小', ''],
  ['B2F 873', '小', '']
];
// 登記：[車位編號, 借用單位, 借用用途, 登記日期, 開始日, 結束日, 備註]（日期 yyyy-MM-dd；結束日空白＝長期使用）
var SEED_BOOKINGS_ = [
  ['大1', '設備課', '設備濾網', '', '', '', '紙本：長期使用'],
  ['大2', '行政課', 'LOPIA保麗龍放置', '', '', '', '紙本：長期使用'],
  ['大3', 'B1F食品美食課', 'LOPIA超市備品包材', '', '2026-03-01', '2026-12-31', ''],
  ['大4', '行政課', '魚缸拆除', '', '2026-09-01', '2026-09-02', '紙本寫 9/1~9/2（未寫年份，以 115 年計）'],
  ['大5', 'B1F食品美食課', '鄧師傅改裝', '', '2026-08-31', '2026-09-13', ''],
  ['大6', 'B1F食品美食課', '千房拆除工程(8/25-9/2 B1家庭家飾課FWEE新櫃使用)', '', '2026-08-09', '2026-08-22', ''],
  ['大6', '行政課', '黑貓宅配', '', '2026-09-03', '2026-09-24', '紙本「預約借用」'],
  ['小7', 'B1F食品美食課', 'B1F 特展區快閃', '', '2026-07-01', '2027-02-28', ''],
  ['小8', '1F化妝品精品課', '公安檢查(雅詩蘭黛放貨)', '', '2026-01-06', '2026-10-31', ''],
  ['小9', 'B1F食品美食課', '韓國展(9/1-9/5內的長谷川 撤櫃改裝)', '', '2026-07-08', '2026-08-22', ''],
  ['小9', 'B1F食品美食課', '8樓活動會館屏東展', '', '2026-09-21', '2026-10-09', '紙本「預約借用」'],
  ['小10', 'B1F食品美食課', '中秋節檔期', '', '2026-08-10', '2026-09-30', '紙本：小10～小12 同一筆'],
  ['小11', 'B1F食品美食課', '中秋節檔期', '', '2026-08-10', '2026-09-30', '紙本：小10～小12 同一筆'],
  ['小12', 'B1F食品美食課', '中秋節檔期', '', '2026-08-10', '2026-09-30', '紙本：小10～小12 同一筆'],
  ['小13', 'B1F家庭家飾課', 'DECO HOME(114.08.10由14改13)', '', '', '', '紙本：長期使用'],
  ['小15', 'B1F食品美食課', 'Apinara及韓美膳改裝工程', '', '2026-08-17', '2026-09-30', '紙本：小15～小16 同一筆'],
  ['小16', 'B1F食品美食課', 'Apinara及韓美膳改裝工程', '', '2026-08-17', '2026-09-30', '紙本：小15～小16 同一筆'],
  ['小17', '8F紳士催事課', 'WILSON快閃櫃理貨', '', '2026-08-27', '2026-09-05', ''],
  ['小18', '8F紳士催事課', 'WILSON快閃櫃理貨', '', '2026-08-27', '2026-09-03', ''],
  ['小19', '1F化妝品精品課（蘭蔻）', '待確認', '', '', '', '紙本只有手寫「1F 蘭蔻」，用途與日期待確認，先以長期使用匯入'],
  ['小20', 'B1F食品美食課', '臨時快閃櫃進撤需求', '', '2026-06-01', '2026-12-31', ''],
  ['小455', 'B1F家庭家飾課', '電器商品', '', '', '', '紙本：長期使用，455～456 同一筆'],
  ['小456', 'B1F家庭家飾課', '電器商品', '', '', '', '紙本：長期使用，455～456 同一筆'],
  ['B2F 865', '3/4F流行服飾課', 'BIRKENSTOCK專櫃改裝', '', '2026-08-29', '2026-08-31', '紙本：865-867 同一筆'],
  ['B2F 866', '3/4F流行服飾課', 'BIRKENSTOCK專櫃改裝', '', '2026-08-29', '2026-08-31', '紙本：865-867 同一筆'],
  ['B2F 867', '3/4F流行服飾課', 'BIRKENSTOCK專櫃改裝', '', '2026-08-29', '2026-08-31', '紙本：865-867 同一筆'],
  ['B2F 856', '8F紳士催事課', '因應安檢', '', '2026-08-25', '2026-08-31', '紙本：856-858 同一筆'],
  ['B2F 857', '8F紳士催事課', '因應安檢', '', '2026-08-25', '2026-08-31', '紙本：856-858 同一筆'],
  ['B2F 858', '8F紳士催事課', '因應安檢', '', '2026-08-25', '2026-08-31', '紙本：856-858 同一筆'],
  ['B2F 862', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-31', '2026-10-14', '紙本：862-864 同一筆'],
  ['B2F 863', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-31', '2026-10-14', '紙本：862-864 同一筆'],
  ['B2F 864', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-31', '2026-10-14', '紙本：862-864 同一筆'],
  ['B2F 868', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-31', '2026-10-14', '紙本：868-871 同一筆'],
  ['B2F 869', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-31', '2026-10-14', '紙本：868-871 同一筆'],
  ['B2F 870', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-31', '2026-10-14', '紙本：868-871 同一筆'],
  ['B2F 871', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-31', '2026-10-14', '紙本：868-871 同一筆'],
  ['B2F 872', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-09', '2026-10-01', '紙本：872-873 同一筆'],
  ['B2F 873', '1F化妝品精品課', '品牌改裝施工', '', '2026-08-09', '2026-10-01', '紙本：872-873 同一筆']
];

function 初始匯入() {
  var slots = readSlots_();
  if (slots.rows.length > 0) {
    throw new Error('「車位」分頁已經有 ' + slots.rows.length + ' 格，初始匯入已中止（避免重複匯入）。' +
                    '若確定要重來，請先手動清空「車位」與「借用登記」分頁的資料列。');
  }
  if (!SEED_SLOTS_.length) throw new Error('SEED_SLOTS_ 是空的，沒有可匯入的車格');
  // 先全部驗完再寫：編號重複、尺寸不對、登記找不到車格、期間重疊，任一項有問題就整批不寫
  var byNo = {}, problems = [];
  SEED_SLOTS_.forEach(function (s, i) {
    var k = normNo_(s[0]);
    if (!k) problems.push('第 ' + (i + 1) + ' 格沒有編號');
    else if (byNo[k]) problems.push('車位編號重複：' + s[0]);
    if (SIZES_.indexOf(s[1]) === -1) problems.push(s[0] + ' 的尺寸不是 大／中／小：' + s[1]);
    byNo[k] = { idx: i, books: [] };
  });
  SEED_BOOKINGS_.forEach(function (b) {
    var slot = byNo[normNo_(b[0])];
    var bk = { unit: b[1], purpose: b[2], regDate: b[3], start: b[4], end: b[5], longTerm: !b[5] };
    if (!slot) { problems.push('登記找不到車格：' + b[0]); return; }
    var err = checkBooking_(bk, slot.books);
    if (err) problems.push(b[0] + '：' + err);
    slot.books.push(bk);
  });
  if (problems.length) throw new Error('初始資料有問題，整批未寫入：\n' + problems.join('\n'));

  var ts = now_();
  var slotRows = SEED_SLOTS_.map(function (s, i) { return [i + 1, s[0], s[1], '否', '', s[2] || '', ts, ts]; });
  slots.sheet.getRange(2, 1, slotRows.length, SLOT_HEADERS_.length).setValues(slotRows);
  var idOf = {};
  SEED_SLOTS_.forEach(function (s, i) { idOf[normNo_(s[0])] = i + 1; });
  if (SEED_BOOKINGS_.length) {
    var bookRows = SEED_BOOKINGS_.map(function (b, i) {
      return [i + 1, idOf[normNo_(b[0])], b[1], b[2], b[3] || '', b[4], b[5], b[6] || '', '', '初始匯入', ts];
    });
    bookSheet_().getRange(2, 1, bookRows.length, BOOK_HEADERS_.length).setValues(bookRows);
  }
  logSheet_(); // 順手把異動紀錄分頁也建好
  Logger.log('已匯入 ' + slotRows.length + ' 格車位、' + SEED_BOOKINGS_.length + ' 筆登記');
}

// ====== 部署後手動執行一次：觸發授權＋檢查本機驗證設定 ======
// ⚠ 本機驗證需要跟主 App 同一把 SESSION_SECRET（缺班調班紀錄／無線電管理 GAS 設過的同一個值）：
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
