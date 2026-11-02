// ============================
// 洽公證管理 — 獨立 GAS（天鷹保全）
// 綁定試算表：洽公證管理（新建，見 洽公證管理_GAS_部署說明.md）
//
// 流程：廠商/員工忘記帶識別證 → 掃「固定 QR」（桌上海報或平板大按鈕顯示）→ 填樓層/專櫃/姓名/電話
//       → 送出當下系統配一個空的洽公證編號（300~600）→ 完成畫面（姓名+電話+編號）
//       → 保全核對後按「確認發證」→ 廠商還證時保全按「已繳回」。
//
// 分頁一「洽公證紀錄」＝一次申請一列（目前借出中＋近 30 天；更舊的終態資料自動搬進 Supabase）
//   A ID | B 編號 | C 狀態 | D 樓層 | E 專櫃或廠商 | F 姓名 | G 電話 | H 申請日期
//   | I 申請時間 | J 發證時間 | K 發證人 | L 繳回時間 | M 繳回人 | N token | O 備註
//   狀態：已申請（待領證）→ 已借出 → 已繳回；另有 已取消、已逾時
//   ⚠️ 「逾期未還」不存，用發證時間算出來（見 overdue 欄）；「已逾時」＝待領證超過 30 分鐘沒人確認，
//      讀取時用時間即時判定（effStatus_），寫入時順手把試算表同步改掉。
//
// 分頁二「卡片例外」＝停用／遺失的號碼（不預建 301 列）
//   A 編號 | B 備註 | C 停用時間 | D 操作人工號 | E 操作人姓名
//
// 主鍵：純數字流水號 = max(掃描 A 欄最大值, 指令碼屬性 LAST_ID) + 1，寫入時上 LockService。
//   ⚠️ 要同時看 LAST_ID：舊資料被搬去 Supabase 後，若 Sheets 剛好被清空，只掃 A 欄會從 1 重來，
//      跟 Supabase 已存的舊 ID 撞號。
//
// 公開（免登入）action：submitRequest、getRequest —— 給掃 QR 的廠商用，防濫用見 submitRequest_。
// 其餘 action 一律驗 token＋工具權限（toolPerms 的 id26）。
//
// ── 部署 ──（詳見 洽公證管理_GAS_部署說明.md）
// 1. 新建空白試算表，把 ID 填到下面 SPREADSHEET_ID
// 2. 部署 → 新增部署 → 網路應用程式，執行身分「我」，存取權限「所有人」
// 3. 部署網址填到 tool_visitor.html 的 VISITOR_GAS_URL
// 4. 指令碼屬性新增 SESSION_SECRET（同主 App）、SUPABASE_URL、SUPABASE_SECRET_KEY，執行一次 forceAuth
// 5. 執行一次 設定每日搬遷觸發器（每天凌晨 4 點把 30 天前的終態資料搬進 Supabase）
// 6. 之後改動：部署 → 管理部署作業 → 編輯 → 版本「新版本」（不要新增部署，網址會變）
// ============================

var SPREADSHEET_ID = '1gDCnZlb9gWz04zsjkNfgnFlGTRhb6wphhJiAKv-VmBU';
var SHEET_REC = '洽公證紀錄';
var SHEET_CARD = '卡片例外';
var TZ = 'Asia/Taipei';

var NO_MIN = 300;            // 洽公證編號範圍（前端 tool_visitor.html 同值）
var NO_MAX = 600;
var HOLD_MIN = 30;           // 待領證超過幾分鐘沒人確認就自動釋放
var PENDING_MAX = 15;        // 同時「待領證」張數上限（防有人亂掃占號）
var OVERDUE_HOURS = 12;      // 已借出超過幾小時算逾期未還（避免晚班跨夜誤判）
var ARCHIVE_DAYS = 30;       // 終態資料在 Sheets 留幾天
var SB_TABLE = 'visitor_pass_logs';
var FLOORS = ['B2F', 'B1F', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '其他']; // 與前端同

// 主 App（天鷹保全APP_後端_GAS.gs）部署網址：本機驗證還沒設定好時的備援驗證管道
var MAIN_APP_GAS_URL_ = 'https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec';
// 主 App 的試算表（「帳號管理」分頁在這裡），本機驗證時用來查角色／停用狀態
var MAIN_APP_SHEET_ID_ = '1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU';
var AUTH_CACHE_SEC_ = 300;

var ALL_ROLES_ = ['parttime', 'fulltime', 'leader', 'vicecaptain', 'captain', 'executive', 'admin'];
var VISITOR_TOOL_ID_ = 26;
var TOOL_PERMS_CACHE_SEC_ = 300;

var REC_HEADERS_ = ['ID', '編號', '狀態', '樓層', '專櫃或廠商', '姓名', '電話', '申請日期',
                    '申請時間', '發證時間', '發證人', '繳回時間', '繳回人', 'token', '備註'];
var CARD_HEADERS_ = ['編號', '備註', '停用時間', '操作人工號', '操作人姓名'];
var ACTIVE_ = ['已申請', '已借出'];          // 占用號碼中
var TERMINAL_ = ['已繳回', '已取消', '已逾時']; // 終態：可被搬進 Supabase

function jsonRes_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ══════════════════════════════════════════════════════════════
   通行證驗證（照物流區車位管理 GAS：本機 HMAC 驗證＋快取，沒設 SESSION_SECRET 退回問主 App）
   ══════════════════════════════════════════════════════════════ */
var lastAuthErr_ = '';  // 'INVALID'｜'SERVER'｜'ROLE'

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

function verifyRemote_(token) {
  try {
    var res = UrlFetchApp.fetch(MAIN_APP_GAS_URL_, {
      method: 'post',
      payload: { action: 'verifySession', data: JSON.stringify({ token: token }) },
      muteHttpExceptions: true
    });
    var d = JSON.parse(res.getContentText());
    if (d.status === 'ok' && d.user && d.user.empId) return { user: d.user };
    if (d.code === 'INVALID' || (!d.code && /登入已失效/.test(d.msg || ''))) return { err: 'INVALID' };
    return { err: 'SERVER' };
  } catch (err) {
    return { err: 'SERVER' };
  }
}

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
    if (r.err === 'SERVER') { Utilities.sleep(800); r = verifyRemote_(token); }
  }
  if (!r.user) { lastAuthErr_ = r.err; return null; }
  try { cache.put(key, JSON.stringify(r.user), AUTH_CACHE_SEC_); } catch (e) {}
  return r.user;
}

