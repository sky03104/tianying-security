// ============================
// 無線電管理 — 獨立 GAS（天鷹保全）
// 綁定試算表：無線電管理（新建，見下方部署說明）
//
// 分頁一「無線電」＝主清冊，一台機器一列，永遠只有一列（唯一鍵：機身編號）
//   A ID | B 機型 | C 機身編號 | D 採購日期 | E 撥發日期 | F 案場 | G 歸屬
//   | H 狀態 | I 使用者工號 | J 使用者姓名 | K 維修紀錄 | L 備註 | M 最後更新
//
// 分頁二「異動紀錄」＝流水帳，只增不改，撥發/歸還/轉移/報修/報廢都留一筆
//   A ID | B 無線電ID | C 機身編號 | D 動作 | E 原使用者 | F 新使用者
//   | G 說明 | H 操作人工號 | I 操作人姓名 | J 時間
//
// 主鍵：純數字流水號（既有最大ID+1，不可用列號──刪列會重號）
//
// 權限：組長以上（leader/vicecaptain/captain/executive/admin）。
//   設備清冊含全體員工姓名與配發狀況，不是公開資料。三層把關——
//   index.html DEFAULT_PERMS 決定看不看得到入口、tool_radio.html 前端擋、
//   本檔每個 action 再驗一次 token+角色（前兩層都在使用者瀏覽器裡改得掉，
//   後端這層才是真的）。
//
// ── 部署 ──────────────────────────────────────────────────────
// 1. Google Drive 新建一份空白試算表，複製它的 ID
//    （網址 https://docs.google.com/spreadsheets/d/【這一段】/edit）
// 2. 把下面 SPREADSHEET_ID 換成剛剛複製的 ID
// 3. 部署 → 新增部署 → 類型「網路應用程式」，執行身分「我」，存取權限「所有人」
// 4. 複製部署網址，填入 tool_radio.html 的 RADIO_GAS_URL 變數
// 5. 在編輯器選函式「初始匯入」按執行一次，把現有 95 台匯進去（只能跑一次，
//    已有資料會直接中止，不會重複匯入）
// 6. 之後改動：部署 → 管理部署作業 → 編輯(鉛筆) → 版本「新版本」
//    （不要「新增部署」，網址會變，前端全斷）
// ============================

var SPREADSHEET_ID = '請填入試算表ID'; // ← 部署前務必替換
var SHEET_MAIN = '無線電';
var SHEET_LOG = '異動紀錄';
var TZ = 'Asia/Taipei';

// 主 App（天鷹保全APP_後端_GAS.gs）部署網址：本機驗證還沒設定好時的備援驗證管道
var MAIN_APP_GAS_URL_ = 'https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec';
// 主 App 的試算表（「帳號管理」分頁在這裡），本機驗證時用來查角色／停用狀態
var MAIN_APP_SHEET_ID_ = '1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU';
// 驗證通過的結果快取幾秒（同一張通行證 5 分鐘內不用重驗；停用帳號最慢 5 分鐘後失效）
var AUTH_CACHE_SEC_ = 300;

// 允許使用本工具的角色：組長以上
var LEADER_PLUS_ROLES_ = ['leader', 'vicecaptain', 'captain', 'executive', 'admin'];

// 合法狀態。前端下拉與這裡必須一致，不在清單內的一律擋掉，
// 免得有人打錯字之後統計數字對不起來。
var STATUSES_ = ['使用中', '庫存', '公用機', '維修中', '繳回公司', '報廢', '未找到', '待盤點'];
var OWNERSHIPS_ = ['公司', '自購'];

var MAIN_HEADERS_ = ['ID', '機型', '機身編號', '採購日期', '撥發日期', '案場', '歸屬',
                     '狀態', '使用者工號', '使用者姓名', '維修紀錄', '備註', '最後更新'];
var LOG_HEADERS_ = ['ID', '無線電ID', '機身編號', '動作', '原使用者', '新使用者',
                    '說明', '操作人工號', '操作人姓名', '時間'];

