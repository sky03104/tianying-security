// ════════════════════════════════════════════════════════════
// 天鷹保全 · 過夜車輛統計 SQL遷移【查詢/寄信 讀取層】
// ────────────────────────────────────────────────────────────
// 用途：
//  ①「查詢歷史紀錄」(searchVehicleLogs) 改讀 Supabase，失敗自動退回讀 Sheets
//  ②「每日寄信」(sendDailySummary) 改讀 Supabase，失敗自動退回讀 Sheets
//
// 這支工具跟施工單/打烊開店/物流不同，Sheets不會完全停用——見
// docs/SQL遷移規劃_過夜車輛統計.md 第三節，寄信是稽核用途不能寄不出去，
// 所以這裡的「備援退回讀Sheets」是永久保留的設計，不是遷移過渡期才有的東西。
//
// ⚠️ 這支要跟 車牌辨識_後端_GAS.gs、過夜車輛_SQL遷移腳本.gs 貼在同一個
// Apps Script 專案裡，共用 supabaseConfig_/supabaseRequest_ 等連線函式。
// ════════════════════════════════════════════════════════════

// Supabase單次GET預設上限1000筆，分頁抓到抓不滿一頁為止
// （寄信這裡一次只查24小時份量通常不會撞到，但沿用其他工具的教訓還是加上防呆）
function supabaseRequestAll_(path) {
  var cfg = supabaseConfig_();
  var headers = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key };
  var all = [];
  var offset = 0;
  var PAGE = 1000;
  while (true) {
    var pageHeaders = {};
    for (var k in headers) pageHeaders[k] = headers[k];
    pageHeaders.Range = offset + '-' + (offset + PAGE - 1);
    var resp = UrlFetchApp.fetch(cfg.url + path, { method: 'get', headers: pageHeaders, muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code >= 400) throw new Error('Supabase請求失敗（' + code + '）：' + resp.getContentText() + '｜path=' + path);
    var chunk = JSON.parse(resp.getContentText() || '[]');
    all = all.concat(chunk);
    if (chunk.length < PAGE) break; // 這頁沒填滿，代表已經是最後一頁
    offset += PAGE;
  }
  return all;
}

