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
  'H2':   { label: 'H2班',   time: '11:00-23:30', color: '#FBBF24' },
  'L':    { label: 'L班',    time: '12:00-20:00', color: '#38BDF8' },
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

    if (action === 'submitApplication')  return submitApplication(e);
    if (action === 'reviewApplication')  return reviewApplication(e);
    if (action === 'submitLeave')        return submitLeave(e);
    if (action === 'updateLeaveStatus')  return updateLeaveStatus(e);

    if (action === 'addUser')            return addUser(e);
    if (action === 'updateUser')         return updateUser(e);
    if (action === 'deleteUser')         return deleteUser(e);

    if (action === 'bindLine')           return bindLine(e);
    if (action === 'unbindLine')         return unbindLine(e);
    if (action === 'generateLineCode')   return generateLineCode(e);

    if (action === 'saveAnnouncements')  return saveAnnouncements(e);

    if (action === 'setSettings')        return setSettings(e);

    if (action === 'notifyScheduleChange')      return notifyScheduleChangeAction_(e);
    if (action === 'notifyScheduleChangeBatch') return notifyScheduleChangeBatchAction_(e);
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

    if (action === 'getSettings')       return getSettings();

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
          pw: String(data[r][5]),
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
      var shift = '晚班';
      if (shiftIdx >= 0) {
        var sv = String(data[r][shiftIdx] || '').trim();
        shift = (sv === '早班') ? '早班' : '晚班';
      }
      users[String(data[r][0])] = {
        name: String(data[r][1]),
        dept: String(data[r][4]),
        role: String(data[r][3]),
        pw: String(data[r][2]),
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

// 用工號查帳號管理分頁的「班別」，回傳「早班」/「晚班」，查不到或空值回 '晚班'
function getShiftByEmpId_(empId) {
  try {
    var sh = getUserDbSheet_();
    var shiftIdx = colIndexByName_(sh, '班別');
    if (shiftIdx < 0) return '晚班';
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(empId)) {
        var v = String(data[r][shiftIdx] || '').trim();
        return (v === '早班') ? '早班' : '晚班';  // 空值或其他一律當晚班
      }
    }
    return '晚班';
  } catch (err) {
    return '晚班';
  }
}

