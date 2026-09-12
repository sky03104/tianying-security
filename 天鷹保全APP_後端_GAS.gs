// ════════════════════════════════════════════════════════════
// 天鷹保全APP · 帳號申請 + 請假申請 + 帳號管理 + LINE綁定 + 班表查詢Bot + 班表異動推播 + 公告欄同步 GAS Web App
// 綁定試算表：天鷹保全APP
//   https://docs.google.com/spreadsheets/d/1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU
//
// ★ 安裝方式：
//   1. 開啟上述試算表 → 擴充功能 → Apps Script
//   2. 刪除預設的 myFunction，全部貼上本檔內容
//   3. 部署 → 管理部署作業 → 編輯 → 版本選「新版本」→ 部署
//   4. Script Properties 設定：
//      LINE_CHANNEL_ACCESS_TOKEN = LINE Messaging API Channel Access Token
//      LINE_BOT_USER_ID（選填）= Bot User ID，用於Webhook來源比對
//   5. 首次儲存公告時會跳出 Drive 授權，請允許（圖片需寫入指定資料夾）
//
// ★ 功能：
//   ・submitApplication / getApplications / reviewApplication / getApprovedUsers
//   ・submitLeave / getLeaveRequests / updateLeaveStatus
//   ・getUserDB / addUser / updateUser / deleteUser
//   ・bindLine / unbindLine / getLineBinding / getLineBindings
//   ・generateLineCode
//   ・getAnnouncements / saveAnnouncements（★公告欄雲端同步，圖片上傳至 Drive 資料夾）
//   ・getDirectives / saveDirectives（★宣導事項雲端同步，獨立試算表：宣導事項＆教育訓練）
//   ・請假 LINE 推播通知（Flex Message 卡片式，含核准/駁回按鈕）
//   ・班表查詢Bot：本週班表/本月班表（早晚班選擇按鈕）、今日班表、明日班表
//   ・班表異動推播：notifyScheduleChange / notifyScheduleChangeBatch / monthScheduleReleased
//                  + onEdit偵測 + 5分鐘彙整推播
//
// ★ v2 修正（本月班表漏7/31）：
//   ・原本 SCHEDULE_DAYS 寫死 30 天，31號永遠不會被讀取/顯示（2月則會多印出不存在的29~30號）
//   ・改用 getDaysInMonth_(year, month) 依當月實際天數動態計算，涉及：
//     readEmployeeShiftsFromSheet_ / getEmployeeShifts_ / findEmployeeShiftsAuto_ /
//     buildWeekScheduleFlex_ / buildMonthScheduleText_ / handleScheduleQuery_ 今日明日跨月判斷
// ════════════════════════════════════════════════════════════

var SHEET_ID = "1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU";

function ss_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

// ── 班表查詢 Bot 用常數 ──
// v2：改用當月實際天數動態計算，不再固定30天（原本31號永遠查不到的bug）
function getDaysInMonth_(year, month) {
  return new Date(year, month, 0).getDate();
}

var SCHEDULE_SHEETS_ = {
  early: { id: "1l8SoOVDQ4nO6qBkXcNEaBzct6AN82-H_0njbKNQauUQ", sheetName: "早班班表", label: "早班" },
  late:  { id: "1hIbgESfLitqC3W9DuSFGMWEuFZKJFKzK8srorQMuia8", sheetName: "晚班班表", label: "晚班" }
};

// ── 公告欄同步用常數 ──
var ANN_SHEET_NAME = "公告欄";
var ANN_FOLDER_ID  = "1K_RRPUjcWrdNAS2ppcx6OFDtlkfSfAl3"; // 公告圖片存放的 Drive 資料夾
var ANN_MAX_IMAGES = 3;

// ── 宣導事項同步用常數（獨立試算表，非公告欄）──
// 試算表：宣導事項＆教育訓練 https://docs.google.com/spreadsheets/d/1AXhSEsR8ubdVdu8qgIJmQv7QnBJyYKBpkWQJQzoHD1I
var DIRECTIVE_SHEET_ID   = "1AXhSEsR8ubdVdu8qgIJmQv7QnBJyYKBpkWQJQzoHD1I";
var DIRECTIVE_SHEET_NAME = "宣導事項";
var DIRECTIVE_MAX_IMAGES = 10;
var DIRECTIVE_FOLDER_ID  = ANN_FOLDER_ID; // 宣導圖片沿用公告的 Drive 資料夾，如需分開存放可換成獨立資料夾 ID

// ── 明日哨點推播用常數 ──
var POST_SHEET_ID   = "1sIcdAhw0mz5iM3F5fulDNPOda2pv-t7xUhT6XXf9X7Q"; // 每日哨表試算表
var POST_SHEET_NAME = "明日哨表";
var POST_PAGE_URL   = "https://sky03104.github.io/tianying-security/post.html"; // 整張明日哨表瀏覽頁
var POST_HISTORY_SHEET_NAME = "歷史哨表"; // 結構化哨表，用於補回視覺表解析不到的哨位
var POST_TODAY_SHEET_NAME = "今日哨表"; // 每日08:00由 明日哨表 原地快照而來（gid固定不變）

var SHIFT_INFO_ = {
  'B':    { label: 'B班',    time: '20:00-08:00', color: '#60A5FA' },
  '海':   { label: '海班',   time: '22:00-10:00', color: '#22D3EE' },
  'N':    { label: 'N班',    time: '20:00-24:00', color: '#F472B6' },
  'S':    { label: 'S班',    time: '08:00-16:00', color: '#34D399' },
  'H':    { label: 'H班',    time: '11:00-22:00', color: '#A78BFA' },
  'H2':   { label: 'H2班',   time: '11:00-23:30', color: '#FBBF24' },
  'L':    { label: 'L班',    time: '12:00-20:00', color: '#38BDF8' },
  'LN':   { label: 'LN班',   time: '12:00-24:00', color: '#E879F9' },
  '南':   { label: '南館班', time: '11:00-23:00', color: '#FB7185' },
  'A':    { label: 'A班',    time: '08:00-20:00', color: '#A78BFA' },
  '休':   { label: '休假',   time: '—', color: '#FB923C' },
  '排休': { label: '排休',   time: '—', color: '#FB923C' },
  '事':   { label: '事假',   time: '—', color: '#C084FC' },
  '病':   { label: '病假',   time: '—', color: '#F87171' },
  '補':   { label: '補休',   time: '—', color: '#4ADE80' },
  '見':   { label: '見習',   time: '依排班', color: '#A3E635' },
  '離':   { label: '離職',   time: '—', color: '#6B7280' },
  '支':   { label: '支援',   time: '—', color: '#94A3B8' },
  '國例': { label: '國定假日補假', time: '—', color: '#34D399' },
  '休B':  { label: '停休加班', time: '—', color: '#EADC00' },
  '休A':  { label: '停休加班', time: '—', color: '#EADC00' },
  '-':    { label: '未排班', time: '—', color: '#6B7280' }
};

var WEEKDAY_MAP_ = { 'Monday':1, 'Tuesday':2, 'Wednesday':3, 'Thursday':4, 'Friday':5, 'Saturday':6, 'Sunday':7 };

// ============================
// POST 入口
// ============================
function doPost(e) {
  try {
    if (isLineWebhook_(e)) {
      return handleLineWebhook_(e);
    }

    var action = e.parameter.action || '';

    // ── 登入驗證（2026-07-26 新增，密碼比對從前端搬到後端）──
    if (action === 'login')              return login(e);
    if (action === 'verifySession')      return verifySession(e);
    if (action === 'changePassword')     return changePassword(e);

    if (action === 'submitApplication')  return submitApplication(e);
    if (action === 'reviewApplication')  return reviewApplication(e);
    if (action === 'submitLeave')        return submitLeave(e);
    if (action === 'updateLeaveStatus')  return updateLeaveStatus(e);
    if (action === 'updateLeaveRequest') return updateLeaveRequest(e);
    if (action === 'deleteLeaveRequest') return deleteLeaveRequest(e);

    if (action === 'addUser')            return addUser(e);
    if (action === 'updateUser')         return updateUser(e);
    if (action === 'deleteUser')         return deleteUser(e);

    if (action === 'bindLine')           return bindLine(e);
    if (action === 'unbindLine')         return unbindLine(e);
    if (action === 'generateLineCode')   return generateLineCode(e);

    if (action === 'saveAnnouncements')  return saveAnnouncements(e);

    if (action === 'saveDirectives')     return saveDirectives(e);

    if (action === 'setSettings')        return setSettings(e);

    if (action === 'notifyScheduleChange')      return notifyScheduleChangeAction_(e);
    if (action === 'notifyScheduleChangeBatch') return notifyScheduleChangeBatchAction_(e);
    if (action === 'notifyScheduleChangeBulk')  return notifyScheduleChangeBulkAction_(e);
    if (action === 'monthScheduleReleased')     return monthScheduleReleasedAction_(e);
    if (action === 'pushTomorrowPost')          return pushTomorrowPostAction_(e);

    if (action === 'notifyNewReport')   return notifyNewReportAction_(e);
    if (action === 'notifyNewFeedback') return notifyNewFeedbackAction_(e);

    return jsonRes({status:'err', msg:'未知 action: ' + action});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// ============================
// GET 入口
// ============================
function doGet(e) {
  try {
    var action = (e && e.parameter) ? (e.parameter.action || '') : '';

    if (action === 'getApplications')   return getApplications();
    if (action === 'getApprovedUsers')  return getApprovedUsers();
    if (action === 'getLeaveRequests')  return getLeaveRequests();

    if (action === 'getUserDB')         return getUserDB();

    if (action === 'getLineBinding')    return getLineBinding(e);
    if (action === 'getLineBindings')   return getLineBindings();

    if (action === 'getAnnouncements')  return getAnnouncements();

    if (action === 'getDirectives')     return getDirectives();

    if (action === 'getSettings')       return getSettings();

    if (action === 'bootstrap')         return bootstrap();

    if (action === 'resolveEmp')        return resolveEmp(e);
    if (action === 'previewTomorrowPost') return previewTomorrowPost(e);
    if (action === 'getTomorrowPost')     return getTomorrowPost(e);
    if (action === 'getTodayPost')        return getTodayPost(e);

    return jsonRes({status:'ok', msg:'天鷹保全APP API 正常 ✓'});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

// ════════════════════════════════════════════════════════════
// 【帳號申請】
// ════════════════════════════════════════════════════════════

function getAccountSheet() {
  var ss = ss_();
  var sh = ss.getSheetByName('帳號申請');
  if (!sh) {
    sh = ss.insertSheet('帳號申請');
    sh.appendRow(['申請ID', '工號', '姓名', '所屬單位', '職務', '密碼', '申請時間', '狀態', '審核時間']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 9)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
  }
  return sh;
}

function submitApplication(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId || !d.name) return jsonRes({status:'err', msg:'申請資料不完整'});
    var sh = getAccountSheet();
    var rows = sh.getDataRange().getValues();
    for (var r = 1; r < rows.length; r++) {
      var st = String(rows[r][7]);
      if (String(rows[r][1]) === String(d.empId) && (st === 'pending' || st === 'approved')) {
        return jsonRes({status:'err', msg: st === 'pending' ? '此工號已有待審核申請' : '此工號已有帳號'});
      }
    }
    sh.appendRow([d.id, "'" + d.empId, d.name, d.dept || '', d.role || 'fulltime', d.pw || '', d.appliedAt || '', 'pending', '']);
    return jsonRes({status:'ok'});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function getApplications() {
  try {
    var sh = getAccountSheet();
    var data = sh.getDataRange().getValues();
    var list = [];
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][7]) === 'pending') {
        list.push({
          id: Number(data[r][0]),
          empId: String(data[r][1]),
          name: String(data[r][2]),
          dept: String(data[r][3]),
          role: String(data[r][4]),
          // 2026-07-26：不再把申請人填的密碼回傳給前端。
          // 核准時後端會自己從申請表把密碼寫進帳號表，前端不需要知道密碼。
          isDefaultPw: (String(data[r][5]) === DEFAULT_PW_),
          appliedAt: String(data[r][6])
        });
      }
    }
    return jsonRes({status:'ok', list:list});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function reviewApplication(e) {
  try {
    var id = String(e.parameter.id);
    var decision = String(e.parameter.decision);
    if (decision !== 'approved' && decision !== 'rejected') {
      return jsonRes({status:'err', msg:'無效的審核結果'});
    }
    var sh = getAccountSheet();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === id) {
        sh.getRange(r + 1, 8).setValue(decision);
        sh.getRange(r + 1, 9).setValue(Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss'));

        if (decision === 'approved') {
          var empId = String(data[r][1]);
          var name  = String(data[r][2]);
          var dept  = String(data[r][3]);
          var role  = String(data[r][4]);
          var pw    = String(data[r][5]);
          upsertUserToUserDB_(empId, name, pw, role, dept, 'active');
        }

        return jsonRes({status:'ok'});
      }
    }
    return jsonRes({status:'err', msg:'找不到該申請單'});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function getApprovedUsers() {
  try {
    var sh = getUserDbSheet_();
    var shiftIdx = colIndexByName_(sh, '班別');
    var data = sh.getDataRange().getValues();
    var users = {};
    for (var r = 1; r < data.length; r++) {
      if (!data[r][0]) continue;
      var status = String(data[r][5] || 'active');
      if (status !== 'active') continue;
      // 班別：只信任明確填「早班」或「晚班」，其餘（空值/查不到）一律回空字串，
      // 不准悄悄當晚班——否則帳號沒設班別的人會被永久誤算進晚班統計
      var shift = '';
      if (shiftIdx >= 0) {
        var sv = String(data[r][shiftIdx] || '').trim();
        if (sv === '早班' || sv === '晚班') shift = sv;
      }
      users[String(data[r][0])] = {
        name: String(data[r][1]),
        dept: String(data[r][4]),
        role: String(data[r][3]),
        // 2026-07-26：不再回傳密碼（本 action 前端已改用 getUserDB，保留僅為相容）
        isDefaultPw: (String(data[r][2]) === DEFAULT_PW_),
        status: 'active',
        shift: shift
      };
    }
    return jsonRes({status:'ok', users:users});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// ════════════════════════════════════════════════════════════
// 【請假申請】
// ════════════════════════════════════════════════════════════

function getLeaveSheet() {
  var ss = ss_();
  var sh = ss.getSheetByName('請假申請');
  if (!sh) {
    sh = ss.insertSheet('請假申請');
    sh.appendRow(['id', '工號', '姓名', '所屬單位', '假別', '日期清單', '起始日', '結束日', '天數', '原因', '狀態', '申請時間', '班別']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 13)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
  }
  return sh;
}

// 依表頭名稱找欄位索引（0-based），找不到回 -1。容錯欄位順序變動。
function colIndexByName_(sh, name) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return -1;
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).trim() === name) return i;
  }
  return -1;
}

// 確保某分頁有指定欄位，沒有就補在最後一欄，回傳該欄索引（0-based）
function ensureColumn_(sh, name) {
  var idx = colIndexByName_(sh, name);
  if (idx >= 0) return idx;
  var newCol = sh.getLastColumn() + 1;
  sh.getRange(1, newCol)
    .setValue(name)
    .setBackground('#D4A800')
    .setFontColor('#0A0C10')
    .setFontWeight('bold');
  return newCol - 1;
}

// 用工號查帳號管理分頁的「班別」，回傳「早班」/「晚班」；查不到、空值、或非這兩個
// 精確值一律回空字串 ''——不准悄悄當晚班，否則帳號沒設班別的人會被永久誤算進晚班統計
function getShiftByEmpId_(empId) {
  try {
    var sh = getUserDbSheet_();
    var shiftIdx = colIndexByName_(sh, '班別');
    if (shiftIdx < 0) return '';
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(empId)) {
        var v = String(data[r][shiftIdx] || '').trim();
        return (v === '早班' || v === '晚班') ? v : '';
      }
    }
    return '';
  } catch (err) {
    return '';
  }
}

function submitLeave(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId || !d.name) return jsonRes({status:'err', msg:'申請資料不完整'});
    var sh = getLeaveSheet();

    // 用工號查帳號管理的班別；前端有帶明確的 早班/晚班 才優先採用
    // 查不到就存空字串，不准偷偷塞晚班——空字串代表「帳號未設定班別」，
    // getLeaveRequests() 統計人數時會直接略過，不計入任何一班的上限
    var shift = (d.shift === '早班' || d.shift === '晚班') ? d.shift : getShiftByEmpId_(d.empId);

    sh.appendRow([
      d.id, "'" + d.empId, d.name, d.dept || '', d.type || '',
      "'" + (d.dates || []).join(","),
      "'" + (d.startDate || ''), "'" + (d.endDate || ''), d.days || '', d.reason || '',
      'pending', "'" + (d.appliedAt || ''), shift
    ]);

    d.shift = shift;  // 帶給通知函式
    notifyLeaveSubmitted_(d);

    return jsonRes({status:'ok', shift:shift, shiftUnset: !shift});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function normDate_(val) {
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  return String(val == null ? '' : val).trim();
}

function getLeaveRequests() {
  try {
    var sh = getLeaveSheet();
    var shiftIdx = colIndexByName_(sh, '班別');  // 班別欄索引（容錯順序）
    var data = sh.getDataRange().getValues();
    var list = [];
    for (var r = 1; r < data.length; r++) {
      if (!data[r][0]) continue;

      var datesRaw = data[r][5];
      var dates;
      if (datesRaw instanceof Date) {
        dates = [normDate_(datesRaw)];
      } else {
        dates = String(datesRaw == null ? '' : datesRaw).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      }

      // 班別：只信任明確的「早班」/「晚班」，讀不到欄位或空值回空字串（未知），
      // 不准悄悄當晚班——空字串由前端排除在早/晚班人數統計之外
      var shift = '';
      if (shiftIdx >= 0) {
        var sv = String(data[r][shiftIdx] || '').trim();
        if (sv === '早班' || sv === '晚班') shift = sv;
      }

      list.push({
        id: data[r][0],
        empId: String(data[r][1]),
        name: String(data[r][2]),
        dept: String(data[r][3]),
        type: String(data[r][4]),
        dates: dates,
        startDate: normDate_(data[r][6]),
        endDate: normDate_(data[r][7]),
        days: data[r][8],
        reason: data[r][9],
        status: data[r][10],
        appliedAt: normDate_(data[r][11]),
        shift: shift
      });
    }
    return jsonRes({status:'ok', list:list});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString(), list:[]});
  }
}