function fmtISO_過夜車輛_(d) {
  return Utilities.formatDate(d, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// --- ① 查詢歷史紀錄：改讀 Supabase ---
function searchVehicleLogs_SQL(payload) {
  var mode = payload.mode;
  var typeLabel = String(payload.typeLabel || '').trim();
  var dateStr = String(payload.date || '').trim();
  var keyword = String(payload.keyword || '').trim();

  var qs = [];
  if (typeLabel) qs.push('type_label=eq.' + encodeURIComponent(typeLabel));

  if (mode === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { success: false, error: '請選擇有效日期' };
    var p = dateStr.split('-');
    var start = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 0, 0, 0);
    var end = new Date(start.getTime() + 86400000);
    qs.push('created_at=gte.' + encodeURIComponent(fmtISO_過夜車輛_(start)));
    qs.push('created_at=lt.' + encodeURIComponent(fmtISO_過夜車輛_(end)));
  } else if (mode === 'plate') {
    if (!keyword) return { success: false, error: '請輸入車牌關鍵字' };
    qs.push('plate=ilike.' + encodeURIComponent('*' + keyword.toUpperCase() + '*'));
  } else {
    return { success: false, error: '未知查詢模式' };
  }
  qs.push('order=created_at.desc');
  qs.push('limit=' + (VEHICLE_SEARCH_MAX_ROWS_ + 1)); // 多抓一筆才能判斷是否truncated

  var cfg = supabaseConfig_();
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/vehicle_overnight_logs?' + qs.join('&'), {
    method: 'get',
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code >= 400) throw new Error('Supabase請求失敗（' + code + '）：' + resp.getContentText());
  var supaRows = JSON.parse(resp.getContentText() || '[]');

  var truncated = supaRows.length > VEHICLE_SEARCH_MAX_ROWS_;
  if (truncated) supaRows = supaRows.slice(0, VEHICLE_SEARCH_MAX_ROWS_);

  var rows = supaRows.map(function (r) {
    return {
      id: r.id, // 2026-08-28新增：供前端「刪除這筆」按鈕精準定位用
      time: Utilities.formatDate(new Date(r.created_at), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
      type: r.type_label,
      plate: r.plate,
      operator: r.operator,
      parkLocation: r.park_location || '' // 2026-09-19新增：Supabase欄位未建立時r.park_location為undefined，統一補空字串
    };
  });
  return { success: true, rows: rows, truncated: truncated };
}

// 查詢歷史紀錄：優先Supabase，失敗自動退回原本讀Sheets的 searchVehicleLogs_
function searchVehicleLogs_含備援(payload) {
  try {
    return searchVehicleLogs_SQL(payload);
  } catch (err) {
    console.error('searchVehicleLogs 查Supabase失敗，退回讀Sheets：' + err.toString());
    return searchVehicleLogs_(payload);
  }
}

// --- ② 每日寄信：改讀 Supabase ---
// 回傳格式跟 車牌辨識_後端_GAS.gs 的 取得過夜車輛統計資料_Sheets_ 一致：{hits, byType}
function 取得過夜車輛統計資料_SQL_(startISO, endISO) {
  var path = '/rest/v1/vehicle_overnight_logs'
    + '?created_at=gte.' + encodeURIComponent(startISO)
    + '&created_at=lt.' + encodeURIComponent(endISO)
    + '&order=created_at.asc';
  var supaRows = supabaseRequestAll_(path);

  var hits = [];
  var byType = {};
  supaRows.forEach(function (r) {
    var key = Utilities.formatDate(new Date(r.created_at), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
    hits.push([key, r.type_label, r.plate, r.operator]);
    byType[r.type_label] = (byType[r.type_label] || 0) + 1;
  });
  return { hits: hits, byType: byType };
}

// ============================
// 比對／效能測試工具
// ============================
function 比對searchVehicleLogs(mode, dateOrKeyword, typeLabel) {
  mode = mode || 'date';
  var payload = { mode: mode, typeLabel: typeLabel || '' };
  if (mode === 'date') payload.date = dateOrKeyword || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  else payload.keyword = dateOrKeyword || '';

  var oldResult = searchVehicleLogs_(payload);
  var newResult = searchVehicleLogs_SQL(payload);

  function keyOf(r) { return [r.time, r.type, r.plate, r.operator, r.parkLocation || ''].join('§'); }
  function toSet(arr) { var s = {}; (arr || []).forEach(function (r) { s[keyOf(r)] = true; }); return s; }
  var oldSet = toSet(oldResult.rows), newSet = toSet(newResult.rows);
  var onlyOld = Object.keys(oldSet).filter(function (k) { return !newSet[k]; });
  var onlyNew = Object.keys(newSet).filter(function (k) { return !oldSet[k]; });

  var msg;
  if (onlyOld.length === 0 && onlyNew.length === 0) {
    msg = '完全一致 ✅（共 ' + (oldResult.rows || []).length + ' 筆）';
  } else {
    var diffs = [];
    if (onlyOld.length > 0) diffs.push('舊有新無 ' + onlyOld.length + ' 筆 → ' + onlyOld.join(' | '));
    if (onlyNew.length > 0) diffs.push('新有舊無 ' + onlyNew.length + ' 筆 → ' + onlyNew.join(' | '));
    msg = '發現差異 ❌\n' + diffs.join('\n');
  }
  Logger.log(msg);
  return msg;
}

function 測試searchVehicleLogs效能(mode, dateOrKeyword) {
  mode = mode || 'date';
  var payload = { mode: mode };
  if (mode === 'date') payload.date = dateOrKeyword || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  else payload.keyword = dateOrKeyword || '';

  var t1 = new Date().getTime();
  searchVehicleLogs_(payload);
  var t2 = new Date().getTime();
  searchVehicleLogs_SQL(payload);
  var t3 = new Date().getTime();
  var msg = '讀Sheets耗時 ' + (t2 - t1) + 'ms　讀Supabase耗時 ' + (t3 - t2) + 'ms';
  Logger.log(msg);
  return msg;
}

// 比對每日寄信的統計資料（不會真的寄信，純比對Sheets版/Supabase版算出來的hits是否一致）
function 比對每日寄信統計資料() {
  var tz = 'Asia/Taipei';
  var now = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var yesterdayStr = Utilities.formatDate(new Date(now.getTime() - 86400000), tz, 'yyyy-MM-dd');
  var startKey = yesterdayStr + ' 08:00:00';
  var endKey = todayStr + ' 08:00:00';

  var oldStat = 取得過夜車輛統計資料_Sheets_(startKey, endKey);
  var startISO = Utilities.formatDate(toDate_(startKey), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  var endISO = Utilities.formatDate(toDate_(endKey), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  var newStat = 取得過夜車輛統計資料_SQL_(startISO, endISO);

  function keyOf(h) { return h.join('§'); }
  function toSet(arr) { var s = {}; arr.forEach(function (h) { s[keyOf(h)] = true; }); return s; }
  var oldSet = toSet(oldStat.hits), newSet = toSet(newStat.hits);
  var onlyOld = Object.keys(oldSet).filter(function (k) { return !newSet[k]; });
  var onlyNew = Object.keys(newSet).filter(function (k) { return !oldSet[k]; });

  var msg;
  if (onlyOld.length === 0 && onlyNew.length === 0) {
    msg = '完全一致 ✅（共 ' + oldStat.hits.length + ' 筆）';
  } else {
    var diffs = [];
    if (onlyOld.length > 0) diffs.push('舊有新無 ' + onlyOld.length + ' 筆 → ' + onlyOld.join(' | '));
    if (onlyNew.length > 0) diffs.push('新有舊無 ' + onlyNew.length + ' 筆 → ' + onlyNew.join(' | '));
    msg = '發現差異 ❌\n' + diffs.join('\n');
  }
  Logger.log(msg);
  return msg;
}