// 使用權限以主控台「工具權限」面板為準（主 App 試算表「系統設定」的 toolPerms，格式 {角色:[工具id]}）；
// 讀不到才退回預設（全部角色可用——這是現場保全櫃檯用的工具）；管理員永遠可用。
function readToolPerms_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('toolPerms');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var perms = null;
  try {
    var sh = SpreadsheetApp.openById(MAIN_APP_SHEET_ID_).getSheetByName('系統設定');
    if (sh) {
      var data = sh.getDataRange().getValues();
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][0]).trim() !== 'toolPerms') continue;
        var p = JSON.parse(String(data[r][1] || ''));
        if (p && typeof p === 'object') perms = p;
        break;
      }
    }
  } catch (e) { perms = null; }
  if (perms) { try { cache.put('toolPerms', JSON.stringify(perms), TOOL_PERMS_CACHE_SEC_); } catch (e) {} }
  return perms;
}
/* 「找不到就退回預設」：雲端 toolPerms 是管理員在面板按儲存時寫下的，之後才新增的工具不會在裡面，
   舊版這裡會直接判成沒權限（隊長開 洽公證管理 顯示「權限不足」就是這樣）。
   做法跟主控台 index.html applyCloudSettings 一致：雲端權限存檔當下的已知工具清單（_known；舊資料沒有
   就用「任何角色清單裡出現過的工具」）若不含本工具＝它是存檔後才新增的新工具 → 套預設角色；
   已知清單含本工具＝管理員看過並決定了 → 嚴格照面板設定（沒勾就是沒權限）。 */
function toolKnownInPerms_(perms, id) {
  var known = [];
  if (perms && Object.prototype.toString.call(perms._known) === '[object Array]') {
    known = perms._known;
  } else if (perms) {
    Object.keys(perms).forEach(function (r) {
      if (Object.prototype.toString.call(perms[r]) === '[object Array]') known = known.concat(perms[r]);
    });
  }
  return known.indexOf(id) >= 0 || known.indexOf(String(id)) >= 0;
}
function canUseTool_(role, perms) {
  if (role === 'admin') return true;
  var id = VISITOR_TOOL_ID_;
  if (perms && Object.prototype.toString.call(perms[role]) === '[object Array]' && toolKnownInPerms_(perms, id)) {
    return perms[role].indexOf(id) >= 0 || perms[role].indexOf(String(id)) >= 0;
  }
  return ALL_ROLES_.indexOf(role) >= 0;
}
function requireToolUser_(token) {
  var user = verifyAuthToken_(token);
  if (!user) return null;
  if (!canUseTool_(user.role, readToolPerms_())) { lastAuthErr_ = 'ROLE'; return null; }
  return user;
}
function authFailRes_() {
  if (lastAuthErr_ === 'SERVER') {
    return jsonRes_({ status: 'error', code: 'SERVER', msg: '伺服器暫時忙碌，無法確認登入狀態，請稍後再試（不用重新登入）' });
  }
  if (lastAuthErr_ === 'ROLE') {
    return jsonRes_({ status: 'error', code: 'ROLE', msg: '權限不足：您的職務目前沒有開放本工具，請洽主管' });
  }
  return jsonRes_({ status: 'error', code: 'INVALID', msg: '登入已失效，請回天鷹保全 App 重新登入' });
}

// ============================
// 時間與文字工具（純函式，可用 node 測）
// ============================
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  var s = String(v == null ? '' : v).trim();
  return s.charAt(0) === "'" ? s.slice(1) : s; // 寫入時為防公式注入補的單引號，讀出時拿掉
}
/** 'yyyy-MM-dd HH:mm:ss'（台北時間）→ 毫秒；空白或格式錯回 NaN */
function parseTs_(s) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(s || ''))) return NaN;
  var t = String(s).replace(' ', 'T');
  if (t.length === 16) t += ':00';
  return new Date(t + '+08:00').getTime();
}
/** 寫入試算表前的文字清理：去頭尾空白、去控制字元、= + - @ 開頭補單引號（防公式注入） */
function safeText_(s) {
  var t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}
/** 電話正規化：去空白/連字號/括號後必須是台灣手機 09xxxxxxxx（共 10 碼）；不合法回 ''。
 *  ⚠️ 規則必須跟 tool_visitor.html 的 normPhone 一模一樣。（2026-11-02 咖哩指定只收手機，不再收市話） */
function normPhone_(s) {
  var d = String(s == null ? '' : s).replace(/[\s\-()（）]/g, '');
  return /^09\d{8}$/.test(d) ? d : '';
}
/** 搜尋/比對用正規化：去空白＋轉大寫，跟前端 正規化 同規則 */
function normKey_(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase(); }

/** 驗證一筆申請。回傳 { ok:true, v:{floor,shop,name,phone} } 或 { ok:false, msg } */
function validateRequest_(d) {
  d = d || {};
  var floor = String(d.floor || '').trim();
  var shop = String(d.shop || '').replace(/\s+/g, ' ').trim();
  var name = String(d.name || '').replace(/\s+/g, ' ').trim();
  var phone = normPhone_(d.phone);
  if (FLOORS.indexOf(floor) < 0) return { ok: false, msg: '請選擇樓層' };
  if (shop.length < 1 || shop.length > 40) return { ok: false, msg: '請填寫專櫃或廠商名稱（40 字以內）' };
  if (name.length < 1 || name.length > 20) return { ok: false, msg: '請填寫姓名（20 字以內）' };
  if (!phone) return { ok: false, msg: '手機號碼格式不對（需 09 開頭共 10 碼，例：0912345678）' };
  return { ok: true, v: { floor: floor, shop: shop, name: name, phone: phone } };
}