function updateLeaveStatus(e) {
  try {
    var id = String(e.parameter.id);
    var decision = String(e.parameter.decision);
    if (decision !== 'approved' && decision !== 'rejected') {
      return jsonRes({status:'err', msg:'無效的審核結果'});
    }
    var sh = getLeaveSheet();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === id) {
        sh.getRange(r + 1, 11).setValue(decision);

        var leaveInfo = {
          empId: String(data[r][1]),
          name: String(data[r][2]),
          type: String(data[r][4]),
          startDate: normDate_(data[r][6]),
          endDate: normDate_(data[r][7]),
          days: data[r][8]
        };
        notifyLeaveResult_(leaveInfo, decision);

        return jsonRes({status:'ok'});
      }
    }
    return jsonRes({status:'err', msg:'找不到對應的請假申請 id=' + id});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// 請假編輯/刪除限管理職才能做（帶班以上）——跟前端 CAN_MANAGE_ROLES 同一份名單。
// 2026-07-23：這兩個是會直接改動/刪除試算表資料的破壞性操作，比原本
// updateLeaveStatus（只改狀態、可逆）風險高一級，前端 isManager 只是畫面
// 擋，後端網址本身是明碼公開的，一定要在後端也驗證身分，不能只信前端。
var LEAVE_MANAGE_ROLES_ = ['leader', 'vicecaptain', 'captain', 'executive', 'admin'];
function isLeaveManager_(empId) {
  try {
    var sh = getUserDbSheet_();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(empId)) {
        return LEAVE_MANAGE_ROLES_.indexOf(String(data[r][3])) !== -1;
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

// 修改已存在的請假申請（管理員用，不管目前是待審/已核准/已拒絕都能改）
// 只改內容（假別/日期/原因），不動「狀態」欄——改完狀態維持原樣，
// 因為會用到這功能的都是已有核准權限的管理員，不強制打回待審重審。
function updateLeaveRequest(e) {
  try {
    if (!isLeaveManager_(e.parameter.operatorEmpId)) return jsonRes({status:'err', msg:'無權限：僅限帶班以上人員操作'});
    var id = String(e.parameter.id);
    var type = String(e.parameter.type || '');
    if (!type) return jsonRes({status:'err', msg:'假別不可為空'});
    var reason = String(e.parameter.reason || '');
    var dates = JSON.parse(e.parameter.dates || '[]');
    if (!dates.length) return jsonRes({status:'err', msg:'日期不可為空'});
    dates = Array.from(new Set(dates)).sort(); // 去重＋排序，不信任前端有沒有防重

    var sh = getLeaveSheet();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === id) {
        sh.getRange(r + 1, 5).setValue(type);
        sh.getRange(r + 1, 6).setValue("'" + dates.join(","));
        sh.getRange(r + 1, 7).setValue("'" + dates[0]);
        sh.getRange(r + 1, 8).setValue("'" + dates[dates.length - 1]);
        sh.getRange(r + 1, 9).setValue(dates.length);
        sh.getRange(r + 1, 10).setValue(reason);

        try {
          var lineUserId = getLineUserIdByEmpId_(String(data[r][1]));
          if (lineUserId) {
            pushLineMessage_(lineUserId,
              '📋 您的請假申請已被管理員修改\n假別：' + type +
              '\n日期：' + dates.join('、') +
              (reason ? '\n原因：' + reason : ''));
          }
        } catch (notifyErr) {
          console.error('updateLeaveRequest 通知失敗：' + notifyErr.toString());
        }

        return jsonRes({status:'ok'});
      }
    }
    return jsonRes({status:'err', msg:'找不到對應的請假申請 id=' + id});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// 刪除請假申請（管理員用）——原本前端的刪除按鈕只改畫面沒有真的刪試算表，
// 這個才是真正會動到試算表資料的版本
function deleteLeaveRequest(e) {
  try {
    if (!isLeaveManager_(e.parameter.operatorEmpId)) return jsonRes({status:'err', msg:'無權限：僅限帶班以上人員操作'});
    var id = String(e.parameter.id);
    var sh = getLeaveSheet();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === id) {
        sh.deleteRow(r + 1);
        return jsonRes({status:'ok'});
      }
    }
    return jsonRes({status:'err', msg:'找不到對應的請假申請 id=' + id});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// ════════════════════════════════════════════════════════════
// 【帳號管理】── 員工帳號主資料庫
// ════════════════════════════════════════════════════════════

// 2026-07-26：原本這裡有一份 48 筆的員工帳號密碼種子資料，用於第一次自動建立
//「帳號管理」分頁。但這個 .gs 檔案存放在公開的 GitHub repo 裡，等於密碼公開，
// 因此清空。「帳號管理」分頁早已建立且持續使用中，資料以該分頁為準。
// 若日後真的需要重建分頁，請直接在試算表手動建立標題列並填入資料，
// 不要把任何真實帳號密碼寫回這個檔案。
var SEED_USER_DB_ = [];

function getUserDbSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('帳號管理');
  if (!sh) {
    sh = ss.insertSheet('帳號管理');
    sh.appendRow(['工號', '姓名', '密碼', '角色', '部門', '狀態', '更新時間']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 7)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');

    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');
    var rows = [];
    var seen = {};
    for (var i = 0; i < SEED_USER_DB_.length; i++) {
      var u = SEED_USER_DB_[i];
      rows.push(["'" + u[0], u[1], u[2], u[3], u[4], u[5], now]);
      seen[String(u[0])] = true;
    }

    var accSh = ss.getSheetByName('帳號申請');
    if (accSh) {
      var accData = accSh.getDataRange().getValues();
      for (var r = 1; r < accData.length; r++) {
        var status = String(accData[r][7]);
        var empId = String(accData[r][1]);
        if (status === 'approved' && empId && !seen[empId]) {
          rows.push([
            "'" + empId,
            String(accData[r][2]),
            String(accData[r][5]),
            String(accData[r][4] || 'fulltime'),
            String(accData[r][3] || ''),
            'active',
            now
          ]);
          seen[empId] = true;
        }
      }
    }

    if (rows.length > 0) {
      sh.getRange(2, 1, rows.length, 7).setValues(rows);
    }
  }
  return sh;
}

function getUserDB() {
  try {
    var sh = getUserDbSheet_();
    var shiftIdx = colIndexByName_(sh, '班別');
    var data = sh.getDataRange().getValues();
    var users = {};
    for (var r = 1; r < data.length; r++) {
      var empId = String(data[r][0]);
      if (!empId) continue;
      var shift = '晚班';
      if (shiftIdx >= 0) {
        var sv = String(data[r][shiftIdx] || '').trim();
        shift = (sv === '早班') ? '早班' : '晚班';
      }
      // 2026-07-26：不再把密碼回傳給前端。
      // 前端唯一需要密碼的用途是管理員畫面的「誰還沒改密碼」統計，
      // 改由後端算好一個布林值給它，前端不必也不該拿到密碼本身。
      users[empId] = {
        name: String(data[r][1]),
        isDefaultPw: (String(data[r][2]) === DEFAULT_PW_),
        role: String(data[r][3]),
        dept: String(data[r][4]),
        status: String(data[r][5] || 'active'),
        shift: shift
      };
    }
    return jsonRes({status:'ok', users:users});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// ════════════════════════════════════════════════════════════
// 【登入驗證】2026-07-26 新增
//
// 目的：把「比對帳號密碼」這件事從前端搬到後端。
//       原本前端 index.html 自己帶著全公司的帳號密碼做比對，
//       而前端檔案是會整份下載到使用者手機上的 → 等於密碼公開。
//       改成後端比對之後，前端不需要、也拿不到任何人的密碼。
//
// 設計：登入成功後發一張「通行證」(token) 給前端。
//       通行證用簽章做成，內容是「工號＋到期時間＋防偽簽章」。
//       驗證時後端重算一次簽章比對，因此不需要另外開一張表來存，
//       也不會愈長愈大、不用定期清理。
//
// ★ 本區塊全部是「新增」，沒有修改任何既有函式。
//   → 可以先單獨部署，舊版前端完全不受影響、照常運作。
// ════════════════════════════════════════════════════════════

var SESSION_TTL_DAYS_ = 30;   // 通行證有效天數，過期要重新登入
var DEFAULT_PW_ = '123';      // 新帳號的預設密碼；用來判斷「這個人還沒改過密碼」

/**
 * 取得簽章用的密鑰。第一次呼叫時自動產生並存進 Script Properties。
 * 密鑰不寫在程式碼裡（程式碼在公開的 GitHub 上），沿用本專案既有的
 * PropertiesService 慣例（LINE 權杖也是這樣存的）。
 */
function getSessionSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SESSION_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', s);
  }
  return s;
}

/** 位元組陣列轉 16 進位字串（GAS 的簽章結果是帶正負號的位元組） */
function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    out += (v.length === 1 ? '0' + v : v);
  }
  return out;
}

/** 依「工號＋到期時間」算出防偽簽章 */
function signPayload_(payload) {
  return bytesToHex_(
    Utilities.computeHmacSha256Signature(payload, getSessionSecret_())
  );
}

/** 發一張通行證給指定工號 */
function issueToken_(empId) {
  var expireMs = new Date().getTime() + SESSION_TTL_DAYS_ * 24 * 60 * 60 * 1000;
  var payload  = String(empId) + '|' + expireMs;
  return Utilities.base64EncodeWebSafe(payload) + '.' + signPayload_(payload);
}

/**
 * 驗證通行證。
 * 通過 → 回傳 { empId, name, role, dept, status, shift }
 * 不通過（偽造／過期／查無此人／帳號停用）→ 回傳 null
 *
 * 之後其他 action 要確認「這個請求真的是這個人發的」，呼叫這個函式即可，
 * 不要再相信前端自己傳過來的工號。
 */
function verifyToken_(token) {
  try {
    if (!token) return null;
    var parts = String(token).split('.');
    if (parts.length !== 2) return null;

    var payload = Utilities.newBlob(
      Utilities.base64DecodeWebSafe(parts[0])
    ).getDataAsString();

    // 簽章對不上 → 通行證被竄改過
    if (signPayload_(payload) !== parts[1]) return null;

    var seg = payload.split('|');
    if (seg.length !== 2) return null;
    var empId    = seg[0];
    var expireMs = Number(seg[1]);
    if (!empId || !expireMs) return null;

    // 過期
    if (new Date().getTime() > expireMs) return null;

    // 帳號本身還要是存在且啟用中的（停用後舊通行證要立刻失效）
    var rec = findUserRecord_(empId);
    if (!rec) return null;
    if (rec.status === 'inactive') return null;

    return {
      empId:  empId,
      name:   rec.name,
      role:   rec.role,
      dept:   rec.dept,
      status: rec.status,
      shift:  rec.shift
    };
  } catch (err) {
    return null;
  }
}

/**
 * 從「帳號管理」表查單一使用者。
 * 回傳含 pw（僅供後端內部比對用），呼叫端務必不要把 pw 傳回前端。
 */
function findUserRecord_(empId) {
  var sh = getUserDbSheet_();
  var shiftIdx = colIndexByName_(sh, '班別');
  var data = sh.getDataRange().getValues();
  var target = String(empId).trim();

  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() !== target) continue;
    var shift = '晚班';
    if (shiftIdx >= 0) {
      var sv = String(data[r][shiftIdx] || '').trim();
      shift = (sv === '早班') ? '早班' : '晚班';
    }
    return {
      empId:  target,
      name:   String(data[r][1]),
      pw:     String(data[r][2]),
      role:   String(data[r][3]),
      dept:   String(data[r][4]),
      status: String(data[r][5] || 'active'),
      shift:  shift,
      row:    r + 1   // 試算表實際列號，改密碼時要用
    };
  }
  return null;
}

/**
 * 【action: login】登入驗證
 * 收：{ empId, pw }
 * 回：成功 { status:'ok', user:{...}, token:'...' }（不含密碼）
 *     失敗 { status:'err', msg:'...' }
 */
function login(e) {
  try {
    var d = JSON.parse(e.parameter.data || '{}');
    var empId = String(d.empId || '').trim();
    var pw    = String(d.pw || '');

    if (!empId || !pw) {
      return jsonRes({status:'err', msg:'請填寫工號與密碼'});
    }

    var rec = findUserRecord_(empId);
    if (!rec) {
      return jsonRes({status:'err', msg:'工號不存在'});
    }
    if (rec.pw !== pw) {
      return jsonRes({status:'err', msg:'密碼錯誤'});
    }
    if (rec.status === 'inactive') {
      return jsonRes({status:'err', msg:'此帳號已被停用，請聯絡管理員'});
    }

    return jsonRes({
      status: 'ok',
      token:  issueToken_(empId),
      user: {
        empId:  rec.empId,
        name:   rec.name,
        role:   rec.role,
        dept:   rec.dept,
        status: rec.status,
        shift:  rec.shift
      }
    });
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

/**
 * 【action: verifySession】用通行證換回登入者資料
 * 給「記住我」自動登入用：前端只存通行證、不存密碼。
 * 收：{ token }
 */
function verifySession(e) {
  try {
    var d = JSON.parse(e.parameter.data || '{}');
    var u = verifyToken_(d.token);
    if (!u) return jsonRes({status:'err', msg:'登入已失效，請重新登入'});
    return jsonRes({status:'ok', user:u});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

/**
 * 【action: changePassword】修改自己的密碼
 * 收：{ token, oldPw, newPw }
 * 身分由通行證決定，不是由前端說了算 → 不能拿來改別人的密碼。
 */
function changePassword(e) {
  try {
    var d = JSON.parse(e.parameter.data || '{}');
    var u = verifyToken_(d.token);
    if (!u) return jsonRes({status:'err', msg:'登入已失效，請重新登入'});

    var oldPw = String(d.oldPw || '');
    var newPw = String(d.newPw || '');
    if (!newPw)            return jsonRes({status:'err', msg:'請輸入新密碼'});
    if (newPw.length < 3)  return jsonRes({status:'err', msg:'新密碼至少 3 個字'});

    var rec = findUserRecord_(u.empId);
    if (!rec)              return jsonRes({status:'err', msg:'查無此帳號'});
    if (rec.pw !== oldPw)  return jsonRes({status:'err', msg:'原密碼錯誤'});

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = getUserDbSheet_();
      sh.getRange(rec.row, 3).setValue(newPw);
      sh.getRange(rec.row, 7).setValue(
        Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss')
      );
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    // 寫入後重新讀一次確認真的寫進去了，不做「送出就當成功」
    var after = findUserRecord_(u.empId);
    if (!after || after.pw !== newPw) {
      return jsonRes({status:'err', msg:'密碼寫入失敗，請再試一次'});
    }

    return jsonRes({status:'ok', msg:'密碼已更新'});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function upsertUserToUserDB_(empId, name, pw, role, dept, status) {
  var sh = getUserDbSheet_();
  var data = sh.getDataRange().getValues();
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(empId)) {
      sh.getRange(r + 1, 2).setValue(name);
      sh.getRange(r + 1, 3).setValue(pw);
      sh.getRange(r + 1, 4).setValue(role);
      sh.getRange(r + 1, 5).setValue(dept);
      sh.getRange(r + 1, 6).setValue(status || 'active');
      sh.getRange(r + 1, 7).setValue(now);
      return;
    }
  }
  sh.appendRow(["'" + empId, name, pw, role, dept, status || 'active', now]);
}

function addUser(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId || !d.name) return jsonRes({status:'err', msg:'資料不完整'});

    var sh = getUserDbSheet_();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(d.empId)) {
        return jsonRes({status:'err', msg:'此工號已存在'});
      }
    }
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');
    sh.appendRow(["'" + d.empId, d.name, d.pw || '123', d.role || 'fulltime', d.dept || '', 'active', now]);
    return jsonRes({status:'ok'});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function updateUser(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId) return jsonRes({status:'err', msg:'缺少工號'});

    var sh = getUserDbSheet_();
    var shiftIdx = colIndexByName_(sh, '班別');  // 班別欄索引（0-based，容錯順序）
    var data = sh.getDataRange().getValues();
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(d.empId)) {
        if (d.name  !== undefined) sh.getRange(r + 1, 2).setValue(d.name);
        if (d.pw    !== undefined) sh.getRange(r + 1, 3).setValue(d.pw);
        if (d.role  !== undefined) sh.getRange(r + 1, 4).setValue(d.role);
        if (d.dept  !== undefined) sh.getRange(r + 1, 5).setValue(d.dept);
        if (d.status !== undefined) sh.getRange(r + 1, 6).setValue(d.status);
        sh.getRange(r + 1, 7).setValue(now);
        // 班別：前端有帶才寫，只接受 早班/晚班
        if (d.shift !== undefined && shiftIdx >= 0) {
          var sv = (d.shift === '早班') ? '早班' : '晚班';
          sh.getRange(r + 1, shiftIdx + 1).setValue(sv);
        }
        return jsonRes({status:'ok'});
      }
    }
    return jsonRes({status:'err', msg:'找不到此工號'});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function deleteUser(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId) return jsonRes({status:'err', msg:'缺少工號'});

    var sh = getUserDbSheet_();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(d.empId)) {
        sh.deleteRow(r + 1);
        return jsonRes({status:'ok'});
      }
    }
    return jsonRes({status:'err', msg:'找不到此工號'});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// ════════════════════════════════════════════════════════════
// 【公告欄同步】── 公告文字寫入「公告欄」分頁，圖片上傳至 Drive 資料夾換成連結
// ════════════════════════════════════════════════════════════

// 取得（或建立）「公告欄」分頁，並確保表頭存在
function getAnnSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(ANN_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ANN_SHEET_NAME);
    sh.appendRow(['ID', '標題', '內容', '發布者', '日期', '置頂', '圖片', '更新時間']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
  }
  return sh;
}

// 將 base64 (data URL) 圖片上傳到 Drive 資料夾，回傳可內嵌的縮圖連結；失敗回傳 null
function annUploadImage_(folder, dataUrl, baseName) {
  try {
    var m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    var contentType = m[1];
    var b64 = m[2];
    var ext = (contentType.split('/')[1] || 'png').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    var bytes = Utilities.base64Decode(b64);
    var blob = Utilities.newBlob(bytes, contentType, baseName + '.' + ext);
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600';
  } catch (err) {
    return null;
  }
}

