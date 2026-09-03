// ════════════════════════════════════════════════════════════
// 天鷹保全 · 班表上傳 Google Apps Script【完整貼上版】
// 部署網址：https://script.google.com/macros/s/AKfycbzs56InZLeaHiRJhy1alNfQwDyH0mXEV9t_WJxzfjTjIhf68DHgMiWVQvVG6vKrRZ2x1w/exec
// （早班晚班共用同一支，透過 SHIFT_CONFIG / payload.shift 分流，非天鷹保全APP帳號系統那支）
//
// 版本：2.16 新增（2026-08-27，效能優化+補同步缺口）：
//   - getSchedule 加一層1小時短時間快取（CacheService，定義於
//     班表管理_SQL讀取層.gs的getScheduleData_含快取），緩解Apps Script平台
//     本身每次冷啟動+重新打開試算表的開銷（跟讀哪個資料庫無關，無法完全消除，
//     只能降低被觸發的頻率）。
//   - handleUpdate/checkAndSwitchMonth_ 寫入成功後主動清除對應快取，不用等
//     1小時自然過期，一改就能查到最新的。
//   - 補上 handleUpdateSchedule（手動改格子）、handleDeleteStaff（刪除人員）
//     這兩支之前漏掉的同步到Supabase呼叫——原本只有「上傳xlsx」那條路徑有
//     同步，直接在畫面上手動改格子/刪人不會同步，導致Supabase跟Sheets
//     可能對不起來，現在兩處都補上。
// 版本：2.15 修正（2026-08-27，SQL遷移效能實測後修正）：
//   - 實測發現 getSchedule（目前線上這份，index.html日常在用）改讀Supabase
//     沒有變快、反而變慢：這支範圍固定很小（27列x33欄），Sheets本來就快
//     （熱機後18~25ms），Supabase每次都要多一段跨公司網路來回（實測
//     750~800ms，不會隨重複呼叫變快）。改回優先讀Sheets，Supabase當備援。
//     getScheduleByMonth/listScheduleMonths維持Supabase優先不變——那兩支
//     查歷史月份，Sheets備份分頁機制已停用，未來月份只有Supabase有資料。
// 版本：2.14 新增（2026-08-27，SQL遷移階段3+5）：
//   - handleUpdate、checkAndSwitchMonth_ 在 Sheets 寫入成功後，多呼叫一次
//     同步目前線上班表到Supabase_()（定義於 班表管理_SQL讀取層.gs），把最新
//     線上班表同步一份到 Supabase，避免 SQL 那邊變成過時的死資料。
//     ⚠️ Sheets 目前仍是唯一權威來源，同步失敗只記 log，不會擋住 Sheets 這邊
//     原本的正常運作。
//   - 【重要】移除 handleUpdate、checkAndSwitchMonth_ 換月時複製整分頁當備份
//     （原 v2.13 的 備份歷史班表_ 呼叫）。完整歷史現在由 Supabase 的
//     schedule_versions 保存（換月時舊版本標記 superseded，資料不會消失），
//     不需要 Sheets 再另外留一份，解決 TODO-31 提到的「隱藏分頁只增不減、
//     長期會撐爆分頁數上限」問題。舊有的 _備份_ 分頁維持不動、不主動清除，
//     只是不再產生新的。手動備份目前班表() 仍保留，供需要時手動執行。
//     LINE小助手、自動排哨工具等直接讀Sheets的其他系統不受影響（它們讀的
//     是「目前線上這份」，本來就跟備份分頁無關）。
// 版本：2.13 新增（2026-08-09）：
//   - 【重要】月初換月覆蓋線上班表「之前」先備份成隱藏分頁 _備份_{分頁名}_{yyyy-MM}
//     原本每月1號凌晨排程會把上個月班表直接蓋掉且無任何備份，班表就此消失；
//     咖哩是「次月初做上個月的請款」，等於每次要用的班表都剛好在前一天不見。
//     兩個覆蓋點（排程 checkAndSwitchMonth_、上傳換月 handleUpdate）都已補上。
//     備份只新增分頁、不刪除也不覆蓋任何既有分頁；同月已備份則跳過保留最早那份；
//     備份失敗只記 log，不中斷換月流程。
//   - 手動備份目前班表()：在 Apps Script 編輯器直接執行，立刻把「目前線上這個月」
//     存一份，不用等下個月1號。**部署後請先跑這個，否則當月班表仍會在下次換月時消失。**
//   - getScheduleByMonth：讀取指定月份班表（先找線上、再翻歷史備份），找不到明確
//     回報失敗，不會拿別的月份充數。供請款工具 tool_billing.html 使用。
//   - listScheduleMonths：列出目前有哪些月份的班表可用
//   - 讀班表分頁_()：把班表解析邏輯抽出來，線上與歷史備份共用同一套
// 版本：2.12 新增：
//   - handleUpdateSchedule：找不到姓名時自動塞入空白列（新增員工同步）、同步寫入職稱欄
//   - handleDeleteStaff：deleteStaff 動作，清空整列（不刪實體列，避免破壞固定範圍/格式）
// 版本：2.11 新增：
//   - getShiftSettings_：讀取「班別設定」分頁，供 APP 跨裝置同步自訂班別代號
//   - updateShiftSettings_：寫入「班別設定」分頁（分頁不存在時自動建立）
// 版本：2.10 新增：
//   - copyRangeWithFormat 不再複製欄寬/列高，避免每次上傳後live分頁欄位變窄
// ════════════════════════════════════════════════════════════