function submitLeave(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    if (!d.empId || !d.name) return jsonRes({status:'err', msg:'申請資料不完整'});
    var sh = getLeaveSheet();

    // 用工號查帳號管理的班別（空值/查不到→晚班）；前端有帶 shift 則優先採用
    var shift = (d.shift === '早班' || d.shift === '晚班') ? d.shift : getShiftByEmpId_(d.empId);

    sh.appendRow([
      d.id, "'" + d.empId, d.name, d.dept || '', d.type || '',
      "'" + (d.dates || []).join(","),
      "'" + (d.startDate || ''), "'" + (d.endDate || ''), d.days || '', d.reason || '',
      'pending', "'" + (d.appliedAt || ''), shift
    ]);

    d.shift = shift;  // 帶給通知函式
    notifyLeaveSubmitted_(d);

    return jsonRes({status:'ok', shift:shift});
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

      // 班別：讀不到欄位或空值一律當晚班
      var shift = '晚班';
      if (shiftIdx >= 0) {
        var sv = String(data[r][shiftIdx] || '').trim();
        shift = (sv === '早班') ? '早班' : '晚班';
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

// ════════════════════════════════════════════════════════════
// 【帳號管理】── 員工帳號主資料庫
// ════════════════════════════════════════════════════════════

var SEED_USER_DB_ = [
  ["sky03104", "咖哩",   "qaz03104", "admin",       "高雄辦事處", "active"],
  ["011340",   "王丞銘", "123",      "captain",     "漢神巨蛋",   "active"],
  ["011341",   "羅聖凱", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011342",   "王麒森", "123",      "vicecaptain", "漢神巨蛋",   "active"],
  ["011362",   "陳國榮", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011395",   "鄭宜慶", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011375",   "許承訓", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011364",   "張瀚升", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011365",   "吳銘哲", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011363",   "黃春福", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011369",   "陳惠景", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011377",   "張宏偉", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["011824",   "葉茂榮", "123",      "leader",      "漢神巨蛋",   "active"],
  ["013536",   "謝孟芸", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["013025",   "蔡明昌", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["013643",   "侯佳良", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["013720",   "吳國賢", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["013884",   "吳騰紘", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["014418",   "王政雄", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["015340",   "蔡東記", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["015638",   "鄭竣丞", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["015645",   "張晉銘", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["015774",   "嚴永珅", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["015783",   "石易晉", "123",      "leader",      "漢神巨蛋",   "active"],
  ["015792",   "陳龍輝", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["015732",   "謝志遠", "123",      "vicecaptain", "漢神巨蛋",   "active"],
  ["015970",   "李怡蒨", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["016187",   "謝伯維", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["016242",   "潘伯威", "123",      "leader",      "漢神巨蛋",   "active"],
  ["016485",   "陳智玄", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["016490",   "陳楷文", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["016507",   "羅世峰", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["016640",   "龔晨嘉", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["016874",   "吳俊明", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["017264",   "吳文珍", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["017801",   "林日典", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["018112",   "吳品學", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["018149",   "盧姣嫚", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["018150",   "蔡和洋", "123",      "fulltime",    "漢神巨蛋",   "active"],
  ["012859",   "張馨遠", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["011389",   "胡文彬", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["011378",   "陳建志", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["011435",   "鄭志民", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["014396",   "林政修", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["015053",   "黃銘杰", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["016146",   "梁春蔓", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["017751",   "黃志堅", "123",      "parttime",    "漢神巨蛋",   "active"],
  ["016696",   "王佩瑊", "123",      "parttime",    "漢神巨蛋",   "active"]
];

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
      users[empId] = {
        name: String(data[r][1]),
        pw: String(data[r][2]),
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
    var supervisors = getDeptSupervisors_(d.dept || '');
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

function monthScheduleReleasedAction_(e) {
  try {
    var d = JSON.parse(e.parameter.data);
    var shiftType = d.shiftType;
    var ym = String(d.ym || '').trim();
    var cfg = SCHEDULE_SHEETS_[shiftType];
    if (!cfg) return jsonRes({status:'err', msg:'未知班別:' + shiftType});

    var sh = getScheduleSheet_(shiftType);
    if (!sh) return jsonRes({status:'err', msg:'找不到' + cfg.label + '班表分頁'});

    var data = sh.getDataRange().getValues();
    var msg = '📅 ' + cfg.label + ' ' + ym + ' 班表已發佈，輸入「本月班表」即可查詢完整內容。';

    var pushed = 0;
    for (var r = 0; r < data.length; r++) {
      var name = String(data[r][1] || '').trim();
      if (!name) continue;

      var empInfo = getEmpInfoByName_(name);
      if (!empInfo) continue;
      var lineUserId = getLineUserIdByEmpId_(empInfo.empId);
      if (!lineUserId) continue;

      pushLineMessage_(lineUserId, msg);
      pushed++;

      if (pushed % 10 === 0) Utilities.sleep(150);
    }

    return jsonRes({status:'ok', shiftType: shiftType, ym: ym, pushed: pushed});
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString()});
  }
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
    var role = 'fulltime', dept = '', name = bound.name, status = 'active', shift = '晚班';
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(bound.empId)) {
        name   = String(data[r][1]) || name;
        role   = String(data[r][3]) || role;
        dept   = String(data[r][4]) || '';
        status = String(data[r][5] || 'active');
        if (shiftIdx >= 0) {
          var sv = String(data[r][shiftIdx] || '').trim();
          shift = (sv === '早班') ? '早班' : '晚班';
        }
        break;
      }
    }
    if (status !== 'active') return jsonRes({status:'ok', bound:false, msg:'帳號未啟用'});

    return jsonRes({status:'ok', bound:true, empId:bound.empId, name:name, role:role, dept:dept, shift:shift});
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
    return jsonRes(res);
  } catch (err) {
    return jsonRes({status:'err', msg:err.toString(),
      leaveCapMorning: DEFAULT_CAP_MORNING, leaveCapNight: DEFAULT_CAP_NIGHT});
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

    var res = {
      status: 'ok',
      leaveCapMorning: readSetting_(SETTING_KEY_CAP_MORNING, DEFAULT_CAP_MORNING),
      leaveCapNight:   readSetting_(SETTING_KEY_CAP_NIGHT,   DEFAULT_CAP_NIGHT)
    };
    var tp = readSettingStr_(SETTING_KEY_TOOL_PERMS, '');
    if (tp) res.toolPerms = tp;
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
  Logger.log('===== 請假推播診斷開始 =====');

  // 1. Token 是否存在
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  Logger.log('① LINE Token：' + (token ? '存在（長度 ' + token.length + '）' : '❌ 不存在！請到 專案設定→指令碼屬性 設定 LINE_CHANNEL_ACCESS_TOKEN'));
  if (!token) { Logger.log('===== 中止：沒有 Token ====='); return; }

  // 2. 篩出該部門主管
  var supervisors = getDeptSupervisors_(dept);
  Logger.log('② 篩到主管 ' + supervisors.length + ' 人：' +
    supervisors.map(function(s){ return s.name + '(' + s.empId + '/' + s.role + ')'; }).join('、'));
  if (supervisors.length === 0) {
    Logger.log('❌ 沒篩到任何主管 → 檢查帳號管理分頁：部門是否為「' + dept + '」、角色是否為審核角色、狀態是否 active');
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
    var ranges = sh.getMergedRanges();
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

function findPostLocation_(values, r, c, empSet) {
  var timeRe = /(\d{4}-\d{4})/;
  var row = values[r];
  var minC = (c >= 8) ? 8 : 0;
  for (var cc = c - 1; cc >= minC; cc--) {
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

  var hit = {};
  var noEmpId = {};

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    for (var c = 0; c < row.length; c++) {
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
      var loc = (raw.indexOf('帶隊幹部') !== -1) ? '帶隊幹部' : findPostLocation_(values, r, c, empSet);
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

  var early = [], late = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    for (var c = 0; c < row.length; c++) {
      var raw = String(row[c] == null ? '' : row[c]).trim();
      if (!raw || !timeRe.test(raw)) continue;
      var name = extractPostName_(raw);
      if (!cnRe.test(name)) continue;
      var time = raw.match(timeRe)[1];
      var loc = (raw.indexOf('帶隊幹部') !== -1) ? '帶隊幹部' : findPostLocation_(values, r, c, empSet);
      var item = { loc: loc, name: name, time: time, empId: nameMap[name] || '' };
      if (c <= 6) early.push(item); else late.push(item);
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
    rows.push({ type: 'text', text: '📍 ' + loc, color: '#FFD700', size: 'sm', weight: 'bold', wrap: true, margin: (o > 0 ? 'md' : 'none') });
    // 該哨點每個人
    for (var p = 0; p < people.length; p++) {
      rows.push({
        type: 'box', layout: 'baseline', spacing: 'sm', paddingStart: 'md',
        contents: [
          { type: 'text', text: people[p].name, color: '#F5F5F5', size: 'sm', flex: 4, weight: 'bold' },
          { type: 'text', text: people[p].time || '依排班', color: '#8A95A8', size: 'sm', flex: 5, align: 'end' }
        ]
      });
    }
  }
  if (rows.length === 0) rows.push({ type: 'text', text: '（無資料）', color: '#6B7280', size: 'sm' });
  return rows;
}

// 組整張明日哨表 Flex：早班區 + 晚班區
function buildFullPostFlex_(dateLabel, early, late) {
  var body = [];

  // 早班區標題
  body.push({ type: 'box', layout: 'horizontal', backgroundColor: '#818CF826', cornerRadius: '6px', paddingAll: '8px',
    contents: [{ type: 'text', text: '🌅 早班區（' + early.length + ' 人）', color: '#818CF8', weight: 'bold', size: 'sm' }] });
  var earlyRows = buildPostSectionRows_(early);
  for (var a = 0; a < earlyRows.length; a++) body.push(earlyRows[a]);

  // 分隔
  body.push({ type: 'separator', color: '#374151', margin: 'xl' });

  // 晚班區標題
  body.push({ type: 'box', layout: 'horizontal', backgroundColor: '#D4A80026', cornerRadius: '6px', paddingAll: '8px', margin: 'xl',
    contents: [{ type: 'text', text: '🌙 晚班區（' + late.length + ' 人）', color: '#FFD700', weight: 'bold', size: 'sm' }] });
  var lateRows = buildPostSectionRows_(late);
  for (var b = 0; b < lateRows.length; b++) body.push(lateRows[b]);

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

function tomorrowPostCore_(doPush) {
  var parsed = parsePostSheet_();
  if (parsed.error) return { status: 'err', msg: parsed.error };

  var di = parsed.dateInfo;
  var dm = checkDateMatch_(di, 1);

  var sent = [], unbound = [], detail = [];
  for (var empId in parsed.hit) {
    var h = parsed.hit[empId];
    var lineUserId = getLineUserIdByEmpId_(empId);
    detail.push({ empId: empId, name: h.name, posts: h.posts, bound: !!lineUserId });
    if (!lineUserId) { unbound.push(h.name + '(' + empId + ')'); continue; }
    if (doPush) {
      pushLineFlex_(lineUserId, '📍 您的明日哨點 ' + (di.label || ''), buildTomorrowPostFlex_(h.name, di.label, h.posts));
      sent.push(h.name);
      if (sent.length % 10 === 0) Utilities.sleep(150);
    }
  }
  return {
    status: 'ok',
    dateLabel: di.label, dateMatch: dm.match, tomorrow: dm.label,
    totalHit: detail.length, pushed: doPush ? sent.length : 0,
    unboundCount: unbound.length, unbound: unbound,
    noEmpId: parsed.noEmpId, detail: detail
  };
}

function previewTomorrowPost(e) {
  try { return jsonRes(tomorrowPostCore_(false)); }
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

function runPushTomorrowPost() {
  Logger.log(JSON.stringify(tomorrowPostCore_(true)));
}

function runPreviewTomorrowPost() {
  Logger.log(JSON.stringify(tomorrowPostCore_(false)));
}

function runSetupTodaySnapshotTrigger() {
  setupTodaySnapshotTrigger_();
}

function runSnapshotTodayPostNow() {
  snapshotTodayPostScheduled_();
  Logger.log('已手動快照今日哨表');
}