// 讀取全部公告 → 回傳給前端（含圖片 Drive 連結陣列）
function getAnnouncements() {
  try {
    var sh = getAnnSheet_();
    var last = sh.getLastRow();
    var rows = [];
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, 8).getValues();
      for (var i = 0; i < vals.length; i++) {
        var r = vals[i];
        if (r[0] === '' && r[1] === '') continue;
        var imgs = [];
        try { var p = JSON.parse(r[6] || '[]'); if (Array.isArray(p)) imgs = p; } catch (e) {}
        var dateStr = (r[4] instanceof Date)
          ? Utilities.formatDate(r[4], 'Asia/Taipei', 'yyyy-MM-dd')
          : String(r[4] || '');
        var pin = (r[5] === true) || String(r[5]).toLowerCase() === 'true' || r[5] === '是';
        rows.push({
          id: Number(r[0]) || r[0],
          title: String(r[1] || ''),
          content: String(r[2] || ''),
          author: String(r[3] || ''),
          date: dateStr,
          pinned: pin,
          images: imgs
        });
      }
    }
    return jsonRes({status:'ok', rows:rows});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString(), rows:[]});
  }
}

// 整份覆寫公告（最後寫入為準）。新圖(base64)上傳 Drive 換連結，舊圖(連結)沿用。回傳含連結的完整清單。
function saveAnnouncements(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e0) {}
  try {
    var payload = JSON.parse(e.parameter.data || '{}');
    var list = payload.announcements || [];

    var folder = null;
    try { folder = DriveApp.getFolderById(ANN_FOLDER_ID); } catch (e1) { folder = null; }

    var out = [];       // 回傳前端（圖片已換 Drive 連結）
    var sheetRows = [];
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');

    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      var imgsIn = Array.isArray(a.images) ? a.images : [];
      var imgsOut = [];
      for (var j = 0; j < imgsIn.length && j < ANN_MAX_IMAGES; j++) {
        var src = String(imgsIn[j] || '');
        if (src.indexOf('data:') === 0) {
          var url = folder ? annUploadImage_(folder, src, '公告_' + (a.id || '') + '_' + (j + 1) + '_' + Date.now()) : null;
          if (url) imgsOut.push(url); // 上傳失敗則略過該圖（不存 base64，避免撐爆儲存格）
        } else if (src) {
          imgsOut.push(src); // 已是連結，沿用
        }
      }

      out.push({
        id: a.id,
        title: String(a.title || ''),
        content: String(a.content || ''),
        author: String(a.author || ''),
        date: String(a.date || ''),
        pinned: !!a.pinned,
        images: imgsOut
      });

      sheetRows.push([
        a.id != null ? a.id : '',
        String(a.title || ''),
        String(a.content || ''),
        String(a.author || ''),
        String(a.date || ''),
        a.pinned ? true : false,
        JSON.stringify(imgsOut),
        now
      ]);
    }

    var sh = getAnnSheet_();
    var last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, 8).clearContent(); // 清舊資料（保留表頭）
    if (sheetRows.length) sh.getRange(2, 1, sheetRows.length, 8).setValues(sheetRows);

    return jsonRes({status:'ok', rows:out, count:out.length});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ════════════════════════════════════════════════════════════
// 【宣導事項同步】── 獨立試算表，供首頁「宣導事項」按鈕讀取/編輯
// ════════════════════════════════════════════════════════════

// 取得（或建立）宣導事項分頁，並確保表頭存在
function getDirectiveSheet_() {
  var ss = SpreadsheetApp.openById(DIRECTIVE_SHEET_ID);
  var sh = ss.getSheetByName(DIRECTIVE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(DIRECTIVE_SHEET_NAME);
    sh.appendRow(['ID', '標題', '內容', '發布者', '日期', '置頂', '圖片', '更新時間']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8)
      .setBackground('#818CF8')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
  }
  return sh;
}

// 讀取全部宣導事項 → 回傳給前端（含圖片 Drive 連結陣列）
function getDirectives() {
  try {
    var sh = getDirectiveSheet_();
    var last = sh.getLastRow();
    var rows = [];
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, 8).getValues();
      for (var i = 0; i < vals.length; i++) {
        var r = vals[i];
        if (r[0] === '' && r[1] === '') continue;
        var dateStr = (r[4] instanceof Date)
          ? Utilities.formatDate(r[4], 'Asia/Taipei', 'yyyy-MM-dd')
          : String(r[4] || '');
        var pin = (r[5] === true) || String(r[5]).toLowerCase() === 'true' || r[5] === '是';
        var imgs = [];
        try { var p = JSON.parse(r[6] || '[]'); if (Array.isArray(p)) imgs = p; } catch (e) {}
        rows.push({
          id: Number(r[0]) || r[0],
          title: String(r[1] || ''),
          content: String(r[2] || ''),
          author: String(r[3] || ''),
          date: dateStr,
          pinned: pin,
          images: imgs
        });
      }
    }
    return jsonRes({status:'ok', rows:rows});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString(), rows:[]});
  }
}

// 整份覆寫宣導事項（最後寫入為準）。新圖(base64)上傳 Drive 換連結，舊圖(連結)沿用。
function saveDirectives(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e0) {}
  try {
    var payload = JSON.parse(e.parameter.data || '{}');
    var list = payload.directives || [];

    var folder = null;
    try { folder = DriveApp.getFolderById(DIRECTIVE_FOLDER_ID); } catch (e1) { folder = null; }

    var out = [];
    var sheetRows = [];
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');

    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      var imgsIn = Array.isArray(a.images) ? a.images : [];
      var imgsOut = [];
      for (var j = 0; j < imgsIn.length && j < DIRECTIVE_MAX_IMAGES; j++) {
        var src = String(imgsIn[j] || '');
        if (src.indexOf('data:') === 0) {
          var url = folder ? annUploadImage_(folder, src, '宣導_' + (a.id || '') + '_' + (j + 1) + '_' + Date.now()) : null;
          if (url) imgsOut.push(url);
        } else if (src) {
          imgsOut.push(src);
        }
      }

      out.push({
        id: a.id,
        title: String(a.title || ''),
        content: String(a.content || ''),
        author: String(a.author || ''),
        date: String(a.date || ''),
        pinned: !!a.pinned,
        images: imgsOut
      });
      sheetRows.push([
        a.id != null ? a.id : '',
        String(a.title || ''),
        String(a.content || ''),
        String(a.author || ''),
        String(a.date || ''),
        a.pinned ? true : false,
        JSON.stringify(imgsOut),
        now
      ]);
    }

    var sh = getDirectiveSheet_();
    var last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, 8).clearContent();
    if (sheetRows.length) sh.getRange(2, 1, sheetRows.length, 8).setValues(sheetRows);

    return jsonRes({status:'ok', rows:out, count:out.length});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ════════════════════════════════════════════════════════════
// 【LINE綁定】── 員工帳號與 LINE 帳號綁定
// ════════════════════════════════════════════════════════════

function getLineBindSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('LINE綁定');
  if (!sh) {
    sh = ss.insertSheet('LINE綁定');
    sh.appendRow(['工號', '姓名', 'LINE UserID', '綁定時間', '狀態']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 5)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
  }
  return sh;
}

function bindLine(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId || !d.lineUserId) return jsonRes({status:'err', msg:'資料不完整'});

    var sh = getLineBindSheet_();
    var data = sh.getDataRange().getValues();
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][2]) === String(d.lineUserId)
          && String(data[r][4]) === 'bound'
          && String(data[r][0]) !== String(d.empId)) {
        return jsonRes({status:'err', msg:'此 LINE 帳號已綁定其他工號'});
      }
    }

    for (var r2 = 1; r2 < data.length; r2++) {
      if (String(data[r2][0]) === String(d.empId)) {
        sh.getRange(r2 + 1, 2).setValue(d.name || data[r2][1]);
        sh.getRange(r2 + 1, 3).setValue(d.lineUserId);
        sh.getRange(r2 + 1, 4).setValue(now);
        sh.getRange(r2 + 1, 5).setValue('bound');
        return jsonRes({status:'ok'});
      }
    }
    sh.appendRow(["'" + d.empId, d.name || '', d.lineUserId, now, 'bound']);
    return jsonRes({status:'ok'});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function unbindLine(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId) return jsonRes({status:'err', msg:'缺少工號'});

    var sh = getLineBindSheet_();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(d.empId)) {
        sh.getRange(r + 1, 5).setValue('unbound');
        return jsonRes({status:'ok'});
      }
    }
    return jsonRes({status:'err', msg:'找不到此工號的綁定紀錄'});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function getLineBinding(e) {
  try {
    var empId = String((e && e.parameter && e.parameter.empId) || '');
    if (!empId) return jsonRes({status:'err', msg:'缺少工號'});

    var sh = getLineBindSheet_();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === empId) {
        return jsonRes({
          status:'ok',
          bound: String(data[r][4]) === 'bound',
          empId: empId,
          name: String(data[r][1]),
          lineUserId: String(data[r][2]),
          boundAt: String(data[r][3])
        });
      }
    }
    return jsonRes({status:'ok', bound:false, empId:empId});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function getLineBindings() {
  try {
    var sh = getLineBindSheet_();
    var data = sh.getDataRange().getValues();
    var list = [];
    for (var r = 1; r < data.length; r++) {
      if (!data[r][0]) continue;
      list.push({
        empId: String(data[r][0]),
        name: String(data[r][1]),
        lineUserId: String(data[r][2]),
        boundAt: String(data[r][3]),
        status: String(data[r][4])
      });
    }
    return jsonRes({status:'ok', list:list});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString(), list:[]});
  }
}

// ════════════════════════════════════════════════════════════
// 【LINE綁定驗證碼】
// ════════════════════════════════════════════════════════════

function getLineCodeSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('LINE驗證碼');
  if (!sh) {
    sh = ss.insertSheet('LINE驗證碼');
    sh.appendRow(['工號', '姓名', '驗證碼', '產生時間', '狀態', '過期時間']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 6)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
  }
  return sh;
}

function genCode6_() {
  var n = Math.floor(Math.random() * 1000000);
  var s = String(n);
  while (s.length < 6) s = '0' + s;
  return s;
}

function generateLineCode(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId) return jsonRes({status:'err', msg:'缺少工號'});

    var sh = getLineCodeSheet_();
    var data = sh.getDataRange().getValues();
    var now = new Date();
    var nowStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');
    var expireAt = new Date(now.getTime() + 5 * 60 * 1000);
    var expireStr = Utilities.formatDate(expireAt, 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');

    var code = genCode6_();

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(d.empId)) {
        sh.getRange(r + 1, 2).setValue(d.name || data[r][1]);
        sh.getRange(r + 1, 3).setValue(code);
        sh.getRange(r + 1, 4).setValue(nowStr);
        sh.getRange(r + 1, 5).setValue('pending');
        sh.getRange(r + 1, 6).setValue(expireStr);
        return jsonRes({status:'ok', code:code, expireAt:expireStr});
      }
    }
    sh.appendRow(["'" + d.empId, d.name || '', code, nowStr, 'pending', expireStr]);
    return jsonRes({status:'ok', code:code, expireAt:expireStr});
  } catch(err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function findEmpIdByLineCode_(code) {
  var sh = getLineCodeSheet_();
  var data = sh.getDataRange().getValues();
  var now = new Date();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][2]) === String(code) && String(data[r][4]) === 'pending') {
      var expireAt = data[r][5];
      var expireDate = (expireAt instanceof Date) ? expireAt : new Date(String(expireAt).replace(/\//g, '-'));
      if (now.getTime() > expireDate.getTime()) {
        sh.getRange(r + 1, 5).setValue('expired');
        return null;
      }
      sh.getRange(r + 1, 5).setValue('used');
      return { empId: String(data[r][0]), name: String(data[r][1]) };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// 【LINE Bot Webhook】
// ════════════════════════════════════════════════════════════

function isLineWebhook_(e) {
  try {
    if (e.parameter && e.parameter.action) return false;
    if (!e.postData || !e.postData.contents) return false;
    var body = JSON.parse(e.postData.contents);
    return !!(body && Array.isArray(body.events));
  } catch (err) {
    return false;
  }
}

// 處理LINE Webhook事件主體
function handleLineWebhook_(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var expectedBotId = PropertiesService.getScriptProperties().getProperty('LINE_BOT_USER_ID');
    if (expectedBotId && body.destination !== expectedBotId) {
      console.error('Webhook destination 不符（' + body.destination + '），忽略此請求');
      return jsonRes({status:'err', msg:'invalid destination'});
    }

    var events = body.events || [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];

      if (ev.type === 'postback') {
        handlePostback_(ev);
        continue;
      }

      // 機器人被加入群組／聊天室 → 自動記錄 groupId，供明日哨表群組推播
      if (ev.type === 'join') {
        var src = ev.source || {};
        var gid = src.groupId || src.roomId || '';
        if (gid) {
          writeSetting_('tomorrowPostGroupId', gid);
          if (ev.replyToken) {
            replyLineMessage_(ev.replyToken,
              '✅ 已將本群組設為「明日哨表」推播群組。\n每晚 21:00 將自動發送完整哨表（早班區／晚班區）至此群組。');
          }
        }
        continue;
      }

      // ── 群組/聊天室來源：只接受推播，不回應任何文字訊息 ──
      var sourceType = (ev.source && ev.source.type) || 'user';
      if ((sourceType === 'group' || sourceType === 'room') && ev.type === 'message') continue;

      if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') continue;

      var lineUserId = (ev.source && ev.source.userId) || '';
      var replyToken = ev.replyToken || '';
      var text = String(ev.message.text || '').trim();

      if (!lineUserId || !replyToken) continue;

      if (/^\d{6}$/.test(text)) {
        var matched = findEmpIdByLineCode_(text);
        if (matched) {
          var bindResult = bindLine_internal_(matched.empId, matched.name, lineUserId);
          if (bindResult.status === 'ok') {
            replyLineMessage_(replyToken,
              '✅ 綁定成功！\n工號：' + matched.empId + '\n姓名：' + matched.name + '\n\n之後系統通知將透過此 LINE 帳號發送。');
          } else {
            replyLineMessage_(replyToken, '❌ 綁定失敗：' + (bindResult.msg || '請重新產生驗證碼後再試一次'));
          }
        } else {
          replyLineMessage_(replyToken, '❌ 驗證碼錯誤或已過期，請回到 APP「綁定 LINE 通知」重新產生驗證碼（5分鐘內有效）。');
        }
      } else if (text === '解除綁定') {
        var unbindResult = unbindLine_internal_(lineUserId);
        if (unbindResult.status === 'ok') {
          replyLineMessage_(replyToken, '✅ 已解除綁定（工號：' + unbindResult.empId + '）。\n如需再次綁定，請回到 APP 重新產生驗證碼。');
        } else {
          replyLineMessage_(replyToken, '⚠️ ' + (unbindResult.msg || '查無綁定紀錄，您尚未綁定任何工號。'));
        }
      } else if (text.indexOf('請假') !== -1 || text === '排休' || text === '我要請假') {
        replyLineFlex_(replyToken, '📝 請假申請', buildLeaveEntryFlex_());
      } else if (text.indexOf('今日哨點') !== -1) {
        handleMyTodayPost_(lineUserId, replyToken);
      } else if (text.indexOf('哨點') !== -1 || text.indexOf('上哪') !== -1) {
        handleMyTomorrowPost_(lineUserId, replyToken);
      } else if (handleScheduleQuery_(text, lineUserId, replyToken)) {
        // 班表查詢類指令已於 handleScheduleQuery_ 內處理完畢
      } else {
        replyLineMessage_(replyToken,
          '👋 歡迎使用天鷹保全通知機器人\n\n' +
          '🔗 綁定帳號：請至 APP「設定」→「綁定 LINE 通知」產生6位數驗證碼，並於5分鐘內輸入此處完成綁定。\n\n' +
          '📅 班表查詢：輸入「本週班表」「本月班表」「今日班表」「明日班表」\n\n' +
          '📝 請假申請：輸入「請假」開啟線上請假表單。\n\n' +
          '📍 今日／明日哨點：輸入「今日哨點」或「哨點」查詢執勤位置。\n\n' +
          '🔓 解除綁定：輸入「解除綁定」即可解除目前 LINE 帳號與工號的連結。');
      }
    }
    return jsonRes({status:'ok'});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function replyLineMessage_(replyToken, text) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) return;

    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: text }]
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('replyLineMessage_ 失敗：' + err.toString());
  }
}

function replyLineFlex_(replyToken, altText, flexContents) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) return;

    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{
          type: 'flex',
          altText: altText,
          contents: flexContents
        }]
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('replyLineFlex_ 失敗：' + err.toString());
  }
}

function bindLine_internal_(empId, name, lineUserId) {
  try {
    var sh = getLineBindSheet_();
    var data = sh.getDataRange().getValues();
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][2]) === String(lineUserId)
          && String(data[r][4]) === 'bound'
          && String(data[r][0]) !== String(empId)) {
        return { status: 'err', msg: '此 LINE 帳號已綁定其他工號（' + String(data[r][0]) + '），請先解除綁定' };
      }
    }

    for (var r2 = 1; r2 < data.length; r2++) {
      if (String(data[r2][0]) === String(empId)) {
        sh.getRange(r2 + 1, 2).setValue(name || data[r2][1]);
        sh.getRange(r2 + 1, 3).setValue(lineUserId);
        sh.getRange(r2 + 1, 4).setValue(now);
        sh.getRange(r2 + 1, 5).setValue('bound');
        return { status: 'ok' };
      }
    }
    sh.appendRow(["'" + empId, name || '', lineUserId, now, 'bound']);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'err', msg: err.toString() };
  }
}

function unbindLine_internal_(lineUserId) {
  try {
    var sh = getLineBindSheet_();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][2]) === String(lineUserId) && String(data[r][4]) === 'bound') {
        sh.getRange(r + 1, 5).setValue('unbound');
        return { status: 'ok', empId: String(data[r][0]) };
      }
    }
    return { status: 'err', msg: '查無綁定紀錄' };
  } catch (err) {
    return { status: 'err', msg: err.toString() };
  }
}

// ════════════════════════════════════════════════════════════
// 【請假 LINE 通知】── Flex Message 卡片式推播 + 按鈕審核
// ════════════════════════════════════════════════════════════

var LEAVE_APPROVER_ROLES_ = ['captain', 'vicecaptain', 'leader', 'admin', 'executive'];

// 2026-07-14：請假送出通知改版——LINE 免費推播額度有限，原本整部門主管
// 全推太浪費。角色階級 captain(隊長) > vicecaptain(副隊長) > leader(帶班
// 幹部)，同班別只推給階級最高的一位；並列最高就都推（現況咖哩確認同班
// 別不會並列，但保留這個容錯，避免哪天真的並列時漏推）。
// admin 不分班別、不分部門，維持全部都收；executive 改為不再自動收。
var LEAVE_ROLE_RANK_ = { captain: 1, vicecaptain: 2, leader: 3 };