// ⚠️ 「天鷹保全APP」GAS的部署網址（doPost那支，結尾為 /exec）
var NOTIFY_GAS_URL = "https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec";

// ── 雙班別設定 ──
var SHIFT_CONFIG = {
  // 晚班：維持原本目標（不變）
  night: {
    label: '晚班',
    targetSsId: '1hIbgESfLitqC3W9DuSFGMWEuFZKJFKzK8srorQMuia8',
    targetSheetName: '晚班班表',
    targetGid: 1144284018,
    sourceSheetName: '晚班班表'
  },
  // 早班：新增目標（早班線上班表）
  morning: {
    label: '早班',
    targetSsId: '1l8SoOVDQ4nO6qBkXcNEaBzct6AN82-H_0njbKNQauUQ',
    targetSheetName: '早班班表',
    targetGid: 38985608,
    sourceSheetName: '早班班表'
  }
};

// 上傳的 Excel 暫存資料夾
var SOURCE_FOLDER_ID = '1JaWrMWQQBGGt1BGGaUKqnwTVKQ9De8Na';

// ============================
// POST 入口
// ============================
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;

    if (action === 'upload') {
      return handleUpload(payload);
    } else if (action === 'update') {
      return handleUpdate(payload);
    } else if (action === 'updateSchedule') {
      return handleUpdateSchedule(payload);
    } else if (action === 'updateShiftSettings') {
      return updateShiftSettings_(payload);
    } else if (action === 'deleteStaff') {
      return handleDeleteStaff(payload);
    } else if (action === 'updateStaffEmpIds') {
      return updateStaffEmpIds_(payload);
    } else if (action === 'upsertStaffEmpId') {
      return upsertStaffEmpId_(payload);
    } else if (action === 'deleteStaffEmpId') {
      return deleteStaffEmpId_(payload);
    }

    throw new Error('未知的 action');
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// GET 入口（連線測試用）
// ============================
function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';

  if (action === 'getSchedule') {
    // v2.15：實測發現這支範圍固定很小（27列x33欄），Sheets本來就快（熱機後
    // 18~25ms），改讀Supabase反而每次都要多一段跨公司網路來回（實測750~800ms，
    // 不會變快）。改回優先讀Sheets，Supabase只當備援（讀取含備援_ 定義於
    // 班表管理_SQL讀取層.gs）。getScheduleByMonth/listScheduleMonths維持
    // Supabase優先不變——那兩支查的是歷史月份，Sheets備份分頁機制已停用，
    // 未來月份只有Supabase有資料，沒有退路也不需要退路。
    // v2.16：真正拖慢的是Apps Script平台每次冷啟動＋重新打開試算表的開銷，
    // 跟讀哪個資料庫無關，加一層1小時短時間快取緩解（getScheduleData_含快取
    // 定義於 班表管理_SQL讀取層.gs）。
    return getScheduleData_含快取(e);
  } else if (action === 'getScheduleByMonth') {
    return 讀取含備援_(e, getScheduleByMonth_SQL, getScheduleByMonth_, 'getScheduleByMonth');   // v2.13：指定月份（含歷史備份），請款工具用
  } else if (action === 'listScheduleMonths') {
    return 讀取含備援_(e, listScheduleMonths_SQL, listScheduleMonths_, 'listScheduleMonths');   // v2.13：列出有哪些月份可用
  } else if (action === 'getShiftSettings') {
    return getShiftSettings_();
  } else if (action === 'getStaffEmpIds') {
    return getStaffEmpIds_();
  }

  return respond({ success: true, status: 'online' });
}

// ============================
// 上傳 Excel 到雲端硬碟
// ============================
function handleUpload(payload) {
  var base64 = payload.fileData;
  var fileName = payload.fileName || '班表上傳.xlsx';

  var folder = DriveApp.getFolderById(SOURCE_FOLDER_ID);

  // 刪除同名舊檔
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);

  // 建立新檔
  var blob = Utilities.newBlob(
    Utilities.base64Decode(base64),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName
  );
  var file = folder.createFile(blob);

  return respond({ success: true, fileId: file.getId(), fileName: file.getName() });
}

// ============================
// 輔助函式：解析班別代號（含排休字色判斷）
// val = 儲存格值，color = 字體顏色字串
// ============================
function parseShiftCode_(val, color) {
  var v = String(val == null ? '' : val).trim();
  var c = String(color || '').toLowerCase();
  // 試算表中「排休」以紅字「休」儲存
  if (v === '休' && (c === '#ff0000' || c === 'red')) return '排休';
  return v || '-';
}

// ============================
// 輔助函式：取得台北時間「yyyy/MM」格式年月字串
// ============================
function getTaipeiYm_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM');
}

// ============================
// 輔助函式：年/月數字 → 「yyyy/MM」字串（與 getTaipeiYm_ 格式一致）
// ============================
function buildYm_(year, monthNum) {
  return year + '/' + (monthNum < 10 ? '0' + monthNum : String(monthNum));
}

