/**
 * 天鷹保全 · 事故報告 + 匿名表揚／舉報 後端（合併版 v3.2）
 * ---------------------------------------------------------------
 * 【重要】此檔取代專案內原本的「事故報告.gs」與「匿名舉報.gs」兩支，
 *   也取代上一版 v3.0/v3.1。請把舊檔內容「全部刪除」，只保留本檔，
 *   避免同專案出現兩個 doPost／doGet 衝突。
 *
 * v3.2 相對 v3.1 新增（2026-07-26，資安修補；2026-08-14 驗證改本機化）：
 *   getReports/getFeedback/updateStatus/deleteRow 原本完全無驗證，只要
 *   知道這支 GAS URL，任何人都能撈出全部事故報告與表揚檢舉（含工號姓名、
 *   事故經過、照片連結），甚至竄改狀態或永久刪除。現在四個 action 都要求
 *   帶主 App 登入通行證(token)，並比對角色需 executive/admin（deleteRow
 *   需 admin），跟前端 AdminApp 的權限判斷一致。
 *   ⚠ 2026-08-14：驗證方式從「呼叫主App的verifySession」改成 verifyAuthToken_()
 *   本機驗證簽章＋直接讀本試算表「帳號管理」分頁（本檔SS_ID跟主App SHEET_ID是同一份
 *   試算表）。原本每次讀清單都要多發一次GAS對GAS的外部連線，偶爾很慢、外部連線授權
 *   沒跑forceAuth()時還會整個連不上；改本機驗證後不再依賴外部連線。**部署後必須手動
 *   把主App的指令碼屬性 SESSION_SECRET 值，原封不動複製一份到本專案的指令碼屬性**
 *   （鍵名同樣叫 SESSION_SECRET），否則簽章對不起來、驗證會全部失敗。
 *
 * v3.1 相對 v3.0 新增（供主管專用畫面使用）：
 *   1. 兩個分頁末端新增「狀態」欄位，送出時預設「未讀」；舊表自動補表頭。
 *   2. doGet 依 action 分流，新增讀清單端點：
 *        action=getReports   → 回事故報告清單（含列號 row 與狀態）
 *        action=getFeedback  → 回匿名表揚/舉報清單（含列號 row、後台工號姓名、狀態）
 *   3. doPost 新增改狀態端點：
 *        action=updateStatus & payload={sheet:'report'|'feedback', row, status}
 *   4. 新資料送出時自動轉發 LINE 推播給主管(executive)/管理員(admin)：
 *        由本檔 notifyReportToLine_/notifyFeedbackToLine_ 呼叫「天鷹保全APP」GAS
 *        （NOTIFY_GAS_URL）代發，因 LINE Channel Access Token 只存在對方的
 *        指令碼屬性裡，本檔沒有金鑰。
 *
 * 單一 doPost 以 action 分流：
 *   action=report       → 事故報告（綁工號，不匿名）
 *   action=feedback     → 匿名表揚／舉報（前台匿名，後台試算表記工號+姓名）
 *   action=updateStatus → 主管修改處理狀態
 *
 * 部署：Web App，執行身分=我，存取權=所有人。
 *   exec URL 必須對齊前端：.../AKfycbwHXlwTMmJyA79.../exec
 *   每次改完務必「部署 → 管理部署作業 → 編輯 → 版本：新版本」，否則 URL 不更新。
 *   首次請手動執行 forceAuth() 觸發 Drive/Sheet 授權。
 */

// ===== 設定區（沿用專案既有資源）=====
var SS_ID            = '1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU'; // 主試算表
var PHOTO_FOLDER_ID  = '1K_RRPUjcWrdNAS2ppcx6OFDtlkfSfAl3';            // 公告圖片資料夾（照片統一存這裡）
var SHEET_REPORT     = '事故報告';      // 事故報告分頁
var SHEET_FEEDBACK   = '匿名表揚檢舉';  // 匿名表揚／舉報分頁（後台含工號姓名）
var TZ               = 'Asia/Taipei';
var NOTIFY_GAS_URL   = "https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec"; // 天鷹保全APP GAS（LINE推播轉發，也用於驗證登入通行證）

// 狀態白名單（主管畫面四態）
var STATUS_LIST = ['未讀', '待處理', '已知悉再觀察', '持續追蹤', '已讀', '處理中', '已處理'];