// 找「該部門＋該班別」階級最高的主管（可能並列多位）＋不分班別都收的 admin
function getShiftLeaveSupervisors_(dept, shift) {
  var sh = getUserDbSheet_();
  var data = sh.getDataRange().getValues();
  var shiftIdx = colIndexByName_(sh, '班別');
  var list = [];
  var bestRank = null;
  var bestOnes = [];
  for (var r = 1; r < data.length; r++) {
    var empId = String(data[r][0]);
    if (!empId) continue;
    var role = String(data[r][3]);
    var udept = String(data[r][4]);
    var status = String(data[r][5] || 'active');
    if (status !== 'active') continue;
    if (role === 'admin') { list.push({ empId: empId, name: String(data[r][1]), role: role }); continue; }
    var rank = LEAVE_ROLE_RANK_[role];
    if (rank === undefined) continue; // vicecaptain/leader/captain 以外（含 executive）不再自動推
    if (udept !== dept) continue;
    var sv = (shiftIdx >= 0) ? String(data[r][shiftIdx] || '').trim() : '';
    if (sv !== shift) continue;
    if (bestRank === null || rank < bestRank) {
      bestRank = rank;
      bestOnes = [{ empId: empId, name: String(data[r][1]), role: role }];
    } else if (rank === bestRank) {
      bestOnes.push({ empId: empId, name: String(data[r][1]), role: role });
    }
  }
  return list.concat(bestOnes);
}

var LEAVE_TYPE_COLOR_ = {
  '事假': '#FB923C',
  '病假': '#F87171',
  '排休': '#818CF8',
  '特休': '#4ADE80',
  '公假': '#3B82F6',
  '婚假': '#F0C040',
  '喪假': '#6B7280',
  '產假': '#F87171',
  '陪產假': '#818CF8'
};

function getDeptSupervisors_(dept) {
  var sh = getUserDbSheet_();
  var data = sh.getDataRange().getValues();
  var list = [];
  for (var r = 1; r < data.length; r++) {
    var empId = String(data[r][0]);
    if (!empId) continue;
    var role = String(data[r][3]);
    var udept = String(data[r][4]);
    var status = String(data[r][5] || 'active');
    if (status !== 'active') continue;
    if (LEAVE_APPROVER_ROLES_.indexOf(role) === -1) continue;
    if ((role === 'admin' || role === 'executive') || udept === dept) {
      list.push({ empId: empId, name: String(data[r][1]), role: role });
    }
  }
  return list;
}

// 事故報告/匿名表揚 通知用：不分部門，只看角色（全公司主管+管理員都收）
function getExecutivesAndAdmins_() {
  var sh = getUserDbSheet_();
  var data = sh.getDataRange().getValues();
  var list = [];
  for (var r = 1; r < data.length; r++) {
    var empId = String(data[r][0]);
    if (!empId) continue;
    var role = String(data[r][3]);
    var status = String(data[r][5] || 'active');
    if (status !== 'active') continue;
    if (role !== 'admin' && role !== 'executive') continue;
    list.push({ empId: empId, name: String(data[r][1]), role: role });
  }
  return list;
}

function getLineUserIdByEmpId_(empId) {
  var sh = getLineBindSheet_();
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(empId) && String(data[r][4]) === 'bound') {
      return String(data[r][2]);
    }
  }
  return null;
}

function getLeaveTypeColor_(type) {
  return LEAVE_TYPE_COLOR_[type] || '#818CF8';
}

function pushLineMessage_(lineUserId, text) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token || !lineUserId) return;

    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text: text }]
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('pushLineMessage_ 失敗：' + err.toString());
  }
}

function pushLineFlex_(lineUserId, altText, flexContents) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token || !lineUserId) {
      console.error('pushLineFlex_ 略過：' + (!token ? '無 Token' : '無 lineUserId'));
      return;
    }

    var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        to: lineUserId,
        messages: [{
          type: 'flex',
          altText: altText,
          contents: flexContents
        }]
      }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code !== 200) {
      console.error('pushLineFlex_ 推播失敗 HTTP ' + code + '：' + resp.getContentText());
    }
  } catch (err) {
    console.error('pushLineFlex_ 失敗：' + err.toString());
  }
}

// ★ 唯一修改處：把「期間 + 天數」改為「請假日期」逐日列出
// d.dates 為前端傳入的日期陣列，格式 ["2026-07-04","2026-07-06",...]
function buildLeaveApprovalFlex_(d) {
  var color = getLeaveTypeColor_(d.type);
  // 將 dates 陣列轉為「07/04、07/06、07/08（共 N 天）」；若無 dates 則 fallback 原本期間格式
  var dates = Array.isArray(d.dates) ? d.dates : [];
  var datesText = dates.length
    ? dates.map(function(dt){ return String(dt).slice(5).replace('-', '/'); }).join('、') + '（共 ' + dates.length + ' 天）'
    : (d.startDate || '') + ' ~ ' + (d.endDate || '') + '（' + (d.days || 0) + ' 天）';

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '📋 請假申請待審核', color: '#0A0C10', weight: 'bold', size: 'md' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#111827',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: '申請人', color: '#8A95A8', size: 'sm', flex: 2 },
            { type: 'text', text: d.name + '（' + d.empId + '）', color: '#F5F5F5', size: 'sm', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: '單位', color: '#8A95A8', size: 'sm', flex: 2 },
            { type: 'text', text: d.dept || '-', color: '#F5F5F5', size: 'sm', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: '假別', color: '#8A95A8', size: 'sm', flex: 2 },
            { type: 'text', text: d.type || '-', color: color, size: 'sm', flex: 5, weight: 'bold' }
          ]
        },
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: '請假日期', color: '#8A95A8', size: 'sm', flex: 2 },
            { type: 'text', text: datesText, color: '#F5F5F5', size: 'sm', flex: 5, wrap: true }
          ]
        }
      ].concat(d.reason ? [{
        type: 'box', layout: 'baseline', spacing: 'sm',
        contents: [
          { type: 'text', text: '原因', color: '#8A95A8', size: 'sm', flex: 2 },
          { type: 'text', text: String(d.reason), color: '#F5F5F5', size: 'sm', flex: 5, wrap: true }
        ]
      }] : [])
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingAll: '12px',
      backgroundColor: '#0A0C10',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#4ADE80',
          action: {
            type: 'postback',
            label: '✅ 核准',
            data: 'leaveAction=approved&id=' + encodeURIComponent(d.id),
            displayText: '核准「' + d.name + '」的' + (d.type || '請假') + '申請'
          }
        },
        {
          type: 'button',
          style: 'primary',
          color: '#F87171',
          action: {
            type: 'postback',
            label: '❌ 駁回',
            data: 'leaveAction=rejected&id=' + encodeURIComponent(d.id),
            displayText: '駁回「' + d.name + '」的' + (d.type || '請假') + '申請'
          }
        }
      ]
    }
  };
}

function buildLeaveResultFlex_(leaveInfo, decision) {
  var isApproved = (decision === 'approved');
  var color = isApproved ? '#4ADE80' : '#F87171';
  var resultText = isApproved ? '✅ 已核准' : '❌ 已駁回';
  var typeColor = getLeaveTypeColor_(leaveInfo.type);

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '📋 請假審核結果', color: '#0A0C10', weight: 'bold', size: 'md' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#111827',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: '假別', color: '#8A95A8', size: 'sm', flex: 2 },
            { type: 'text', text: leaveInfo.type || '-', color: typeColor, size: 'sm', flex: 5, weight: 'bold' }
          ]
        },
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: '期間', color: '#8A95A8', size: 'sm', flex: 2 },
            { type: 'text', text: (leaveInfo.startDate || '') + ' ~ ' + (leaveInfo.endDate || ''), color: '#F5F5F5', size: 'sm', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: '天數', color: '#8A95A8', size: 'sm', flex: 2 },
            { type: 'text', text: String(leaveInfo.days || '') + ' 天', color: '#F5F5F5', size: 'sm', flex: 5 }
          ]
        },
        {
          type: 'separator', color: '#1F2937'
        },
        {
          type: 'box', layout: 'vertical', paddingTop: 'md',
          contents: [
            { type: 'text', text: '審核結果', color: '#8A95A8', size: 'sm' },
            { type: 'text', text: resultText, color: color, size: 'xl', weight: 'bold', margin: 'sm' }
          ]
        }
      ]
    }
  };
}

function notifyLeaveSubmitted_(d) {
  try {
    var supervisors = getShiftLeaveSupervisors_(d.dept || '', d.shift || '');
    if (supervisors.length === 0) return;

    var flex = buildLeaveApprovalFlex_(d);
    var altText = '📋 ' + d.name + ' 送出' + (d.type || '請假') + '申請，請審核';

    for (var i = 0; i < supervisors.length; i++) {
      var lineUserId = getLineUserIdByEmpId_(supervisors[i].empId);
      if (lineUserId) pushLineFlex_(lineUserId, altText, flex);
    }
  } catch (err) {
    console.error('notifyLeaveSubmitted_ 失敗：' + err.toString());
  }
}

function notifyLeaveResult_(leaveInfo, decision) {
  try {
    var lineUserId = getLineUserIdByEmpId_(leaveInfo.empId);
    if (!lineUserId) return;

    var flex = buildLeaveResultFlex_(leaveInfo, decision);
    var resultText = (decision === 'approved') ? '已核准' : '已駁回';
    var altText = '📋 您的' + (leaveInfo.type || '請假') + '申請' + resultText;

    pushLineFlex_(lineUserId, altText, flex);
  } catch (err) {
    console.error('notifyLeaveResult_ 失敗：' + err.toString());
  }
}

// 處理 postback 事件：請假審核按鈕 + 班表查詢早晚班選擇按鈕
function handlePostback_(ev) {
  try {
    var replyToken = ev.replyToken || '';
    var dataStr = (ev.postback && ev.postback.data) || '';
    var params = {};
    dataStr.split('&').forEach(function(pair) {
      var kv = pair.split('=');
      if (kv.length === 2) params[kv[0]] = decodeURIComponent(kv[1]);
    });

    // ── 班表查詢：早晚班選擇按鈕 ──
    if (params.scheduleQuery) {
      handleScheduleResultPostback_(params, ev);
      return;
    }

    if (params.leaveAction !== 'approved' && params.leaveAction !== 'rejected') return;

    var id = params.id;
    var decision = params.leaveAction;

    var sh = getLeaveSheet();
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(id)) {
        var currentStatus = String(data[r][10]);

        if (currentStatus !== 'pending') {
          if (replyToken) {
            replyLineMessage_(replyToken, '⚠️ 此請假申請已審核過（目前狀態：' +
              (currentStatus === 'approved' ? '✅ 已核准' : '❌ 已駁回') + '），無需重複操作。');
          }
          return;
        }

        sh.getRange(r + 1, 11).setValue(decision);

        var leaveInfo = {
          empId: String(data[r][1]),
          name: String(data[r][2]),
          type: String(data[r][4]),
          startDate: normDate_(data[r][6]),
          endDate: normDate_(data[r][7]),
          days: data[r][8]
        };

        notifyLeaveResult_(leaveInfo, decision);

        if (replyToken) {
          var resultText = (decision === 'approved') ? '✅ 已核准' : '❌ 已駁回';
          replyLineMessage_(replyToken,
            resultText + '「' + leaveInfo.name + '」的' + (leaveInfo.type || '請假') + '申請\n' +
            '期間：' + leaveInfo.startDate + ' ~ ' + leaveInfo.endDate + '（' + leaveInfo.days + '天）');
        }
        return;
      }
    }

    if (replyToken) {
      replyLineMessage_(replyToken, '❌ 找不到對應的請假申請單（id=' + id + '），可能已被刪除。');
    }
  } catch (err) {
    console.error('handlePostback_ 失敗：' + err.toString());
  }
}

// ════════════════════════════════════════════════════════════
// 【班表查詢 Bot】── 本週/本月（早晚班選擇）、今日/明日（自動判斷）
// ════════════════════════════════════════════════════════════

function getTaipeiToday_() {
  var now = new Date();
  var dowName = Utilities.formatDate(now, 'Asia/Taipei', 'EEEE');
  return {
    year:  Number(Utilities.formatDate(now, 'Asia/Taipei', 'yyyy')),
    month: Number(Utilities.formatDate(now, 'Asia/Taipei', 'M')),
    day:   Number(Utilities.formatDate(now, 'Asia/Taipei', 'd')),
    dow:   WEEKDAY_MAP_[dowName] || 1
  };
}

function getEmpIdByLineUserId_(lineUserId) {
  var sh = getLineBindSheet_();
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][2]) === String(lineUserId) && String(data[r][4]) === 'bound') {
      return { empId: String(data[r][0]), name: String(data[r][1]) };
    }
  }
  return null;
}

function getEmpNameByEmpId_(empId) {
  var sh = getUserDbSheet_();
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(empId)) return String(data[r][1]);
  }
  return null;
}

function getScheduleSheet_(shiftType) {
  var cfg = SCHEDULE_SHEETS_[shiftType];
  if (!cfg) return null;
  var ss = SpreadsheetApp.openById(cfg.id);
  var sh = ss.getSheetByName(cfg.sheetName);
  if (!sh) sh = ss.getSheets()[0];
  return sh;
}

function readEmployeeShiftsFromSheet_(sh, name, dayCount) {
  if (!sh) return null;
  var data = sh.getDataRange().getValues();
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][1]) === name) {
      var shifts = [];
      for (var i = 0; i < dayCount; i++) {
        shifts.push(String(data[r][i + 2] || '-').trim());
      }
      return shifts;
    }
  }
  return null;
}

function getEmployeeShifts_(shiftType, name) {
  var today = getTaipeiToday_();
  var dayCount = getDaysInMonth_(today.year, today.month);
  return readEmployeeShiftsFromSheet_(getScheduleSheet_(shiftType), name, dayCount);
}

function findEmployeeShiftsAuto_(name) {
  var today = getTaipeiToday_();
  var dayCount = getDaysInMonth_(today.year, today.month);
  for (var key in SCHEDULE_SHEETS_) {
    var shifts = readEmployeeShiftsFromSheet_(getScheduleSheet_(key), name, dayCount);
    if (shifts) return { shiftType: key, shifts: shifts };
  }
  return null;
}

function buildShiftSelectFlex_(queryType) {
  var title = (queryType === 'week') ? '📅 本週班表查詢' : '📅 本月班表查詢';
  var dispPrefix = (queryType === 'week') ? '本週' : '本月';
  return {
    type: 'bubble', size: 'kilo',
    body: {
      type: 'box', layout: 'vertical', backgroundColor: '#111827', paddingAll: '16px', spacing: 'md',
      contents: [
        { type: 'text', text: title, color: '#F5F5F5', weight: 'bold', size: 'md' },
        { type: 'text', text: '請選擇查詢的班別：', color: '#8A95A8', size: 'sm' }
      ]
    },
    footer: {
      type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px', backgroundColor: '#0A0C10',
      contents: [
        {
          type: 'button', style: 'primary', color: '#F0C040',
          action: { type: 'postback', label: '☀️ 早班', data: 'scheduleQuery=' + queryType + '&shift=early', displayText: dispPrefix + '早班班表' }
        },
        {
          type: 'button', style: 'primary', color: '#818CF8',
          action: { type: 'postback', label: '🌙 晚班', data: 'scheduleQuery=' + queryType + '&shift=late', displayText: dispPrefix + '晚班班表' }
        }
      ]
    }
  };
}

function buildWeekScheduleFlex_(name, shifts, monday, today, shiftLabel) {
  var weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  var dayCount = getDaysInMonth_(today.year, today.month);
  var rows = [];
  for (var i = 0; i < 7; i++) {
    var dayNum = monday + i;
    var info, dateLabel;
    if (dayNum >= 1 && dayNum <= dayCount) {
      var code = shifts[dayNum - 1] || '-';
      info = SHIFT_INFO_[code] || SHIFT_INFO_['-'];
      dateLabel = today.month + '/' + (dayNum < 10 ? '0' + dayNum : dayNum);
    } else {
      info = { label: '跨月（暫不支援）', time: '—', color: '#6B7280' };
      dateLabel = '—';
    }
    rows.push({
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'text', text: dateLabel + '（' + weekdayLabels[i] + '）', color: '#8A95A8', size: 'sm', flex: 4 },
        { type: 'text', text: info.label, color: info.color, size: 'sm', weight: 'bold', flex: 3 },
        { type: 'text', text: info.time, color: '#F5F5F5', size: 'xs', flex: 4, align: 'end' }
      ]
    });
  }
  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#818CF8', paddingAll: '16px',
      contents: [{ type: 'text', text: '📅 ' + name + ' 本週' + shiftLabel + '班表', color: '#0A0C10', weight: 'bold', size: 'md' }]
    },
    body: {
      type: 'box', layout: 'vertical', backgroundColor: '#111827', paddingAll: '16px', spacing: 'md',
      contents: rows
    }
  };
}

function buildMonthScheduleText_(name, shifts, today, shiftLabel) {
  var weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  var todayDowJs = today.dow % 7;
  var firstDow = ((todayDowJs - (today.day - 1)) % 7 + 7) % 7;
  var dayCount = getDaysInMonth_(today.year, today.month);

  var lines = ['📅 ' + name + ' ' + shiftLabel + ' ' + today.month + '月班表', ''];
  for (var d = 1; d <= dayCount; d++) {
    var code = shifts[d - 1] || '-';
    var info = SHIFT_INFO_[code] || SHIFT_INFO_['-'];
    var w = weekdayLabels[(firstDow + (d - 1)) % 7];
    var dateStr = today.month + '/' + (d < 10 ? '0' + d : d);
    lines.push(dateStr + '（' + w + '）' + info.label + (info.time !== '—' ? ' ' + info.time : ''));
  }
  return lines.join('\n');
}