/** 有效狀態：待領證超過 HOLD_MIN 分鐘沒人確認 → 已逾時（不看試算表當下寫的值，避免排程沒跑就卡號） */
function effStatus_(rec, nowMs) {
  if (rec.status === '已申請') {
    var t = parseTs_(rec.appliedAt);
    if (isFinite(t) && nowMs - t > HOLD_MIN * 60000) return '已逾時';
  }
  return rec.status;
}
function isOverdue_(rec, nowMs) {
  if (rec.status !== '已借出') return false;
  var t = parseTs_(rec.issuedAt);
  return isFinite(t) && nowMs - t > OVERDUE_HOURS * 3600000;
}
function isActive_(rec, nowMs) { return ACTIVE_.indexOf(effStatus_(rec, nowMs)) >= 0; }

/** 配號：最小的「未占用且未停用」號碼；全滿回 0 */
function allocateNo_(records, disabledNos, nowMs) {
  var used = {};
  records.forEach(function (r) { if (isActive_(r, nowMs)) used[r.no] = true; });
  var off = {};
  disabledNos.forEach(function (n) { off[n] = true; });
  for (var n = NO_MIN; n <= NO_MAX; n++) if (!used[n] && !off[n]) return n;
  return 0;
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
    // 整張設成純文字：電話開頭的 0、日期時間都不讓 Sheets 自動轉型
    sh.getRange(2, 1, sh.getMaxRows() - 1, headers.length).setNumberFormat('@');
    sh.getRange(2, 1, sh.getMaxRows() - 1, 2).setNumberFormat('0'); // A、B 欄是數字（ID／編號）
    (widths || []).forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
  }
  return sh;
}
function recSheet_() { return getSheet_(SHEET_REC, REC_HEADERS_, [[5, 160], [7, 110], [9, 150], [10, 150], [12, 150], [15, 200]]); }
function cardSheet_() { return getSheet_(SHEET_CARD, CARD_HEADERS_, [[2, 220], [3, 150]]); }

/* 純數字流水號主鍵。⚠️ isFinite 過濾（Infinity 會被 !isNaN 放行，寫回變 #NUM!，2026-08-08 踩過）；
   同時取 LAST_ID，避免舊資料搬走後從 1 重來撞 Supabase 舊 ID。 */
function nextId_(sh) {
  var max = 0;
  var last = sh.getLastRow();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var n = Number(vals[i][0]);
      if (!isFinite(n)) continue;
      n = Math.floor(n);
      if (n > 0 && n <= 10000000 && n > max) max = n;
    }
  }
  var props = PropertiesService.getScriptProperties();
  var saved = Number(props.getProperty('LAST_ID'));
  if (isFinite(saved) && saved > max && saved <= 10000000) max = Math.floor(saved);
  var id = max + 1;
  props.setProperty('LAST_ID', String(id));
  return id;
}

function readRecords_() {
  var sh = recSheet_();
  var last = sh.getLastRow();
  var rows = [];
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, REC_HEADERS_.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[0] && !r[1]) continue;
      rows.push({
        id: Number(r[0]) || 0, row: i + 2, no: Number(r[1]) || 0, status: cell_(r[2]),
        floor: cell_(r[3]), shop: cell_(r[4]), name: cell_(r[5]), phone: fixPhone_(cell_(r[6])),
        date: cell_(r[7]).slice(0, 10), appliedAt: cell_(r[8]), issuedAt: cell_(r[9]), issuedBy: cell_(r[10]),
        returnedAt: cell_(r[11]), returnedBy: cell_(r[12]), token: cell_(r[13]), note: cell_(r[14])
      });
    }
  }
  return { sheet: sh, rows: rows };
}
function readDisabled_() {
  var sh = cardSheet_();
  var last = sh.getLastRow();
  var out = [];
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      var n = Number(data[i][0]);
      if (n >= NO_MIN && n <= NO_MAX) out.push({ no: n, note: cell_(data[i][1]), row: i + 2 });
    }
  }
  return { sheet: sh, list: out };
}

/** 單列局部更新：patch = { 狀態:'已借出', ... }（欄名見 REC_HEADERS_） */
function patchRow_(sh, row, patch) {
  Object.keys(patch).forEach(function (k) {
    var c = REC_HEADERS_.indexOf(k);
    if (c >= 0) { var cell = sh.getRange(row, c + 1); if (c >= 3) cell.setNumberFormat('@'); cell.setValue(patch[k]); }
  });
}

/** 把試算表上「已申請但已超時」的列同步改成已逾時（寫入類 action 開頭順手做） */
function sweepExpired_(rows, sh, nowMs) {
  rows.forEach(function (r) {
    if (r.status === '已申請' && effStatus_(r, nowMs) === '已逾時') {
      patchRow_(sh, r.row, { '狀態': '已逾時', '備註': r.note || '待領證逾時自動釋放' });
      r.status = '已逾時';
    }
  });
}

/** 對外輸出的紀錄（含有效狀態與逾期旗標；token 只在 submitRequest 回給申請人本人） */
function recOut_(r, nowMs) {
  return { id: r.id, no: r.no, status: effStatus_(r, nowMs), floor: r.floor, shop: r.shop, name: r.name,
           phone: r.phone, date: r.date, appliedAt: r.appliedAt, issuedAt: r.issuedAt, issuedBy: r.issuedBy,
           returnedAt: r.returnedAt, returnedBy: r.returnedBy, note: r.note, overdue: isOverdue_(r, nowMs) };
}
function publicOut_(r, nowMs) {
  return { no: r.no, status: effStatus_(r, nowMs), floor: r.floor, shop: r.shop, name: r.name,
           phone: r.phone, date: r.date, appliedAt: r.appliedAt, issuedAt: r.issuedAt, now: nowMs };
}

/* token 第一碼固定用字母 a：全數字或「數字e數字」的 16 碼字串，Sheets 會當成科學記號數字吞掉（Infinity／失真）。
   格式仍是 16 碼小寫 hex，getRequest 的檢查規則不變。 */
