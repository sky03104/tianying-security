// ════════════════════════════════════════════════════════════
// 天鷹保全 · 班表管理 SQL遷移【第三階段：讀取層】
// ────────────────────────────────────────────────────────────
// 用途：提供跟 getScheduleData / getScheduleByMonth_ / listScheduleMonths_
//       回傳格式「完全相同」的 Supabase 版本，供比對驗證用。
//
// ⚠️ 目前階段：這幾支 _SQL 結尾的函式尚未接進 doGet 路由，正式流量
//       還是走原本讀 Sheets 的版本，不影響現在正在使用的人。
//       等比對驗證通過，才會把 doGet 裡的路由換成呼叫這幾支。
//
// 這個檔案要跟 班表管理_後端_GAS_v2.13.gs、班表管理_SQL遷移腳本.gs
// 貼在「同一個」Apps Script 專案裡（共用 SHIFT_CONFIG / supabaseRequest_ 等）。
// ════════════════════════════════════════════════════════════

// ============================
// 把 Supabase 明細（entries）重組回跟 讀班表分頁_() 一模一樣的 rows 格式
// ============================
function 重組Rows_(entries) {
  // 用 row_index 分組，一組就是一個人
  var byRow = {};
  var order = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!(e.row_index in byRow)) {
      byRow[e.row_index] = { roleStr: e.role || '', name: e.emp_name || '', days: {} };
      order.push(e.row_index);
    }
    byRow[e.row_index].days[e.day_of_month] = e.shift_code || '';
  }
  order.sort(function (a, b) { return a - b; });

  var rows = [];
  for (var r = 0; r < order.length; r++) {
    var g = byRow[order[r]];
    var 天數 = 0;
    for (var d in g.days) { if (Number(d) > 天數) 天數 = Number(d); }
    var shifts = [];
    for (var day = 1; day <= 天數; day++) {
      shifts.push(g.days[day] !== undefined ? g.days[day] : '');
    }
    rows.push({ roleStr: g.roleStr, name: g.name, shifts: shifts });
  }
  return rows;
}

// 抓某個版本的全部明細（Supabase 預設一次最多回1000筆，一個月頂多 30人*31天=930筆，
// 單次夠用；未來人數/月份範圍變大再考慮分頁）
function 抓版本明細_(versionId) {
  return supabaseRequest_('GET',
    '/rest/v1/schedule_entries?version_id=eq.' + versionId +
    '&order=row_index.asc,day_of_month.asc');
}

