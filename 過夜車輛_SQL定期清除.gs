// ═══════════════════════════════════════════════════════
// 天鷹保全 · 過夜車輛統計 SQL遷移【階段7：Sheets定期清除】（2026-11-25 改版 v2）
// ───────────────────────────────────────────────────────
// 用途：Supabase已是「館內機車/館內汽車/新莊停車場」三個登記分頁的
// 權威來源，Sheets角色改成「Supabase查詢失敗時的備援緩衝」，不需要
// 永久保留全部歷史。這支每天清掉Sheets裡超過30天的舊列，只留最近
// 30天，完整歷史仍在Supabase查得到（透過查詢歷史紀錄功能）。
//
// ⚠️ 注意：這支是「刪除列」（deleteRows，下面的列會往上補），不是「清除內容」；
//    執行紀錄裡寫的「清除N列」意思是「刪掉N列」。
//
// v2 改版原因（2026-11-25）：
//   v1 假設「時間欄一路由舊到新、格式整齊」，從最上面往下找第一筆還在保留範圍內的列，
//   遇到看不懂的列（空白列、或「2026/7/2 下午 10:55:54」這種中文上午/下午格式）就整個停下來
//   → 館內汽車、新莊停車場最上面是中文格式，永遠清不動；表中間有空白列時也會卡住。
//   v2 改成「逐列判斷」，不再靠順序：
//     ① 超過保留天數的列 → 刪（看得懂各種日期格式，含中文上午/下午）
//     ② 整列空白的列（A~G全空）→ 刪
//     ③ 時間看不懂、但有內容的列 → 保留（寧可少清也不要清錯）並在紀錄裡列出來
//   刪除前還會跟Supabase核對：試算表裡的舊資料筆數若比資料庫還多（疑似還沒同步進資料庫），
//   今天就不刪舊列（空白列仍會刪），避免刪到資料庫沒有的資料。
//
// ⚠️⚠️ 前置條件：查詢歷史紀錄／每日寄信都已經改讀Supabase且穩定運作（已完成）。
//
// ⚠️ 這支要跟 車牌辨識_後端_GAS.gs、過夜車輛_SQL遷移腳本.gs 貼在同一個
// Apps Script 專案裡（共用 SPREADSHEET_ID / VEHICLE_TYPE_LABELS_SQL_ / supabaseCount_）。
//
// 部署：貼新版覆蓋舊的「過夜車輛_SQL定期清除.gs」→ 先執行 預覽過夜車輛Sheets清除_不刪除()
// 看執行記錄確認各分頁要刪幾列 → 沒問題再等每日觸發（或手動執行一次 每日清除過夜車輛過期Sheets資料）。
// 觸發器沿用原本的（函式名稱沒變）；沒建過的話執行一次 設定過夜車輛Sheets清除觸發器()。
// ═══════════════════════════════════════════════════════

var 過夜車輛SHEETS保留天數_ = 30;
var 過夜車輛清除_欄數_ = 7;   // A時間 B類型 C車牌 D登記人 E停放位置 F(此欄勿動) G車況，判斷「整列空白」用

// ───────────────────────────────────────────────────────
// 純函式（不碰試算表，可在 node 單獨測）
// ───────────────────────────────────────────────────────

/**
 * 把登記時間欄的各種寫法轉成 Date；看不懂回 null。
 * 支援：Date 物件、2026-11-25 5:26:51、2026-11-25T05:26:51、2026/7/2 下午 10:55:54、
 *      2026/7/3 上午 3:05:47、只有日期的 2026-07-08。字串一律以台北時間（+08:00）解讀，
 *      不受腳本時區影響。
 */