function handleScheduleQuery_(text, lineUserId, replyToken) {
  if (text.indexOf('本月') !== -1 || text.indexOf('這個月') !== -1) {
    replyLineFlex_(replyToken, '📅 請選擇查詢班別', buildShiftSelectFlex_('month'));
    return true;
  }

  if (text.indexOf('本週') !== -1 || text.indexOf('本周') !== -1 || text.indexOf('這週') !== -1 || text.indexOf('這周') !== -1) {
    replyLineFlex_(replyToken, '📅 請選擇查詢班別', buildShiftSelectFlex_('week'));
    return true;
  }

  if (text.indexOf('今日') !== -1 || text.indexOf('今天') !== -1 || text.indexOf('明日') !== -1 || text.indexOf('明天') !== -1) {
    var bound = getEmpIdByLineUserId_(lineUserId);
    if (!bound) {
      replyLineMessage_(replyToken, '⚠️ 您尚未綁定工號，請至 APP「設定」→「綁定 LINE 通知」完成綁定後再查詢班表。');
      return true;
    }
    var name = getEmpNameByEmpId_(bound.empId) || bound.name;
    var found = findEmployeeShiftsAuto_(name);
    if (!found) {
      replyLineMessage_(replyToken, '⚠️ 查無「' + name + '」的班表資料，請聯絡管理員確認班表是否已建立。');
      return true;
    }
    var today = getTaipeiToday_();
    var cfg = SCHEDULE_SHEETS_[found.shiftType];
    var isTomorrow = (text.indexOf('明') !== -1);
    var targetDay = isTomorrow ? today.day + 1 : today.day;
    var dayCount = getDaysInMonth_(today.year, today.month);
    if (targetDay > dayCount) {
      replyLineMessage_(replyToken, '⚠️ 查詢日期已跨月，暫不支援查詢，請使用「本月班表」。');
      return true;
    }
    var code = found.shifts[targetDay - 1] || '-';
    var info = SHIFT_INFO_[code] || SHIFT_INFO_['-'];
    var dayLabel = isTomorrow ? '明日' : '今日';
    replyLineMessage_(replyToken, '📅 ' + name + '（' + cfg.label + '）' + dayLabel + '（' + today.month + '/' + targetDay + '）：' + info.label + (info.time !== '—' ? '\n時間：' + info.time : ''));
    return true;
  }

  return false;
}

function handleScheduleResultPostback_(params, ev) {
  var replyToken = ev.replyToken || '';
  var lineUserId = (ev.source && ev.source.userId) || '';
  var queryType = params.scheduleQuery;
  var shiftType = params.shift;
  var cfg = SCHEDULE_SHEETS_[shiftType];

  var bound = getEmpIdByLineUserId_(lineUserId);
  if (!bound) {
    replyLineMessage_(replyToken, '⚠️ 您尚未綁定工號，請至 APP「設定」→「綁定 LINE 通知」完成綁定後再查詢班表。');
    return;
  }

  var name = getEmpNameByEmpId_(bound.empId) || bound.name;
  var shifts = getEmployeeShifts_(shiftType, name);
  if (!shifts) {
    replyLineMessage_(replyToken, '⚠️ 查無「' + name + '」的' + (cfg ? cfg.label : '') + '班表資料，請確認您是否屬於該班別，或聯絡管理員確認班表是否已建立。');
    return;
  }

  var today = getTaipeiToday_();

  if (queryType === 'week') {
    var monday = today.day - (today.dow - 1);
    replyLineFlex_(replyToken, '📅 ' + name + ' 本週' + cfg.label + '班表', buildWeekScheduleFlex_(name, shifts, monday, today, cfg.label));
  } else if (queryType === 'month') {
    replyLineMessage_(replyToken, buildMonthScheduleText_(name, shifts, today, cfg.label));
  }
}

// ════════════════════════════════════════════════════════════
// 【班表異動推播】
// ════════════════════════════════════════════════════════════

function getEmpInfoByName_(name) {
  var sh = getUserDbSheet_();
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][1]) === name) return { empId: String(data[r][0]), name: name };
  }
  return null;
}

function getScheduleQueueSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('班表異動佇列');
  if (!sh) {
    sh = ss.insertSheet('班表異動佇列');
    sh.appendRow(['姓名', '班別', '日期', '新班別代碼', '記錄時間']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 5)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
  }
  return sh;
}

function notifyScheduleChangeAction_(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.name || !d.shiftType || !d.days || !d.days.length) {
      return jsonRes({status:'ok', skipped:true}); // 無變動，靜默忽略
    }

    // ── 即時推播一次（不再寫入佇列、不靠5分鐘輪詢，避免重複推播）──
    var empInfo = getEmpInfoByName_(d.name);
    if (!empInfo) return jsonRes({status:'ok', skipped:'查無工號'});
    var lineUserId = getLineUserIdByEmpId_(empInfo.empId);
    if (!lineUserId) return jsonRes({status:'ok', skipped:'未綁定LINE'});

    var cfg = SCHEDULE_SHEETS_[d.shiftType];
    var today = getTaipeiToday_();
    var dayNums = [], codeMap = {};
    for (var i = 0; i < d.days.length; i++) {
      var n = Number(d.days[i].day);
      dayNums.push(n); codeMap[n] = d.days[i].code;
    }
    dayNums.sort(function(a, b) { return a - b; });

    var lines = ['🔔 班表異動通知', '', '您的' + (cfg ? cfg.label : '') + '班表有以下異動：'];
    for (var k = 0; k < dayNums.length; k++) {
      var dn = dayNums[k];
      var info = SHIFT_INFO_[codeMap[dn]] || SHIFT_INFO_['-'];
      var ds = today.month + '/' + (dn < 10 ? '0' + dn : dn);
      lines.push(ds + '　' + info.label + (info.time !== '—' ? '（' + info.time + '）' : ''));
    }
    pushLineMessage_(lineUserId, lines.join('\n'));
    return jsonRes({status:'ok', pushed:1});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// ════════════════════════════════════════════════════════════
// 【事故報告/匿名表揚 LINE 通知】── 新資料送出即推播主管/管理員
// ════════════════════════════════════════════════════════════

function buildNotifyCardFlex_(headerText, headerColor, rows, buttonLabel, buttonUrl) {
  var body = [];
  for (var i = 0; i < rows.length; i++) {
    body.push({ type: 'box', layout: 'baseline', spacing: 'sm', contents: [
      { type: 'text', text: rows[i].label, color: '#8A95A8', size: 'sm', flex: 2 },
      { type: 'text', text: rows[i].value, color: '#F5F5F5', size: 'sm', flex: 6, wrap: true }
    ]});
  }
  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: headerColor, paddingAll: '16px',
      contents: [{ type: 'text', text: headerText, color: '#0A0C10', weight: 'bold', size: 'md' }] },
    body: { type: 'box', layout: 'vertical', backgroundColor: '#111827', paddingAll: '16px', spacing: 'md', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', backgroundColor: '#0A0C10',
      contents: [
        { type: 'button', style: 'primary', color: '#818CF8', height: 'sm',
          action: { type: 'uri', label: buttonLabel, uri: buttonUrl } },
        { type: 'text', text: '天鷹保全 · 請儘速查看處理', color: '#6B7280', size: 'xs', align: 'center' }
      ] }
  };
}

function notifyNewReportAction_(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    var execs = getExecutivesAndAdmins_();
    if (!execs.length) return jsonRes({status:'ok', skipped:'無主管/管理員'});
    var rows = [
      { label: '地點', value: d.location || '未填寫' },
      { label: '類別', value: d.category || '未分類' },
      { label: '時間', value: (d.date || '') + ' ' + (d.time || '') },
      { label: '回報人', value: (d.name || '') + '（' + (d.empId || '未登入') + '）' }
    ];
    var flex = buildNotifyCardFlex_('🚨 新事故報告', '#F87171', rows, '📋 查看詳情',
      'https://sky03104.github.io/tianying-security/tool_report.html?mode=admin');
    var sent = 0;
    for (var i = 0; i < execs.length; i++) {
      var lineUserId = getLineUserIdByEmpId_(execs[i].empId);
      if (lineUserId) { pushLineFlex_(lineUserId, '🚨 新事故報告：' + (d.location || ''), flex); sent++; }
    }
    return jsonRes({status:'ok', pushed:sent});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function notifyNewFeedbackAction_(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    var execs = getExecutivesAndAdmins_();
    if (!execs.length) return jsonRes({status:'ok', skipped:'無主管/管理員'});
    var isPraise = (d.type === 'praise');
    var headerText = isPraise ? '🎉 新匿名表揚' : '⚠️ 新匿名反應';
    var headerColor = isPraise ? '#D4A800' : '#FB923C';
    var rows = [
      { label: '對象', value: d.target || '未填寫' },
      { label: '分類', value: d.category || '未分類' },
      { label: '日期', value: d.date || '' }
    ];
    var flex = buildNotifyCardFlex_(headerText, headerColor, rows, '📋 查看詳情',
      'https://sky03104.github.io/tianying-security/tool_feedback.html?mode=admin');
    var sent = 0;
    for (var i = 0; i < execs.length; i++) {
      var lineUserId = getLineUserIdByEmpId_(execs[i].empId);
      if (lineUserId) { pushLineFlex_(lineUserId, headerText + '：' + (d.target || ''), flex); sent++; }
    }
    return jsonRes({status:'ok', pushed:sent});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

function notifyScheduleChangeBatchAction_(e) {
  try {
    var list = JSON.parse(e.parameter.data);
    if (!list || !list.length) return jsonRes({status:'ok', skipped:true});

    var valid = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it && it.name && it.shiftType && it.days && it.days.length) valid.push(it);
    }
    if (!valid.length) return jsonRes({status:'ok', skipped:true});

    var today = getTaipeiToday_();
    var pushed = 0;
    for (var i = 0; i < valid.length; i++) {
      var it = valid[i];
      var empInfo = getEmpInfoByName_(it.name);
      if (!empInfo) continue;
      var lineUserId = getLineUserIdByEmpId_(empInfo.empId);
      if (!lineUserId) continue;

      var cfg = SCHEDULE_SHEETS_[it.shiftType];
      var dayNums = [];
      var codeMap = {};
      for (var j = 0; j < it.days.length; j++) {
        var dNum = Number(it.days[j].day);
        dayNums.push(dNum);
        codeMap[dNum] = it.days[j].code;
      }
      dayNums.sort(function(a, b) { return a - b; });

      var lines = ['🔔 班表異動通知', '', '您的' + (cfg ? cfg.label : '') + '班表有以下異動：'];
      for (var k = 0; k < dayNums.length; k++) {
        var dNum2 = dayNums[k];
        var code = codeMap[dNum2];
        var info = SHIFT_INFO_[code] || SHIFT_INFO_['-'];
        var dateStr = today.month + '/' + (dNum2 < 10 ? '0' + dNum2 : dNum2);
        lines.push(dateStr + '　' + info.label + (info.time !== '—' ? '（' + info.time + '）' : ''));
      }
      pushLineMessage_(lineUserId, lines.join('\n'));
      pushed++;

      if (pushed % 10 === 0) Utilities.sleep(150);
    }

    return jsonRes({status:'ok', pushed: pushed});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// 2026-08-02 新增：一次異動人數太多時（例如換月整批班表一起改），改群組推播一則就好，
// 不要逐人各發一則——換月那天 149 人一次異動、逐人推播把當月免費額度一天燒光，就是這裡沒擋。
// 個位數的一般小異動（平常補改一兩人班表）維持 notifyScheduleChangeBatchAction_ 的個人化推播，
// 仍然便宜又有用（讓當事人知道自己哪幾天改了），只有大量異動才切換成這個群組版本。
function notifyScheduleChangeBulkAction_(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    var shiftType = d.shiftType;
    var count = Number(d.count) || 0;
    var cfg = SCHEDULE_SHEETS_[shiftType];

    var msg = '🔔 ' + (cfg ? cfg.label : '') + '班表大幅更新（本次共 ' + count + ' 人異動），請至 APP 或輸入「本月班表」查詢您的最新班表。';

    var groupId = readSettingStr_('tomorrowPostGroupId', '');
    if (!groupId) return jsonRes({status:'err', msg:'尚未設定群組ID，請先把機器人加入群組'});

    var code = pushTextToGroup_(groupId, msg);
    if (code !== 200) return jsonRes({status:'err', msg:'群組推播失敗 HTTP ' + code});

    return jsonRes({status:'ok', shiftType: shiftType, count: count});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// 改群組推播（不再逐人 push，節省每月200則免費額度）
function monthScheduleReleasedAction_(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    var shiftType = d.shiftType;
    var ym = String(d.ym || '').trim();
    var cfg = SCHEDULE_SHEETS_[shiftType];
    if (!cfg) return jsonRes({status:'err', msg:'未知班別:' + shiftType});

    var msg = '📅 ' + ym + ' 班表已發佈，輸入「本月班表」即可查詢完整內容。';

    var groupId = readSettingStr_('tomorrowPostGroupId', '');
    if (!groupId) return jsonRes({status:'err', msg:'尚未設定群組ID，請先把機器人加入群組'});

    var code = pushTextToGroup_(groupId, msg);
    if (code !== 200) return jsonRes({status:'err', msg:'群組推播失敗 HTTP ' + code});

    return jsonRes({status:'ok', shiftType: shiftType, ym: ym});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// 推播純文字到群組（回傳 HTTP 碼）
function pushTextToGroup_(groupId, text) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !groupId) return -1;
  var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({
      to: groupId,
      messages: [{ type: 'text', text: text }]
    }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) console.error('群組文字推播失敗 HTTP ' + code + '：' + resp.getContentText());
  return code;
}

function onScheduleEdit_(e) {
  try {
    var range = e.range;
    var sheet = range.getSheet();
    var ss = e.source;
    var ssId = ss.getId();

    var shiftType = null;
    for (var key in SCHEDULE_SHEETS_) {
      if (SCHEDULE_SHEETS_[key].id === ssId) { shiftType = key; break; }
    }
    if (!shiftType) return;
    var cfg = SCHEDULE_SHEETS_[shiftType];
    if (sheet.getName() !== cfg.sheetName) return;

    var startRow = range.getRow();
    var numRows = range.getNumRows();
    var startCol = range.getColumn();
    var numCols = range.getNumColumns();

    var colFrom = Math.max(startCol, 3);
    var colTo = Math.min(startCol + numCols - 1, 32);
    if (colFrom > colTo) return;

    var queueSh = getScheduleQueueSheet_();
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/M/d HH:mm:ss');
    var rowsToAppend = [];

    for (var ri = 0; ri < numRows; ri++) {
      var row = startRow + ri;
      if (row < 4) continue;

      var name = String(sheet.getRange(row, 2).getValue() || '').trim();
      if (!name) continue;

      for (var col = colFrom; col <= colTo; col++) {
        var dayNum = col - 2;
        var newVal = String(sheet.getRange(row, col).getValue() || '-').trim() || '-';
        rowsToAppend.push([name, shiftType, dayNum, newVal, now]);
      }
    }

    if (rowsToAppend.length > 0) {
      queueSh.getRange(queueSh.getLastRow() + 1, 1, rowsToAppend.length, 5).setValues(rowsToAppend);
    }
  } catch (err) {
    console.error('onScheduleEdit_ 失敗：' + err.toString());
  }
}

function processScheduleChangeQueue_() {
  try {
    var sh = getScheduleQueueSheet_();
    var data = sh.getDataRange().getValues();
    if (data.length <= 1) return;

    var groups = {};
    for (var r = 1; r < data.length; r++) {
      var name = String(data[r][0]);
      var shiftType = String(data[r][1]);
      var dayNum = Number(data[r][2]);
      var code = String(data[r][3]);
      if (!name || !SCHEDULE_SHEETS_[shiftType]) continue;

      var key = name + '|' + shiftType;
      if (!groups[key]) groups[key] = { name: name, shiftType: shiftType, days: {} };
      groups[key].days[dayNum] = code;
    }

    var today = getTaipeiToday_();
    for (var key in groups) {
      var g = groups[key];
      var empInfo = getEmpInfoByName_(g.name);
      if (!empInfo) continue;
      var lineUserId = getLineUserIdByEmpId_(empInfo.empId);
      if (!lineUserId) continue;

      var cfg = SCHEDULE_SHEETS_[g.shiftType];
      var dayNums = Object.keys(g.days).map(Number).sort(function(a, b) { return a - b; });

      var lines = ['🔔 班表異動通知', '', '您的' + cfg.label + '班表有以下異動：'];
      for (var i = 0; i < dayNums.length; i++) {
        var d = dayNums[i];
        var code = g.days[d];
        var info = SHIFT_INFO_[code] || SHIFT_INFO_['-'];
        var dateStr = today.month + '/' + (d < 10 ? '0' + d : d);
        lines.push(dateStr + '　' + info.label + (info.time !== '—' ? '（' + info.time + '）' : ''));
      }
      pushLineMessage_(lineUserId, lines.join('\n'));
    }

    if (sh.getLastRow() > 1) {
      sh.deleteRows(2, sh.getLastRow() - 1);
    }
  } catch (err) {
    console.error('processScheduleChangeQueue_ 失敗：' + err.toString());
  }
}

function setupScheduleNotifyTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'onScheduleEdit_' || fn === 'processScheduleChangeQueue_') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  Logger.log('班表異動已改為「即時推播一次」，已移除 ' + removed + ' 個舊的輪詢/偵測觸發器（不再重複推播）。');
}

// ════════════════════════════════════════════════════════════
// 【LIFF 請假入口】
// ════════════════════════════════════════════════════════════

function resolveEmp(e) {
  try {
    var userId = String((e && e.parameter && e.parameter.userId) || '');
    if (!userId) return jsonRes({status:'ok', bound:false, msg:'缺少 userId'});

    var bound = getEmpIdByLineUserId_(userId);
    if (!bound) return jsonRes({status:'ok', bound:false});

    var sh = getUserDbSheet_();
    var shiftIdx = colIndexByName_(sh, '班別');
    var data = sh.getDataRange().getValues();
    // 班別：只信任明確的「早班」/「晚班」，查不到或空值回空字串——不准悄悄當晚班
    var role = 'fulltime', dept = '', name = bound.name, status = 'active', shift = '';
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(bound.empId)) {
        name   = String(data[r][1]) || name;
        role   = String(data[r][3]) || role;
        dept   = String(data[r][4]) || '';
        status = String(data[r][5] || 'active');
        if (shiftIdx >= 0) {
          var sv = String(data[r][shiftIdx] || '').trim();
          if (sv === '早班' || sv === '晚班') shift = sv;
        }
        break;
      }
    }
    if (status !== 'active') return jsonRes({status:'ok', bound:false, msg:'帳號未啟用'});

    return jsonRes({status:'ok', bound:true, empId:bound.empId, name:name, role:role, dept:dept, shift:shift, shiftUnset: !shift});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString(), bound:false});
  }
}

function buildLeaveEntryFlex_() {
  return {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#D4A800', paddingAll: '16px',
      contents: [{ type: 'text', text: '📝 請假申請', color: '#0A0C10', weight: 'bold', size: 'md' }]
    },
    body: {
      type: 'box', layout: 'vertical', backgroundColor: '#111827', paddingAll: '16px', spacing: 'md',
      contents: [{ type: 'text', text: '點下方按鈕開啟請假申請表單，免登入直接填寫送出，主管將收到審核通知。', color: '#F5F5F5', size: 'sm', wrap: true }]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', backgroundColor: '#0A0C10',
      contents: [{
        type: 'button', style: 'primary', color: '#F0C040',
        action: { type: 'uri', label: '📝 開啟請假申請', uri: 'https://liff.line.me/2010392723-P8uR4CaO' }
      }]
    }
  };
}