function newToken_() { return 'a' + Utilities.getUuid().replace(/-/g, '').slice(0, 15); }
/* 電話補回被 Sheets 吃掉的開頭 0（欄位若不是純文字格式，0926266621 會被存成數字 926266621）。
   手機 9 開頭共 9 碼、市話 2~8 開頭共 8~9 碼 → 前面補 0；其他原樣。讀出一律過這一道，舊資料也一起修好。 */
function fixPhone_(s) {
  var t = String(s == null ? '' : s).trim();
  if (/^9\d{8}$/.test(t) || /^[2-8]\d{7,8}$/.test(t)) return '0' + t;
  return t;
}
/* 寫入前先把這一列的 D~O 欄設成純文字，再 appendRow：電話、時間、token 才不會被自動轉型 */
function appendTextRow_(sh, values) {
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 4, 1, REC_HEADERS_.length - 3).setNumberFormat('@');
  sh.appendRow(values);
}

// ============================
// 公開 action（免登入）
// ============================
/* 防濫用：欄位驗證＋公式注入清理；同電話已有效 → 回原本那筆（不重複占號，也是重掃/重整的去重）；
   待領證同時上限 PENDING_MAX；配號與寫入全在 LockService 內，並發不撞號。 */
function submitRequest_(d) {
  var chk = validateRequest_(d);
  if (!chk.ok) return jsonRes_({ status: 'error', msg: chk.msg });
  var v = chk.v;
  var nowMs = new Date().getTime();
  var rr = readRecords_();
  sweepExpired_(rr.rows, rr.sheet, nowMs);

  for (var i = 0; i < rr.rows.length; i++) {
    var ex = rr.rows[i];
    if (isActive_(ex, nowMs) && ex.phone === v.phone) {
      return jsonRes_({ status: 'ok', token: ex.token, dup: true, rec: publicOut_(ex, nowMs) });
    }
  }
  var pending = rr.rows.filter(function (r) { return effStatus_(r, nowMs) === '已申請'; }).length;
  if (pending >= PENDING_MAX) {
    return jsonRes_({ status: 'error', code: 'BUSY', msg: '目前申請人數較多，請洽保全櫃檯協助' });
  }
  var no = allocateNo_(rr.rows, readDisabled_().list.map(function (x) { return x.no; }), nowMs);
  if (!no) return jsonRes_({ status: 'error', code: 'FULL', msg: '洽公證已全數借出，請洽保全櫃檯' });

  var token = newToken_();
  var id = nextId_(rr.sheet);
  var ts = now_();
  appendTextRow_(rr.sheet, [id, no, '已申請', safeText_(v.floor), safeText_(v.shop), safeText_(v.name), v.phone,
                      today_(), ts, '', '', '', '', token, '']);
  var rec = { id: id, no: no, status: '已申請', floor: v.floor, shop: v.shop, name: v.name, phone: v.phone,
              date: today_(), appliedAt: ts, issuedAt: '' };
  return jsonRes_({ status: 'ok', token: token, dup: false, rec: publicOut_(rec, nowMs) });
}

/* 只回 token 對應的那一筆，不會洩漏別人的資料；token 找不到（已搬進 Supabase 或亂猜）→ gone */
function getRequest_(token) {
  var nowMs = new Date().getTime();
  var t = String(token || '').trim();
  if (!/^[0-9a-f]{16}$/.test(t)) return jsonRes_({ status: 'ok', gone: true, now: nowMs });
  var rows = readRecords_().rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].token === t) return jsonRes_({ status: 'ok', rec: publicOut_(rows[i], nowMs) });
  }
  return jsonRes_({ status: 'ok', gone: true, now: nowMs });
}

// ============================
// 管理 action（驗 token＋工具權限）
// ============================
function getAll_() {
  var nowMs = new Date().getTime();
  var today = today_();
  var rr = readRecords_();
  var active = [], todayDone = [];
  rr.rows.forEach(function (r) {
    var o = recOut_(r, nowMs);
    if (ACTIVE_.indexOf(o.status) >= 0) active.push(o);
    else if (r.date === today) todayDone.push(o);
  });
  return jsonRes_({ status: 'ok', now: nowMs, today: today, min: NO_MIN, max: NO_MAX,
                    disabled: readDisabled_().list.map(function (x) { return { no: x.no, note: x.note }; }),
                    active: active, todayDone: todayDone });
}

function findRec_(rows, id) {
  for (var i = 0; i < rows.length; i++) if (rows[i].id === Number(id)) return rows[i];
  return null;
}

function confirmIssue_(d, user) {
  var nowMs = new Date().getTime();
  var rr = readRecords_();
  sweepExpired_(rr.rows, rr.sheet, nowMs);
  var r = findRec_(rr.rows, d.id);
  if (!r) return jsonRes_({ status: 'error', msg: '找不到這筆申請' });
  if (r.status === '已逾時') return jsonRes_({ status: 'error', msg: '這筆已逾時釋放，請廠商重新掃碼申請' });
  if (r.status !== '已申請') return jsonRes_({ status: 'error', msg: '目前狀態是「' + r.status + '」，無法確認發證' });
  patchRow_(rr.sheet, r.row, { '狀態': '已借出', '發證時間': now_(), '發證人': safeText_(user.name || user.empId) });
  return jsonRes_({ status: 'ok', msg: '已確認發證' });
}

function returnPass_(d, user) {
  var rr = readRecords_();
  var r = findRec_(rr.rows, d.id);
  if (!r) return jsonRes_({ status: 'error', msg: '找不到這筆紀錄' });
  if (r.status !== '已借出') return jsonRes_({ status: 'error', msg: '目前狀態是「' + r.status + '」，只有「已借出」能按已繳回' });
  patchRow_(rr.sheet, r.row, { '狀態': '已繳回', '繳回時間': now_(), '繳回人': safeText_(user.name || user.empId) });
  return jsonRes_({ status: 'ok', msg: '已繳回' });
}