function 解析登記時間_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  var m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T\s]\s*(上午|下午|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  var h = m[5] === undefined ? 0 : +m[5], mi = m[6] === undefined ? 0 : +m[6], sec = m[7] === undefined ? 0 : +m[7];
  var ap = m[4];
  if (ap) {
    if (/下午|PM|pm/.test(ap) && h < 12) h += 12;
    if (/上午|AM|am/.test(ap) && h === 12) h = 0;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  var t = Date.UTC(y, mo - 1, d, h - 8, mi, sec);   // 台北 = UTC+8
  return new Date(t);
}

function 整列空白_(row) {
  for (var i = 0; i < row.length; i++) {
    var c = row[i];
    if (c !== '' && c !== null && c !== undefined && String(c).trim() !== '') return false;
  }
  return true;
}

/**
 * 規劃要刪哪些列。rows＝從第2列開始的二維陣列（每列至少 A~G 七欄）。
 * 回傳 { oldRows:[試算表列號], blankRows:[試算表列號], keptUnparsed:[{row,value}], keptRecent:n }
 */
function 規劃清除列_(rows, cutoffMs) {
  var oldRows = [], blankRows = [], keptUnparsed = [], keptRecent = 0;
  for (var i = 0; i < rows.length; i++) {
    var rowNo = i + 2;
    if (整列空白_(rows[i])) { blankRows.push(rowNo); continue; }
    var d = 解析登記時間_(rows[i][0]);
    if (!d) { keptUnparsed.push({ row: rowNo, value: String(rows[i][0]) }); continue; }
    if (d.getTime() < cutoffMs) oldRows.push(rowNo); else keptRecent++;
  }
  return { oldRows: oldRows, blankRows: blankRows, keptUnparsed: keptUnparsed, keptRecent: keptRecent };
}

/** 把升冪的列號合併成連續區段 [{start, count}] */
function 合併連續列_(rowNos) {
  var sorted = rowNos.slice().sort(function (a, b) { return a - b; });
  var blocks = [];
  for (var i = 0; i < sorted.length; i++) {
    var last = blocks.length ? blocks[blocks.length - 1] : null;
    if (last && sorted[i] === last.start + last.count) last.count++;
    else blocks.push({ start: sorted[i], count: 1 });
  }
  return blocks;
}

/**
 * 決定這次實際要刪的列號。
 *  - 空白列永遠可刪
 *  - 舊列：skipOld 為真（例如跟資料庫核對沒過）就不刪
 *  - 至少留一個資料列（試算表不能刪光非凍結列）：全部都要刪時，保留最後一列
 */
function 決定刪除列_(plan, totalRows, skipOld) {
  var del = plan.blankRows.slice();
  if (!skipOld) del = del.concat(plan.oldRows);
  del.sort(function (a, b) { return a - b; });
  if (totalRows > 0 && del.length >= totalRows) del.pop();
  return del;
}

// ───────────────────────────────────────────────────────
// 跟試算表／資料庫互動
// ───────────────────────────────────────────────────────

function 過夜車輛清除界線_() {
  return new Date().getTime() - 過夜車輛SHEETS保留天數_ * 86400000;
}

/** 資料庫裡該類型「早於界線」的筆數；失敗回 -1 */
function 取得資料庫舊資料筆數_(typeLabel, cutoffMs) {
  try {
    var iso = Utilities.formatDate(new Date(cutoffMs), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX");
    return supabaseCount_('/rest/v1/vehicle_overnight_logs?select=id&type_label=eq.' + encodeURIComponent(typeLabel)
      + '&created_at=lt.' + encodeURIComponent(iso));
  } catch (err) {
    console.error('取得資料庫舊資料筆數失敗（' + typeLabel + '）：' + err.toString());
    return -1;
  }
}

/** 試算表舊資料比資料庫多太多＝疑似還沒同步，不刪。容許誤差：2% 或 5 筆（取大的）。 */
function 舊資料核對是否通過_(sheetOldCount, dbOldCount) {
  if (sheetOldCount === 0) return true;     // 沒有舊列要刪，不必核對
  if (dbOldCount < 0) return false;         // 資料庫讀不到：保守不刪舊列
  var tol = Math.max(5, Math.ceil(dbOldCount * 0.02));
  return sheetOldCount <= dbOldCount + tol;
}

/**
 * 處理單一分頁。dryRun＝true 只回報不刪。
 * 回傳 { sheet, deletedOld, deletedBlank, keptUnparsed, keptRecent, skippedOld, note }
 */
function 清除過夜車輛過期Sheets列_(sheetName, dryRun) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { sheet: sheetName, notFound: true, deletedOld: 0, deletedBlank: 0 };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);   // 跟 vehicleReg 同一把鎖，避免清除到一半有人登記
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { sheet: sheetName, deletedOld: 0, deletedBlank: 0, keptUnparsed: [], keptRecent: 0 };

    var cutoffMs = 過夜車輛清除界線_();
    var rows = sheet.getRange(2, 1, lastRow - 1, 過夜車輛清除_欄數_).getValues();
    var plan = 規劃清除列_(rows, cutoffMs);

    var dbOld = plan.oldRows.length ? 取得資料庫舊資料筆數_(sheetName, cutoffMs) : 0;
    var oldOk = 舊資料核對是否通過_(plan.oldRows.length, dbOld);
    var skipOld = !oldOk;
    var del = 決定刪除列_(plan, rows.length, skipOld);

    var res = {
      sheet: sheetName,
      deletedOld: skipOld ? 0 : Math.min(plan.oldRows.length, del.length),
      deletedBlank: plan.blankRows.length,
      keptUnparsed: plan.keptUnparsed, keptRecent: plan.keptRecent,
      skippedOld: skipOld ? plan.oldRows.length : 0,
      dbOld: dbOld
    };
    // 實際刪掉的空白／舊列要以 del 為準（至少留一列時可能少刪一列）
    var delSet = {}; del.forEach(function (r) { delSet[r] = true; });
    res.deletedBlank = plan.blankRows.filter(function (r) { return delSet[r]; }).length;
    res.deletedOld = skipOld ? 0 : plan.oldRows.filter(function (r) { return delSet[r]; }).length;

    if (dryRun || !del.length) return res;

    var blocks = 合併連續列_(del);
    for (var b = blocks.length - 1; b >= 0; b--) {      // 從下面往上刪，列號才不會跑掉
      sheet.deleteRows(blocks[b].start, blocks[b].count);
    }
    return res;
  } finally {
    lock.releaseLock();
  }
}