// 主管審閱清單（getReports/getFeedback/updateStatus）允許角色，跟前端 AdminApp 的 allowed 一致
var ADMIN_ROLES_  = ['executive', 'admin'];
// 永久刪除（deleteRow）僅限管理員，跟前端 canDelete 一致
var DELETE_ROLES_ = ['admin'];

/**
 * 驗證通行證（2026-08-14 改為本機驗證，不再呼叫外部 GAS）。
 * 通行證由「天鷹保全APP」GAS 登入時發放，格式：base64(工號|到期時間) + '.' + HMAC-SHA256簽章，
 * 簽章邏輯跟主 App 完全一致，密鑰(SESSION_SECRET)需與主 App 的指令碼屬性完全相同（部署後手動同步一次，
 * 見檔尾 forceAuth() 說明）。角色/狀態不必跨腳本查——事故與表揚跟主 App 本來就共用同一份試算表
 * (本檔 SS_ID === 主App SHEET_ID)，「帳號管理」分頁直接讀得到。
 * 通過回傳 { empId, name, role }，不通過回傳 null。
 */
function verifyAuthToken_(token) {
  try {
    if (!token) return null;
    var parts = String(token).split('.');
    if (parts.length !== 2) return null;

    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    if (signPayload_(payload) !== parts[1]) return null; // 簽章對不上：偽造，或密鑰尚未同步

    var seg = payload.split('|');
    if (seg.length !== 2) return null;
    var empId    = seg[0];
    var expireMs = Number(seg[1]);
    if (!empId || !expireMs) return null;
    if (new Date().getTime() > expireMs) return null; // 通行證過期

    var rec = findUserRole_(empId);
    if (!rec) return null;
    if (rec.status === 'inactive') return null;
    return { empId: empId, name: rec.name, role: rec.role };
  } catch (err) {
    return null;
  }
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

function signPayload_(payload) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(payload, getSessionSecret_()));
}

/** 讀本腳本的指令碼屬性 SESSION_SECRET，需跟主App手動同步（見 forceAuth() 說明），沒設定就直接失敗 */
function getSessionSecret_() {
  var s = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  if (!s) throw new Error('尚未設定 SESSION_SECRET（指令碼屬性），需與主App的值完全相同');
  return s;
}

/** 用工號查「帳號管理」分頁的角色/姓名/狀態——跟主App同一份試算表(SS_ID)，不用跨腳本查 */
function findUserRole_(empId) {
  var sh = SpreadsheetApp.openById(SS_ID).getSheetByName('帳號管理');
  if (!sh) return null;
  var data = sh.getDataRange().getValues();
  var target = String(empId).trim();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() !== target) continue;
    return { name: String(data[r][1]), role: String(data[r][3]), status: String(data[r][5] || 'active') };
  }
  return null;
}

// 各分頁表頭（末欄一律為「狀態」）
var HEADERS_REPORT = [
  '提交時間', '回報人員工號', '回報人員姓名', '事故日期', '事故時間',
  '事故地點', '事故類別', '事故經過描述', '處理經過與結果', '現場相關人員', '照片連結', '狀態'
];
var HEADERS_FEEDBACK = [
  '時間戳記', '類型', '對象', '事由分類', '事件描述', '發生日期', '附件連結',
  '【後台】工號', '【後台】姓名', '狀態', '處置'
];