// ============================
// v2.13：歷史班表備份
// ────────────────────────────
// 背景：月初排程會把「待生效」直接蓋掉線上班表，舊月份班表從此消失。
// 咖哩是「次月初做上個月的請款」，等於每次要用的班表都剛好在前一天被蓋掉；
// 出勤爭議時也查不到當時的排班。所以覆蓋前一律先留一份。
//
// 安全原則（這裡動的是正式營運資料，寫法刻意保守）：
//   1. 只「新增」分頁，絕不刪除或覆蓋任何既有分頁
//   2. 同月備份已存在就直接跳過——保留最早那份（最接近當時真實狀態）
//   3. 備份失敗只記 log，不能讓它中斷換月流程（班表照常切換比較重要）
// ============================
var 備份分頁前綴_ = '_備份_';

function 備份分頁名_(cfg, ym) {
  // 例：_備份_晚班班表_2026-08
  return 備份分頁前綴_ + cfg.targetSheetName + '_' + String(ym).replace(/\//g, '-');
}

function 備份歷史班表_(cfg, tgtSheet, ym) {
  try {
    var y = String(ym || '').trim();
    if (!/^\d{4}\/\d{2}$/.test(y)) {
      console.log('備份跳過：月份格式不正確（' + ym + '）');
      return false;
    }
    var ss = SpreadsheetApp.openById(cfg.targetSsId);
    var name = 備份分頁名_(cfg, y);
    if (ss.getSheetByName(name)) {
      console.log('備份跳過：' + name + ' 已存在，保留原有那份');
      return false;
    }
    var copy = tgtSheet.copyTo(ss);
    copy.setName(name);
    copy.hideSheet(); // 藏起來，不干擾日常操作
    SpreadsheetApp.flush();
    console.log('已備份班表：' + name);
    return true;
  } catch (err) {
    // 備份失敗不能擋住換月，班表該切還是要切
    console.error('備份歷史班表失敗（' + cfg.label + ' ' + ym + '）：' + err.toString());
    return false;
  }
}

// ============================
// v2.13：一次性手動備份（在 Apps Script 編輯器直接執行這個函式）
// 用途：程式剛部署時，先把「目前線上這個月」的班表保起來，
//       不用等到下個月 1 號排程才有備份。
// ============================
function 手動備份目前班表() {
  var 結果 = [];
  for (var key in SHIFT_CONFIG) {
    var cfg = SHIFT_CONFIG[key];
    try {
      var sh = resolveTargetSheet(cfg);
      var ym = String(sh.getRange('Z1').getValue() || '').trim();
      var ok = 備份歷史班表_(cfg, sh, ym);
      結果.push(cfg.label + ' ' + (ym || '(無月份)') + '：' + (ok ? '已備份' : '跳過（已存在或月份無效）'));
    } catch (err) {
      結果.push(cfg.label + '：失敗 ' + err.toString());
    }
  }
  Logger.log(結果.join('\n'));
  return 結果.join('\n');
}

// ============================
// 依設定取得「待生效」分頁；不存在則複製live分頁建立同結構分頁
// ============================
function getStagingSheet_(cfg) {
  var ss = SpreadsheetApp.openById(cfg.targetSsId);
  var stagingName = cfg.targetSheetName + '_待生效';
  var sh = ss.getSheetByName(stagingName);
  if (!sh) {
    var liveSheet = resolveTargetSheet(cfg);
    sh = liveSheet.copyTo(ss);
    sh.setName(stagingName);
  }
  return sh;
}

// ============================
// 從雲端硬碟讀取 Excel 並更新線上班表
// ============================
function handleUpdate(payload) {
  var fileId = payload.fileId;

  var cfg = SHIFT_CONFIG[payload.shift] || SHIFT_CONFIG.night;
  var srcName = payload.srcSheet || cfg.sourceSheetName;

  var tempSs = Drive.Files.copy(
    { title: '_temp_班表_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
    fileId
  );
  var tempSsId = tempSs.id;

  try {
    var srcSs = SpreadsheetApp.openById(tempSsId);
    var srcSheet = srcSs.getSheetByName(srcName);
    if (!srcSheet) throw new Error('找不到來源分頁「' + srcName + '」');

    var tgtSheet = resolveTargetSheet(cfg);

    var notifyShiftType = (payload.shift === 'morning') ? 'early' : 'late';

    var monthVal = srcSheet.getRange('Z1').getValue();
    var monthNum = Number(monthVal);
    var year = Number(payload.year) || (new Date()).getFullYear();
    var newYm = (monthNum >= 1 && monthNum <= 12) ? buildYm_(year, monthNum) : '';

    var liveYm = String(tgtSheet.getRange('Z1').getValue() || '').trim();
    var todayYm = getTaipeiYm_();

    var isStagingUpload = !!(newYm && liveYm && newYm !== liveYm && newYm !== todayYm);
    var isMonthSwitch   = !!(newYm && newYm !== liveYm && newYm === todayYm);

    if (isStagingUpload) {
      var stagingSheet = getStagingSheet_(cfg);
      copyRangeWithFormat(srcSheet, stagingSheet, 'A4:AG30');
      copyRangeWithFormat(srcSheet, stagingSheet, 'C2:AG3');
      stagingSheet.getRange('Z1').setValue(newYm);
      SpreadsheetApp.flush();
      return respond({
        success: true,
        message: cfg.label + newYm + ' 班表已上傳至待生效區，將於 ' + newYm + ' 1日自動切換生效（目前線上班表不受影響）'
      });
    }

    var oldVals, oldColors;
    if (!isMonthSwitch) {
      oldVals   = tgtSheet.getRange('A4:AG30').getValues();
      oldColors = tgtSheet.getRange('A4:AG30').getFontColors();
    }

    // v2.14：SQL遷移階段5——不再於換月時複製整分頁當備份。
    // 原因：完整歷史現在由 同步目前線上班表到Supabase_() 保存在 Supabase（換月時
    // 舊版本會標記 superseded 保留，不會消失），不需要 Sheets 這邊再另外留一份，
    // 否則隱藏分頁只會一直往上疊，長期會撐爆 Google Sheets 分頁數上限（TODO-31/36）。
    // 舊的 _備份_ 分頁維持不動（不主動刪除），只是不再產生新的。

    copyRangeWithFormat(srcSheet, tgtSheet, 'A4:AG30');

    if (isMonthSwitch) {
      notifyMonthScheduleReleased_(notifyShiftType, newYm);
    } else {
      var newVals   = tgtSheet.getRange('A4:AG30').getValues();
      var newColors = tgtSheet.getRange('A4:AG30').getFontColors();

      var allDiffs = [];

      for (var r = 0; r < newVals.length; r++) {
        var name = String(newVals[r][1] || '').trim();
        if (!name) continue;

        var diffDays = [];
        for (var c = 2; c <= 31; c++) {
          var oldCode = parseShiftCode_(oldVals[r][c], oldColors[r][c]);
          var newCode = parseShiftCode_(newVals[r][c], newColors[r][c]);
          if (oldCode !== newCode) {
            diffDays.push({ day: c - 1, code: newCode });
          }
        }

        if (diffDays.length > 0) {
          allDiffs.push({ name: name, shiftType: notifyShiftType, days: diffDays });
        }
      }

      // 2026-08-02：一次異動達門檻（換月、整批調整）改群組發一則，個位數的一般小異動
      // 仍走個人化推播（讓當事人清楚知道自己哪幾天改了），兩種情境門檻分開處理。
      var BULK_DIFF_THRESHOLD = 10;
      if (allDiffs.length >= BULK_DIFF_THRESHOLD) {
        notifyScheduleChangeBulkToLine_(notifyShiftType, allDiffs.length);
      } else if (allDiffs.length > 0) {
        notifyScheduleChangeBatchToLine_(allDiffs);
      }
    }

    copyRangeWithFormat(srcSheet, tgtSheet, 'C2:AG3');

    if (newYm) {
      tgtSheet.getRange('Z1').setValue(newYm);
    }

    SpreadsheetApp.flush();

    // v2.14：SQL遷移階段3——Sheets寫入成功後，同步一份到Supabase，避免SQL側變成
    // 過時的死資料。失敗只記log不擋Sheets這邊的正常流程（Sheets目前仍是權威來源）。
    try { 同步目前線上班表到Supabase_(payload.shift); } catch (syncErr) {
      console.error('同步Supabase失敗（不影響Sheets已成功更新）：' + syncErr.toString());
    }
    清除班表快取_(payload.shift); // v2.16：寫入後主動清快取，不用等1小時自然過期

    return respond({
      success: true,
      message: cfg.label + '線上班表已更新完成' + (isMonthSwitch ? '（已切換為' + newYm + '）' : '')
    });

  } finally {
    try { DriveApp.getFileById(tempSsId).setTrashed(true); } catch (e) {}
  }
}

// ============================
// 依設定取得目標分頁：gid 優先、名稱備援
// ============================
function resolveTargetSheet(cfg) {
  var ss = SpreadsheetApp.openById(cfg.targetSsId);
  if (cfg.targetGid != null) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === cfg.targetGid) return sheets[i];
    }
  }
  if (cfg.targetSheetName) {
    var sh = ss.getSheetByName(cfg.targetSheetName);
    if (sh) return sh;
  }
  throw new Error('找不到' + cfg.label + '目標分頁（gid:' + cfg.targetGid + ' / 名稱:' + cfg.targetSheetName + '）');
}