// ============================
// 共用
// ============================
function jsonRes_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ══════════════════════════════════════════════════════════════
   通行證驗證（2026-09-25 改版，比照缺班調班紀錄 GAS）
   舊版：每一次讀取／新增／修改都用 UrlFetchApp 去「問」主 App 的 GAS。
     ① 慢：等於每次都要多等一支 GAS 冷啟動＋讀帳號表，讀清單動輒多好幾秒
     ② 會誤判：主 App 那邊只要逾時／忙碌／回傳格式不對，這邊一律當成「登入已失效」，
        咖哩回報「點進去會卡住」，清單空白的時間大多花在這一步
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


// 驗證通行證＋角色需組長以上，通過回傳使用者物件，不通過回傳 null
function requireLeaderPlus_(token) {
  var user = verifyAuthToken_(token);
  if (!user) return null;
  if (LEADER_PLUS_ROLES_.indexOf(user.role) === -1) { lastAuthErr_ = 'ROLE'; return null; }
  return user;
}

// 依失敗原因回不同訊息；code 給前端判斷要顯示「重新登入」還是「稍後再試」
function authFailRes_() {
  if (lastAuthErr_ === 'SERVER') {
    return jsonRes_({ status: 'error', code: 'SERVER', msg: '伺服器暫時忙碌，無法確認登入狀態，請稍後再試（不用重新登入）' });
  }
  if (lastAuthErr_ === 'ROLE') {
    return jsonRes_({ status: 'error', code: 'ROLE', msg: '權限不足：本工具僅限組長以上使用' });
  }
  return jsonRes_({ status: 'error', code: 'INVALID', msg: '登入已失效，請回天鷹保全 App 重新登入' });
}

function getMainSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_MAIN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_MAIN);
    sh.getRange(1, 1, 1, MAIN_HEADERS_.length).setValues([MAIN_HEADERS_])
      .setFontWeight('bold').setBackground('#1A2340').setFontColor('#D4A800');
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 140); // 機型
    sh.setColumnWidth(3, 190); // 機身編號
    sh.setColumnWidth(12, 240); // 備註
  }
  return sh;
}

function getLogSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_LOG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_LOG);
    sh.getRange(1, 1, 1, LOG_HEADERS_.length).setValues([LOG_HEADERS_])
      .setFontWeight('bold').setBackground('#1A2340').setFontColor('#D4A800');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 190); // 機身編號
    sh.setColumnWidth(7, 260); // 說明
  }
  return sh;
}

/* 純數字流水號主鍵。
   ⚠️ 一定要用 isFinite 過濾，不能只用 !isNaN——isNaN(Infinity) 是 false，
   Infinity 會被當成合法數字放行，之後 max+1 還是 Infinity，寫回試算表
   會變成 #NUM! 而且永久復發（2026-08-08 打烊工具真的踩過，見技術經驗筆記）。 */
function nextId_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var raw = vals[i][0];
    if (typeof raw !== 'number' || !isFinite(raw)) continue;
    var n = Math.floor(raw);
    if (n > 0 && n <= 10000000 && n > max) max = n;
  }
  return max + 1;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function fmtCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

/* 機身編號正規化後拿來比對唯一性。
   現場抄寫時空格、大小寫、全形半形都會飄（'S/NO 0531C6A51017' vs
   's/no0531c6a51017'），只做字面比對會讓同一台機器被登記成兩台，
   庫存數就永遠對不起來。 */
function normSn_(sn) {
  return String(sn == null ? '' : sn).replace(/\s+/g, '').toUpperCase();
}

// 讀出主清冊全部資料，回傳 { rows: [...], byNormSn: {正規化編號: 物件} }
function readAll_() {
  var sh = getMainSheet_();
  var last = sh.getLastRow();
  var rows = [];
  var byNormSn = {};
  if (last < 2) return { sheet: sh, rows: rows, byNormSn: byNormSn };
  var data = sh.getRange(2, 1, last - 1, MAIN_HEADERS_.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0] && !r[2]) continue; // 整列空白跳過
    var o = {
      id: Number(r[0]) || 0, row: i + 2,
      model: fmtCell_(r[1]), sn: fmtCell_(r[2]),
      buyDate: fmtCell_(r[3]), issueDate: fmtCell_(r[4]),
      site: fmtCell_(r[5]), ownership: fmtCell_(r[6]) || '公司',
      status: fmtCell_(r[7]) || '庫存',
      userEmpId: fmtCell_(r[8]), userName: fmtCell_(r[9]),
      fixNote: fmtCell_(r[10]), note: fmtCell_(r[11]),
      updatedAt: fmtCell_(r[12])
    };
    rows.push(o);
    byNormSn[normSn_(o.sn)] = o;
  }
  return { sheet: sh, rows: rows, byNormSn: byNormSn };
}