function cancelRequest_(d, user) {
  var nowMs = new Date().getTime();
  var rr = readRecords_();
  sweepExpired_(rr.rows, rr.sheet, nowMs);
  var r = findRec_(rr.rows, d.id);
  if (!r) return jsonRes_({ status: 'error', msg: '找不到這筆申請' });
  if (r.status !== '已申請') return jsonRes_({ status: 'error', msg: '目前狀態是「' + r.status + '」，只有「已申請（待領證）」能取消' });
  patchRow_(rr.sheet, r.row, { '狀態': '已取消', '備註': '由 ' + safeText_(user.name || user.empId) + ' 取消' });
  return jsonRes_({ status: 'ok', msg: '已取消，號碼已釋放' });
}

function setCardDisabled_(d, user) {
  var no = Math.floor(Number(d.no));
  if (!isFinite(no) || no < NO_MIN || no > NO_MAX) return jsonRes_({ status: 'error', msg: '編號需在 ' + NO_MIN + '~' + NO_MAX });
  var dis = readDisabled_();
  var hit = null;
  dis.list.forEach(function (x) { if (x.no === no) hit = x; });
  if (d.disabled) {
    if (hit) return jsonRes_({ status: 'ok', msg: '這張已是停用狀態' });
    var nowMs = new Date().getTime();
    var rr = readRecords_();
    sweepExpired_(rr.rows, rr.sheet, nowMs);
    if (rr.rows.some(function (r) { return r.no === no && isActive_(r, nowMs); })) {
      return jsonRes_({ status: 'error', msg: no + ' 號目前借出中，請先收回再停用' });
    }
    dis.sheet.appendRow([no, safeText_(d.note || ''), now_(), user.empId, safeText_(user.name || '')]);
    return jsonRes_({ status: 'ok', msg: no + ' 號已停用（不再被配發）' });
  }
  if (!hit) return jsonRes_({ status: 'ok', msg: '這張本來就沒有停用' });
  dis.sheet.deleteRow(hit.row);
  return jsonRes_({ status: 'ok', msg: no + ' 號已恢復可用' });
}

// ============================
// 搜尋（近 30 天走 Sheets；日期落在更早或沒指定日期 → 另查 Supabase）
// ============================
function matchRec_(r, kw) {
  if (!kw) return true;
  var k = normKey_(kw);
  return String(r.no) === k || normKey_(r.name).indexOf(k) >= 0 || normKey_(r.shop).indexOf(k) >= 0 ||
         normKey_(r.phone).indexOf(k) >= 0 || normKey_(r.floor) === k;
}
function cutoffDate_() {
  var d = new Date(new Date().getTime() - ARCHIVE_DAYS * 86400000);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function search_(d) {
  var nowMs = new Date().getTime();
  var kw = String(d.q || '').trim();
  var from = String(d.from || ''), to = String(d.to || '');
  var cutoff = cutoffDate_();
  var out = [];
  readRecords_().rows.forEach(function (r) {
    if (from && r.date < from) return;
    if (to && r.date > to) return;
    if (matchRec_(r, kw)) out.push(recOut_(r, nowMs));
  });
  var res = { status: 'ok', records: out, archiveChecked: false };
  if (!from || from < cutoff) {
    try {
      var sb = sbSearch_(kw, from, to && to < cutoff ? to : '');
      res.archiveChecked = true;
      res.truncated = sb.truncated;
      var seen = {};
      out.forEach(function (o) { seen[o.id] = true; });
      sb.rows.forEach(function (o) { if (!seen[o.id]) out.push(o); });
    } catch (err) {
      // 絕不把「歷史讀不到」裝成「查無資料」
      res.archiveError = '歷史資料（30 天前）暫時讀不到：' + err.message;
    }
  }
  out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });
  res.records = out.slice(0, 500);
  return jsonRes_(res);
}

// ============================
// Supabase（30 天前的終態資料）
// 規則：只准連天鷹正式專案 narilpgjmjncladkquly；連線設定放指令碼屬性，不硬編。
// ⚠️ UrlFetchApp 的 method 一律小寫（大寫 PATCH/DELETE 會靜默無效）；單次 GET 上限 1000 筆。
// ============================
function sbConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new Error('尚未設定 SUPABASE_URL／SUPABASE_SECRET_KEY');
  return { url: String(url).replace(/\/+$/, ''), key: key };
}
function sbRequest_(method, path, body, extra) {
  var cfg = sbConfig_();
  var headers = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
  if (extra) Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
  var opt = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== undefined) opt.payload = JSON.stringify(body);
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + path, opt);
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code >= 400) throw new Error('Supabase 請求失敗（' + code + '）：' + String(text).slice(0, 200));
  return text ? JSON.parse(text) : null;
}
function toIso_(s) {
  var t = parseTs_(s);
  return isFinite(t) ? String(s).replace(' ', 'T') + (String(s).length === 16 ? ':00' : '') + '+08:00' : null;
}
function fromIso_(s) {
  if (!s) return '';
  return Utilities.formatDate(new Date(s), TZ, 'yyyy-MM-dd HH:mm:ss');
}
function sbRowFromRec_(r) {
  return { id: r.id, pass_no: r.no, status: r.status, floor: r.floor, shop: r.shop, person_name: r.name,
           phone: r.phone, apply_date: r.date, applied_at: toIso_(r.appliedAt), issued_at: toIso_(r.issuedAt),
           issued_by: r.issuedBy || null, returned_at: toIso_(r.returnedAt), returned_by: r.returnedBy || null,
           note: r.note || null };
}
function recFromSb_(x) {
  return { id: x.id, no: x.pass_no, status: x.status, floor: x.floor || '', shop: x.shop || '', name: x.person_name || '',
           phone: x.phone || '', date: x.apply_date, appliedAt: fromIso_(x.applied_at), issuedAt: fromIso_(x.issued_at),
           issuedBy: x.issued_by || '', returnedAt: fromIso_(x.returned_at), returnedBy: x.returned_by || '',
           note: x.note || '', overdue: false };
}