// ════════════════════════════════════════════════════════════
// 【系統設定】早晚班請假上限（存「系統設定」分頁，管理員可改）
// ════════════════════════════════════════════════════════════

// 設定鍵名常數（LIFF 頁、管理員頁、GAS 三方必須一致）
var SETTING_KEY_CAP_MORNING = 'leaveCapMorning';
var SETTING_KEY_CAP_NIGHT   = 'leaveCapNight';
var SETTING_KEY_TOOL_PERMS  = 'toolPerms';   // ★ 工具權限雲端同步用設定鍵
var SETTING_KEY_WORK_ALLOWED = 'workAllowedIds'; // ★ 施工單查詢 正職/兼職個別白名單（JSON字串；空=不限制）
var SETTING_KEY_TOOLS_CONFIG = 'toolsConfig'; // ★ 工具名稱/圖示/分類 覆寫表（JSON字串，id→{icon,name,category}；空=沿用預設）
var DEFAULT_CAP_MORNING = 5;
var DEFAULT_CAP_NIGHT   = 3;

function getSettingsSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('系統設定');
  if (!sh) {
    sh = ss.insertSheet('系統設定');
    sh.appendRow(['設定鍵', '設定值']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 2)
      .setBackground('#D4A800')
      .setFontColor('#0A0C10')
      .setFontWeight('bold');
    sh.appendRow([SETTING_KEY_CAP_MORNING, DEFAULT_CAP_MORNING]);
    sh.appendRow([SETTING_KEY_CAP_NIGHT,   DEFAULT_CAP_NIGHT]);
  }
  return sh;
}

// 讀取一個設定值（找不到回預設）
function readSetting_(key, def) {
  var sh = getSettingsSheet_();
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() === key) {
      var v = parseInt(data[r][1], 10);
      return isNaN(v) ? def : v;
    }
  }
  return def;
}

// 讀取一個設定值（字串版，找不到回 def）
function readSettingStr_(key, def) {
  var sh = getSettingsSheet_();
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() === key) {
      var v = String(data[r][1] || '').trim();
      return v || def;
    }
  }
  return def;
}

// 寫入一個設定值（沒有就新增）
function writeSetting_(key, val) {
  var sh = getSettingsSheet_();
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() === key) {
      sh.getRange(r + 1, 2).setValue(val);
      return;
    }
  }
  sh.appendRow([key, val]);
}

// GET：回傳早晚班上限 + 工具權限（toolPerms）
function getSettings() {
  try {
    var res = {
      status: 'ok',
      leaveCapMorning: readSetting_(SETTING_KEY_CAP_MORNING, DEFAULT_CAP_MORNING),
      leaveCapNight:   readSetting_(SETTING_KEY_CAP_NIGHT,   DEFAULT_CAP_NIGHT)
    };
    // ★ 工具權限：有設定才回傳（空字串代表雲端尚未設定，前端沿用本機）
    var tp = readSettingStr_(SETTING_KEY_TOOL_PERMS, '');
    if (tp) res.toolPerms = tp;
    // ★ 施工單個別白名單：有設定且為合法陣列才回傳（前端只認 Array）
    var wa = readSettingStr_(SETTING_KEY_WORK_ALLOWED, '');
    if (wa) {
      try {
        var waArr = JSON.parse(wa);
        if (Array.isArray(waArr)) res.workAllowedIds = waArr;
      } catch (e2) {}
    }
    // ★ 工具名稱/圖示/分類：有設定才回傳（空字串代表雲端尚未設定，前端沿用本機/預設）
    var tc = readSettingStr_(SETTING_KEY_TOOLS_CONFIG, '');
    if (tc) res.toolsConfig = tc;
    return jsonRes(res);
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString(),
      leaveCapMorning: DEFAULT_CAP_MORNING, leaveCapNight: DEFAULT_CAP_NIGHT});
  }
}

// ════════════════════════════════════════════════════════════
// 【登入 Bootstrap】── 把 App 登入當下要拉的 getApplications／getLeaveRequests／
//   getSettings 三支呼叫合併成一支，前端一次 fetch 拿齊，省掉 2 趟 GAS 冷啟往返。
//   直接呼叫既有三支函式取其 ContentService 內容重新解析組合，不重寫個別邏輯，
//   確保跟前端其他「重新整理」按鈕各自呼叫單一 action 時的行為完全一致、不會日後跑掉。
// ════════════════════════════════════════════════════════════
function bootstrap() {
  try {
    var appsRes    = JSON.parse(getApplications().getContent());
    var leaveRes   = JSON.parse(getLeaveRequests().getContent());
    var settingsRes = JSON.parse(getSettings().getContent());
    return jsonRes({
      status: 'ok',
      applications: (appsRes && Array.isArray(appsRes.list)) ? appsRes.list : [],
      leaveRequests: (leaveRes && Array.isArray(leaveRes.list)) ? leaveRes.list : [],
      settings: settingsRes || null
    });
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// POST：管理員寫入早晚班上限 + 工具權限（toolPerms）
function setSettings(e) {
  try {
    var d = JSON.parse(e.parameter.data || '{}');
    var m = parseInt(d.leaveCapMorning, 10);
    var n = parseInt(d.leaveCapNight, 10);
    if (!isNaN(m) && m >= 0) writeSetting_(SETTING_KEY_CAP_MORNING, m);
    if (!isNaN(n) && n >= 0) writeSetting_(SETTING_KEY_CAP_NIGHT, n);

    // ★ 工具權限：前端有帶非空字串才寫入（toolPerms 為 JSON 字串）
    if (typeof d.toolPerms === 'string' && d.toolPerms.trim() !== '') {
      writeSetting_(SETTING_KEY_TOOL_PERMS, d.toolPerms);
    }

    // ★ 施工單個別白名單：陣列→存JSON字串；null→清空（代表還原成全員可用）
    if (Array.isArray(d.workAllowedIds)) {
      writeSetting_(SETTING_KEY_WORK_ALLOWED, JSON.stringify(d.workAllowedIds));
    } else if (d.workAllowedIds === null) {
      writeSetting_(SETTING_KEY_WORK_ALLOWED, '');
    }

    // ★ 工具名稱/圖示/分類覆寫表：前端有帶非空字串才寫入（toolsConfig 為 JSON 字串）
    if (typeof d.toolsConfig === 'string' && d.toolsConfig.trim() !== '') {
      writeSetting_(SETTING_KEY_TOOLS_CONFIG, d.toolsConfig);
    }

    var res = {
      status: 'ok',
      leaveCapMorning: readSetting_(SETTING_KEY_CAP_MORNING, DEFAULT_CAP_MORNING),
      leaveCapNight:   readSetting_(SETTING_KEY_CAP_NIGHT,   DEFAULT_CAP_NIGHT)
    };
    var tp = readSettingStr_(SETTING_KEY_TOOL_PERMS, '');
    if (tp) res.toolPerms = tp;
    var wa2 = readSettingStr_(SETTING_KEY_WORK_ALLOWED, '');
    if (wa2) {
      try {
        var waArr2 = JSON.parse(wa2);
        if (Array.isArray(waArr2)) res.workAllowedIds = waArr2;
      } catch (e3) {}
    }
    var tc2 = readSettingStr_(SETTING_KEY_TOOLS_CONFIG, '');
    if (tc2) res.toolsConfig = tc2;
    return jsonRes(res);
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
}

// ════════════════════════════════════════════════════════════
// 【一鍵初始化】早晚班分軌功能 — 冪等，可重複執行不會壞
//   1. 帳號管理加「班別」欄，所有空值預設「晚班」
//   2. 請假申請加「班別」欄，所有空值（舊資料）填「晚班」
//   3. 建立「系統設定」分頁（早班5/晚班3）
// 在 GAS 編輯器選此函式執行一次即可。
// ════════════════════════════════════════════════════════════
function 初始化早晚班分軌() {
  var log = [];

  // ── 1. 帳號管理加「班別」欄，空值預設晚班 ──
  var userSh = getUserDbSheet_();
  var userShiftIdx = ensureColumn_(userSh, '班別');  // 0-based
  var userLast = userSh.getLastRow();
  if (userLast >= 2) {
    var userRange = userSh.getRange(2, userShiftIdx + 1, userLast - 1, 1);
    var userVals = userRange.getValues();
    var userFilled = 0;
    for (var i = 0; i < userVals.length; i++) {
      if (String(userVals[i][0] || '').trim() === '') {
        userVals[i][0] = '晚班';
        userFilled++;
      }
    }
    userRange.setValues(userVals);
    log.push('帳號管理：班別欄就緒，補上 ' + userFilled + ' 筆預設晚班');
  } else {
    log.push('帳號管理：無資料列');
  }

  // ── 2. 請假申請加「班別」欄，舊資料空值填晚班 ──
  var leaveSh = getLeaveSheet();
  var leaveShiftIdx = ensureColumn_(leaveSh, '班別');
  var leaveLast = leaveSh.getLastRow();
  if (leaveLast >= 2) {
    var leaveRange = leaveSh.getRange(2, leaveShiftIdx + 1, leaveLast - 1, 1);
    var leaveVals = leaveRange.getValues();
    var leaveFilled = 0;
    for (var j = 0; j < leaveVals.length; j++) {
      if (String(leaveVals[j][0] || '').trim() === '') {
        leaveVals[j][0] = '晚班';
        leaveFilled++;
      }
    }
    leaveRange.setValues(leaveVals);
    log.push('請假申請：班別欄就緒，補上 ' + leaveFilled + ' 筆舊資料晚班');
  } else {
    log.push('請假申請：無資料列');
  }

  // ── 3. 建立系統設定分頁 ──
  getSettingsSheet_();
  log.push('系統設定：就緒（早班' +
    readSetting_(SETTING_KEY_CAP_MORNING, DEFAULT_CAP_MORNING) + '／晚班' +
    readSetting_(SETTING_KEY_CAP_NIGHT, DEFAULT_CAP_NIGHT) + '）');

  var msg = '✅ 初始化完成\n' + log.join('\n');
  Logger.log(msg);
  return msg;
}

// ============================
// ════════════════════════════════════════════════════════════
// 【診斷】請假推播全鏈路測試 — 在 GAS 編輯器直接執行此函式看 Log
//   會逐步印出：主管篩選、LINE 綁定、push HTTP 回應碼與內容
//   不會真的影響任何資料，純測試
// ════════════════════════════════════════════════════════════
function 測試請假推播() {
  var dept = '漢神巨蛋';  // 要測的部門
  var shift = '早班';     // 要測的班別（早班/晚班）
  Logger.log('===== 請假推播診斷開始 =====');

  // 1. Token 是否存在
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  Logger.log('① LINE Token：' + (token ? '存在（長度 ' + token.length + '）' : '❌ 不存在！請到 專案設定→指令碼屬性 設定 LINE_CHANNEL_ACCESS_TOKEN'));
  if (!token) { Logger.log('===== 中止：沒有 Token ====='); return; }

  // 2. 篩出「該部門＋該班別」階級最高的主管 + admin（2026-07-14 改版：不再整部門全推）
  var supervisors = getShiftLeaveSupervisors_(dept, shift);
  Logger.log('② 篩到 ' + shift + ' 通知對象 ' + supervisors.length + ' 人：' +
    supervisors.map(function(s){ return s.name + '(' + s.empId + '/' + s.role + ')'; }).join('、'));
  if (supervisors.length === 0) {
    Logger.log('❌ 沒篩到任何通知對象 → 檢查帳號管理分頁：部門是否為「' + dept + '」、班別是否為「' + shift + '」、角色是否為 captain/vicecaptain/leader/admin、狀態是否 active');
    Logger.log('===== 中止 ====='); return;
  }

  // 3. 逐一查 LINE 綁定
  var boundCount = 0;
  for (var i = 0; i < supervisors.length; i++) {
    var uid = getLineUserIdByEmpId_(supervisors[i].empId);
    if (uid) {
      boundCount++;
      Logger.log('③ ' + supervisors[i].name + ' → 已綁定 UserID：' + uid.substring(0, 12) + '…');
    } else {
      Logger.log('③ ' + supervisors[i].name + ' → ❌ 未綁定 LINE（不會收到）');
    }
  }
  if (boundCount === 0) {
    Logger.log('❌ 所有主管都沒綁定 LINE → 這就是收不到推播的原因');
    Logger.log('===== 中止 ====='); return;
  }

  // 4. 實際發一則測試推播給「第一個有綁定的主管」，印出 HTTP 回應
  var targetUid = null, targetName = '';
  for (var j = 0; j < supervisors.length; j++) {
    var u = getLineUserIdByEmpId_(supervisors[j].empId);
    if (u) { targetUid = u; targetName = supervisors[j].name; break; }
  }
  Logger.log('④ 對 ' + targetName + ' 發送測試推播…');
  var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({
      to: targetUid,
      messages: [{ type: 'text', text: '🔔 這是請假推播診斷測試訊息，收到代表推播管道正常。' }]
    }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  Logger.log('④ HTTP 回應碼：' + code);
  Logger.log('④ 回應內容：' + resp.getContentText());
  if (code === 200) {
    Logger.log('✅ 推播成功！' + targetName + ' 應該收到測試訊息了。');
    Logger.log('→ 若實際請假仍收不到，問題在 submitLeave 沒呼叫通知，或申請人 dept 值不符。');
  } else if (code === 401) {
    Logger.log('❌ 401 → Token 失效或錯誤，請重新到 LINE Developers 複製 Channel Access Token');
  } else if (code === 400) {
    Logger.log('❌ 400 → UserID 無效，或此人已封鎖官方帳號 / 未加官方帳號好友');
  } else if (code === 403) {
    Logger.log('❌ 403 → 此 LINE 官方帳號方案不支援 push（需 Messaging API，且非僅回覆模式）');
  }
  Logger.log('===== 診斷結束 =====');
}

// ════════════════════════════════════════════════════════════
// 【診斷】群組哨表推播測試 — 在編輯器執行看 Log
// ════════════════════════════════════════════════════════════
function 測試群組哨表推播() {
  Logger.log('===== 群組哨表推播診斷 =====');
  var groupId = readSettingStr_('tomorrowPostGroupId', '');
  Logger.log('① 群組ID：' + (groupId ? groupId : '❌ 未設定！請先把官方帳號加入群組（會自動記錄）'));
  if (!groupId) { Logger.log('===== 中止：請先把機器人加進群組 ====='); return; }

  var full = parsePostFullList_();
  if (full.error) { Logger.log('② 解析哨表失敗：' + full.error); return; }
  Logger.log('② 解析成功 → 日期：' + full.dateInfo.label + '　早班 ' + full.early.length + ' 人　晚班 ' + full.late.length + ' 人');

  var tomorrow = new Date(Date.now() + 86400000);
  var tM = Number(Utilities.formatDate(tomorrow, 'Asia/Taipei', 'M'));
  var tD = Number(Utilities.formatDate(tomorrow, 'Asia/Taipei', 'd'));
  Logger.log('③ 哨表日期 vs 系統明天：' + full.dateInfo.month + '/' + full.dateInfo.day + ' vs ' + tM + '/' + tD +
    ((full.dateInfo.month === tM && full.dateInfo.day === tD) ? '　✅符合' : '　⚠️不符（實際排程會跳過，但此測試強制發送）'));

  Logger.log('④ 發送測試推播到群組…');
  var code = pushFullPostToGroup_(groupId, full.dateInfo.label, full.early, full.late);
  Logger.log('④ HTTP 回應碼：' + code);
  if (code === 200) Logger.log('✅ 群組推播成功！群組應已收到完整哨表。');
  else if (code === 429) Logger.log('❌ 429 → 本月推播額度已用完（但群組只算1則，下月重置即可，或升級方案）');
  else if (code === 400) Logger.log('❌ 400 → groupId 失效（機器人可能已被踢出群組）');
  else if (code === 401) Logger.log('❌ 401 → Token 失效');
  Logger.log('===== 診斷結束 =====');
}

// ════════════════════════════════════════════════════════════
// 【診斷】明日/今日哨表重複姓名檢查 — 在編輯器執行看 Log
// 若哨表頁面又出現同一人被算進早晚班兩次、或哨位/時間對不上，
// 執行這個函式，Log 會列出每個「出現超過一次」的姓名＋其所有
// loc/time，方便對照試算表原始儲存格找出是哪一格資料有問題。
// ════════════════════════════════════════════════════════════
function 診斷哨表重複姓名(sheetName) {
  var full = parsePostFullList_(sheetName || POST_SHEET_NAME);
  if (full.error) { Logger.log('解析失敗：' + full.error); return; }
  Logger.log('日期：' + full.dateInfo.label + '　早班 ' + full.early.length + ' 人　晚班 ' + full.late.length + ' 人');

  var byName = {};
  var all = full.early.map(function (it) { return Object.assign({ block: '早班' }, it); })
    .concat(full.late.map(function (it) { return Object.assign({ block: '晚班' }, it); }));
  for (var i = 0; i < all.length; i++) {
    var n = all[i].name;
    if (!byName[n]) byName[n] = [];
    byName[n].push(all[i]);
  }
  var dupCount = 0;
  for (var name in byName) {
    if (byName[name].length <= 1) continue;
    dupCount++;
    Logger.log('⚠️ 「' + name + '」出現 ' + byName[name].length + ' 次：');
    for (var j = 0; j < byName[name].length; j++) {
      var it2 = byName[name][j];
      Logger.log('   - ' + it2.block + '｜' + it2.loc + '｜' + it2.time + '｜empId=' + it2.empId);
    }
  }
  if (!dupCount) Logger.log('✅ 沒有姓名重複出現的項目。');
}

// ════════════════════════════════════════════════════════════
// 【診斷】哨表原始儲存格內容 dump — 在編輯器執行看 Log
// 逐欄印出每一列有值的儲存格（含欄位英文字母 A/B/C…方便對照試算表），
// 以及所有合併儲存格範圍。用來精準定位「哪一欄的資料被算錯」，
// 不用再靠截圖猜欄位。預設只印前 6 列（表頭＋前幾個哨位就夠對照結構），
// 需要印更多列可自行帶入 maxRows。
// ════════════════════════════════════════════════════════════
function 診斷哨表原始格內容(sheetName, maxRows) {
  sheetName = sheetName || POST_SHEET_NAME;
  maxRows = maxRows || 6;
  var ss = SpreadsheetApp.openById(POST_SHEET_ID);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) { Logger.log('找不到分頁：' + sheetName); return; }
  var values = sh.getDataRange().getValues();

  function colLetter(c) {
    var s = '';
    c++;
    while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - m) / 26); }
    return s;
  }

  Logger.log('===== 分頁「' + sheetName + '」原始內容（未展開合併儲存格前）=====');
  var rowsToShow = Math.min(maxRows, values.length);
  for (var r = 0; r < rowsToShow; r++) {
    var row = values[r];
    var parts = [];
    for (var c = 0; c < row.length; c++) {
      var v = String(row[c] == null ? '' : row[c]).replace(/\n/g, '⏎');
      if (v.trim() === '') continue;
      parts.push(colLetter(c) + r + '=[' + v + ']');
    }
    Logger.log('R' + r + ': ' + (parts.length ? parts.join('  ') : '(全空)'));
  }

  Logger.log('----- 合併儲存格範圍（列於前 ' + rowsToShow + ' 列內的）-----');
  var ranges = sh.getDataRange().getMergedRanges(); // getMergedRanges 是 Range 的方法，不是 Sheet 的（上次執行報錯就是這裡）
  var shown = 0;
  for (var i = 0; i < ranges.length; i++) {
    var rng = ranges[i];
    var r0 = rng.getRow() - 1, c0 = rng.getColumn() - 1;
    if (r0 >= rowsToShow) continue;
    Logger.log('merge: ' + colLetter(c0) + r0 + ' 起，' + rng.getNumRows() + '列×' + rng.getNumColumns() + '欄，值=[' +
      String(values[r0] && values[r0][c0] != null ? values[r0][c0] : '').replace(/\n/g, '⏎') + ']');
    shown++;
  }
  if (!shown) Logger.log('（前 ' + rowsToShow + ' 列內沒有合併儲存格，或此範圍內的合併都在更下面）');

  Logger.log('===== 若要看更後面的哨位列，執行「診斷哨表原始格內容("' + sheetName + '", 20)」把列數加大 =====');
}