function findById_(all, id) {
  for (var i = 0; i < all.rows.length; i++) {
    if (all.rows[i].id === Number(id)) return all.rows[i];
  }
  return null;
}

// 寫一筆異動紀錄。log 只增不改，出爭議時要靠它回溯。
function writeLog_(radio, action, fromUser, toUser, desc, user) {
  var sh = getLogSheet_();
  sh.appendRow([nextId_(sh), radio.id, radio.sn, action,
                fromUser || '', toUser || '', desc || '',
                user.empId, user.name || '', now_()]);
}

// ============================
// 讀取
// ============================
function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';
  var token = (e && e.parameter) ? e.parameter.token : '';

  if (action === 'getRadios') {
    var user = requireLeaderPlus_(token);
    if (!user) return authFailRes_();
    try {
      var all = readAll_();
      var out = all.rows.map(function (o) {
        return {
          id: o.id, model: o.model, sn: o.sn, buyDate: o.buyDate, issueDate: o.issueDate,
          site: o.site, ownership: o.ownership, status: o.status,
          userEmpId: o.userEmpId, userName: o.userName,
          fixNote: o.fixNote, note: o.note, updatedAt: o.updatedAt
        };
      });
      return jsonRes_({ status: 'ok', radios: out });
    } catch (err) {
      return jsonRes_({ status: 'error', msg: err.message });
    }
  }

  if (action === 'getLogs') {
    var u2 = requireLeaderPlus_(token);
    if (!u2) return authFailRes_();
    try {
      var radioId = Number((e.parameter && e.parameter.radioId) || 0);
      var sh = getLogSheet_();
      var last = sh.getLastRow();
      if (last < 2) return jsonRes_({ status: 'ok', logs: [] });
      var data = sh.getRange(2, 1, last - 1, LOG_HEADERS_.length).getValues();
      var logs = [];
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        if (!r[0]) continue;
        if (radioId && Number(r[1]) !== radioId) continue;
        logs.push({
          id: Number(r[0]), radioId: Number(r[1]), sn: fmtCell_(r[2]), action: fmtCell_(r[3]),
          fromUser: fmtCell_(r[4]), toUser: fmtCell_(r[5]), desc: fmtCell_(r[6]),
          byEmpId: fmtCell_(r[7]), byName: fmtCell_(r[8]), at: fmtCell_(r[9])
        });
      }
      logs.reverse(); // 新的在前
      return jsonRes_({ status: 'ok', logs: logs });
    } catch (err2) {
      return jsonRes_({ status: 'error', msg: err2.message });
    }
  }

  return jsonRes_({ status: 'ok', msg: '天鷹保全 無線電管理 API 正常 ✓' });
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

    var user = requireLeaderPlus_(token);
    if (!user) return authFailRes_();

    if (action === 'addRadio')    return addRadio_(data, user);
    if (action === 'updateRadio') return updateRadio_(data, user);
    if (action === 'changeUser')  return changeUser_(data, user);
    if (action === 'setStatus')   return setStatus_(data, user);
    if (action === 'deleteRadio') return deleteRadio_(data, user);
    return jsonRes_({ status: 'error', msg: '未知動作: ' + action });
  } catch (err) {
    return jsonRes_({ status: 'error', msg: err.message });
  }
}