function sbSearch_(kw, from, to) {
  var q = 'select=*&order=apply_date.desc,id.desc&limit=300';
  if (from) q += '&apply_date=gte.' + encodeURIComponent(from);
  if (to) q += '&apply_date=lte.' + encodeURIComponent(to);
  var cutoff = cutoffDate_();
  if (!to) q += '&apply_date=lt.' + cutoff; // 沒給結束日時只查 Sheets 以外的部分
  var k = String(kw || '').replace(/[,()*%\\"']/g, '').trim();
  if (k) {
    var conds = ['person_name.ilike.*' + k + '*', 'shop.ilike.*' + k + '*', 'phone.ilike.*' + k + '*'];
    if (/^\d{3}$/.test(k)) conds.push('pass_no.eq.' + k);
    q += '&or=(' + conds.join(',') + ')';
  }
  var rows = sbRequest_('get', SB_TABLE + '?' + q);
  return { rows: (rows || []).map(recFromSb_), truncated: !!(rows && rows.length >= 300) };
}

/* 每日搬遷：終態且申請日 < 30 天前 → upsert 進 Supabase → 回查確認每個 id 都在 → 才刪 Sheets 該列。
   任何一步失敗都不刪，隔天重試；重複執行冪等（ignore-duplicates）。
   未繳回（已申請/已借出）的舊單永遠不搬。 */
function archiveOldRows() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cutoff = cutoffDate_();
    var rr = readRecords_();
    var old = rr.rows.filter(function (r) { return TERMINAL_.indexOf(r.status) >= 0 && r.date && r.date < cutoff; });
    var moved = 0, failed = 0;
    for (var i = 0; i < old.length; i += 200) {
      var batch = old.slice(i, i + 200);
      try {
        sbRequest_('post', SB_TABLE + '?on_conflict=id', batch.map(sbRowFromRec_),
                   { Prefer: 'resolution=ignore-duplicates,return=minimal' });
        var ids = batch.map(function (r) { return r.id; });
        var got = sbRequest_('get', SB_TABLE + '?select=id&id=in.(' + ids.join(',') + ')&limit=1000') || [];
        var have = {};
        got.forEach(function (x) { have[x.id] = true; });
        var ok = batch.filter(function (r) { return have[r.id]; });
        failed += batch.length - ok.length;
        // 由下往上刪，列號才不會跑掉
        ok.sort(function (a, b) { return b.row - a.row; })
          .forEach(function (r) { rr.sheet.deleteRow(r.row); moved++; });
        // 刪列後後面批次的列號會改變 → 重新讀一次
        if (ok.length) {
          rr = readRecords_();
          old = rr.rows.filter(function (r) { return TERMINAL_.indexOf(r.status) >= 0 && r.date && r.date < cutoff; });
          i = -200; // 重新從頭（已搬走的不會再出現）
          if (!old.length) break;
        }
      } catch (err) {
        console.log('搬遷失敗（不刪列，明日重試）：' + err.message);
        failed += batch.length;
        break;
      }
    }
    console.log('搬遷完成：搬走 ' + moved + ' 筆，未成功 ' + failed + ' 筆');
    return { moved: moved, failed: failed };
  } finally {
    lock.releaseLock();
  }
}

// ============================
// 路由
// ============================
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || '';
  try {
    if (action === 'getRequest') return getRequest_(p.t);
    if (action === 'getAll') {
      var user = requireToolUser_(p.token);
      if (!user) return authFailRes_();
      return getAll_();
    }
    if (action === 'search') {
      var u2 = requireToolUser_(p.token);
      if (!u2) return authFailRes_();
      var dd = {};
      try { dd = JSON.parse(p.data || '{}'); } catch (x) { dd = {}; }
      return search_(dd);
    }
    return jsonRes_({ status: 'ok', msg: '天鷹保全 洽公證管理 API 正常 ✓' });
  } catch (err) {
    return jsonRes_({ status: 'error', msg: err.message });
  }
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || '';
    var data = {};
    try { data = JSON.parse(p.data || '{}'); } catch (err) { data = {}; }

    var user = null;
    if (action !== 'submitRequest') {   // 只有 submitRequest 是公開的
      user = requireToolUser_(p.token);
      if (!user) return authFailRes_();
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (action === 'submitRequest') return submitRequest_(data);
      if (action === 'confirmIssue')  return confirmIssue_(data, user);
      if (action === 'returnPass')    return returnPass_(data, user);
      if (action === 'cancelRequest') return cancelRequest_(data, user);
      if (action === 'setCardDisabled') return setCardDisabled_(data, user);
      return jsonRes_({ status: 'error', msg: '未知動作: ' + action });
    } finally {
      lock.releaseLock();
    }
  } catch (err2) {
    return jsonRes_({ status: 'error', msg: err2.message });
  }
}

// ============================
// 每月 1 號寄上個月月報（2026-11-02）
// 收件人：指令碼屬性 MONTHLY_REPORT_EMAILS（多人用逗號分隔，不要寫進程式碼）。
// 內容：上個月每一筆申請明細＋統計，xlsx 附件，信件本文放摘要。
// 上個月的資料一部分已被每日搬遷搬進 Supabase，所以這裡「Sheets＋Supabase 合併、依 ID 去重」；
// ⚠️ Supabase 讀不到時一律丟錯、不寄（寄出殘缺月報比沒寄更糟，會讓人以為那個月就只有這些），
//    並另寄一封「月報產生失敗」通知給收件人，GAS 失敗通知信也會寄給專案擁有者。
// ============================
var MONTHLY_MAIL_PROP_ = 'MONTHLY_REPORT_EMAILS';
var MONTHLY_SENT_PROP_ = 'LAST_MONTHLY_SENT';

function pad2_(n) { return ('0' + n).slice(-2); }
/** 以台北時間算「上個月」：{ ym:'2026-10', from:'2026-10-01', to:'2026-11-01'（不含） } */
function lastMonth_() {
  var p = Utilities.formatDate(new Date(), TZ, 'yyyy-MM').split('-');
  var y = Number(p[0]), m = Number(p[1]) - 1;
  if (m < 1) { m = 12; y--; }
  var ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return { ym: y + '-' + pad2_(m), from: y + '-' + pad2_(m) + '-01', to: ny + '-' + pad2_(nm) + '-01' };
}