// ════════════════════════════════════════════════════════════
// 【診斷】事故報告/匿名表揚 LINE 推播測試 — 在編輯器執行看 Log
// ════════════════════════════════════════════════════════════
function 測試事故表揚推播() {
  var execs = getExecutivesAndAdmins_();
  Logger.log('主管/管理員清單：' + JSON.stringify(execs));
  var r = notifyNewReportAction_({ parameter: { data: JSON.stringify({
    empId: 'TEST', name: '測試員', date: '2026-07-04', time: '10:00',
    location: 'B1F大廳', category: '設備異常', description: '測試用'
  }) } });
  Logger.log('事故報告推播結果：' + r.getContent());
}

function jsonRes(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════
// 【明日哨點推播】
// ════════════════════════════════════════════════════════════

function buildEmpNameMap_() {
  var sh = getUserDbSheet_();
  var data = sh.getDataRange().getValues();
  var map = {};
  for (var r = 1; r < data.length; r++) {
    var empId = String(data[r][0]); if (!empId) continue;
    var name = String(data[r][1]).replace(/[\s　]/g, '');
    var status = String(data[r][5] || 'active');
    if (status !== 'active' || !name) continue;
    map[name] = empId;
  }
  return map;
}

function extractPostName_(raw) {
  var t = String(raw).replace(/(\d{4}-\d{4})/g, '');
  t = t.replace(/帶隊幹部\s*[:：]/g, '');
  t = t.replace(/[\s　\n\r]/g, '');
  return t.trim();
}

function cleanPostLoc_(raw) {
  var s = String(raw).replace(/[\n\r]/g, '').replace(/[\s　]+/g, '');
  s = s.replace(/帶隊幹部\s*[:：]\s*/g, '帶隊幹部');
  return s;
}

var LOC_BLACKLIST_ = { '外圍': 1, '巡檢': 1, '哨位': 1, '姓名': 1, '帶班': 1 };

function fillMergedCells_(sh, values) {
  try {
    // 注意：getMergedRanges() 是 Range 的方法，不是 Sheet 的方法！
    // 2026-07-13 抓到：這裡原本寫 sh.getMergedRanges()，Sheet 物件根本沒有
    // 這個方法，每次呼叫都丟 TypeError，被外層 try/catch 整個吞掉——這個
    // 函式從一開始就沒有真正執行過，所有合併儲存格的哨位標籤，只有合併
    // 範圍左上角那一格讀得到值，其餘被合併蓋住的格子在 values 裡其實是
    // 空的。這就是哨位常常「未標示」、或往回找標籤時撲空、跨欄跨去搜到
    // 別排的哨位標籤（陳國榮被誤標成「帶隊幹部」「漢來飯店」）的真正原因。
    var ranges = sh.getDataRange().getMergedRanges();
    for (var i = 0; i < ranges.length; i++) {
      var rng = ranges[i];
      var r0 = rng.getRow() - 1, c0 = rng.getColumn() - 1;
      var nr = rng.getNumRows(), nc = rng.getNumColumns();
      if (r0 < 0 || c0 < 0 || !values[r0]) continue;
      var v = values[r0][c0];
      if (v === '' || v == null) continue;
      for (var r = r0; r < r0 + nr; r++) {
        if (!values[r]) continue;
        for (var c = c0; c < c0 + nc; c++) values[r][c] = v;
      }
    }
  } catch (e) {}
  return values;
}

// 逐欄判斷屬於早班區還是晚班區：直接看表頭列（合併儲存格已被
// fillMergedCells_ 展開複製到整個合併範圍）該欄底下寫的是「早班」還是
// 「晚班」，而不是用單一欄位數字當分界。
// 2026-07-13 踩坑：原本只用一個固定分界欄位數字（findLateBlockStartCol_
// 抓到的第一個「晚班」欄），但哨表模板每天的「早班增派」欄實際位置會
// 跟著當天人數浮動，只要早班增派欄位落在那個數字之後，就會被整批誤判
// 成晚班（症狀：晚班每個哨位都多一筆時間是「1200-2000」的人，那其實
// 是早班的8小時增派時段；陳國榮的1100-2200/2230也是早班12小時增派時段
// 被誤標成晚班的「帶隊幹部」「漢來飯店」）。改成逐欄直接讀表頭文字，
// 不管早班增派欄實際落在哪一欄，都能正確判斷。
function buildColBlockMap_(values) {
  var maxR = Math.min(values.length, 5);
  var maxC = 0;
  for (var r = 0; r < maxR; r++) if (values[r]) maxC = Math.max(maxC, values[r].length);
  var labelCol = {}; // 只記錄「表頭本身真的寫著早班/晚班」的欄位
  for (var c = 0; c < maxC; c++) {
    for (var r = 0; r < maxR; r++) {
      var row = values[r]; if (!row) continue;
      var v = String(row[c] == null ? '' : row[c]).trim();
      if (!v) continue;
      if (v.indexOf('晚班') !== -1) { labelCol[c] = 'late'; break; }
      if (v.indexOf('早班') !== -1) { labelCol[c] = 'early'; break; }
    }
  }
  // 2026-07-15 踩坑：表頭合併儲存格若沒蓋滿整個班別的欄位範圍（例如
  // 「晚班人員」那格只合併了1欄，右邊實際哨位資料的欄位都讀不到「晚班」
  // 字樣），逐欄比對法會把那些欄位當成「沒有表頭」整批跳過，導致該班別
  // 資料整批消失（症狀：晚班顯示0人，但原始儲存格裡明明有資料）。
  // 改成「往右延伸」：從找到表頭字樣的那一欄開始，把同一個班別往右
  // 填到遇到下一個表頭欄（早/晚班切換）為止，不再要求每一欄自己都要
  // 能讀到表頭文字——這樣即使表頭合併範圍設定不完整，也不會漏資料。
  // 安全上限：只往右延伸到「最後一個有表頭字樣的欄位」+6欄為止，避免
  // 萬一右側還殘留無關的輔助名單（2026-07-13 踩過的坑），被無限往右
  // 延伸吃進來——正常早/晚班一個區塊頂多5~6欄，+6剛好夠蓋滿又不過頭。
  var lastLabelCol = -1;
  for (var lc in labelCol) lastLabelCol = Math.max(lastLabelCol, Number(lc));
  var fillLimit = (lastLabelCol >= 0) ? Math.min(maxC, lastLabelCol + 6) : maxC;
  var map = {};
  var curBlock = null;
  for (var cc = 0; cc < fillLimit; cc++) {
    if (labelCol[cc]) curBlock = labelCol[cc];
    if (curBlock) map[cc] = curBlock;
  }
  return map;
}

function findPostLocation_(values, r, c, empSet, lateStartCol, colBlockMap) {
  var timeRe = /(\d{4}-\d{4})/;
  var row = values[r];
  var myBlock = colBlockMap ? colBlockMap[c] : undefined;
  // 邊界退回舊版單一分界欄位數字，只在該欄沒有表頭文字可判斷時當備援。
  var boundary = (typeof lateStartCol === 'number') ? lateStartCol : 8;
  var minC = (c >= boundary) ? boundary : 0;
  for (var cc = c - 1; cc >= minC; cc--) {
    // 逐欄表頭判斷優先：往回搜尋途中一旦跨到對面班別的欄位就停止，
    // 沒有表頭文字可判斷的欄位（間隔欄）不會誤擋，直接放行繼續往回找。
    if (colBlockMap && myBlock && colBlockMap[cc] && colBlockMap[cc] !== myBlock) break;
    var v = String(row[cc] == null ? '' : row[cc]).trim();
    if (!v) continue;
    if (timeRe.test(v)) continue;
    var vn = v.replace(/[\s　\n\r]/g, '');
    if (empSet[vn]) continue;
    if (LOC_BLACKLIST_[vn]) continue;
    return cleanPostLoc_(v);
  }
  return '未標示';
}

function parsePostDate_(values) {
  var roc = '', mo = '', dy = '', wd = '';
  if (values.length > 0) {
    var row0 = values[0];
    for (var c = 0; c < row0.length; c++) {
      var v = String(row0[c] == null ? '' : row0[c]).trim();
      var m = v.match(/^(\d+)年$/); if (m) roc = m[1];
      if (v === '月' && c > 0) mo = String(row0[c - 1]).trim();
      if (v.indexOf('日') !== -1 && c > 0 && /^\d+$/.test(String(row0[c - 1]).trim())) dy = String(row0[c - 1]).trim();
      if (v.indexOf('星期') !== -1 && c + 1 < row0.length) wd = String(row0[c + 1]).trim();
    }
  }
  var label = (mo && dy) ? (mo + '/' + dy + (wd ? '(' + wd + ')' : '')) : '';
  return { roc: roc, month: Number(mo) || 0, day: Number(dy) || 0, wd: wd, label: label };
}

function histYmd_(dateInfo) {
  function p(n){ return n < 10 ? '0' + n : '' + n; }
  var y = dateInfo.roc ? (Number(dateInfo.roc) + 1911) : Number(Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy'));
  return y + '/' + p(dateInfo.month || 0) + '/' + p(dateInfo.day || 0);
}

function buildHistoryLocMap_(ymd) {
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(POST_SHEET_ID);
    var sh = ss.getSheetByName(POST_HISTORY_SHEET_NAME);
    if (!sh) return map;
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var d = data[r][0];
      var ds = (d instanceof Date) ? Utilities.formatDate(d, 'Asia/Taipei', 'yyyy/MM/dd') : String(d || '').trim().replace(/-/g, '/');
      if (ds !== ymd) continue;
      var loc = String(data[r][4] || '').replace(/[\s　]/g, '');
      var name = String(data[r][5] || '').replace(/[\s　]/g, '');
      var time = String(data[r][6] || '').replace(/[\s　]/g, '');
      if (!name || !loc) continue;
      map[name + '|' + time] = loc;
    }
  } catch (e) {}
  return map;
}

function fillUnmarkedHit_(hit, dateInfo) {
  var need = false;
  for (var eid in hit) { var ps = hit[eid].posts; for (var i = 0; i < ps.length; i++) if (ps[i].loc === '未標示') need = true; }
  if (!need) return;
  var hmap = buildHistoryLocMap_(histYmd_(dateInfo));
  for (var eid2 in hit) {
    var nm = hit[eid2].name, ps2 = hit[eid2].posts;
    for (var j = 0; j < ps2.length; j++) {
      if (ps2[j].loc === '未標示') { var k = nm + '|' + ps2[j].time; if (hmap[k]) ps2[j].loc = hmap[k]; }
    }
  }
}

function fillUnmarkedList_(items, dateInfo) {
  var need = false;
  for (var i = 0; i < items.length; i++) if (items[i].loc === '未標示') need = true;
  if (!need) return;
  var hmap = buildHistoryLocMap_(histYmd_(dateInfo));
  for (var j = 0; j < items.length; j++) {
    if (items[j].loc === '未標示') { var k = items[j].name + '|' + items[j].time; if (hmap[k]) items[j].loc = hmap[k]; }
  }
}

function parsePostSheet_(sheetName) {
  sheetName = sheetName || POST_SHEET_NAME;
  var ss = SpreadsheetApp.openById(POST_SHEET_ID);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return { error: '找不到分頁：' + sheetName };
  var values = sh.getDataRange().getValues();
  values = fillMergedCells_(sh, values);
  var nameMap = buildEmpNameMap_();
  var empSet = {}; for (var k in nameMap) empSet[k] = true;
  var timeRe = /(\d{4}-\d{4})/;
  var lateStartCol = findLateBlockStartCol_(values);
  var colBlockMap = buildColBlockMap_(values);

  var hit = {};
  var noEmpId = {};

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    for (var c = 0; c < row.length; c++) {
      // 早/晚班表頭合併範圍以外的欄位（例如另外獨立列在旁邊的「巡檢增派」
      // 名單，跟哨位欄格完全脫鉤）直接跳過，不猜測歸屬、不亂貼哨位標籤。
      // 2026-07-13 抓到：陳國榮的「帶隊幹部」「漢來飯店」兩筆重複，就是
      // P欄一份獨立的增援名單被誤判成晚班資料，往回搜尋撞到晚班區最近
      // 的文字硬貼上去的（P欄根本沒有對應哨位，跟陳國榮的班表無關）。
      if (!colBlockMap[c]) continue;
      var raw = String(row[c] == null ? '' : row[c]).trim();
      if (!raw) continue;
      var name = extractPostName_(raw);
      if (!name) continue;
      if (!empSet[name]) {
        if (timeRe.test(raw) && name.length >= 2 && name.length <= 4) noEmpId[name] = true;
        continue;
      }
      var tm = raw.match(timeRe);
      var time = tm ? tm[1] : '依排班';
      var loc = (raw.indexOf('帶隊幹部') !== -1) ? '帶隊幹部' : findPostLocation_(values, r, c, empSet, lateStartCol, colBlockMap);
      var empId = nameMap[name];
      if (!hit[empId]) hit[empId] = { name: name, posts: [] };
      var dup = false;
      for (var p = 0; p < hit[empId].posts.length; p++) {
        if (hit[empId].posts[p].loc === loc && hit[empId].posts[p].time === time) { dup = true; break; }
      }
      if (!dup) hit[empId].posts.push({ loc: loc, time: time });
    }
  }
  var dateInfo = parsePostDate_(values);
  fillUnmarkedHit_(hit, dateInfo);
  return { hit: hit, noEmpId: Object.keys(noEmpId), dateInfo: dateInfo };
}

// 從表頭找出「晚班人員」實際落在第幾欄，當作早/晚班的分界欄。
// 找不到時退回舊的寫死欄位6，避免表頭文字被改掉時整個解析失效。
function findLateBlockStartCol_(values) {
  var maxR = Math.min(values.length, 5);
  for (var r = 0; r < maxR; r++) {
    var row = values[r];
    for (var c = 0; c < row.length; c++) {
      var v = String(row[c] == null ? '' : row[c]).trim();
      if (v.indexOf('晚班') !== -1) return c;
    }
  }
  return 7; // fallback：對應舊版 c<=6 為早班的邊界
}

function parsePostFullList_(sheetName) {
  sheetName = sheetName || POST_SHEET_NAME;
  var ss = SpreadsheetApp.openById(POST_SHEET_ID);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return { error: '找不到分頁：' + sheetName, early: [], late: [] };
  var values = sh.getDataRange().getValues();
  values = fillMergedCells_(sh, values);
  var nameMap = buildEmpNameMap_();
  var empSet = {}; for (var k in nameMap) empSet[k] = true;
  var timeRe = /(\d{4}-\d{4})/;
  var cnRe = /^[一-龥]{2,4}$/;
  var lateStartCol = findLateBlockStartCol_(values);
  var colBlockMap = buildColBlockMap_(values);

  var early = [], late = [];
  // 合併儲存格會把同一個值複製到範圍內每一欄，同一筆資料可能被掃到不只
  // 一次；用「哨位+姓名+時間」去重，避免同一人在早/晚班區各自重複出現
  // （2026-07-13 踩坑：陳國榮在晚班區出現兩筆不同哨位/時間的重複資料）。
  var seenEarly = {}, seenLate = {};
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    for (var c = 0; c < row.length; c++) {
      // 早/晚班表頭合併範圍以外的欄位直接跳過（見上方 2026-07-13 註解：
      // 「巡檢增派」等獨立名單常常另外放在表格最右邊，沒有自己的哨位欄，
      // 硬塞進晚班只會產生誤標的重複資料）。
      if (!colBlockMap[c]) continue;
      var raw = String(row[c] == null ? '' : row[c]).trim();
      if (!raw || !timeRe.test(raw)) continue;
      var name = extractPostName_(raw);
      if (!cnRe.test(name)) continue;
      var time = raw.match(timeRe)[1];
      var loc = (raw.indexOf('帶隊幹部') !== -1) ? '帶隊幹部' : findPostLocation_(values, r, c, empSet, lateStartCol, colBlockMap);
      var item = { loc: loc, name: name, time: time, empId: nameMap[name] || '' };
      var key = loc + '|' + name + '|' + time;
      var block = colBlockMap[c];
      if (block === 'early') {
        if (!seenEarly[key]) { seenEarly[key] = true; early.push(item); }
      } else {
        if (!seenLate[key]) { seenLate[key] = true; late.push(item); }
      }
    }
  }
  var dateInfo = parsePostDate_(values);
  fillUnmarkedList_(early.concat(late), dateInfo);
  return { early: early, late: late, dateInfo: dateInfo };
}

// 比對某解析出的哨表日期，是否等於「今天+offsetDays」（Asia/Taipei）
function checkDateMatch_(dateInfo, offsetDays) {
  var target = new Date(Date.now() + offsetDays * 86400000);
  var m = Number(Utilities.formatDate(target, 'Asia/Taipei', 'M'));
  var d = Number(Utilities.formatDate(target, 'Asia/Taipei', 'd'));
  return { match: (dateInfo.month === m && dateInfo.day === d), label: (m + '/' + d) };
}