// ── 新增一台無線電 ──
function addRadio_(d, user) {
  var sn = String(d.sn || '').trim();
  var model = String(d.model || '').trim();
  if (!sn) return jsonRes_({ status: 'error', msg: '請填寫機身編號' });
  if (!model) return jsonRes_({ status: 'error', msg: '請填寫機型' });

  var status = String(d.status || '庫存').trim();
  if (STATUSES_.indexOf(status) === -1) return jsonRes_({ status: 'error', msg: '狀態不合法：' + status });
  var ownership = String(d.ownership || '公司').trim();
  if (OWNERSHIPS_.indexOf(ownership) === -1) ownership = '公司';

  var all = readAll_();
  // 去重：同一台機器只能有一列（大量貼上或兩個幹部同時新增都擋得住）
  var dup = all.byNormSn[normSn_(sn)];
  if (dup) return jsonRes_({ status: 'error', msg: '機身編號 ' + dup.sn + ' 已存在（' + dup.status +
                                                  (dup.userName ? '・' + dup.userName : '') + '）' });

  var sh = all.sheet;
  var id = nextId_(sh);
  var userName = String(d.userName || '').trim();
  var userEmpId = String(d.userEmpId || '').trim();
  // 狀態不是「使用中」就不該掛著使用者，否則統計會把它算成兩種身分
  if (status !== '使用中') { userName = ''; userEmpId = ''; }

  sh.appendRow([id, model, sn, String(d.buyDate || '').trim(), String(d.issueDate || '').trim(),
                String(d.site || '巨蛋').trim(), ownership, status, userEmpId, userName,
                String(d.fixNote || '').trim(), String(d.note || '').trim(), now_()]);

  writeLog_({ id: id, sn: sn }, '新增', '', userName,
            '機型 ' + model + '・狀態 ' + status, user);
  return jsonRes_({ status: 'ok', id: id });
}

// ── 修改基本資料（不動狀態與使用者，那兩件事走 setStatus / changeUser）──
function updateRadio_(d, user) {
  var id = Number(d.id);
  if (!id) return jsonRes_({ status: 'error', msg: '缺少無線電 ID' });
  var all = readAll_();
  var o = findById_(all, id);
  if (!o) return jsonRes_({ status: 'error', msg: '找不到該台無線電' });

  /* ⚠️ 全部欄位先驗完再寫。一邊驗一邊寫的話，後面某欄不合法而中途 return，
     前面幾欄已經進試算表了——使用者看到錯誤訊息以為沒改到，其實改了一半。 */
  var sn = null, ow = null;
  if (d.sn != null) {
    sn = String(d.sn).trim();
    if (!sn) return jsonRes_({ status: 'error', msg: '機身編號不可空白' });
    var dup = all.byNormSn[normSn_(sn)];
    if (dup && dup.id !== id) return jsonRes_({ status: 'error', msg: '機身編號 ' + dup.sn + ' 已被其他機器使用' });
  }
  if (d.ownership != null) {
    ow = String(d.ownership).trim();
    if (OWNERSHIPS_.indexOf(ow) === -1) return jsonRes_({ status: 'error', msg: '歸屬只能是 公司 或 自購' });
  }

  var sh = all.sheet;
  if (sn !== null)         sh.getRange(o.row, 3).setValue(sn);
  if (ow !== null)         sh.getRange(o.row, 7).setValue(ow);
  if (d.model != null)     sh.getRange(o.row, 2).setValue(String(d.model).trim());
  if (d.buyDate != null)   sh.getRange(o.row, 4).setValue(String(d.buyDate).trim());
  if (d.issueDate != null) sh.getRange(o.row, 5).setValue(String(d.issueDate).trim());
  if (d.site != null)      sh.getRange(o.row, 6).setValue(String(d.site).trim());
  if (d.fixNote != null)   sh.getRange(o.row, 11).setValue(String(d.fixNote).trim());
  if (d.note != null)      sh.getRange(o.row, 12).setValue(String(d.note).trim());
  sh.getRange(o.row, 13).setValue(now_());

  writeLog_(o, '修改資料', o.userName, o.userName, String(d.desc || '基本資料更新'), user);
  return jsonRes_({ status: 'ok' });
}

/* ── 撥發／歸還／轉移：同一支 API ──
   toUserName 有值＝撥發或轉移（狀態一律變「使用中」）
   toUserName 空白＝歸還（狀態變成呼叫端指定的 backStatus，預設「庫存」）
   一台機器的使用者與狀態永遠一起改，不留「使用中但沒人」或
   「庫存卻掛著人」這種前後矛盾的資料。 */