/** Supabase 分頁讀全部（單次上限 1000 筆）。失敗直接丟錯。 */
function sbGetAll_(query) {
  var out = [], off = 0;
  for (;;) {
    var rows = sbRequest_('get', SB_TABLE + '?' + query + '&limit=1000&offset=' + off) || [];
    out = out.concat(rows);
    if (rows.length < 1000) break;
    off += 1000;
  }
  return out;
}

/** 某月全部申請（Sheets＋Supabase，依 id 去重，Sheets 優先）。依日期、id 排序。 */
function monthRecords_(from, to) {
  var nowMs = new Date().getTime();
  var map = {};
  readRecords_().rows.forEach(function (r) {
    if (r.date >= from && r.date < to) map[r.id] = recOut_(r, nowMs);
  });
  if (from < cutoffDate_()) {          // 這個月有部分日期可能已被搬進 Supabase
    sbGetAll_('select=*&order=id.asc&apply_date=gte.' + from + '&apply_date=lt.' + to).forEach(function (x) {
      if (!map[x.id]) map[x.id] = recFromSb_(x);
    });
  }
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
  });
}

/** 統計（純函式）。issued＝真的發出證的（已借出＋已繳回）；neverIssued＝取消／逾時沒領 */
function monthStats_(recs) {
  var s = { total: recs.length, byStatus: {}, issued: 0, neverIssued: 0, stillOut: 0, overdue: 0,
            byFloor: {}, topShops: [], avgMin: 0, avgN: 0 };
  var shopCount = {}, sumMin = 0;
  recs.forEach(function (r) {
    s.byStatus[r.status] = (s.byStatus[r.status] || 0) + 1;
    if (r.status === '已借出' || r.status === '已繳回') s.issued++;
    if (r.status === '已取消' || r.status === '已逾時') s.neverIssued++;
    if (r.status === '已借出') { s.stillOut++; if (r.overdue) s.overdue++; }
    s.byFloor[r.floor] = (s.byFloor[r.floor] || 0) + 1;
    shopCount[r.shop] = (shopCount[r.shop] || 0) + 1;
    var a = parseTs_(r.issuedAt), b = parseTs_(r.returnedAt);
    if (r.status === '已繳回' && isFinite(a) && isFinite(b) && b >= a) { sumMin += (b - a) / 60000; s.avgN++; }
  });
  s.avgMin = s.avgN ? Math.round(sumMin / s.avgN) : 0;
  s.topShops = Object.keys(shopCount).map(function (k) { return { shop: k, n: shopCount[k] }; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
  return s;
}

function htmlEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; });
}

/** 兩個分頁：統計、明細。電話欄一定設純文字（開頭的 0 不能被吃掉）。 */
function visitorReportSheets_(ym, recs, st) {
  var sum = [['項目', '數值'],
    ['月份', ym], ['申請總張數', st.total], ['實際發證（已借出＋已繳回）', st.issued],
    ['已繳回', st.byStatus['已繳回'] || 0], ['尚未繳回（寄信當下）', st.stillOut], ['其中逾期未還', st.overdue],
    ['已取消', st.byStatus['已取消'] || 0], ['逾時未領', st.byStatus['已逾時'] || 0],
    ['平均借用時間（分鐘，發證→繳回）', st.avgMin], ['', ''], ['各樓層申請張數', '']];
  Object.keys(st.byFloor).sort().forEach(function (f) { sum.push(['　' + f, st.byFloor[f]]); });
  sum.push(['', ''], ['申請最多的專櫃／廠商（前 5）', '']);
  st.topShops.forEach(function (t) { sum.push(['　' + t.shop, t.n]); });
  var det = [['編號', '狀態', '日期', '樓層', '專櫃或廠商', '姓名', '電話', '申請時間', '發證時間', '發證人', '繳回時間', '繳回人', '備註']];
  recs.forEach(function (r) {
    det.push([r.no, r.overdue ? '逾期未還' : r.status, r.date, r.floor, r.shop, r.name, r.phone,
              r.appliedAt, r.issuedAt, r.issuedBy, r.returnedAt, r.returnedBy, r.note]);
  });
  return [{ name: '統計', rows: sum, textCols: [] }, { name: '明細', rows: det, textCols: [3, 7, 8, 9, 11] }];
}

/** 建暫存試算表 → 匯出 xlsx → 刪暫存。textCols 是「要設純文字」的欄（1 起算）。 */
function buildXlsxBlob_(fileName, sheetsDef) {
  var ss = SpreadsheetApp.create(fileName);
  var id = ss.getId();
  try {
    sheetsDef.forEach(function (def, i) {
      var sh = i === 0 ? ss.getSheets()[0] : ss.insertSheet();
      sh.setName(def.name);
      var rows = def.rows, w = rows[0].length;
      def.textCols.forEach(function (c) { sh.getRange(1, c, rows.length, 1).setNumberFormat('@'); });
      sh.getRange(1, 1, rows.length, w).setValues(rows);
      sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#1A2340').setFontColor('#D4A800');
      sh.setFrozenRows(1);
      sh.autoResizeColumns(1, w);
    });
    SpreadsheetApp.flush();
    var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('匯出 xlsx 失敗（' + resp.getResponseCode() + '）');
    return resp.getBlob().setName(fileName + '.xlsx');
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
  }
}

function monthlyEmails_() {
  var emails = (PropertiesService.getScriptProperties().getProperty(MONTHLY_MAIL_PROP_) || '').trim();
  if (!emails) throw new Error('收件人未設定：請在「專案設定 → 指令碼屬性」新增 MONTHLY_REPORT_EMAILS（多人用逗號分隔）');
  return emails;
}