function getTomorrowPost(e) {
  try {
    var full = parsePostFullList_(POST_SHEET_NAME);
    if (full.error) return jsonRes({ status: 'notyet', msg: full.error, early: [], late: [] });
    var dm = checkDateMatch_(full.dateInfo, 1);
    if (!dm.match) return jsonRes({ status: 'notyet', msg: '明日哨表尚未更新', date: full.dateInfo.label, early: [], late: [] });
    return jsonRes({ status: 'ok', date: full.dateInfo.label, early: full.early, late: full.late });
  } catch (err) {
    return jsonRes({ status: 'err', msg: err.toString(), early: [], late: [] });
  }
}

function getTodayPost(e) {
  try {
    var full = parsePostFullList_(POST_TODAY_SHEET_NAME);
    if (full.error) return jsonRes({ status: 'notyet', msg: '今日哨表尚未產生', early: [], late: [] });
    var dm = checkDateMatch_(full.dateInfo, 0);
    if (!dm.match) return jsonRes({ status: 'notyet', msg: '今日哨表尚未更新', date: full.dateInfo.label, early: [], late: [] });
    return jsonRes({ status: 'ok', date: full.dateInfo.label, early: full.early, late: full.late });
  } catch (err) {
    return jsonRes({ status: 'err', msg: err.toString(), early: [], late: [] });
  }
}

function buildTomorrowPostFlex_(name, dateLabel, posts, titlePrefix) {
  var body = [{ type: 'text', text: name + ' 您好', color: '#F5F5F5', size: 'sm', weight: 'bold' }];
  for (var i = 0; i < posts.length; i++) {
    if (i > 0) body.push({ type: 'separator', color: '#1F2937' });
    body.push({
      type: 'box', layout: 'vertical', spacing: 'xs', paddingTop: (i > 0 ? 'md' : 'sm'),
      contents: [
        { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
          { type: 'text', text: '位置', color: '#8A95A8', size: 'sm', flex: 2 },
          { type: 'text', text: posts[i].loc, color: '#FFD700', size: 'sm', flex: 6, weight: 'bold', wrap: true }
        ]},
        { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
          { type: 'text', text: '時段', color: '#8A95A8', size: 'sm', flex: 2 },
          { type: 'text', text: posts[i].time, color: '#F5F5F5', size: 'sm', flex: 6 }
        ]}
      ]
    });
  }
  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#D4A800', paddingAll: '16px',
      contents: [{ type: 'text', text: (titlePrefix || '📍 明日哨點　') + (dateLabel || ''), color: '#0A0C10', weight: 'bold', size: 'md' }] },
    body: { type: 'box', layout: 'vertical', backgroundColor: '#111827', paddingAll: '16px', spacing: 'md', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', backgroundColor: '#0A0C10',
      contents: [
        { type: 'button', style: 'primary', color: '#818CF8', height: 'sm',
          action: { type: 'uri', label: '📋 看完整明日哨表', uri: POST_PAGE_URL } },
        { type: 'text', text: '天鷹保全 · 祝執勤順利', color: '#6B7280', size: 'xs', align: 'center' }
      ] }
  };
}

// 將 early/late 清單依「哨點」分組，回傳 Flex 用的內容區塊陣列
// 2026-09-15：早/晚班改左右並排（見buildFullPostFlex_），單欄變窄，姓名/時段
// 改上下堆疊（原本是baseline左右排，窄欄位會擠在一起看不清楚）。
function buildPostSectionRows_(items) {
  // 依哨點(loc)歸群：{ loc: [ {name,time}, ... ] }
  var byLoc = {};
  var order = [];
  for (var i = 0; i < items.length; i++) {
    var loc = items[i].loc || '未標示';
    if (!byLoc[loc]) { byLoc[loc] = []; order.push(loc); }
    byLoc[loc].push({ name: items[i].name, time: items[i].time });
  }
  var rows = [];
  for (var o = 0; o < order.length; o++) {
    var loc = order[o];
    var people = byLoc[loc];
    if (o > 0) rows.push({ type: 'separator', color: '#1F2937', margin: 'md' });
    // 哨點名稱
    rows.push({ type: 'text', text: '📍 ' + loc, color: '#FFD700', size: 'xs', weight: 'bold', wrap: true, margin: (o > 0 ? 'md' : 'none') });
    // 該哨點每個人：姓名/時段上下堆疊，窄欄位比左右baseline排版好讀
    for (var p = 0; p < people.length; p++) {
      rows.push({
        type: 'box', layout: 'vertical', spacing: 'xs', paddingStart: 'md', margin: 'xs',
        contents: [
          { type: 'text', text: people[p].name, color: '#F5F5F5', size: 'xs', weight: 'bold', wrap: true },
          { type: 'text', text: people[p].time || '依排班', color: '#8A95A8', size: 'xxs', wrap: true }
        ]
      });
    }
  }
  if (rows.length === 0) rows.push({ type: 'text', text: '（無資料）', color: '#6B7280', size: 'xs' });
  return rows;
}

// 組整張明日哨表 Flex：早班區 + 晚班區左右並排
// 2026-09-15：原本早班區整段疊在晚班區上面，卡片拉得很長，改跟排哨工具的
// 「逐格檢視」一樣分左右兩欄並排，縮短整張卡片高度。
function buildFullPostFlex_(dateLabel, early, late) {
  var earlyCol = [
    { type: 'box', layout: 'horizontal', backgroundColor: '#818CF826', cornerRadius: '6px', paddingAll: '6px',
      contents: [{ type: 'text', text: '🌅 早班（' + early.length + '）', color: '#818CF8', weight: 'bold', size: 'xs', wrap: true }] }
  ].concat(buildPostSectionRows_(early));
  var lateCol = [
    { type: 'box', layout: 'horizontal', backgroundColor: '#D4A80026', cornerRadius: '6px', paddingAll: '6px',
      contents: [{ type: 'text', text: '🌙 晚班（' + late.length + '）', color: '#FFD700', weight: 'bold', size: 'xs', wrap: true }] }
  ].concat(buildPostSectionRows_(late));

  var body = [{
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [
      { type: 'box', layout: 'vertical', flex: 1, spacing: 'sm', contents: earlyCol },
      { type: 'separator', color: '#374151' },
      { type: 'box', layout: 'vertical', flex: 1, spacing: 'sm', contents: lateCol }
    ]
  }];

  return {
    type: 'bubble', size: 'giga',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#D4A800', paddingAll: '16px',
      contents: [
        { type: 'text', text: '📋 明日完整哨表', color: '#0A0C10', weight: 'bold', size: 'lg' },
        { type: 'text', text: dateLabel || '', color: '#0A0C10', size: 'sm', margin: 'xs' }
      ] },
    body: { type: 'box', layout: 'vertical', backgroundColor: '#111827', paddingAll: '16px', spacing: 'sm', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', backgroundColor: '#0A0C10',
      contents: [
        { type: 'button', style: 'primary', color: '#818CF8', height: 'sm',
          action: { type: 'uri', label: '📋 看完整哨表頁', uri: POST_PAGE_URL } },
        { type: 'text', text: '天鷹保全 · 祝執勤順利', color: '#6B7280', size: 'xs', align: 'center' }
      ] }
  };
}

// 推播整張哨表到群組（回傳 HTTP 碼）
function pushFullPostToGroup_(groupId, dateLabel, early, late) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !groupId) return -1;
  var flex = buildFullPostFlex_(dateLabel, early, late);
  var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({
      to: groupId,
      messages: [{ type: 'flex', altText: '📋 明日完整哨表 ' + (dateLabel || ''), contents: flex }]
    }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) console.error('群組哨表推播失敗 HTTP ' + code + '：' + resp.getContentText());
  return code;
}

// 群組哨表推播核心：解析完整哨表 → 推到群組
function tomorrowPostGroupCore_(doPush) {
  var full = parsePostFullList_();
  if (full.error) return { status: 'err', msg: full.error };

  var di = full.dateInfo;
  var dm = checkDateMatch_(di, 1);

  var groupId = readSettingStr_('tomorrowPostGroupId', '');

  var result = {
    status: 'ok',
    dateLabel: di.label, dateMatch: dm.match, tomorrow: dm.label,
    earlyCount: full.early.length, lateCount: full.late.length,
    groupId: groupId ? (groupId.substring(0, 10) + '…') : '（未設定）',
    pushed: false, httpCode: null
  };

  if (doPush) {
    if (!groupId) { result.status = 'err'; result.msg = '尚未設定群組ID，請先把機器人加入群組'; return result; }
    var code = pushFullPostToGroup_(groupId, di.label, full.early, full.late);
    result.httpCode = code;
    result.pushed = (code === 200);
  }
  return result;
}

// 明日哨點：僅供預覽/診斷用（哪些人有排班、有無綁定LINE），不再逐人 push（額度吃太兇，改用群組版 tomorrowPostGroupCore_）
function tomorrowPostCore_() {
  var parsed = parsePostSheet_();
  if (parsed.error) return { status: 'err', msg: parsed.error };

  var di = parsed.dateInfo;
  var dm = checkDateMatch_(di, 1);

  var unbound = [], detail = [];
  for (var empId in parsed.hit) {
    var h = parsed.hit[empId];
    var lineUserId = getLineUserIdByEmpId_(empId);
    detail.push({ empId: empId, name: h.name, posts: h.posts, bound: !!lineUserId });
    if (!lineUserId) unbound.push(h.name + '(' + empId + ')');
  }
  return {
    status: 'ok',
    dateLabel: di.label, dateMatch: dm.match, tomorrow: dm.label,
    totalHit: detail.length,
    unboundCount: unbound.length, unbound: unbound,
    noEmpId: parsed.noEmpId, detail: detail
  };
}

function previewTomorrowPost(e) {
  try { return jsonRes(tomorrowPostCore_()); }
  catch (err) { return jsonRes({ status: 'err', msg: err.toString() }); }
}

function pushTomorrowPostAction_(e) {
  try {
    var force = (e && e.parameter && String(e.parameter.force) === '1');
    var pv = tomorrowPostGroupCore_(false);
    if (pv.status !== 'err' && !pv.dateMatch && !force) {
      return jsonRes({ status: 'warn', msg: '明日哨表日期(' + pv.dateLabel + ')與系統明天(' + pv.tomorrow + ')不符，未推播。確認無誤可加 &force=1 強制推播。', preview: pv });
    }
    return jsonRes(tomorrowPostGroupCore_(true));
  } catch (err) {
    return jsonRes({ status: 'err', msg: err.toString() });
  }
}

function pushTomorrowPostScheduled_() {
  try {
    var pv = tomorrowPostGroupCore_(false);
    if (pv.status === 'err') { console.error('明日哨表群組推播失敗：' + pv.msg); return; }
    if (!pv.dateMatch) {
      console.error('明日哨表日期(' + pv.dateLabel + ') ≠ 系統明天(' + pv.tomorrow + ')，21:00自動推播已跳過，請確認哨表是否已更新為隔日。');
      return;
    }
    var r = tomorrowPostGroupCore_(true);
    if (r.pushed) {
      Logger.log('✅ 已推播完整哨表至群組（早' + r.earlyCount + '／晚' + r.lateCount + '）');
    } else {
      console.error('群組推播未成功：' + (r.msg || ('HTTP ' + r.httpCode)));
    }
  } catch (err) {
    console.error('pushTomorrowPostScheduled_ 失敗：' + err.toString());
  }
}

function setupTomorrowPostTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pushTomorrowPostScheduled_') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('pushTomorrowPostScheduled_')
    .timeBased().everyDays(1).atHour(21).inTimezone('Asia/Taipei').create();
  Logger.log('已建立明日哨點每日21:00推播觸發器');
}

// 每日08:00：把當時的 明日哨表 內容原地覆寫進 今日哨表（保留分頁gid不變，完全靜默無推播）
function snapshotTodayPostScheduled_() {
  try {
    var ss = SpreadsheetApp.openById(POST_SHEET_ID);
    var src = ss.getSheetByName(POST_SHEET_NAME);
    var dst = ss.getSheetByName(POST_TODAY_SHEET_NAME);
    if (!src) { console.error('快照今日哨表失敗：找不到分頁 ' + POST_SHEET_NAME); return; }
    if (!dst) { console.error('快照今日哨表失敗：找不到分頁 ' + POST_TODAY_SHEET_NAME + '（請確認試算表分頁存在）'); return; }
    // dst.clear() 不會拆掉既有合併儲存格——前一天殘留的合併範圍如果跟今天
    // 來源的合併形狀對不上，會讓 copyTo 貼進去的值被舊合併範圍吃掉或錯位
    // （2026-07-14 踩坑：晚班表頭「晚班人員：20:00~08:00」複製後變成只剩
    // 「人員：20:00~08:00」，導致 buildColBlockMap_ 找不到「晚班」文字，
    // 整個晚班區塊被判定成沒資料）。先拆合併再清空，才能保證是乾淨貼上。
    dst.getDataRange().breakApart();
    dst.clear();
    var srcRange = src.getDataRange();
    srcRange.copyTo(dst.getRange(1, 1, srcRange.getNumRows(), srcRange.getNumColumns()));
  } catch (err) {
    console.error('snapshotTodayPostScheduled_ 失敗：' + err.toString());
  }
}

function setupTodaySnapshotTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'snapshotTodayPostScheduled_') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('snapshotTodayPostScheduled_')
    .timeBased().everyDays(1).atHour(8).inTimezone('Asia/Taipei').create();
  Logger.log('已建立今日哨表每日08:00快照觸發器');
}

function handleMyTomorrowPost_(lineUserId, replyToken) {
  var bound = getEmpIdByLineUserId_(lineUserId);
  if (!bound) {
    replyLineMessage_(replyToken, '⚠️ 您尚未綁定工號，請至 APP「設定」→「綁定 LINE 通知」完成綁定後再查詢。');
    return;
  }
  var name = getEmpNameByEmpId_(bound.empId) || bound.name;
  var parsed = parsePostSheet_();
  if (parsed.error) { replyLineMessage_(replyToken, '⚠️ ' + parsed.error); return; }
  var h = parsed.hit[bound.empId];
  if (!h || !h.posts.length) {
    replyLineMessage_(replyToken, '📍 明日哨表（' + (parsed.dateInfo.label || '') + '）查無您（' + name + '）的排班，如有疑問請洽帶班幹部。');
    return;
  }
  replyLineFlex_(replyToken, '📍 您的明日哨點 ' + (parsed.dateInfo.label || ''), buildTomorrowPostFlex_(name, parsed.dateInfo.label, h.posts));
}

function handleMyTodayPost_(lineUserId, replyToken) {
  var bound = getEmpIdByLineUserId_(lineUserId);
  if (!bound) {
    replyLineMessage_(replyToken, '⚠️ 您尚未綁定工號，請至 APP「設定」→「綁定 LINE 通知」完成綁定後再查詢。');
    return;
  }
  var name = getEmpNameByEmpId_(bound.empId) || bound.name;
  var parsed = parsePostSheet_(POST_TODAY_SHEET_NAME);
  if (parsed.error) { replyLineMessage_(replyToken, '⚠️ 今日哨表尚未產生，請稍後再試。'); return; }
  var h = parsed.hit[bound.empId];
  if (!h || !h.posts.length) {
    replyLineMessage_(replyToken, '📍 今日哨表（' + (parsed.dateInfo.label || '') + '）查無您（' + name + '）的排班，如有疑問請洽帶班幹部。');
    return;
  }
  replyLineFlex_(replyToken, '📍 您的今日哨點 ' + (parsed.dateInfo.label || ''), buildTomorrowPostFlex_(name, parsed.dateInfo.label, h.posts, '📍 今日哨點　'));
}

// 手動執行用包裝函式（無底線結尾，選單才會顯示）
function runSetupScheduleNotifyTriggers() {
  setupScheduleNotifyTriggers_();
}

function runProcessScheduleChangeQueue() {
  processScheduleChangeQueue_();
}

function runSetupTomorrowPostTrigger() {
  setupTomorrowPostTrigger_();
}

function runPreviewTomorrowPost() {
  Logger.log(JSON.stringify(tomorrowPostCore_()));
}

function runSetupTodaySnapshotTrigger() {
  setupTodaySnapshotTrigger_();
}

function runSnapshotTodayPostNow() {
  snapshotTodayPostScheduled_();
  Logger.log('已手動快照今日哨表');
}

// ════════════════════════════════════════════════════════════
// 【一鍵重建哨表觸發器】── 清掉殘留的舊觸發器（含舊版21:00個人逐人推播），
//   只重建正確的兩個：21:00 群組版哨表推播、08:00 今日哨表快照。
//   ★ 重要觀念：時間觸發器執行的是「編輯器目前儲存的程式碼」，不是部署版本。
//     所以修掉個人版推播後，必須把新程式碼貼進 GAS 編輯器儲存，觸發器才會跑新版。
//   在編輯器選此函式執行一次，看 Log 確認清理結果。
// ════════════════════════════════════════════════════════════
function 一鍵重建哨表觸發器() {
  // 這個專案唯二需要的排程觸發器（其餘同名或舊版殘留一律刪除重建）
  var KILL_LIST = {
    'pushTomorrowPostScheduled_': 1,   // 21:00 哨表推播（舊版此函式是個人逐人push，同名觸發器一併清掉重建）
    'snapshotTodayPostScheduled_': 1,  // 08:00 今日哨表快照
    'onScheduleEdit_': 1,              // 已廢棄的班表偵測（改即時推播後不再需要）
    'processScheduleChangeQueue_': 1   // 已廢棄的5分鐘彙整推播
  };
  var triggers = ScriptApp.getProjectTriggers();
  var log = ['目前專案共 ' + triggers.length + ' 個觸發器：'];
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (KILL_LIST[fn]) {
      ScriptApp.deleteTrigger(triggers[i]);
      log.push('🗑️ 已刪除：' + fn);
    } else {
      log.push('⏭️ 保留（非哨表相關）：' + fn);
    }
  }
  ScriptApp.newTrigger('pushTomorrowPostScheduled_')
    .timeBased().everyDays(1).atHour(21).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('snapshotTodayPostScheduled_')
    .timeBased().everyDays(1).atHour(8).inTimezone('Asia/Taipei').create();
  log.push('✅ 已重建：pushTomorrowPostScheduled_（每日21:00 群組版完整哨表，只吃1則額度）');
  log.push('✅ 已重建：snapshotTodayPostScheduled_（每日08:00 今日哨表快照，無推播）');
  log.push('提醒：個人「哨點」查詢是 reply 回覆訊息，不佔每月200則推播額度，可放心使用。');
  Logger.log(log.join('\n'));
}