// ====== 入口：單一 doPost，action 分流 ======
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var p = (e && e.parameter) || {};
    var action = p.action || '';
    var d = {};

    // 前端用 JSON body 送出（fetch + JSON.stringify）
    if (!action && e && e.postData && e.postData.contents) {
      try {
        var body = JSON.parse(e.postData.contents);
        action = body.action || '';
        d = body;
      } catch (err) {}
    }

    // 解析 payload（前端用 parameter 送）
    if ((!d || !d.action) && p.payload) {
      try { d = JSON.parse(p.payload); } catch (err) { d = {}; }
    }

    if (action === 'report')         return handleReport_(d);
    if (action === 'feedback')       return handleFeedback_(d);

    if (action === 'updateStatus') {
      var updUser = verifyAuthToken_(d.token);
      if (!updUser || ADMIN_ROLES_.indexOf(updUser.role) === -1) {
        return json_({ status: 'error', msg: '登入已失效或權限不足，請重新登入天鷹保全 App' });
      }
      return handleUpdateStatus_(d);
    }
    if (action === 'deleteRow') {
      var delUser = verifyAuthToken_(d.token);
      if (!delUser || DELETE_ROLES_.indexOf(delUser.role) === -1) {
        return json_({ status: 'error', msg: '登入已失效或權限不足（僅管理員可刪除），請重新登入' });
      }
      return handleDeleteRow_(d);
    }
    // 車牌辨識已移至「天鷹AI助手_GAS.gs」的 recognizePlate（共用 Gemini API Key）；
    // 本檔原本的 recognizePlate / vehicleReg 路由指向不存在的函數，已移除避免整支 doPost 崩潰。

    // 向後相容：舊版事故報告前端送 e.parameter.data（無 action）
    if (p.data) { try { return handleReport_(JSON.parse(p.data)); } catch (err2) {} }

    return json_({ status: 'error', msg: '未知的 action 參數：' + action });
  } catch (error) {
    return json_({ status: 'error', msg: '伺服器錯誤：' + (error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

// ====== 事故報告（綁工號、不匿名）======
function handleReport_(d) {
  var sheet = getSheet_(SHEET_REPORT, HEADERS_REPORT);

  // 照片：base64 陣列 → 公告資料夾
  var urls = saveImages_(d.photos, '事故照片_' + (d.empId || 'na') + '_' + (d.date || ''));

  sheet.appendRow([
    "'" + now_(),                 // 提交時間（' 前綴防 UTC 偏移）
    "'" + (d.empId || '未登入'),  // 工號（不匿名）
    "'" + (d.name || ''),         // 姓名
    "'" + (d.date || ''),         // 事故日期
    "'" + (d.time || ''),         // 事故時間
    d.location || '',
    d.category || '',
    d.description || '',
    d.action || '',               // 處理經過與結果
    d.personnel || '',            // 現場相關人員
    urls.join('\n'),
    '未讀'                        // 狀態（新增）
  ]);
  notifyReportToLine_(d);
  return json_({ status: 'ok', msg: '報告與照片已成功儲存', photos: urls.length });
}

// ====== 匿名表揚／舉報（前台匿名；後台 sheet 記工號+姓名）======
function handleFeedback_(d) {
  var sheet = getSheet_(SHEET_FEEDBACK, HEADERS_FEEDBACK);

  var typeLabel = (d.type === 'praise') ? '表揚' : (d.type === 'report' ? '反應' : (d.type || ''));
  var urls = saveImages_(d.images, typeLabel + '_' + (d.target || '') + '_' + (d.date || ''));

  sheet.appendRow([
    "'" + now_(),
    typeLabel,
    d.target || '',
    d.category || '',
    d.description || '',
    "'" + (d.date || ''),
    urls.join('\n'),
    "'" + (d.empId || '未登入'),  // 後台可見：填寫人工號
    "'" + (d.name || ''),         // 後台可見：填寫人姓名
    '未讀',                       // 狀態（新增）
    ''                            // 處置（主管裁決後寫入）
  ]);
  notifyFeedbackToLine_(d);
  return json_({ status: 'ok', msg: '提交成功', photos: urls.length });
}

// ====== 轉發通知：由「天鷹保全APP」GAS 代發 LINE 推播給主管/管理員 ======
// 本檔沒有 LINE Channel Access Token（存在天鷹保全APP GAS 的指令碼屬性），
// 故用 UrlFetchApp 打對方 GAS，由對方負責查綁定、組卡片、實際推播。
function notifyReportToLine_(d) {
  try {
    if (!NOTIFY_GAS_URL || NOTIFY_GAS_URL.indexOf('請填入') === 0) return;
    UrlFetchApp.fetch(NOTIFY_GAS_URL, {
      method: 'post',
      payload: { action: 'notifyNewReport', data: JSON.stringify({
        empId: d.empId || '未登入', name: d.name || '', date: d.date || '',
        time: d.time || '', location: d.location || '', category: d.category || '',
        description: d.description || ''
      }) },
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('notifyReportToLine_ 失敗：' + err.toString());
  }
}

function notifyFeedbackToLine_(d) {
  try {
    if (!NOTIFY_GAS_URL || NOTIFY_GAS_URL.indexOf('請填入') === 0) return;
    UrlFetchApp.fetch(NOTIFY_GAS_URL, {
      method: 'post',
      payload: { action: 'notifyNewFeedback', data: JSON.stringify({
        type: d.type || '', target: d.target || '', category: d.category || '',
        description: d.description || '', date: d.date || '',
        empId: d.empId || '未登入', name: d.name || ''
      }) },
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('notifyFeedbackToLine_ 失敗：' + err.toString());
  }
}

// ====== 主管：修改處理狀態 ======
function handleUpdateStatus_(d) {
  var which = (d.sheet === 'feedback') ? SHEET_FEEDBACK : (d.sheet === 'report' ? SHEET_REPORT : '');
  if (!which) return json_({ status: 'error', msg: '未知分頁：' + d.sheet });

  var row = parseInt(d.row, 10);
  if (!row || row < 2) return json_({ status: 'error', msg: '列號無效：' + d.row });

  var status = String(d.status || '');
  if (STATUS_LIST.indexOf(status) === -1) return json_({ status: 'error', msg: '狀態值無效：' + status });

  var headers = (which === SHEET_FEEDBACK) ? HEADERS_FEEDBACK : HEADERS_REPORT;
  var sheet = getSheet_(which, headers);
  if (row > sheet.getLastRow()) return json_({ status: 'error', msg: '列號超出範圍：' + row });

  var statusCol = headers.indexOf('狀態') + 1; // 依表頭名稱定位（不再假設末欄）
  if (statusCol < 1) return json_({ status: 'error', msg: '找不到「狀態」欄' });
  sheet.getRange(row, statusCol).setValue(status);

  // 主管裁決：寫入「處置」欄（同意表揚／不同意表揚／同意懲處／不同意懲處）
  if (d.decision !== undefined && d.decision !== null) {
    var decCol = headers.indexOf('處置') + 1;
    if (decCol >= 1) sheet.getRange(row, decCol).setValue(String(d.decision));
  }
  return json_({ status: 'ok', msg: '狀態已更新', row: row, newStatus: status });
}

// ====== 主管（限管理員）：永久刪除一列 ======
// 注意：deleteRow 會使下方列號位移，前端刪除後須重新讀清單以同步列號。
function handleDeleteRow_(d) {
  var which = (d.sheet === 'feedback') ? SHEET_FEEDBACK : (d.sheet === 'report' ? SHEET_REPORT : '');
  if (!which) return json_({ status: 'error', msg: '未知分頁：' + d.sheet });

  var row = parseInt(d.row, 10);
  if (!row || row < 2) return json_({ status: 'error', msg: '列號無效：' + d.row });

  var headers = (which === SHEET_FEEDBACK) ? HEADERS_FEEDBACK : HEADERS_REPORT;
  var sheet = getSheet_(which, headers);
  if (row > sheet.getLastRow()) return json_({ status: 'error', msg: '列號超出範圍：' + row });

  sheet.deleteRow(row);
  return json_({ status: 'ok', msg: '已刪除', deletedRow: row });
}

// ====== 取得可寫入的上傳資料夾 ======
// 優先用公告資料夾；若執行帳號連資料夾都打不開（存取遭拒），退回執行帳號自己的
// 「天鷹_上傳照片」資料夾，確保照片一定上傳得了。
function getUploadFolder_() {
  try {
    return DriveApp.getFolderById(PHOTO_FOLDER_ID);
  } catch (e) {
    var name = '天鷹_上傳照片';
    var it = DriveApp.getFoldersByName(name);
    return it.hasNext() ? it.next() : DriveApp.createFolder(name);
  }
}

// ====== 共用：base64 圖片陣列 → 上傳資料夾，回連結陣列 ======
function saveImages_(arr, namePrefix) {
  var urls = [];
  if (!arr || !arr.length) return urls;
  var folder = getUploadFolder_();
  for (var i = 0; i < arr.length; i++) {
    var raw = arr[i];
    if (!raw) continue;
    try {
      var mime = 'image/jpeg';
      if (String(raw).indexOf('data:') === 0) {
        var mm = String(raw).match(/data:([^;]+);/);
        if (mm) mime = mm[1];
      }
      var ext = 'jpg';
      if (mime.indexOf('png') > -1) ext = 'png';
      else if (mime.indexOf('gif') > -1) ext = 'gif';
      else if (mime.indexOf('webp') > -1) ext = 'webp';

      var b64 = String(raw).indexOf(',') > -1 ? String(raw).split(',')[1] : String(raw);
      var fileName = namePrefix + '_' + (i + 1) + '.' + ext;
      var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, fileName);
      var file = folder.createFile(blob);
      // 設為「任何知道連結的人可檢視」；部分帳號政策禁止任意連結共用會丟錯，
      // 包成非致命：即使共用設不起來，檔案已建立，仍回傳連結（不讓整筆變失敗）。
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {}
      urls.push(file.getUrl());
    } catch (err) {
      urls.push('（第' + (i + 1) + '張上傳失敗：' + err.message + '）');
    }
  }
  return urls;
}

// ====== 工具函式 ======
function getSheet_(name, headers) {
  var ss = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  // 既有舊表：若欄數不足（缺「狀態」欄），補寫完整表頭，使既有資料相容
  var lastCol = sheet.getLastColumn();
  if (lastCol < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

// ====== 讀清單共用：把分頁資料轉成物件陣列（含列號 row 與顯示編號）======
function readSheetRows_(name, headers, keys) {
  var sheet = getSheet_(name, headers);
  var last = sheet.getLastRow();
  var list = [];
  if (last < 2) return list;
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var rowArr = values[i];
    var obj = { row: i + 2, 編號: i + 1 }; // row=試算表實際列號（更新主鍵）；編號=純數字流水號（顯示用）
    for (var c = 0; c < keys.length; c++) {
      var v = rowArr[c];
      obj[keys[c]] = (v === null || v === undefined) ? '' : String(v);
    }
    if (!obj['狀態']) obj['狀態'] = '未讀'; // 舊資料空值視同未讀
    list.push(obj);
  }
  list.reverse(); // 最新在前
  return list;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====== GET：連線測試 + 主管讀清單 ======
// getReports/getFeedback 含工號姓名、事故經過、照片連結，只有主管(executive)/管理員(admin)
// 帶著有效通行證才能讀，跟前端 AdminApp 的 allowed 一致。
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getReports') {
    var rUser = verifyAuthToken_(e.parameter.token);
    if (!rUser || ADMIN_ROLES_.indexOf(rUser.role) === -1) {
      return json_({ status: 'error', msg: '登入已失效或權限不足，請重新登入天鷹保全 App' });
    }
    var rList = readSheetRows_(SHEET_REPORT, HEADERS_REPORT,
      ['提交時間', '工號', '姓名', '日期', '時間', '地點', '類別', '描述', '處理經過', '相關人員', '照片連結', '狀態']);
    return json_({ status: 'ok', list: rList });
  }

  if (action === 'getFeedback') {
    var fUser = verifyAuthToken_(e.parameter.token);
    if (!fUser || ADMIN_ROLES_.indexOf(fUser.role) === -1) {
      return json_({ status: 'error', msg: '登入已失效或權限不足，請重新登入天鷹保全 App' });
    }
    var fList = readSheetRows_(SHEET_FEEDBACK, HEADERS_FEEDBACK,
      ['時間戳記', '類型', '對象', '分類', '描述', '發生日期', '附件', '工號', '姓名', '狀態', '處置']);
    return json_({ status: 'ok', list: fList });
  }

  return json_({ status: 'ok', msg: '天鷹保全 事故報告/匿名表揚舉報 API 運作正常', time: new Date().toString() });
}

// ====== 首次部署用：手動執行一次以觸發授權 ======
// ⚠ 照片上傳需「完整 Drive 權限」(auth/drive)。若只授到 drive.file，寫入既有資料夾會失敗。
//   請先在「專案設定 → 顯示 appsscript.json」加上 oauthScopes（見部署說明），再執行本函式並同意授權。
// ⚠ 2026-08-14 起 getReports/getFeedback/updateStatus/deleteRow 的通行證驗證已改本機化
//   （verifyAuthToken_ 不再用 UrlFetchApp），所以這幾個 action 已不依賴「連上外部服務」授權。
//   但 notifyReportToLine_/notifyFeedbackToLine_（新資料送出轉發LINE推播）仍會呼叫外部GAS，
//   所以「連上外部服務」的授權還是要跑一次，本函式一併觸發。
//   ⚠⚠ 更重要：本機驗證需要 SESSION_SECRET 跟主App一致，部署後務必手動同步一次：
//   1. 開主App「天鷹保全APP_後端_GAS」專案 → 專案設定 → 指令碼屬性 → 複製 SESSION_SECRET 的值
//   2. 開本專案 → 專案設定 → 指令碼屬性 → 新增同名 SESSION_SECRET，貼上同一個值
//   沒做這步的話 verifyAuthToken_ 一律驗證失敗（getSessionSecret_ 直接丟例外），
//   getReports/getFeedback 對任何人（含管理員）都會回「登入已失效或權限不足」。
function forceAuth() {
  // 觸發 Sheet 讀寫
  SpreadsheetApp.openById(SS_ID);
  // 觸發 Drive「建檔」權限（關鍵：在公告資料夾建一個測試檔再刪除，逼出 createFile 範圍）
  var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  var f = folder.createFile('授權測試_' + Date.now() + '.txt', 'auth test', MimeType.PLAIN_TEXT);
  f.setTrashed(true);
  // 觸發「連上外部服務」權限（UrlFetchApp，供LINE推播轉發用）：純GET打主App、不帶action，
  // 對方會回「運作正常」測試訊息，不會觸發任何實際通知（⚠ 千萬別用notifyNewReport等action測試，
  // 那會真的推播一則假事故報告給所有主管的LINE）。重點是這行真的有執行到、跳出授權視窗讓你同意。
  try {
    UrlFetchApp.fetch(NOTIFY_GAS_URL, { muteHttpExceptions: true });
  } catch (err) { console.log('外部連線測試例外（若是授權視窗被取消才需注意）：' + err); }
  // 順便驗一次本機通行證驗證有沒有正確設定 SESSION_SECRET
  try {
    getSessionSecret_();
    console.log('SESSION_SECRET 已設定，本機通行證驗證可正常運作');
  } catch (err) {
    console.log('⚠ ' + err.message + '　→ getReports/getFeedback 目前會全部驗證失敗，請照上方註解同步密鑰');
  }
  console.log('授權測試完成！Sheet 讀寫 + Drive 建檔 + 外部連線權限皆已觸發');
}

// ====== 測試用 ======
function testReport() {
  var r = handleReport_({ date: '2026-06-22', time: '00:55', location: 'A棟大廳', category: '一般事故',
    description: '測試事故報告', action: '已處理', personnel: '王小明', empId: '011340', name: '王丞銘', photos: [] });
  Logger.log(r.getContent());
}
function testFeedback() {
  var r = handleFeedback_({ type: 'praise', target: '測試人員', category: '工作表現優異',
    description: '測試表揚', date: '2026-06-22', empId: '011340', name: '王丞銘', images: [] });
  Logger.log(r.getContent());
}
function testGetReports() {
  Logger.log(doGet({ parameter: { action: 'getReports' } }).getContent());
}
function testGetFeedback() {
  Logger.log(doGet({ parameter: { action: 'getFeedback' } }).getContent());
}
function testUpdateStatus() {
  Logger.log(handleUpdateStatus_({ sheet: 'report', row: 2, status: '已處理' }).getContent());
}
function testNotifyReportToLine() {
  notifyReportToLine_({ empId: 'TEST', name: '測試員', date: '2026-07-04', time: '10:00',
    location: 'B1F大廳', category: '設備異常', description: '測試用（本檔僅轉發，實際推播結果請看天鷹保全APP GAS 的 Log）' });
}

function testFolder() {
  try {
    var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    Logger.log('資料夾名稱: ' + folder.getName());
    Logger.log('資料夾存取成功！');
    var testFile = folder.createFile('test_' + Date.now() + '.txt', 'test', MimeType.PLAIN_TEXT);
    Logger.log('檔案建立成功: ' + testFile.getName());
    testFile.setTrashed(true);
    Logger.log('測試完成，一切正常！');
  } catch (e) {
    Logger.log('錯誤: ' + e.toString());
  }
}