function visitorReportHtml_(ym, st) {
  var floor = Object.keys(st.byFloor).sort().map(function (f) { return htmlEsc_(f) + '：' + st.byFloor[f] + ' 張'; }).join('　');
  var warn = st.stillOut ? '<p style="color:#B91C1C">⚠ 尚有 <b>' + st.stillOut + '</b> 張洽公證尚未繳回（其中逾期 ' + st.overdue + ' 張），明細請看附件。</p>' : '';
  return '<div style="font-family:Microsoft JhengHei,sans-serif;font-size:14px;line-height:1.7">' +
    '<h3>天鷹保全｜洽公證 ' + htmlEsc_(ym) + ' 月報</h3>' +
    '<table cellpadding="6" style="border-collapse:collapse"><tr><td>申請總張數</td><td><b>' + st.total + '</b></td></tr>' +
    '<tr><td>實際發證</td><td><b>' + st.issued + '</b>（已繳回 ' + (st.byStatus['已繳回'] || 0) + '，尚未繳回 ' + st.stillOut + '）</td></tr>' +
    '<tr><td>已取消／逾時未領</td><td>' + (st.byStatus['已取消'] || 0) + ' ／ ' + (st.byStatus['已逾時'] || 0) + '</td></tr>' +
    '<tr><td>平均借用時間</td><td>' + (st.avgN ? st.avgMin + ' 分鐘' : '—') + '</td></tr></table>' +
    '<p>各樓層：' + (floor || '—') + '</p>' + warn +
    '<p style="color:#666">完整明細（含姓名、電話）見附件 Excel；內容含個人資料，請妥善保管。<br>此信由系統於每月 1 號自動寄出。</p></div>';
}

function 寄送洽公證月報_(force) {
  var emails = monthlyEmails_();
  var lm = lastMonth_();
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(MONTHLY_SENT_PROP_) === lm.ym) { console.log(lm.ym + ' 月報已寄過，略過'); return; }
  var recs = monthRecords_(lm.from, lm.to);       // Supabase 讀不到會丟錯，不會寄出殘缺月報
  var st = monthStats_(recs);
  var blob = buildXlsxBlob_('洽公證月報_' + lm.ym, visitorReportSheets_(lm.ym, recs, st));
  MailApp.sendEmail({ to: emails, subject: '【天鷹保全】洽公證 ' + lm.ym + ' 月報（共 ' + st.total + ' 張）',
                      htmlBody: visitorReportHtml_(lm.ym, st), attachments: [blob], name: '天鷹保全 洽公證管理' });
  props.setProperty(MONTHLY_SENT_PROP_, lm.ym);
  console.log('已寄出 ' + lm.ym + ' 月報給：' + emails);
}

function 月報失敗通知_(err) {
  try {
    MailApp.sendEmail({ to: monthlyEmails_(), subject: '【天鷹保全】洽公證月報產生失敗，請通知管理員',
      htmlBody: '<p>洽公證 ' + htmlEsc_(lastMonth_().ym) + ' 月報沒有寄出。原因：' + htmlEsc_(err && err.message) +
                '</p><p>系統不會寄出資料不完整的月報。修好後請在 Apps Script 執行「手動重寄上個月月報」。</p>' });
  } catch (e) { console.log('連失敗通知都寄不出去：' + e.message); }
}

/** 觸發器進入點：每月 1 號 07:00 */
function 每月寄送月報() {
  try { 寄送洽公證月報_(false); } catch (err) { 月報失敗通知_(err); throw err; }
}
/** 手動補寄／重寄上個月（不看「已寄過」記號） */
function 手動重寄上個月月報() { 寄送洽公證月報_(true); }
/** 只需執行一次：每月 1 號早上 7 點寄上個月月報 */
function 設定每月月報觸發器() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === '每月寄送月報') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('每月寄送月報').timeBased().onMonthDay(1).atHour(7).create();
  console.log('已設定：每月 1 號 07:00 寄上個月洽公證月報（收件人：指令碼屬性 ' + MONTHLY_MAIL_PROP_ + '）');
}

// ====== 部署後手動執行 ======
function forceAuth() {
  SpreadsheetApp.openById(SPREADSHEET_ID);
  SpreadsheetApp.openById(MAIN_APP_SHEET_ID_).getSheetByName('帳號管理');
  try { UrlFetchApp.fetch(MAIN_APP_GAS_URL_, { muteHttpExceptions: true }); } catch (e) {}
  var props = PropertiesService.getScriptProperties();
  console.log(props.getProperty('SESSION_SECRET') ? 'SESSION_SECRET 已設定：走本機驗證（快）' : '⚠ 尚未設定 SESSION_SECRET：走備援驗證（較慢）');
  console.log(props.getProperty('MONTHLY_REPORT_EMAILS') ? '月報收件人已設定' : '⚠ 尚未設定 MONTHLY_REPORT_EMAILS：每月月報無法寄出');
  console.log(props.getProperty('SUPABASE_URL') && props.getProperty('SUPABASE_SECRET_KEY')
    ? 'Supabase 連線設定已填' : '⚠ 尚未設定 SUPABASE_URL／SUPABASE_SECRET_KEY：30 天前資料無法搬遷與查詢');
}
/** 只需執行一次：每天凌晨 4 點執行 archiveOldRows */
function 設定每日搬遷觸發器() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'archiveOldRows') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('archiveOldRows').timeBased().everyDays(1).atHour(4).create();
  console.log('已設定：每天 04:00 搬遷 30 天前的終態資料到 Supabase');
}

// node 測試用（GAS 環境沒有 module，不影響執行）
if (typeof module !== 'undefined') module.exports = Object.assign(module.exports || {}, {
  fixPhone_: fixPhone_, newToken_: newToken_,
  validateRequest_: validateRequest_, normPhone_: normPhone_, safeText_: safeText_, effStatus_: effStatus_,
  isOverdue_: isOverdue_, allocateNo_: allocateNo_, parseTs_: parseTs_, canUseTool_: canUseTool_,
  submitRequest_: submitRequest_, getRequest_: getRequest_, getAll_: getAll_, confirmIssue_: confirmIssue_,
  returnPass_: returnPass_, cancelRequest_: cancelRequest_, setCardDisabled_: setCardDisabled_, search_: search_,
  archiveOldRows: archiveOldRows, lastMonth_: lastMonth_, monthRecords_: monthRecords_, monthStats_: monthStats_,
  visitorReportSheets_: visitorReportSheets_, 寄送洽公證月報_: 寄送洽公證月報_, 每月寄送月報: 每月寄送月報, doPost: doPost, doGet: doGet, nextId_: nextId_, matchRec_: matchRec_
});