// ============================
// 複製範圍：內容＋格式＋合併儲存格（v2.10：不複製欄寬/列高）
// ============================
function copyRangeWithFormat(srcSheet, tgtSheet, rangeA1) {
  var src = srcSheet.getRange(rangeA1);
  var tgt = tgtSheet.getRange(rangeA1);

  tgt.setValues(src.getValues());
  tgt.setBackgrounds(src.getBackgrounds());
  tgt.setFontColors(src.getFontColors());
  tgt.setFontWeights(src.getFontWeights());
  tgt.setFontStyles(src.getFontStyles());
  tgt.setFontSizes(src.getFontSizes());
  tgt.setFontFamilies(src.getFontFamilies());
  tgt.setHorizontalAlignments(src.getHorizontalAlignments());
  tgt.setVerticalAlignments(src.getVerticalAlignments());
  tgt.setNumberFormats(src.getNumberFormats());

  tgt.breakApart();
  var merges = src.getMergedRanges();
  for (var i = 0; i < merges.length; i++) {
    var m = merges[i];
    tgtSheet.getRange(m.getRow(), m.getColumn(), m.getNumRows(), m.getNumColumns()).merge();
  }
}

// ============================
// 班表管理工具：讀取線上班表
// ============================
/* v2.13：把「把一個班表分頁讀成 rows」抽出來，線上班表與歷史備份共用同一套解析，
   免得兩邊各寫一份、日後改了一邊忘了另一邊（本 repo 已經因為這種寫法出過 bug）。 */