function changeUser_(d, user) {
  var id = Number(d.id);
  if (!id) return jsonRes_({ status: 'error', msg: '缺少無線電 ID' });
  var all = readAll_();
  var o = findById_(all, id);
  if (!o) return jsonRes_({ status: 'error', msg: '找不到該台無線電' });

  var toName = String(d.toUserName || '').trim();
  var toEmpId = String(d.toUserEmpId || '').trim();
  var sh = all.sheet;
  var action, status;

  if (toName) {
    if (o.status === '報廢') return jsonRes_({ status: 'error', msg: '已報廢的機器不能撥發，請先改狀態' });
    action = o.userName ? '轉移' : '撥發';
    status = '使用中';
    // 撥發日期沒填就補今天（民國年格式跟舊表一致，例：115.08.19）
    var issue = String(d.issueDate || '').trim() || rocToday_();
    sh.getRange(o.row, 5).setValue(issue);
  } else {
    action = '歸還';
    status = String(d.backStatus || '庫存').trim();
    if (STATUSES_.indexOf(status) === -1) return jsonRes_({ status: 'error', msg: '狀態不合法：' + status });
    if (status === '使用中') return jsonRes_({ status: 'error', msg: '歸還後的狀態不能是「使用中」' });
  }

  sh.getRange(o.row, 8).setValue(status);
  sh.getRange(o.row, 9).setValue(toEmpId);
  sh.getRange(o.row, 10).setValue(toName);
  sh.getRange(o.row, 13).setValue(now_());

  writeLog_(o, action, o.userName, toName,
            String(d.desc || '').trim() || ('狀態 ' + o.status + ' → ' + status), user);
  return jsonRes_({ status: 'ok' });
}

// ── 只改狀態（報修／修好／報廢／繳回／盤點）──
function setStatus_(d, user) {
  var id = Number(d.id);
  if (!id) return jsonRes_({ status: 'error', msg: '缺少無線電 ID' });
  var status = String(d.status || '').trim();
  if (STATUSES_.indexOf(status) === -1) return jsonRes_({ status: 'error', msg: '狀態不合法：' + status });

  var all = readAll_();
  var o = findById_(all, id);
  if (!o) return jsonRes_({ status: 'error', msg: '找不到該台無線電' });
  var sh = all.sheet;

  /* ⚠️ 檢查一定要在任何 setValue 之前做完。
     原本是先寫狀態再檢查，回傳錯誤時那一列已經被改成「使用中」卻沒有使用者，
     畫面看起來是拒絕了、資料其實已經壞掉（測試抓到）。 */
  if (status === '使用中' && !o.userName) {
    return jsonRes_({ status: 'error', msg: '要改成「使用中」請用撥發功能指定使用者' });
  }

  sh.getRange(o.row, 8).setValue(status);
  // 離開「使用中」代表機器不在人身上了，使用者欄一併清空
  if (status !== '使用中') {
    sh.getRange(o.row, 9).setValue('');
    sh.getRange(o.row, 10).setValue('');
  }
  if (d.fixNote != null) sh.getRange(o.row, 11).setValue(String(d.fixNote).trim());
  sh.getRange(o.row, 13).setValue(now_());

  writeLog_(o, '狀態變更', o.userName, status === '使用中' ? o.userName : '',
            o.status + ' → ' + status + (d.desc ? '・' + String(d.desc).trim() : ''), user);
  return jsonRes_({ status: 'ok' });
}

// ── 刪除（誤登記才用；正常淘汰請改狀態為「報廢」，紀錄要留著）──
function deleteRadio_(d, user) {
  var id = Number(d.id);
  if (!id) return jsonRes_({ status: 'error', msg: '缺少無線電 ID' });
  var all = readAll_();
  var o = findById_(all, id);
  if (!o) return jsonRes_({ status: 'error', msg: '找不到該台無線電' });
  all.sheet.deleteRow(o.row);
  writeLog_(o, '刪除', o.userName, '', '機型 ' + o.model + '・原狀態 ' + o.status, user);
  return jsonRes_({ status: 'ok' });
}

// 今天的民國年日期字串（例：115.08.19），跟舊表寫法一致
function rocToday_() {
  var d = new Date();
  var y = Number(Utilities.formatDate(d, TZ, 'yyyy')) - 1911;
  return y + '.' + Utilities.formatDate(d, TZ, 'MM.dd');
}