// ============================
// 對應 getScheduleData（action=getSchedule）
// ============================
function getScheduleData_SQL(e) {
  try {
    var shiftKey = (e && e.parameter) ? e.parameter.shift : '';
    var cfg = SHIFT_CONFIG[shiftKey] || SHIFT_CONFIG.night;
    var shiftTypeForDb = SHIFT_TYPE_MAP_[shiftKey] || SHIFT_TYPE_MAP_.night;

    var versions = supabaseRequest_('GET',
      '/rest/v1/schedule_versions?shift_type=eq.' + shiftTypeForDb + '&status=eq.live');
    if (!versions || versions.length === 0) {
      return respond({ success: false, error: 'Supabase 找不到' + cfg.label + '的線上版本' });
    }
    var v = versions[0];
    var entries = 抓版本明細_(v.id);
    return respond({ success: true, ym: v.year_month.replace('-', '/'), rows: 重組Rows_(entries) });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// 對應 getScheduleByMonth_（action=getScheduleByMonth）
// ============================
function getScheduleByMonth_SQL(e) {
  try {
    var shiftKey = (e && e.parameter) ? e.parameter.shift : '';
    var ymSlash = String((e && e.parameter) ? e.parameter.ym : '').trim();
    if (!/^\d{4}\/\d{2}$/.test(ymSlash)) {
      return respond({ success: false, error: '月份格式需為 yyyy/MM，收到：' + ymSlash });
    }
    var cfg = SHIFT_CONFIG[shiftKey] || SHIFT_CONFIG.night;
    var shiftTypeForDb = SHIFT_TYPE_MAP_[shiftKey] || SHIFT_TYPE_MAP_.night;
    var ym = ymSlash.replace('/', '-');

    // 先找線上版本
    var live = supabaseRequest_('GET',
      '/rest/v1/schedule_versions?shift_type=eq.' + shiftTypeForDb +
      '&status=eq.live&year_month=eq.' + ym);
    if (live && live.length > 0) {
      var entriesLive = 抓版本明細_(live[0].id);
      return respond({ success: true, ym: ymSlash, source: 'live', rows: 重組Rows_(entriesLive) });
    }

    // 找不到再翻歷史（superseded）版本
    var backup = supabaseRequest_('GET',
      '/rest/v1/schedule_versions?shift_type=eq.' + shiftTypeForDb +
      '&status=eq.superseded&year_month=eq.' + ym);
    if (backup && backup.length > 0) {
      var entriesBackup = 抓版本明細_(backup[0].id);
      return respond({ success: true, ym: ymSlash, source: 'backup', rows: 重組Rows_(entriesBackup) });
    }

    var curLive = supabaseRequest_('GET',
      '/rest/v1/schedule_versions?shift_type=eq.' + shiftTypeForDb + '&status=eq.live');
    var liveYm = (curLive && curLive.length > 0) ? curLive[0].year_month.replace('-', '/') : '';
    return respond({
      success: false,
      error: '找不到 ' + ymSlash + ' 的' + cfg.label + '班表（線上目前是 ' + (liveYm || '未知') + '，也沒有該月備份）',
      liveYm: liveYm
    });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// 對應 listScheduleMonths_（action=listScheduleMonths）
// ============================
function listScheduleMonths_SQL(e) {
  try {
    var shiftKey = (e && e.parameter) ? e.parameter.shift : '';
    var cfg = SHIFT_CONFIG[shiftKey] || SHIFT_CONFIG.night;
    var shiftTypeForDb = SHIFT_TYPE_MAP_[shiftKey] || SHIFT_TYPE_MAP_.night;

    var all = supabaseRequest_('GET',
      '/rest/v1/schedule_versions?shift_type=eq.' + shiftTypeForDb + '&select=year_month,status');

    var 備份月份 = [];
    var liveYm = '';
    for (var i = 0; i < all.length; i++) {
      var ymSlash = all[i].year_month.replace('-', '/');
      if (all[i].status === 'superseded' && 備份月份.indexOf(ymSlash) < 0) 備份月份.push(ymSlash);
      if (all[i].status === 'live') liveYm = ymSlash;
    }
    備份月份.sort();
    var 全部 = 備份月份.slice();
    if (liveYm && 全部.indexOf(liveYm) < 0) 全部.push(liveYm);
    全部.sort();

    return respond({
      success: true,
      months: 全部,
      backups: 備份月份,
      backupCount: 備份月份.length,
      liveYm: liveYm
    });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// v2.16：getSchedule 短時間快取（1小時）
// ────────────────────────────
// getSchedule 這支查詢範圍固定很小，Sheets本身就夠快，真正拖慢的是 Apps
// Script 平台本身每次冷啟動＋重新打開試算表的開銷（跟讀哪個資料庫無關）。
// 加一層短時間快取：第一個人查詢照常走完整流程，接下來1小時內任何人再查
// 直接吃快取，幾乎瞬間。所有會改動班表的地方（handleUpdate/
// handleUpdateSchedule/handleDeleteStaff/checkAndSwitchMonth_）寫入成功
// 後都會主動清掉快取，不用等1小時自然過期，一改就能查到最新的。
// ============================
var 班表快取秒數_ = 3600; // 1小時。寫入時會主動清快取（見下方），設長一點沒關係

function 班表快取Key_(shiftKey) {
  return 'schedule_' + (shiftKey || 'night');
}

function 清除班表快取_(shiftKey) {
  try {
    CacheService.getScriptCache().remove(班表快取Key_(shiftKey));
  } catch (err) {
    console.error('清除班表快取失敗（' + shiftKey + '）：' + err.toString());
  }
}

function getScheduleData_含快取(e) {
  var shiftKey = (e && e.parameter) ? e.parameter.shift : '';
  var cache = CacheService.getScriptCache();
  var key = 班表快取Key_(shiftKey);
  var cached = cache.get(key);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  var result = 讀取含備援_(e, getScheduleData, getScheduleData_SQL, 'getSchedule');
  try {
    // v2.18：只快取「讀成功」的結果。原本失敗也照存，Sheets 與 Supabase 剛好同時出錯那一次
    // 會把錯誤結果鎖住 1 小時，期間前端一直只能用本機快取
    var content = result.getContent();
    if (JSON.parse(content).success) cache.put(key, content, 班表快取秒數_);
  } catch (err) {
    console.error('寫入班表快取失敗：' + err.toString());
  }
  return result;
}

// ============================
// v2.14：把「目前線上這份」同步進 Supabase
// ────────────────────────────
// 呼叫時機：Sheets 寫入成功之後（handleUpdate、checkAndSwitchMonth_）。
// Sheets 目前仍是唯一權威來源，這裡只是「順便同步一份」，失敗不能擋住
// Sheets 那邊已經成功的操作，呼叫端務必包 try/catch。
//
// 兩種情況：
//   1. 同月修訂（月份沒變）：既有 live 版本原地清掉明細重灌，version本身不變
//   2. 換月／第一次同步：舊 live 版本標記成 superseded，另外開一個新的 live 版本
// ============================
function 同步目前線上班表到Supabase_(shiftKey) {
  var cfg = SHIFT_CONFIG[shiftKey];
  var shiftTypeForDb = SHIFT_TYPE_MAP_[shiftKey];
  if (!cfg || !shiftTypeForDb) throw new Error('未知的班別代號：' + shiftKey);

  var sh = resolveTargetSheet(cfg);
  var slashYm = String(sh.getRange('Z1').getValue() || '').trim();
  if (!slashYm) return; // 月份是空的，沒東西好同步

  var ym = 轉為橫線年月_(slashYm);
  var rows = 讀班表分頁_(sh);

  var existingLive = supabaseRequest_('GET',
    '/rest/v1/schedule_versions?shift_type=eq.' + shiftTypeForDb + '&status=eq.live');

  var versionId;
  if (existingLive && existingLive.length > 0 && existingLive[0].year_month === ym) {
    // 同月修訂：原地清掉重灌
    versionId = existingLive[0].id;
    // 2026-08-27踩坑：GAS的UrlFetchApp對大寫'DELETE'/'PATCH'方法字串疑似無法正確
    // 辨識（會靜默失敗或被當成別的方法處理，不報錯但也不會真的執行），改用小寫。
    // 施工單管理搬遷時實測發現大寫'PATCH'完全沒有更新到資料才抓到這個問題，
    // 這裡的DELETE/PATCH當初沒被實際驗證過是否真的執行成功，一併修正。
    supabaseRequest_('delete', '/rest/v1/schedule_entries?version_id=eq.' + versionId);
  } else {
    // 換月或第一次：舊的line標記成歷史，開一個新版本
    if (existingLive && existingLive.length > 0) {
      supabaseRequest_('patch', '/rest/v1/schedule_versions?id=eq.' + existingLive[0].id, {
        status: 'superseded',
        superseded_at: new Date().toISOString()
      });
    }
    versionId = 建立或取得版本_(shiftTypeForDb, ym, 'live', cfg.label + '-同步-' + ym);
  }

  批次寫入Entries_(轉為Entries_(rows, shiftTypeForDb, ym, versionId));
}

// ============================
// v2.14：讀取含備援——doGet 路由用這支，優先讀 Supabase，任何失敗
// （連不上／查無資料／格式錯誤）都自動退回讀 Sheets，並留一筆 log
// 方便之後追蹤 Supabase 是不是常常在跳針。
// Sheets 目前仍是唯一權威來源，這個備援機制在階段6收尾前都要留著。
// ============================
function 讀取含備援_(e, sqlFn, sheetsFn, label) {
  try {
    var sqlResp = sqlFn(e);
    var sqlData = JSON.parse(sqlResp.getContent());
    if (sqlData.success) return sqlResp;
    console.error('SQL讀取（' + label + '）回報失敗，改用Sheets：' + (sqlData.error || '未知原因'));
  } catch (err) {
    console.error('SQL讀取（' + label + '）發生例外，改用Sheets：' + err.toString());
  }
  return sheetsFn(e);
}

// ============================
// 效能測試：同一次執行裡分別計時「讀Sheets」跟「讀Supabase」，排除網路
// 環境誤差，兩邊放同一把尺上比才準。在編輯器直接執行 測試讀取效能() 看結果。
// ============================
function 測試單一班別效能_(shiftKey) {
  var eFake = { parameter: { shift: shiftKey } };

  var t1 = new Date().getTime();
  getScheduleData(eFake); // 讀 Sheets
  var t2 = new Date().getTime();
  getScheduleData_SQL(eFake); // 讀 Supabase
  var t3 = new Date().getTime();

  return shiftKey + '：讀Sheets耗時 ' + (t2 - t1) + 'ms　讀Supabase耗時 ' + (t3 - t2) + 'ms';
}

function 測試讀取效能() {
  var 結果 = [];
  for (var key in SHIFT_CONFIG) {
    // 各測3次取平均，單次測量容易被偶發的網路延遲誤導
    var sheetsTimes = [], sqlTimes = [];
    for (var i = 0; i < 3; i++) {
      var eFake = { parameter: { shift: key } };
      var t1 = new Date().getTime();
      getScheduleData(eFake);
      var t2 = new Date().getTime();
      getScheduleData_SQL(eFake);
      var t3 = new Date().getTime();
      sheetsTimes.push(t2 - t1);
      sqlTimes.push(t3 - t2);
    }
    var avg = function (arr) { return Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length); };
    結果.push(key + '：讀Sheets平均 ' + avg(sheetsTimes) + 'ms（' + sheetsTimes.join(',') + '）　讀Supabase平均 ' + avg(sqlTimes) + 'ms（' + sqlTimes.join(',') + '）');
  }
  var msg = 結果.join('\n');
  Logger.log(msg);
  return msg;
}

// ============================
// 比對工具：把「讀Sheets」跟「讀Supabase」的結果拿來對，逐欄比對差異
// 在 Apps Script 編輯器直接執行 比對讀取結果() 看執行紀錄
// ============================
function 比對單一班別_(shiftKey) {
  var eFake = { parameter: { shift: shiftKey } };
  var oldResult = getScheduleData(eFake);
  var newResult = getScheduleData_SQL(eFake);
  var oldData = JSON.parse(oldResult.getContent());
  var newData = JSON.parse(newResult.getContent());

  if (!oldData.success || !newData.success) {
    return shiftKey + '：其中一邊讀取失敗 — 舊:' + JSON.stringify(oldData.success) + ' 新:' + JSON.stringify(newData.success)
      + (oldData.error ? ' 舊錯誤:' + oldData.error : '') + (newData.error ? ' 新錯誤:' + newData.error : '');
  }
  if (oldData.ym !== newData.ym) {
    return shiftKey + '：月份不一致！舊=' + oldData.ym + ' 新=' + newData.ym;
  }
  if (oldData.rows.length !== newData.rows.length) {
    return shiftKey + '：人數不一致！舊=' + oldData.rows.length + ' 新=' + newData.rows.length;
  }

  var 差異 = [];
  for (var r = 0; r < oldData.rows.length; r++) {
    var o = oldData.rows[r], n = newData.rows[r];
    if (o.name !== n.name || o.roleStr !== n.roleStr) {
      差異.push('第' + r + '列 姓名/職稱不一致：舊[' + o.roleStr + ',' + o.name + '] 新[' + n.roleStr + ',' + n.name + ']');
      continue;
    }
    if (o.shifts.length !== n.shifts.length) {
      差異.push(o.name + '：天數不一致 舊=' + o.shifts.length + ' 新=' + n.shifts.length);
      continue;
    }
    for (var d = 0; d < o.shifts.length; d++) {
      if (o.shifts[d] !== n.shifts[d]) {
        差異.push(o.name + ' 第' + (d + 1) + '天：舊[' + o.shifts[d] + '] 新[' + n.shifts[d] + ']');
      }
    }
  }

  if (差異.length === 0) {
    return shiftKey + '：完全一致 ✅（' + oldData.rows.length + '人 x ' + oldData.rows[0].shifts.length + '天）';
  }
  return shiftKey + '：發現 ' + 差異.length + ' 處差異 ❌\n' + 差異.join('\n');
}

// 比對 listScheduleMonths（月份清單）
function 比對月份清單_(shiftKey) {
  var eFake = { parameter: { shift: shiftKey } };
  var oldResult = JSON.parse(listScheduleMonths_(eFake).getContent());
  var newResult = JSON.parse(listScheduleMonths_SQL(eFake).getContent());

  var 差異 = [];
  if (oldResult.liveYm !== newResult.liveYm) 差異.push('liveYm不一致：舊=' + oldResult.liveYm + ' 新=' + newResult.liveYm);
  if (JSON.stringify(oldResult.months.slice().sort()) !== JSON.stringify(newResult.months.slice().sort())) {
    差異.push('months不一致：舊=' + JSON.stringify(oldResult.months) + ' 新=' + JSON.stringify(newResult.months));
  }
  if (JSON.stringify(oldResult.backups.slice().sort()) !== JSON.stringify(newResult.backups.slice().sort())) {
    差異.push('backups不一致：舊=' + JSON.stringify(oldResult.backups) + ' 新=' + JSON.stringify(newResult.backups));
  }
  if (差異.length === 0) {
    return shiftKey + '（月份清單）：完全一致 ✅ liveYm=' + oldResult.liveYm + ' months=' + JSON.stringify(oldResult.months);
  }
  return shiftKey + '（月份清單）：發現差異 ❌\n' + 差異.join('\n');
}

// 比對 getScheduleByMonth（拿目前線上月份去查，至少驗證 live 分支；
// 若之後有實際換月產生的歷史備份月份，可以把 ym 換成那個月再測一次 backup 分支）
function 比對指定月份_(shiftKey, ymSlash) {
  var eFake = { parameter: { shift: shiftKey, ym: ymSlash } };
  var oldData = JSON.parse(getScheduleByMonth_(eFake).getContent());
  var newData = JSON.parse(getScheduleByMonth_SQL(eFake).getContent());

  if (oldData.success !== newData.success) {
    return shiftKey + ' ' + ymSlash + '：success不一致 舊=' + oldData.success + ' 新=' + newData.success;
  }
  if (!oldData.success) {
    return shiftKey + ' ' + ymSlash + '：兩邊都查不到（一致）✅';
  }
  if (oldData.source !== newData.source) {
    return shiftKey + ' ' + ymSlash + '：source不一致 舊=' + oldData.source + ' 新=' + newData.source;
  }
  if (JSON.stringify(oldData.rows) !== JSON.stringify(newData.rows)) {
    return shiftKey + ' ' + ymSlash + '：rows內容不一致 ❌（用 比對單一班別_ 那套邏輯細查）';
  }
  return shiftKey + ' ' + ymSlash + '（來源:' + oldData.source + '）：完全一致 ✅';
}

function 比對讀取結果() {
  var 結果 = [];
  for (var key in SHIFT_CONFIG) {
    結果.push(比對單一班別_(key));
    結果.push(比對月份清單_(key));

    var liveYm = String(resolveTargetSheet(SHIFT_CONFIG[key]).getRange('Z1').getValue() || '').trim();
    if (liveYm) 結果.push(比對指定月份_(key, liveYm));
  }
  var msg = 結果.join('\n\n');
  Logger.log(msg);
  return msg;
}