function 讀班表分頁_(sh) {
  var rng = sh.getRange('A4:AG30');
  var data = rng.getValues();
  var colors = rng.getFontColors();
  var rows = [];
  for (var r = 0; r < data.length; r++) {
    var name = String(data[r][1] || '').trim();
    if (!name) continue;
    var shifts = [];
    for (var c = 2; c < 33; c++) {
      var v = String(data[r][c] == null ? '' : data[r][c]).trim();
      if (v === '休') {
        var col = String(colors[r][c] || '').toLowerCase();
        if (col === '#ff0000' || col === 'red') v = '排休';
      }
      shifts.push(v);
    }
    rows.push({ roleStr: String(data[r][0] || '').trim(), name: name, shifts: shifts });
  }
  return rows;
}

function getScheduleData(e) {
  try {
    var shiftKey = (e && e.parameter) ? e.parameter.shift : '';
    var cfg = SHIFT_CONFIG[shiftKey] || SHIFT_CONFIG.night;
    var sh = resolveTargetSheet(cfg);
    var ym = String(sh.getRange('Z1').getValue() || '').trim();
    return respond({ success: true, ym: ym, rows: 讀班表分頁_(sh) });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// v2.13：讀取「指定月份」的班表（給請款工具用）
// 參數：shift=morning|night、ym=yyyy/MM
// 先找線上班表（月份剛好相符時），找不到再翻歷史備份分頁。
// 找不到就明確回報失敗，不會退而求其次拿別的月份充數——
// 拿錯月份的班表去請款會出大事。
// ============================
function getScheduleByMonth_(e) {
  try {
    var shiftKey = (e && e.parameter) ? e.parameter.shift : '';
    var ym = String((e && e.parameter) ? e.parameter.ym : '').trim();
    if (!/^\d{4}\/\d{2}$/.test(ym)) {
      return respond({ success: false, error: '月份格式需為 yyyy/MM，收到：' + ym });
    }
    var cfg = SHIFT_CONFIG[shiftKey] || SHIFT_CONFIG.night;

    var live = resolveTargetSheet(cfg);
    var liveYm = String(live.getRange('Z1').getValue() || '').trim();
    if (liveYm === ym) {
      return respond({ success: true, ym: ym, source: 'live', rows: 讀班表分頁_(live) });
    }

    var ss = SpreadsheetApp.openById(cfg.targetSsId);
    var backup = ss.getSheetByName(備份分頁名_(cfg, ym));
    if (backup) {
      return respond({ success: true, ym: ym, source: 'backup', rows: 讀班表分頁_(backup) });
    }

    return respond({
      success: false,
      error: '找不到 ' + ym + ' 的' + cfg.label + '班表（線上目前是 ' + (liveYm || '未知') + '，也沒有該月備份）',
      liveYm: liveYm
    });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// v2.13：列出有哪些月份的班表可用（給前端顯示「可選月份」）
// ============================
function listScheduleMonths_(e) {
  try {
    var shiftKey = (e && e.parameter) ? e.parameter.shift : '';
    var cfg = SHIFT_CONFIG[shiftKey] || SHIFT_CONFIG.night;
    var ss = SpreadsheetApp.openById(cfg.targetSsId);
    var 前綴 = 備份分頁前綴_ + cfg.targetSheetName + '_';
    var 月份 = [];
    ss.getSheets().forEach(function (sh) {
      var n = sh.getName();
      if (n.indexOf(前綴) === 0) {
        var ym = n.substring(前綴.length).replace(/-/g, '/');
        if (/^\d{4}\/\d{2}$/.test(ym)) 月份.push(ym);
      }
    });
    var liveYm = String(resolveTargetSheet(cfg).getRange('Z1').getValue() || '').trim();
    /* 2026-08-09 修：原本只回一個混在一起的 months，備份分頁的月份和目前線上的月份
       分不出來。當線上正好是 2026/08、備份也是 2026/08 時，回傳長得一模一樣——
       「備份成功」和「備份根本沒建」無法區分，這種檢查等於沒檢查。
       改成 backups 單獨回報，才驗得出備份到底有沒有建立。 */
    var 備份月份 = 月份.slice().sort();
    var 全部 = 月份.slice();
    if (liveYm && 全部.indexOf(liveYm) < 0) 全部.push(liveYm);
    全部.sort();
    return respond({
      success: true,
      months: 全部,          // 可用月份（備份 ＋ 目前線上）
      backups: 備份月份,     // 只有備份分頁的月份，用來確認備份機制有沒有真的在動
      backupCount: 備份月份.length,
      liveYm: liveYm
    });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// 通知「天鷹保全APP」GAS：班表異動（單一員工）
// ============================
function notifyScheduleChangeToLine_(name, shiftType, days) {
  try {
    if (!days || !days.length) return;
    if (!NOTIFY_GAS_URL || NOTIFY_GAS_URL.indexOf('請填入') === 0) return;
    UrlFetchApp.fetch(NOTIFY_GAS_URL, {
      method: 'post',
      payload: {
        action: 'notifyScheduleChange',
        data: JSON.stringify({ name: name, shiftType: shiftType, days: days })
      },
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('notifyScheduleChangeToLine_ 失敗：' + err.toString());
  }
}

// ============================
// v2.8：通知「天鷹保全APP」GAS：班表異動（整批多員工）
// ============================
function notifyScheduleChangeBatchToLine_(items) {
  try {
    if (!items || !items.length) return;
    if (!NOTIFY_GAS_URL || NOTIFY_GAS_URL.indexOf('請填入') === 0) return;
    UrlFetchApp.fetch(NOTIFY_GAS_URL, {
      method: 'post',
      payload: {
        action: 'notifyScheduleChangeBatch',
        data: JSON.stringify(items)
      },
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('notifyScheduleChangeBatchToLine_ 失敗：' + err.toString());
  }
}

// 2026-08-02 新增：一次異動人數太多（例如換月整批班表一起改）改群組發一則，不逐人各發一則，
// 避免像 8/1 換月那次一天燒掉149則個人推播、把當月免費額度吃光。
function notifyScheduleChangeBulkToLine_(shiftType, count) {
  try {
    if (!NOTIFY_GAS_URL || NOTIFY_GAS_URL.indexOf('請填入') === 0) return;
    UrlFetchApp.fetch(NOTIFY_GAS_URL, {
      method: 'post',
      payload: {
        action: 'notifyScheduleChangeBulk',
        data: JSON.stringify({ shiftType: shiftType, count: count })
      },
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('notifyScheduleChangeBulkToLine_ 失敗：' + err.toString());
  }
}

// ============================
// v2.9：通知「天鷹保全APP」GAS：換月公告
// ============================
function notifyMonthScheduleReleased_(shiftType, ym) {
  try {
    if (!NOTIFY_GAS_URL || NOTIFY_GAS_URL.indexOf('請填入') === 0) return;
    UrlFetchApp.fetch(NOTIFY_GAS_URL, {
      method: 'post',
      payload: {
        action: 'monthScheduleReleased',
        data: JSON.stringify({ shiftType: shiftType, ym: ym })
      },
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('notifyMonthScheduleReleased_ 失敗：' + err.toString());
  }
}

// ============================
// v2.9：每日時間觸發器執行函式（月初自動切換待生效分頁）
// ============================
function checkAndSwitchMonth_() {
  var todayYm = getTaipeiYm_();

  for (var key in SHIFT_CONFIG) {
    var cfg = SHIFT_CONFIG[key];
    try {
      var ss = SpreadsheetApp.openById(cfg.targetSsId);
      var stagingSheet = ss.getSheetByName(cfg.targetSheetName + '_待生效');
      if (!stagingSheet) continue;

      var stagingYm = String(stagingSheet.getRange('Z1').getValue() || '').trim();
      if (!stagingYm || stagingYm !== todayYm) continue;

      var tgtSheet = resolveTargetSheet(cfg);
      var liveYm = String(tgtSheet.getRange('Z1').getValue() || '').trim();
      if (liveYm === todayYm) continue;

      // v2.14：不再複製整分頁備份，理由同 handleUpdate 那處——完整歷史已由
      // 同步目前線上班表到Supabase_() 保存在 Supabase，不需要 Sheets 再留一份。

      copyRangeWithFormat(stagingSheet, tgtSheet, 'A4:AG30');
      copyRangeWithFormat(stagingSheet, tgtSheet, 'C2:AG3');
      tgtSheet.getRange('Z1').setValue(stagingYm);
      SpreadsheetApp.flush();

      // v2.14：同上，排程換月也要同步到Supabase，失敗只記log不擋換月流程。
      try { 同步目前線上班表到Supabase_(key); } catch (syncErr) {
        console.error('排程換月同步Supabase失敗（不影響Sheets已完成換月）：' + syncErr.toString());
      }
      清除班表快取_(key); // v2.16：換月後主動清快取

      var notifyShiftType = (key === 'morning') ? 'early' : 'late';
      notifyMonthScheduleReleased_(notifyShiftType, stagingYm);
    } catch (err) {
      console.error('checkAndSwitchMonth_ 失敗（' + key + '）：' + err.toString());
    }
  }
}

// ============================
// v2.9：一次性設定每日換月檢查觸發器
// ============================
function setupMonthSwitchTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkAndSwitchMonth_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('checkAndSwitchMonth_')
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .create();
  Logger.log('已建立每日換月檢查觸發器（每日00:00~01:00間執行一次）');
}

function runSetupMonthSwitchTrigger() {
  setupMonthSwitchTrigger_();
}

// ============================
// 班表管理工具：手動排班寫回線上班表
// v2.12：找不到姓名時自動塞入空白列（新增員工同步）、同步寫入職稱欄
// ============================
function handleUpdateSchedule(payload) {
  try {
    var cfg = SHIFT_CONFIG[payload.shift] || SHIFT_CONFIG.night;
    var sh = resolveTargetSheet(cfg);

    var ym = String(sh.getRange('Z1').getValue() || '').trim();
    var m = Number(payload.month), y = Number(payload.year);
    if (ym && m >= 1 && m <= 12 && y > 2000) {
      var expect = y + '/' + (m < 10 ? '0' + m : String(m));
      if (ym !== expect) {
        return respond({ success: false, error: '線上班表月份(' + ym + ')與資料月份(' + expect + ')不符，未寫入' });
      }
    }

    var notifyShiftType = (payload.shift === 'morning') ? 'early' : 'late';

    var grid = sh.getRange('A4:AG30').getValues();
    var list = payload.data || [];
    var updated = 0, added = 0, skipped = 0;
    var allDiffs = []; // v2.17：跟 handleImportSchedule 共用門檻邏輯，不逐人即時推播
    for (var i = 0; i < list.length; i++) {
      var nm = String(list[i].name || '').trim();
      if (!nm) continue;

      var foundRow = -1, emptyRow = -1;
      for (var r = 0; r < grid.length; r++) {
        var rowName = String(grid[r][1] || '').trim();
        if (rowName === nm) { foundRow = r; break; }
        if (emptyRow === -1 && !rowName) emptyRow = r;
      }

      var targetRow = foundRow;
      var isNew = false;
      if (targetRow === -1) {
        if (emptyRow === -1) { skipped++; continue; } // 沒有空白列可用，需人工到試算表擴充範圍
        targetRow = emptyRow;
        isNew = true;
      }

      var roleStr = String(list[i].roleStr || '').trim();
      if (isNew || roleStr) {
        sh.getRange(4 + targetRow, 1).setValue(roleStr || '保全');
        sh.getRange(4 + targetRow, 2).setValue(nm);
        grid[targetRow][0] = roleStr || '保全';
        grid[targetRow][1] = nm;
      }
      var shifts = list[i].shifts || [];
      var n = Math.min(shifts.length, 31);
      if (n > 0) {
        var oldVals = sh.getRange(4 + targetRow, 3, 1, n).getValues()[0];

        var vals = [], cols = [], notifyCodes = [];
        for (var c = 0; c < n; c++) {
          var v = String(shifts[c] == null ? '' : shifts[c]).trim();
          if (v === '排休') {
            vals.push('休');
            cols.push('#ff0000');
            notifyCodes.push('排休');
          } else {
            vals.push(v === '-' ? '' : v);
            cols.push('#000000');
            notifyCodes.push(v === '-' ? '-' : v);
          }
        }
        var wRng = sh.getRange(4 + targetRow, 3, 1, n);
        wRng.setValues([vals]);
        wRng.setFontColors([cols]);

        if (isNew) {
          added++;
        } else {
          updated++;
          var diffDays = [];
          for (var k = 0; k < n && k < 30; k++) {
            var oldVal = String(oldVals[k] == null ? '' : oldVals[k]).trim();
            if (oldVal !== vals[k]) {
              diffDays.push({ day: k + 1, code: notifyCodes[k] });
            }
          }
          if (diffDays.length > 0) {
            allDiffs.push({ name: nm, shiftType: notifyShiftType, days: diffDays });
          }
        }
      }
    }

    // v2.17：異動人數達門檻（例如批次職務修正、大量調整）改群組發一則，不逐人各發一則，
    // 跟 handleImportSchedule 用同一套門檻（見 2026-08-02 換月149人燒光額度那次的教訓）——
    // 手動存檔這條路徑當時漏補，才會又發生3天內燒掉187則的事。
    var BULK_DIFF_THRESHOLD = 10;
    if (allDiffs.length >= BULK_DIFF_THRESHOLD) {
      notifyScheduleChangeBulkToLine_(notifyShiftType, allDiffs.length);
    } else if (allDiffs.length > 0) {
      notifyScheduleChangeBatchToLine_(allDiffs);
    }

    SpreadsheetApp.flush();

    // v2.16：這支之前漏掉同步到Supabase＋清快取（只有上傳xlsx那條路徑有做），
    // 導致直接在畫面上手動改格子時Supabase會跟Sheets對不起來，現在補上。
    try { 同步目前線上班表到Supabase_(payload.shift); } catch (syncErr) {
      console.error('同步Supabase失敗（不影響Sheets已成功更新）：' + syncErr.toString());
    }
    清除班表快取_(payload.shift);

    return respond({ success: true, updated: updated, added: added, skipped: skipped });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// v2.12：刪除員工 — 清空該列（不刪實體列，避免破壞 A4:AG30 固定範圍/格式/合併儲存格）
// ============================
function handleDeleteStaff(payload) {
  try {
    var cfg = SHIFT_CONFIG[payload.shift] || SHIFT_CONFIG.night;
    var sh = resolveTargetSheet(cfg);
    var nm = String(payload.name || '').trim();
    if (!nm) return respond({ success: false, error: '缺少姓名' });

    var grid = sh.getRange('A4:AG30').getValues();
    var targetRow = -1;
    for (var r = 0; r < grid.length; r++) {
      if (String(grid[r][1] || '').trim() === nm) { targetRow = r; break; }
    }
    if (targetRow === -1) return respond({ success: true, deleted: false });

    var rng = sh.getRange(4 + targetRow, 1, 1, 33); // A~AG 整列清空（不刪實體列，避免破壞固定範圍/格式/合併儲存格）
    rng.setValue('');
    rng.setFontColor('#000000');
    SpreadsheetApp.flush();

    // v2.16：同上，補同步到Supabase＋清快取
    try { 同步目前線上班表到Supabase_(payload.shift); } catch (syncErr) {
      console.error('同步Supabase失敗（不影響Sheets已成功更新）：' + syncErr.toString());
    }
    清除班表快取_(payload.shift);

    return respond({ success: true, deleted: true });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ============================
// 回傳 JSON
// ============================
function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
// ============================
// v2.11：班別設定 — 讀取（跨裝置同步）
// ============================
function getShiftSettings_() {
  var ss = SpreadsheetApp.openById(SHIFT_CONFIG.night.targetSsId);  // ← 改這行
  var sh = ss.getSheetByName('班別設定');
  if (!sh || sh.getLastRow() < 2) {
    return respond({ success: true, types: [] });
  }
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  var types = data
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return { code: String(r[0]), label: String(r[1]), time: String(r[2]), hours: Number(r[3]), color: String(r[4]) };
    });
  return respond({ success: true, types: types });
}

// ============================
// v2.11：班別設定 — 儲存（跨裝置同步）
// ============================
function updateShiftSettings_(payload) {
  var ss = SpreadsheetApp.openById(SHIFT_CONFIG.night.targetSsId);  // ← 改這行
  var sh = ss.getSheetByName('班別設定');
  if (!sh) sh = ss.insertSheet('班別設定');
  sh.clearContents();
  sh.appendRow(['代號', '名稱', '時間', '工時', '顏色']);
  var types = payload.types || [];
  for (var i = 0; i < types.length; i++) {
    var t = types[i];
    sh.appendRow([t.code, t.label, t.time || '—', Number(t.hours) || 0, t.color]);
  }
  return respond({ success: true });
}

// ============================
// 2026-08-28新增：員工工號對照——姓名/工號兩欄的獨立分頁，供之後跟帳號
// 系統比對用（第一步只存起來，還沒接自動查帳號的邏輯）。
// ⚠️ 原本規劃直接在A4:AG30這個固定班表格子外面加一欄（AH），才發現AH~AJ
// 已經是既有的表定值/實際值勤時數/已休天數欄位，貿然加欄會撞到既有資料。
// 改成獨立分頁，做法比照「班別設定」——存在SHIFT_CONFIG.night那份試算表，
// 早晚班共用同一份對照表（工號跟人綁定，不分早晚班），不會有撞欄風險，
// 也不用重複維護兩份。
// ============================
var 員工工號分頁名稱_ = '員工工號對照';

function getStaffEmpIds_() {
  var ss = SpreadsheetApp.openById(SHIFT_CONFIG.night.targetSsId);
  var sh = ss.getSheetByName(員工工號分頁名稱_);
  if (!sh || sh.getLastRow() < 2) return respond({ success: true, list: [] });
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  var list = data
    .filter(function (r) { return String(r[0] || '').trim(); })
    .map(function (r) { return { name: String(r[0]).trim(), empId: String(r[1] || '').trim() }; });
  return respond({ success: true, list: list });
}

// 2026-08-28修正：原本沒上鎖，短時間內重新整理/重新開啟頁面觸發好幾次自動比對時，
// 好幾個請求同時「清空→逐列appendRow」互相插隊，寫出一堆重複資料（咖哩實機截圖
// 抓到）。改成上鎖＋整批setValues一次寫入（比一列列appendRow快很多，縮短鎖定時間）。
function updateStaffEmpIds_(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.openById(SHIFT_CONFIG.night.targetSsId);
    var sh = ss.getSheetByName(員工工號分頁名稱_);
    if (!sh) sh = ss.insertSheet(員工工號分頁名稱_);
    sh.clearContents();
    var list = payload.list || [];
    var rows = [['姓名', '工號']];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var nm = String((it && it.name) || '').trim();
      if (!nm) continue;
      // 工號固定6位數字，開頭可能是0（例：015732）；Sheets看到純數字字串會自動轉成
      // 數字格式吃掉開頭的0，加單引號前綴強制存成文字（跟tool_signin.html等處存
      // 工號欄的做法一致）。
      var eid = String((it && it.empId) || '').trim();
      rows.push([nm, eid ? "'" + eid : '']);
    }
    sh.getRange(1, 1, rows.length, 2).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return respond({ success: true });
}

// 2026-08-28新增：只新增/更新單一員工的工號，不動其他人的資料。
// 背景：早班/晚班畫面各自只載入自己那班的員工清單（既有設計），如果修改單一
// 員工時沿用 updateStaffEmpIds_ 的「整批覆寫」寫法，在早班畫面存檔會把晚班
// 員工的工號資料整批洗掉（反之亦然，咖哩實機測試發現）。這份對照表早晚班
// 共用同一份，一定要用「只改這一筆」的寫法，不能整批覆寫。
function upsertStaffEmpId_(payload) {
  var nm = String((payload && payload.name) || '').trim();
  if (!nm) return respond({ success: false, error: '缺少姓名' });
  var eid = String((payload && payload.empId) || '').trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.openById(SHIFT_CONFIG.night.targetSsId);
    var sh = ss.getSheetByName(員工工號分頁名稱_);
    if (!sh) { sh = ss.insertSheet(員工工號分頁名稱_); sh.appendRow(['姓名', '工號']); }
    var lastRow = sh.getLastRow();
    var targetRow = -1;
    if (lastRow >= 2) {
      var names = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (String(names[i][0] || '').trim() === nm) { targetRow = i + 2; break; }
      }
    }
    var val = eid ? "'" + eid : '';
    if (targetRow === -1) sh.appendRow([nm, val]);
    else sh.getRange(targetRow, 2).setValue(val);
  } finally {
    lock.releaseLock();
  }
  return respond({ success: true });
}

// 2026-08-28新增：刪除單一員工的工號那一列，同理不動其他人。
function deleteStaffEmpId_(payload) {
  var nm = String((payload && payload.name) || '').trim();
  if (!nm) return respond({ success: false, error: '缺少姓名' });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.openById(SHIFT_CONFIG.night.targetSsId);
    var sh = ss.getSheetByName(員工工號分頁名稱_);
    if (!sh) return respond({ success: true, deleted: false });
    var lastRow = sh.getLastRow();
    for (var i = lastRow; i >= 2; i--) {
      if (String(sh.getRange(i, 1).getValue() || '').trim() === nm) {
        sh.deleteRow(i);
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
  return respond({ success: true });
}