// ============================
// 初始匯入（只跑一次，從編輯器手動執行）
// ============================
// 資料來源：咖哩提供的「無線電編列登錄.xlsx」三個分頁去重合併後的現況。
//   優先序：無線電持有人（最新現況）> 故障繳回編號 > 無線電使用狀況（舊表）
//   同一台機器以機身編號為準只留一列。
//   ⚠️ 標為「待盤點」的是只出現在舊表「無線電使用狀況」、新表沒收錄的機器，
//      不確定是已換新機還是漏登記，要現場盤點過才改狀態，不要直接當成使用中。
// 欄位順序：機型, 機身編號, 採購日期, 撥發日期, 案場, 歸屬, 狀態, 使用者姓名, 維修紀錄, 備註
var SEED_DATA_ = [
  ["NTS-18LC", "S/N2107E01028", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "張馨遠", "", ""],
  ["NTS-18LC", "S/N2407E00466", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "葉茂榮", "", "已更換新機 此為舊機編號S/N2107E01037"],
  ["NTS-18LC", "S/N2107E01043", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "李怡蒨", "", ""],
  ["NTS-18LC", "S/N2107E01053", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "謝志遠", "", ""],
  ["NTS-18LC", "S/N2107E01208", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "謝伯維", "", ""],
  ["NTS-18LC", "S/N2107E01209", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "羅聖凱", "", ""],
  ["NTS-18LC", "S/N2407E00461", "113.5.21", "114.11.1", "巨蛋", "公司", "使用中", "張宏偉", "", ""],
  ["NTS-18LC", "S/N2107E01212", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "侯佳良", "", ""],
  ["NTS-18LC", "S/N2107E01215", "113.5.21", "113.5.22", "巨蛋", "公司", "使用中", "吳國賢", "", ""],
  ["NTS-18LC", "S/N2107E01216", "113.5.21", "113.5.22", "巨蛋", "公司", "庫存", "", "", ""],
  ["NTS-18LC", "S/N2407E00004", "", "115.6.01", "本館支援(巨蛋)", "公司", "使用中", "王佩瑊", "", ""],
  ["NTS-18LC", "S/N2407E00009", "", "114.1.17", "本館支援(巨蛋)", "公司", "使用中", "羅世峰", "", ""],
  ["NTS-18LC", "S/N2107E01768", "", "114.1.17", "本館支援(巨蛋)", "公司", "使用中", "吳俊明", "", ""],
  ["NTS-18LC", "S/N2107E01771", "", "114.1.17", "本館支援(巨蛋)", "公司", "使用中", "龔晨嘉", "", ""],
  ["NTS-18LC", "S/N2407E00002", "", "115.2.09", "本館支援(巨蛋)", "公司", "使用中", "賴俐蓉", "", ""],
  ["NTS-18LC", "S/N2407E00202", "", "114.1.17", "本館支援(巨蛋)", "公司", "使用中", "陳楷文", "", ""],
  ["NTS-18LC", "S/N2407E00019", "", "114.1.17", "本館支援(巨蛋)", "公司", "使用中", "鄭宜慶", "", ""],
  ["NTS-18LC", "S/N2107E01770", "", "114.1.17", "本館支援(巨蛋)", "公司", "使用中", "邱品睿", "", ""],
  ["NTS-18LC", "S/N2407E00169", "", "114.2.14", "巨蛋", "公司", "使用中", "謝孟芸", "", ""],
  ["NTS-18LC", "S/N2407E00114", "", "114.2.14", "巨蛋", "公司", "使用中", "嚴永珅", "", ""],
  ["NTS-18LC", "S/N2407E00051", "", "115.4.11", "巨蛋", "公司", "使用中", "陳龍輝", "", ""],
  ["NTS-18LC", "S/N2407E00070", "", "114.2.15", "巨蛋", "公司", "使用中", "吳騰紘", "", ""],
  ["NTS-18LC", "S/N2407E00056", "", "114.2.14", "巨蛋", "公司", "使用中", "蔡東記", "", ""],
  ["NTS-18LC", "S/N2407E00080", "", "114.2.15", "巨蛋", "公司", "使用中", "陳建志", "", ""],
  ["NTS-18LC", "S/N2107E01748", "", "114.2.14", "巨蛋", "公司", "使用中", "吳銘哲", "", ""],
  ["NTS-18LC", "S/N2407E00103", "", "114.2.14", "巨蛋", "公司", "使用中", "黃春福", "", ""],
  ["NTS-18LC", "S/N2407E00087", "", "114.12.03", "巨蛋", "公司", "使用中", "劉壹志", "", "機子有破損轉交給葉茂榮"],
  ["NTS-18LC", "S/N2107E01758", "112.5.24", "114.3.6", "巨蛋", "公司", "使用中", "潘伯威", "", ""],
  ["NTS-18LC", "S/N2407E00460", "", "114.11.1", "巨蛋", "公司", "使用中", "許承訓", "", ""],
  ["NTS-18LC", "S/N2407E00458", "", "115.2.09", "巨蛋", "公司", "使用中", "林日典", "", ""],
  ["NTS-18LC", "S/N2407E00459", "", "115.06.25", "巨蛋", "公司", "使用中", "鷹凱璇", "", ""],
  ["Any Tone AT-318P", "S/NO 0531C6A51017", "109.龍邦轉賣", "114.2.10", "巨蛋", "公司", "使用中", "胡文彬", "", ""],
  ["HORA S-18A", "10610129 (S18A-013085)", "112.5.24", "", "巨蛋", "公司", "使用中", "張晉銘", "", ""],
  ["HORA S-18A", "10601095 (S18A-013082)", "112.5.24", "", "巨蛋", "公司", "使用中", "陳國榮", "", ""],
  ["HORA S-18A", "105976122 (S18A-010473)", "112.5.24", "114.11.4", "巨蛋", "公司", "使用中", "王政雄", "", "無線電耳機孔有問題 已更換Any Tone AT-318P"],
  ["HORA S-18A", "10601037 (S18A-013084)", "112.5.24", "", "巨蛋", "公司", "庫存", "", "", ""],
  ["HORA S-18A", "10601028 (S18A-013083)", "112.5.24", "", "巨蛋", "公司", "使用中", "葉茂榮", "", ""],
  ["Any Tone AT-318P", "S/NO 0531C6A70011", "109.龍邦轉賣", "115.04.11", "巨蛋", "公司", "公用機", "", "", "停管公用機"],
  ["MTS", "S/N:2305A00049", "112.自購", "114.2.06", "巨蛋", "自購", "使用中", "蔡明昌", "", ""],
  ["MTS", "S/N:2107A00073", "110.10.06(自購)", "114.2.06", "巨蛋", "自購", "使用中", "左雙福", "", ""],
  ["BADFENG", "S/N:20126272", "113.自購", "114.2.06", "巨蛋", "自購", "使用中", "鄭竣丞", "", ""],
  ["ADI AQ-50", "3AAQ503010316", "113.自購", "114.2.06", "巨蛋", "自購", "使用中", "鄭竣丞", "", ""],
  ["BADFENG", "S/N:21BFV801241", "112.自購", "114.2.07", "巨蛋", "自購", "使用中", "許承訓", "", "已更換新機 NTS-18LC"],
  ["BADFENG", "S/N:21BFV801062", "112.自購", "114.2.07", "巨蛋", "自購", "使用中", "許承訓", "", "已更換新機 NTS-18LC"],
  ["ADI AT-48", "CCAI14LP1560T", "109.自購", "114.2.07", "巨蛋", "自購", "使用中", "張瀚升", "", ""],
  ["ANYTONE", "S/NO:2289E190100186", "", "114.2.11", "巨蛋", "自購", "使用中", "陳惠景", "", ""],
  ["Any Tone AT-318P", "S/NO 0531A6480081", "109.龍邦轉賣", "", "巨蛋", "公司", "繳回公司", "", "", "繳回公司"],
  ["Any Tone AT-318P", "S/NO 0531C6430466", "109.龍邦轉賣", "", "巨蛋", "公司", "繳回公司", "", "", "繳回公司"],
  ["Any Tone AT-318P", "S/NO 0531C6A50831", "109.龍邦轉賣", "", "巨蛋", "公司", "繳回公司", "", "", "繳回公司"],
  ["Any Tone AT-318P", "S/NO 0531C6430478", "109.龍邦轉賣", "", "巨蛋", "公司", "繳回公司", "", "", "繳回公司"],
  ["Any Tone AT-318P", "S/NO 0531C6430479", "109.龍邦轉賣", "", "巨蛋", "公司", "繳回公司", "", "", "繳回公司"],
  ["HORA S-18A", "10601026 (S18A-013087)", "112.5.24", "", "巨蛋", "公司", "繳回公司", "", "無法發話", "繳回公司"],
  ["HORA S-18A", "10610133 (S18A-013081)", "112.5.24", "", "巨蛋", "公司", "未找到", "", "未找到", ""],
  ["HORA S-18A", "10601038 (S18A-013086)", "112.5.24", "", "巨蛋", "公司", "未找到", "", "未找到", ""],
  ["Any Tone AT-318P", "S/NO 0531C6A50836", "109.龍邦轉賣", "", "巨蛋", "公司", "未找到", "", "未找到", ""],
  ["Any Tone AT-318P", "S/NO 0531C6450014", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A70009", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A50829", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C5E10873", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6430445", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A50825", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A51004", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6430548", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A50008", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6430482", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A50983", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A50984", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6A50800", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["Any Tone AT-318P", "S/NO 0531C6430118", "109.龍邦轉賣", "", "巨蛋", "公司", "報廢", "", "", "報廢箱子"],
  ["NTS-18LC", "S/N2107E01037", "113.5.21", "113.5.22", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：石易晉。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["NTS-18LC", "S/N2107E01211", "113.5.21", "113.5.22", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：張宏偉。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["HORA S-18A", "10601837 (S18A-013032)", "112.5.24", "", "巨蛋", "公司", "繳回公司", "", "堪用", "繳回公司"],
  ["HORA S-18A", "102026429 (S18A-013023)", "112.5.24", "", "巨蛋", "公司", "繳回公司", "", "耳機插孔有問題", "繳回公司"],
  ["Any Tone AT-318P", "S/NO 0531C6A70004", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531A64A0305", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A50901", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A50816", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A50781", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A50780", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A50778", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A50806", "109.龍邦轉賣", "", "巨蛋", "公司", "維修中", "", "訊號不好", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A50019", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用(無夾子)", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531A6480655", "109.龍邦轉賣", "", "巨蛋", "公司", "公用機", "", "堪用(無夾子)", "公用機"],
  ["Any Tone AT-318P", "S/NO 0531C6A51011", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：王麒森。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531C6A51006", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：謝孟芸。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531C6A50817", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：嚴永珅。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531A64A0332", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：朱智崇。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531A6480663", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：吳騰紘。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531A6480073", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：蔡東記。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531C6A50812", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "正常", "原登記使用者：陳建志。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "", "原登記使用者：吳銘哲。機身號碼無法辨識編號 （來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531C6A50985", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "正常", "原登記使用者：黃春福。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531A64A0307", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "正常", "原登記使用者：白恩菽。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["Any Tone AT-318P", "S/NO 0531C6A50833", "109.龍邦轉賣", "", "巨蛋", "公司", "待盤點", "", "正常", "原登記使用者：王字豪。（來源：舊表「無線電使用狀況」，需盤點確認）"],
  ["BADFENG", "S/N:240312394", "113.自購", "114.2.06", "巨蛋", "自購", "待盤點", "", "", "原登記使用者：潘伯威。（來源：舊表「無線電使用狀況」，需盤點確認）"]
];

function 初始匯入() {
  var all = readAll_();
  if (all.rows.length > 0) {
    throw new Error('清冊裡已經有 ' + all.rows.length + ' 筆資料，初始匯入已中止（避免重複匯入）。' +
                    '若確定要重來，請先手動清空「無線電」分頁的資料列。');
  }
  var sh = all.sheet;
  var ts = now_();
  var out = [];
  var seen = {};
  for (var i = 0; i < SEED_DATA_.length; i++) {
    var s = SEED_DATA_[i];
    var key = normSn_(s[1]);
    if (!key || seen[key]) continue; // 種子資料自身也再去重一次
    seen[key] = true;
    out.push([out.length + 1, s[0], s[1], s[2], s[3], s[4], s[5], s[6],
              '', s[7], s[8], s[9], ts]);
  }
  sh.getRange(2, 1, out.length, MAIN_HEADERS_.length).setValues(out);
  getLogSheet_(); // 順手把異動紀錄分頁也建好
  Logger.log('已匯入 ' + out.length + ' 台無線電');
  return out.length;
}

// ====== 部署後手動執行一次：觸發授權＋檢查本機驗證設定 ======
// ⚠ 本機驗證需要跟主 App 同一把 SESSION_SECRET（缺班調班紀錄 GAS 設過的同一個值）：
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