function 過夜車輛清除結果文字_(r) {
  if (r.notFound) return r.sheet + '：找不到分頁，跳過';
  var s = r.sheet + '：刪除' + (r.deletedOld + r.deletedBlank) + '列（超過' + 過夜車輛SHEETS保留天數_ + '天的舊列' + r.deletedOld + '、空白列' + r.deletedBlank + '）';
  if (r.skippedOld) s += '\n  ⚠️ 有 ' + r.skippedOld + ' 筆舊資料比資料庫（' + r.dbOld + ' 筆）還多或資料庫讀不到，今天不刪舊列，請確認資料有同步進資料庫';
  if (r.keptUnparsed && r.keptUnparsed.length) {
    s += '\n  ⚠️ ' + r.keptUnparsed.length + ' 列時間看不懂、已保留（例如第' + r.keptUnparsed[0].row + '列：「' + r.keptUnparsed[0].value + '」）';
  }
  return s;
}

function 每日清除過夜車輛過期Sheets資料() {
  try {
    var results = VEHICLE_TYPE_LABELS_SQL_.map(function (t) { return 清除過夜車輛過期Sheets列_(t, false); });
    var msg = results.map(過夜車輛清除結果文字_).join('\n');
    console.log('過夜車輛Sheets定期清除完成：\n' + msg);
    return msg;
  } catch (err) {
    console.error('過夜車輛Sheets定期清除失敗：' + err.toString());
  }
}

/** 預覽：只報告各分頁「會刪幾列」，完全不刪。第一次部署新版先跑這個。 */
function 預覽過夜車輛Sheets清除_不刪除() {
  var results = VEHICLE_TYPE_LABELS_SQL_.map(function (t) { return 清除過夜車輛過期Sheets列_(t, true); });
  var msg = '【預覽，沒有刪除任何資料】\n' + results.map(過夜車輛清除結果文字_).join('\n');
  Logger.log(msg);
  return msg;
}

function 設定過夜車輛Sheets清除觸發器() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === '每日清除過夜車輛過期Sheets資料') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('每日清除過夜車輛過期Sheets資料')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
  Logger.log('已建立每日清除觸發器（每日凌晨4:00~5:00執行一次，接在每日備份3點之後）');
}

// 讓 node 能單獨測純函式（GAS 環境沒有 module，用防禦寫法）
try {
  module.exports = {
    解析登記時間_: 解析登記時間_, 整列空白_: 整列空白_, 規劃清除列_: 規劃清除列_, 合併連續列_: 合併連續列_,
    決定刪除列_: 決定刪除列_, 舊資料核對是否通過_: 舊資料核對是否通過_, 清除過夜車輛過期Sheets列_: 清除過夜車輛過期Sheets列_,
    每日清除過夜車輛過期Sheets資料: 每日清除過夜車輛過期Sheets資料, 預覽過夜車輛Sheets清除_不刪除: 預覽過夜車輛Sheets清除_不刪除
  };
} catch (e) { /* GAS 環境：忽略 */ }
