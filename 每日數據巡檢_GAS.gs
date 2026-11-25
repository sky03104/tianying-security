// ═══════════════════════════════════════════════════════════════
// 天鷹保全 · 每日數據巡檢（TODO-48）
// ───────────────────────────────────────────────────────────────
// 用途：主管每天要檢查「開店前／打烊後有沒有登記、施工單有沒有上傳、
//       物流車輛有沒有填、過夜車輛有沒有登記」。這支 GAS 在固定時間
//       自動檢查，有異常就寄 Email ＋ 寫站內通知給隊長／副隊長／組長。
//
// 設計原則：
//   1. 只讀 Supabase，不寫任何業務資料。
//   2. 全部用「規則」判斷，不用 AI（AI 不適合當資料庫，見技術經驗筆記 2026-06-29）。
//   3. 偏多報：0 筆一定報（紅）；明顯低於近14天平均也報（橘）。
//   4. 讀不到資料＝「巡檢失敗」，一律當異常通知，絕不當成「正常」。
//   5. 每天 22:00 另寄一封「今日巡檢總結」，沒收到總結＝巡檢本身壞了。
//
// 檢查時間點（台北時間）：
//   06:00  打烊後（昨20:00~今06:00）、過夜車輛（同窗）
//   08:00  物流車輛·晚班（昨20:00~今08:00）
//   11:00  開店前（今06:00~11:00）
//   20:00  物流車輛·早班（今08:00~20:00）
//   22:00  施工單（明天有沒有施工單、最近有沒有上傳）＋今日總結
//
// 另有「數據巡檢」工具（tool_patrol.html，主選單 id27）：看今日結果、立即檢查、近30天紀錄、調門檻。
// 本檔同時是它的後端（網頁應用程式 doGet／doPost，每個 action 驗通行證＋角色）。
//
// 指令碼屬性（專案設定 → 指令碼屬性）：
//   SUPABASE_URL / SUPABASE_SECRET_KEY  同其他 GAS（只讀）
//   PATROL_EMAILS   收件人，多人用逗號分隔
//   MAIN_GAS_URL    主 App GAS 的 /exec 網址（寫站內通知用，可不設＝不發站內通知）
//   PATROL_SECRET   與主 App GAS 設同一個值（隨機長字串）
//   SESSION_SECRET  與主 App 同一個值（工具驗登入用；沒設會退回問主 App，較慢）
//   PATROL_CONFIG   （自動產生）工具裡「設定」分頁存的門檻，不用手動設
// ═══════════════════════════════════════════════════════════════

var PATROL_TZ = 'Asia/Taipei';
var PATROL_BASELINE_DAYS = 14;   // 近幾天當比較基準
var PATROL_LOW_RATIO = 0.5;      // （預設）低於基準平均的幾成算「偏少」（橘）；實際值見 patrolGetConfig_
var PATROL_HISTORY_DAYS = 31;    // 巡檢結果保留天數（工具「紀錄」分頁看近 30 天）
var PATROL_CONSTRUCTION_STALE_HOURS = 72; // 施工單超過幾小時沒新上傳算「太久」（實測最長連續 3 天沒上傳屬正常）
var PATROL_MIN_BASELINE = 3;     // 基準平均至少幾筆才啟用「偏少」判斷（量太小不準）

// ───────────────────────────────────────────────────────────────
// 一、時間工具（全部用台北日曆字串運算，不依賴腳本時區）
// ───────────────────────────────────────────────────────────────

/** 'yyyy-MM-dd' 加減天數（純日曆運算，台北無日光節約，安全） */
function patrolAddDays_(dateStr, n) {
  var p = dateStr.split('-');
  var t = Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)) + n * 86400000;
  var d = new Date(t);
  var m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/** 台北日期字串 + 'HH:mm' → 毫秒（以 +08:00 解讀） */
function patrolToMs_(dateStr, hhmm) {
  return new Date(dateStr + 'T' + hhmm + ':00+08:00').getTime();
}

/** 毫秒 → 台北 ISO 字串（給 Supabase 查詢） */
function patrolMsToISO_(ms) {
  return Utilities.formatDate(new Date(ms), PATROL_TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function patrolTodayStr_() {
  return Utilities.formatDate(new Date(), PATROL_TZ, 'yyyy-MM-dd');
}

// ───────────────────────────────────────────────────────────────
// 二、檢查項目定義
//   windowFor(D) 回傳 [起毫秒, 迄毫秒)，D＝執行當天的台北日期
//   select       要向 Supabase 取的欄位
//   extra(rows)  額外品質檢查（rows＝窗內資料），回傳 [{level, msg}]
// ───────────────────────────────────────────────────────────────
var PATROL_CHECKS = {
  closing: {
    label: '打烊後登記', deadline: '06:00', table: 'closing_gate_logs',
    select: 'created_at,exit_time,inspector',
    windowFor: function (D) { return [patrolToMs_(patrolAddDays_(D, -1), '20:00'), patrolToMs_(D, '06:00')]; },
    extra: function (rows) {
      var noExit = 0, noIns = 0;
      rows.forEach(function (r) {
        if (!r.exit_time) noExit++;
        if (!r.inspector) noIns++;
      });
      var out = [];
      if (noExit > 0) out.push({ level: 'ORANGE', msg: noExit + ' 筆「有進場、沒有出場時間」' });
      if (noIns > 0) out.push({ level: 'ORANGE', msg: noIns + ' 筆「檢查人」空白' });
      return out;
    }
  },
  overnight: {
    label: '過夜車輛登記', deadline: '06:00', table: 'vehicle_overnight_logs',
    select: 'created_at',
    windowFor: function (D) { return [patrolToMs_(patrolAddDays_(D, -1), '20:00'), patrolToMs_(D, '06:00')]; }
  },
  logiNight: {
    label: '物流車輛（晚班）', deadline: '08:00', table: 'logistics_records',
    select: 'created_at,category',
    zeroMinBaseline: 1, // 實測近30天晚班只有 4 天有登記：近14天平均 <1 筆時，0 筆視為平常、不報警
    windowFor: function (D) { return [patrolToMs_(patrolAddDays_(D, -1), '20:00'), patrolToMs_(D, '08:00')]; }
  },
  opening: {
    label: '開店前登記', deadline: '11:00', table: 'opening_gate_logs',
    select: 'created_at',
    windowFor: function (D) { return [patrolToMs_(D, '06:00'), patrolToMs_(D, '11:00')]; }
  },
  logiDay: {
    label: '物流車輛（早班）', deadline: '20:00', table: 'logistics_records',
    select: 'created_at,category',
    windowFor: function (D) { return [patrolToMs_(D, '08:00'), patrolToMs_(D, '20:00')]; }
  },
  // 施工單不走「窗內筆數」判斷（實測近30天約4成的日子當天沒上傳、是整批上傳），
  // 改看「明天有沒有施工單」＋「最近一次上傳是不是太久以前」，見 patrolRunConstruction_
  construction: {
    label: '施工單更新', deadline: '22:00', table: 'construction_orders', custom: true
  }
};

Object.keys(PATROL_CHECKS).forEach(function (k) { PATROL_CHECKS[k].key = k; });

// 工具顯示用：預計檢查時間（觸發器時間，實際會在其後約 15 分鐘內執行）
var PATROL_RUN_AT = { closing: '06:00', overnight: '06:00', logiNight: '08:00', opening: '11:00', logiDay: '20:00', construction: '22:00' };
var PATROL_ORDER = ['closing', 'overnight', 'logiNight', 'opening', 'logiDay', 'construction'];

// ───────────────────────────────────────────────────────────────
// 二之一、門檻設定（工具「設定」分頁可改；存在指令碼屬性 PATROL_CONFIG）
//   偏少比例依真實資料訂：打烊/開店 0.5、過夜車輛 0.25（每晚 2~159 台起伏大）、
//   物流早/晚班 0.15（每天 5~119 筆起伏大）
// ───────────────────────────────────────────────────────────────
var PATROL_DEFAULT_CFG = {
  lowRatio: { closing: 0.5, overnight: 0.25, logiNight: 0.15, opening: 0.5, logiDay: 0.15, construction: 0.5 },
  minBaseline: PATROL_MIN_BASELINE,
  staleHours: PATROL_CONSTRUCTION_STALE_HOURS,
  enabled: { closing: true, overnight: true, logiNight: true, opening: true, logiDay: true, construction: true }
};

/** 把輸入整理成合法設定：非法值退回預設、數字夾在合理範圍（前端驗證只是方便，後端才是真的） */
function patrolSanitizeConfig_(c) {
  c = c || {};
  var out = { lowRatio: {}, enabled: {} };
  PATROL_ORDER.forEach(function (k) {
    var v = c.lowRatio ? Number(c.lowRatio[k]) : NaN;
    out.lowRatio[k] = (isFinite(v) && v >= 0.05 && v <= 0.95) ? Math.round(v * 100) / 100 : PATROL_DEFAULT_CFG.lowRatio[k];
    var e = c.enabled ? c.enabled[k] : undefined;
    out.enabled[k] = (e === undefined || e === null) ? PATROL_DEFAULT_CFG.enabled[k] : (e === true || e === 'true');
  });
  var mb = Number(c.minBaseline);
  out.minBaseline = (isFinite(mb) && mb >= 1 && mb <= 50) ? Math.round(mb) : PATROL_DEFAULT_CFG.minBaseline;
  var sh = Number(c.staleHours);
  out.staleHours = (isFinite(sh) && sh >= 12 && sh <= 336) ? Math.round(sh) : PATROL_DEFAULT_CFG.staleHours;
  return out;
}

function patrolGetConfig_() {
  var raw = null;
  try { raw = JSON.parse(PropertiesService.getScriptProperties().getProperty('PATROL_CONFIG') || 'null'); } catch (e) { raw = null; }
  return patrolSanitizeConfig_(raw);
}

// ───────────────────────────────────────────────────────────────
// 三、純函式：判斷邏輯（可在 node 單獨測）
// ───────────────────────────────────────────────────────────────

/** 算「近 N 天同一窗口」的每日筆數，回傳 {avg, days:[...]} */
function patrolBaseline_(check, D, tsList) {
  var counts = [];
  for (var k = 1; k <= PATROL_BASELINE_DAYS; k++) {
    var w = check.windowFor(patrolAddDays_(D, -k));
    var c = 0;
    for (var i = 0; i < tsList.length; i++) {
      if (tsList[i] >= w[0] && tsList[i] < w[1]) c++;
    }
    counts.push(c);
  }
  var sum = 0;
  counts.forEach(function (c) { sum += c; });
  return { avg: counts.length ? sum / counts.length : 0, days: counts };
}

/**
 * 判斷一個檢查項目當天的結果
 * rows：已取回的資料列（需含 created_at，且涵蓋 D 前 14 天到窗尾）
 * 回傳：{status:'GREEN'|'ORANGE'|'RED', count, avg, lines:[文字]}
 */
function patrolEvaluate_(check, D, rows) {
  var w = check.windowFor(D);
  var tsList = rows.map(function (r) { return new Date(r.created_at).getTime(); });
  var inWin = rows.filter(function (r, i) { return tsList[i] >= w[0] && tsList[i] < w[1]; });
  var count = inWin.length;
  var base = patrolBaseline_(check, D, tsList);
  var avgTxt = base.avg.toFixed(1);
  var status = 'GREEN';
  var lines = [];

  var cfg = patrolGetConfig_();
  var lowRatio = cfg.lowRatio[check.key] || PATROL_LOW_RATIO;
  if (count === 0 && base.avg < (check.zeroMinBaseline || 0)) {
    lines.push('0 筆（這個時段平常就很少登記，近 ' + PATROL_BASELINE_DAYS + ' 天平均 ' + avgTxt + ' 筆，不算異常）');
  } else if (count === 0) {
    status = 'RED';
    lines.push('截止 ' + check.deadline + ' 前「0 筆」登記（近 ' + PATROL_BASELINE_DAYS + ' 天平均 ' + avgTxt + ' 筆）');
  } else if (base.avg >= cfg.minBaseline && count < base.avg * lowRatio) {
    status = 'ORANGE';
    lines.push('只有 ' + count + ' 筆，明顯低於近 ' + PATROL_BASELINE_DAYS + ' 天平均 ' + avgTxt + ' 筆');
  } else {
    lines.push(count + ' 筆（近 ' + PATROL_BASELINE_DAYS + ' 天平均 ' + avgTxt + ' 筆）');
  }

  if (check.extra && count > 0) {
    check.extra(inWin).forEach(function (x) {
      lines.push(x.msg);
      if (x.level === 'ORANGE' && status === 'GREEN') status = 'ORANGE';
    });
  }
  return { status: status, count: count, avg: base.avg, lines: lines };
}

/**
 * 施工單判斷（純函式）
 * p：{ tomorrowStr, tomorrowEq（明天開工的筆數）, tomorrowCover（明天有效的筆數，含跨日施工）,
 *      sameWeekdayEq（近幾週同星期的開工筆數陣列）, lastUploadMs（最近一次上傳時間，null＝完全沒有）,
 *      nowMs, todayUploaded（今天上傳筆數）, lastUploadText }
 */
function patrolEvaluateConstruction_(p) {
  var status = 'GREEN', lines = [];
  var cfg = patrolGetConfig_();
  var sum = 0;
  p.sameWeekdayEq.forEach(function (c) { sum += c; });
  var avg = p.sameWeekdayEq.length ? sum / p.sameWeekdayEq.length : 0;

  if (p.tomorrowCover === 0) {
    status = 'RED';
    lines.push(p.tomorrowStr + '（明天）截止 22:00 前「0 筆」施工單');
  } else if (avg >= cfg.minBaseline && p.tomorrowEq < avg * cfg.lowRatio.construction) {
    status = 'ORANGE';
    lines.push(p.tomorrowStr + '（明天）施工單只有 ' + p.tomorrowEq + ' 筆，明顯低於近 ' + p.sameWeekdayEq.length + ' 週同星期平均 ' + avg.toFixed(1) + ' 筆');
  } else {
    lines.push(p.tomorrowStr + '（明天）施工單 ' + p.tomorrowEq + ' 筆（近 ' + p.sameWeekdayEq.length + ' 週同星期平均 ' + avg.toFixed(1) + ' 筆）');
  }

  if (p.lastUploadMs === null || p.lastUploadMs === undefined) {
    status = 'RED';
    lines.push('找不到任何上傳紀錄');
  } else {
    var ageH = (p.nowMs - p.lastUploadMs) / 3600000;
    if (ageH > cfg.staleHours) {
      if (status === 'GREEN') status = 'ORANGE';
      lines.push('最近一次上傳是 ' + p.lastUploadText + '，已超過 ' + Math.floor(ageH / 24) + ' 天沒有新上傳');
    } else {
      lines.push('最近一次上傳：' + p.lastUploadText + '（今天上傳 ' + p.todayUploaded + ' 筆）');
    }
  }
  return { status: status, count: p.tomorrowEq, avg: avg, lines: lines };
}

// ───────────────────────────────────────────────────────────────
// 四、Supabase 讀取（只讀、分頁）
// ───────────────────────────────────────────────────────────────

function patrolSupabaseCfg_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new Error('請先設定指令碼屬性 SUPABASE_URL 與 SUPABASE_SECRET_KEY');
  return { url: url.replace(/\/+$/, ''), key: key };
}

/** GET + Range 分頁抓全部（Supabase 單次上限 1000 筆，踩過的坑） */
function patrolFetchAll_(path) {
  var cfg = patrolSupabaseCfg_();
  var all = [], offset = 0, PAGE = 1000;
  while (true) {
    var resp = UrlFetchApp.fetch(cfg.url + path, {
      method: 'get',
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, Range: offset + '-' + (offset + PAGE - 1) },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code >= 400) throw new Error('Supabase 請求失敗（' + code + '）：' + resp.getContentText() + '｜' + path);
    var chunk = JSON.parse(resp.getContentText() || '[]');
    all = all.concat(chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

/** 取某檢查項目「D 前 14 天 ～ 窗尾」的資料 */
function patrolFetchRows_(check, D) {
  var from = check.windowFor(patrolAddDays_(D, -PATROL_BASELINE_DAYS))[0];
  var to = check.windowFor(D)[1];
  var path = '/rest/v1/' + check.table
    + '?select=' + check.select
    + '&created_at=gte.' + encodeURIComponent(patrolMsToISO_(from))
    + '&created_at=lt.' + encodeURIComponent(patrolMsToISO_(to))
    + '&order=created_at.asc';
  return patrolFetchAll_(path);
}

/** 施工單巡檢：抓資料並套用 patrolEvaluateConstruction_ */
function patrolRunConstruction_(D) {
  var tmr = patrolAddDays_(D, 1);
  var weeks = 4;
  var oldest = patrolAddDays_(tmr, -7 * weeks);
  var rows = patrolFetchAll_('/rest/v1/construction_orders?select=work_date&work_date=gte.' + oldest + '&work_date=lte.' + tmr);
  var perDay = {};
  rows.forEach(function (r) { perDay[r.work_date] = (perDay[r.work_date] || 0) + 1; });
  var sameWeekday = [];
  for (var w = 1; w <= weeks; w++) sameWeekday.push(perDay[patrolAddDays_(tmr, -7 * w)] || 0);
  var last = patrolFetchAll_('/rest/v1/construction_orders?select=created_at&order=created_at.desc&limit=1');
  var todayStartISO = patrolMsToISO_(patrolToMs_(D, '00:00'));
  var todayRows = patrolFetchAll_('/rest/v1/construction_orders?select=created_at&created_at=gte.' + encodeURIComponent(todayStartISO));
  var lastMs = last.length ? new Date(last[0].created_at).getTime() : null;
  return patrolEvaluateConstruction_({
    tomorrowStr: tmr,
    tomorrowEq: perDay[tmr] || 0,
    tomorrowCover: patrolCountTomorrowOrders_(tmr),
    sameWeekdayEq: sameWeekday,
    lastUploadMs: lastMs,
    nowMs: Date.now(),
    todayUploaded: todayRows.length,
    lastUploadText: lastMs === null ? '' : Utilities.formatDate(new Date(lastMs), PATROL_TZ, 'yyyy-MM-dd HH:mm')
  });
}

/** 明天（含跨日施工）有幾筆施工單 */
function patrolCountTomorrowOrders_(tomorrowStr) {
  var path = '/rest/v1/construction_orders?select=work_date'
    + '&or=' + encodeURIComponent('(work_date.eq.' + tomorrowStr + ',and(work_date.lte.' + tomorrowStr + ',exit_date.gte.' + tomorrowStr + '))');
  return patrolFetchAll_(path).length;
}

// ───────────────────────────────────────────────────────────────
// 五、執行單一檢查（含失敗處理）
// ───────────────────────────────────────────────────────────────

/** 執行一項檢查，永遠回傳結果物件；讀取失敗回 RED「巡檢失敗」 */
function patrolRunOne_(key, D) {
  var check = PATROL_CHECKS[key];
  var res;
  try {
    if (check.custom) {
      res = patrolRunConstruction_(D);
    } else {
      res = patrolEvaluate_(check, D, patrolFetchRows_(check, D));
    }
  } catch (err) {
    res = { status: 'RED', count: -1, avg: 0, failed: true,
      lines: ['⚠️ 巡檢失敗，無法確認資料是否登記：' + err.message] };
  }
  res.key = key;
  res.label = check.label;
  res.deadline = check.deadline;
  res.at = Utilities.formatDate(new Date(), PATROL_TZ, 'HH:mm');
  return res;
}

// ───────────────────────────────────────────────────────────────
// 六、結果暫存（供 22:00 總結用；舊資料自動清）
// ───────────────────────────────────────────────────────────────

function patrolSaveResults_(D, results) {
  var props = PropertiesService.getScriptProperties();
  var k = 'RESULT_' + D;
  var cur = {};
  try { cur = JSON.parse(props.getProperty(k) || '{}'); } catch (e) { cur = {}; }
  results.forEach(function (r) { cur[r.key] = r; });
  props.setProperty(k, JSON.stringify(cur));
  // 清掉超過保留天數的舊紀錄
  var all = props.getProperties();
  Object.keys(all).forEach(function (name) {
    if (name.indexOf('RESULT_') === 0 && name.slice(7) < patrolAddDays_(D, -PATROL_HISTORY_DAYS)) props.deleteProperty(name);
  });
}

function patrolLoadResults_(D) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('RESULT_' + D) || '{}'); }
  catch (e) { return {}; }
}

// ───────────────────────────────────────────────────────────────
// 七、通知（Email ＋ 站內）
// ───────────────────────────────────────────────────────────────
var PATROL_ICON = { GREEN: '🟢', ORANGE: '🟠', RED: '🔴', OFF: '⚪' };
var PATROL_COLOR = { GREEN: '#16A34A', ORANGE: '#EA580C', RED: '#DC2626', OFF: '#9CA3AF' };

function patrolEmails_() {
  return PropertiesService.getScriptProperties().getProperty('PATROL_EMAILS') || '';
}

function patrolEscape_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function patrolResultsHtml_(results) {
  var h = '';
  results.forEach(function (r) {
    h += '<div style="margin:0 0 12px;padding:10px 14px;border-left:4px solid ' + PATROL_COLOR[r.status] + ';background:#F8F8F8;">'
      + '<div style="font-size:15px;font-weight:bold;">' + PATROL_ICON[r.status] + ' ' + patrolEscape_(r.label)
      + '<span style="font-weight:normal;color:#888;font-size:12px;">　（截止 ' + r.deadline + '）</span></div>';
    r.lines.forEach(function (l) { h += '<div style="font-size:13px;color:#333;margin-top:3px;">' + patrolEscape_(l) + '</div>'; });
    h += '</div>';
  });
  return h;
}

/** 寄 Email；沒設收件人要明講，不能靜默 */
function patrolSendMail_(subject, bodyHtml) {
  var to = patrolEmails_();
  if (!to) throw new Error('收件人未設定：請在指令碼屬性新增 PATROL_EMAILS');
  MailApp.sendEmail({
    to: to, subject: subject, name: '天鷹保全 數據巡檢',
    htmlBody: '<div style="font-family:Microsoft JhengHei,Noto Sans TC,sans-serif;max-width:560px;">' + bodyHtml
      + '<div style="margin-top:16px;font-size:11px;color:#999;">此信由「每日數據巡檢」自動寄出，只讀資料、不會修改任何登記內容。</div></div>'
  });
}

/** 最近一次發站內通知的結果（給工具「寄測試通知」顯示原因用；不是業務資料） */
var patrolLastNoticeErr_ = '';
var patrolLastNoticeCount_ = -1;

/** 寫站內通知（隊長／副隊長／組長）；失敗只記 log，不影響 Email。失敗原因記在 patrolLastNoticeErr_ */
function patrolPostNotice_(title, body) {
  patrolLastNoticeErr_ = ''; patrolLastNoticeCount_ = -1;
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('MAIN_GAS_URL');
  var secret = props.getProperty('PATROL_SECRET');
  if (!url || !secret) {
    patrolLastNoticeErr_ = '巡檢 GAS 的指令碼屬性還沒設 ' + (!url ? 'MAIN_GAS_URL' : 'PATROL_SECRET');
    console.log('未設定 MAIN_GAS_URL／PATROL_SECRET，略過站內通知'); return false;
  }
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: { action: 'addPatrolNotices', data: JSON.stringify({ secret: secret, title: title, body: body }) },
      muteHttpExceptions: true
    });
    var text = resp.getContentText() || '';
    var j = null;
    try { j = JSON.parse(text); } catch (e) { j = null; }
    if (!j) {
      patrolLastNoticeErr_ = '主 App 回應不是預期格式（HTTP ' + resp.getResponseCode() + '）：MAIN_GAS_URL 可能不對，或主 App GAS 的存取權限不是「任何人」';
      console.error('站內通知失敗（非 JSON 回應）：' + text.slice(0, 200)); return false;
    }
    if (j.status === 'ok') { patrolLastNoticeCount_ = Number(j.count); return true; }
    if (j.code === 'FORBIDDEN') patrolLastNoticeErr_ = '主 App 拒絕：兩邊的 PATROL_SECRET 不一致，或主 App 沒設 PATROL_SECRET';
    else if (/未知 action/.test(j.msg || '')) patrolLastNoticeErr_ = '主 App GAS 還沒部署新版本（不認得 addPatrolNotices 這個動作）';
    else patrolLastNoticeErr_ = '主 App 回報：' + String(j.msg || text).slice(0, 80);
    console.error('站內通知失敗：' + text.slice(0, 200));
    return false;
  } catch (err) {
    patrolLastNoticeErr_ = '連不到主 App：' + err.message;
    console.error('站內通知失敗：' + err.toString());
    return false;
  }
}

/** 有異常（紅／橘）就即時通知；全綠不打擾（22:00 總結另寄） */
function patrolNotifyIssues_(D, results) {
  var bad = results.filter(function (r) { return r.status !== 'GREEN'; });
  if (!bad.length) return;
  var hasRed = bad.some(function (r) { return r.status === 'RED'; });
  var names = bad.map(function (r) { return r.label; }).join('、');
  var subject = '【天鷹保全巡檢】' + (hasRed ? '🔴 異常' : '🟠 注意') + ' ' + D + '｜' + names;
  var mailErr = '';
  try { patrolSendMail_(subject, patrolResultsHtml_(bad)); } catch (e) { mailErr = e.message; console.error('巡檢寄信失敗：' + mailErr); }
  var lines = [];
  bad.forEach(function (r) { lines.push((r.status === 'RED' ? '🔴 ' : '🟠 ') + r.label + '：' + r.lines.join('；')); });
  patrolPostNotice_((hasRed ? '🔴 數據巡檢異常：' : '🟠 數據巡檢注意：') + names, lines.join('\n'));
  if (mailErr) throw new Error('巡檢寄信失敗：' + mailErr);
}

/** 22:00 每日總結：所有時間點的結果＋沒跑到的標「未執行」 */
function patrolSendDailySummary_(D) {
  var saved = patrolLoadResults_(D);
  var order = PATROL_ORDER;
  var cfg = patrolGetConfig_();
  var list = [];
  order.forEach(function (k) {
    if (!cfg.enabled[k]) list.push({ key: k, label: PATROL_CHECKS[k].label, deadline: PATROL_CHECKS[k].deadline, status: 'OFF', lines: ['已停用（在「數據巡檢」工具的設定裡關閉了這一項）'] });
    else if (saved[k]) list.push(saved[k]);
    else list.push({ key: k, label: PATROL_CHECKS[k].label, deadline: PATROL_CHECKS[k].deadline,
      status: 'RED', lines: ['⚠️ 今天沒有這項的巡檢紀錄（觸發器可能沒跑），請確認巡檢是否正常'] });
  });
  var red = list.filter(function (r) { return r.status === 'RED'; }).length;
  var orange = list.filter(function (r) { return r.status === 'ORANGE'; }).length;
  var head = red ? ('🔴 ' + red + ' 項異常') : (orange ? ('🟠 ' + orange + ' 項注意') : '🟢 全部正常');
  patrolSendMail_('【天鷹保全巡檢】今日總結 ' + D + '｜' + head,
    '<div style="font-size:17px;font-weight:bold;margin-bottom:12px;">' + D + ' 今日巡檢總結：' + head + '</div>' + patrolResultsHtml_(list));
}

// ───────────────────────────────────────────────────────────────
// 八、觸發器入口（五個時間點）
// ───────────────────────────────────────────────────────────────

function patrolRunKeys_(keys, withSummary) {
  var D = patrolTodayStr_();
  var cfg = patrolGetConfig_();
  var results = keys.filter(function (k) { return cfg.enabled[k]; }).map(function (k) { return patrolRunOne_(k, D); });
  if (results.length) {
    patrolSaveResults_(D, results);
    patrolNotifyIssues_(D, results);
  }
  if (withSummary) patrolSendDailySummary_(D);
  return results;
}

function 巡檢_0600() { patrolRunKeys_(['closing', 'overnight'], false); }
function 巡檢_0800() { patrolRunKeys_(['logiNight'], false); }
function 巡檢_1100() { patrolRunKeys_(['opening'], false); }
function 巡檢_2000() { patrolRunKeys_(['logiDay'], false); }
function 巡檢_2200() { patrolRunKeys_(['construction'], true); }

// ───────────────────────────────────────────────────────────────
// 九、安裝／測試工具（在 Apps Script 編輯器手動執行）
// ───────────────────────────────────────────────────────────────

/** 授權＋檢查指令碼屬性（部署第一步先跑這個） */
function forceAuth() {
  var props = PropertiesService.getScriptProperties();
  var msg = [
    'SUPABASE_URL：' + (props.getProperty('SUPABASE_URL') ? '已設定' : '❌ 未設定'),
    'SUPABASE_SECRET_KEY：' + (props.getProperty('SUPABASE_SECRET_KEY') ? '已設定' : '❌ 未設定'),
    'PATROL_EMAILS：' + (props.getProperty('PATROL_EMAILS') ? '已設定' : '❌ 未設定'),
    'MAIN_GAS_URL：' + (props.getProperty('MAIN_GAS_URL') ? '已設定' : '（未設定＝不發站內通知）'),
    'PATROL_SECRET：' + (props.getProperty('PATROL_SECRET') ? '已設定' : '（未設定＝不發站內通知）'),
    'SESSION_SECRET：' + (props.getProperty('SESSION_SECRET') ? '已設定（工具登入驗證走本機，快）' : '（未設定＝工具登入驗證退回問主 App，較慢）')
  ].join('\n');
  MailApp.getRemainingDailyQuota(); // 觸發寄信授權
  Logger.log(msg);
  return msg;
}

/** 建立五個每日觸發器（會先清掉舊的同名觸發器，可重複執行） */
function 設定每日巡檢觸發器() {
  var map = { '巡檢_0600': 6, '巡檢_0800': 8, '巡檢_1100': 11, '巡檢_2000': 20, '巡檢_2200': 22 };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (map[t.getHandlerFunction()] !== undefined) ScriptApp.deleteTrigger(t);
  });
  Object.keys(map).forEach(function (fn) {
    ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(map[fn]).nearMinute(5).inTimezone(PATROL_TZ).create();
  });
  Logger.log('已建立 5 個每日觸發器：06:00、08:00、11:00、20:00、22:00（台北時間，實際會在該時間後約 15 分鐘內執行）');
}

/** 試跑：全部檢查跑一遍，只寫 Logger，不寄信、不發通知、不存結果 */
function 試跑巡檢_不通知() {
  var D = patrolTodayStr_();
  var out = [];
  Object.keys(PATROL_CHECKS).forEach(function (k) {
    var r = patrolRunOne_(k, D);
    out.push(PATROL_ICON[r.status] + ' ' + r.label + '：' + r.lines.join('；'));
  });
  var text = '【試跑 ' + D + '】（以「今天」的窗口計算，尚未到截止時間的項目出現 0 筆是正常的）\n' + out.join('\n');
  Logger.log(text);
  return text;
}

/** 試寄：寄一封測試信＋發一則測試站內通知，確認兩條通知管道都通 */
function 試寄測試通知() {
  patrolSendMail_('【天鷹保全巡檢】測試信', '<div>這是測試信，收到代表 Email 通知管道正常。</div>');
  var ok = patrolPostNotice_('🔔 數據巡檢測試通知', '這是測試通知，收到代表站內通知管道正常。');
  var msg = 'Email 已寄出；站內通知：' + (ok ? '成功' : '失敗或未設定（見執行記錄）');
  Logger.log(msg);
  return msg;
}

/**
 * 回測：拿過去 N 天（預設 30）的真實資料，逐日套用同一套規則，看每項會報幾次警。
 * 用來校準門檻（誤報太多就調 PATROL_LOW_RATIO／PATROL_MIN_BASELINE）。只讀、不通知。
 */
function 回測近30天(days) {
  var N = days || 30;
  var D0 = patrolTodayStr_();
  var lines = ['【回測 ' + N + ' 天】🔴＝0 筆 或 讀取失敗，🟠＝偏少／品質問題'];
  Object.keys(PATROL_CHECKS).forEach(function (k) {
    var check = PATROL_CHECKS[k];
    if (check.custom) { lines.push('■ ' + check.label + '：改看「明天施工單＋最近上傳時間」，不做逐日回測'); return; }
    // 一次抓足資料：最早那天往前 14 天 ～ 昨天窗尾
    var earliest = patrolAddDays_(D0, -N);
    var from = check.windowFor(patrolAddDays_(earliest, -PATROL_BASELINE_DAYS))[0];
    var to = check.windowFor(patrolAddDays_(D0, -1))[1];
    var rows = patrolFetchAll_('/rest/v1/' + check.table + '?select=' + check.select
      + '&created_at=gte.' + encodeURIComponent(patrolMsToISO_(from))
      + '&created_at=lt.' + encodeURIComponent(patrolMsToISO_(to)) + '&order=created_at.asc');
    var red = [], orange = [];
    for (var i = N; i >= 1; i--) {
      var D = patrolAddDays_(D0, -i);
      var r = patrolEvaluate_(check, D, rows);
      if (r.status === 'RED') red.push(D.slice(5) + '(' + r.count + ')');
      else if (r.status === 'ORANGE') orange.push(D.slice(5) + '(' + r.count + '/均' + r.avg.toFixed(1) + ')');
    }
    lines.push('■ ' + check.label + '：🔴 ' + red.length + ' 天' + (red.length ? ' → ' + red.join(' ') : '')
      + '｜🟠 ' + orange.length + ' 天' + (orange.length ? ' → ' + orange.join(' ') : ''));
  });
  var text = lines.join('\n');
  Logger.log(text);
  return text;
}

// ───────────────────────────────────────────────────────────────
// 十、工具後端（網頁應用程式）：tool_patrol.html 用
//   通行證驗證照洽公證管理 GAS（本機 HMAC 驗證＋快取，沒設 SESSION_SECRET 退回問主 App）。
//   看（getOverview／runNow）：組長以上（以主控台工具權限面板為準，id27）；
//   改設定／寄測試通知：副隊長以上（面板怎麼勾都一樣，這兩個固定限制）。
//   前端的角色判斷只是方便，真正的把關在這裡每個 action。
// ───────────────────────────────────────────────────────────────
var PATROL_TOOL_ID_ = 27;
var PATROL_VIEW_ROLES_ = ['leader', 'vicecaptain', 'captain', 'executive', 'admin'];   // 沒有面板設定時的預設
var PATROL_EDIT_ROLES_ = ['vicecaptain', 'captain', 'executive', 'admin'];
var MAIN_APP_GAS_URL_ = 'https://script.google.com/macros/s/AKfycbxEVBHseDpLWiWe4d8kLcCHbVFiKAK9wyoLwqNkt59PS4vPCY9QfG0_wiDJf2coO3zMcg/exec';
var MAIN_APP_SHEET_ID_ = '1oZsn8WlJ_-qQ6k9tIzm6Ymp3Zp-IfBFCf80Ut7Zw_JU';
var PATROL_AUTH_CACHE_SEC_ = 300;
var lastAuthErr_ = '';  // 'INVALID'｜'SERVER'｜'ROLE'

function jsonRes_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

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
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); }
  catch (e) { return { err: 'INVALID' }; }
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
  } catch (e) { return { err: 'SERVER' }; }
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
  } catch (err) { return { err: 'SERVER' }; }
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
  try { cache.put(key, JSON.stringify(r.user), PATROL_AUTH_CACHE_SEC_); } catch (e) {}
  return r.user;
}

/** 主控台「工具權限」面板設定（主 App 試算表「系統設定」的 toolPerms）；讀不到回 null */
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
        var pp = JSON.parse(String(data[r][1] || ''));
        if (pp && typeof pp === 'object') perms = pp;
        break;
      }
    }
  } catch (e) { perms = null; }
  if (perms) { try { cache.put('toolPerms', JSON.stringify(perms), 300); } catch (e) {} }
  return perms;
}

/** 本工具是不是在面板的「已知工具」清單裡：不在＝存檔後才新增的新工具 → 退回預設角色（同主控台規則） */
function patrolToolKnown_(perms) {
  var known = [];
  if (perms && Object.prototype.toString.call(perms._known) === '[object Array]') known = perms._known;
  else if (perms) {
    Object.keys(perms).forEach(function (r) {
      if (Object.prototype.toString.call(perms[r]) === '[object Array]') known = known.concat(perms[r]);
    });
  }
  return known.indexOf(PATROL_TOOL_ID_) >= 0 || known.indexOf(String(PATROL_TOOL_ID_)) >= 0;
}

function canViewPatrol_(role, perms) {
  if (role === 'admin') return true;
  if (perms && Object.prototype.toString.call(perms[role]) === '[object Array]' && patrolToolKnown_(perms)) {
    return perms[role].indexOf(PATROL_TOOL_ID_) >= 0 || perms[role].indexOf(String(PATROL_TOOL_ID_)) >= 0;
  }
  return PATROL_VIEW_ROLES_.indexOf(role) >= 0;
}

/** 驗通行證＋角色；needEdit＝true 時還要副隊長以上。失敗回 null 並設 lastAuthErr_ */
function requirePatrolUser_(token, needEdit) {
  var user = verifyAuthToken_(token);
  if (!user) return null;
  if (!canViewPatrol_(user.role, readToolPerms_())) { lastAuthErr_ = 'ROLE'; return null; }
  if (needEdit && PATROL_EDIT_ROLES_.indexOf(user.role) < 0) { lastAuthErr_ = 'EDIT'; return null; }
  return user;
}

function authFailRes_() {
  if (lastAuthErr_ === 'SERVER') return jsonRes_({ status: 'error', code: 'SERVER', msg: '伺服器暫時忙碌，無法確認登入狀態，請稍後再試（不用重新登入）' });
  if (lastAuthErr_ === 'ROLE') return jsonRes_({ status: 'error', code: 'ROLE', msg: '權限不足：您的職務目前沒有開放「數據巡檢」，請洽主管' });
  if (lastAuthErr_ === 'EDIT') return jsonRes_({ status: 'error', code: 'EDIT', msg: '只有副隊長以上可以修改設定或寄測試通知' });
  return jsonRes_({ status: 'error', code: 'INVALID', msg: '登入已失效，請回天鷹保全 App 重新登入' });
}

/** 讀所有已存的每日結果：回傳 { 'yyyy-MM-dd': { key: result } }，只取 fromDate 之後 */
function patrolLoadAllResults_(fromDate) {
  var all = PropertiesService.getScriptProperties().getProperties();
  var out = {};
  Object.keys(all).forEach(function (name) {
    if (name.indexOf('RESULT_') !== 0) return;
    var d = name.slice(7);
    if (d < fromDate) return;
    try { out[d] = JSON.parse(all[name]); } catch (e) {}
  });
  return out;
}

/** 已建立的巡檢觸發器數量（應為 5） */
function patrolTriggerCount_() {
  var names = ['巡檢_0600', '巡檢_0800', '巡檢_1100', '巡檢_2000', '巡檢_2200'];
  try {
    return ScriptApp.getProjectTriggers().filter(function (t) { return names.indexOf(t.getHandlerFunction()) >= 0; }).length;
  } catch (e) { return -1; }   // -1＝讀不到（沒授權），前端不顯示警告
}

/** action: getOverview：今日結果＋近30天紀錄＋目前設定 */
function patrolOverview_(user) {
  var D = patrolTodayStr_();
  var hist = patrolLoadAllResults_(patrolAddDays_(D, -29));
  var checks = PATROL_ORDER.map(function (k) {
    return { key: k, label: PATROL_CHECKS[k].label, deadline: PATROL_CHECKS[k].deadline, runAt: PATROL_RUN_AT[k] };
  });
  return {
    status: 'ok', today: D, now: Utilities.formatDate(new Date(), PATROL_TZ, 'HH:mm'),
    checks: checks, history: hist, config: patrolGetConfig_(),
    canEdit: PATROL_EDIT_ROLES_.indexOf(user.role) >= 0,
    triggerCount: patrolTriggerCount_(),
    emailsSet: !!patrolEmails_(),
    noticeSet: !!(PropertiesService.getScriptProperties().getProperty('MAIN_GAS_URL') && PropertiesService.getScriptProperties().getProperty('PATROL_SECRET'))
  };
}

/**
 * action: getCharts：「數據圖」分頁用，近 30 天每項的每日數據（直接從 Supabase 算，不依賴巡檢紀錄，部署第一天就有圖）。
 *   一般項目：每日筆數（過夜車輛＝台）；物流：每日「車輛數」（登記台數加總）並依車型分堆疊；
 *   施工單：每日「開工筆數」（含明後天已排的）。
 *   每天附上「近 14 天滾動平均」，前端乘上目前設定的偏少比例就是紅色門檻線（所以改設定不用重算）。
 *   結果快取 10 分鐘（約 10 個 Supabase 請求，不要每次打開都重算）；refresh=1 強制重算。
 */
var PATROL_CHART_DAYS = 30;
var PATROL_CHART_CATS = ['1.9噸', '3.5噸', '8噸以上'];
var PATROL_CHART_CACHE_KEY = 'charts_v1';
var PATROL_CHART_CACHE_SEC = 600;

function patrolChartUnit_(key) {
  if (key === 'overnight' || key === 'logiNight' || key === 'logiDay') return '台';
  return '筆';
}

/** 純函式：把資料列依「每天的窗口」分桶。rows 含 created_at（毫秒由此函式轉）、logistics 另含 category／count */
function patrolBucketDays_(check, dayList, rows, isLogi) {
  var ts = rows.map(function (r) { return new Date(r.created_at).getTime(); });
  var vals = [], cats = {};
  if (isLogi) PATROL_CHART_CATS.forEach(function (c) { cats[c] = []; });
  dayList.forEach(function (d) {
    var w = check.windowFor(d);
    var total = 0, per = {};
    for (var i = 0; i < rows.length; i++) {
      if (ts[i] < w[0] || ts[i] >= w[1]) continue;
      if (isLogi) {
        var n = Number(rows[i].count); if (!isFinite(n) || n < 0) n = 0;
        total += n;
        var cat = PATROL_CHART_CATS.indexOf(rows[i].category) >= 0 ? rows[i].category : null;
        if (cat) per[cat] = (per[cat] || 0) + n;
      } else { total++; }
    }
    vals.push(total);
    if (isLogi) PATROL_CHART_CATS.forEach(function (c) { cats[c].push(per[c] || 0); });
  });
  return { vals: vals, cats: isLogi ? cats : null };
}

/** 純函式：每個位置取「前 N 天」平均（滾動平均）。vals 是由舊到新；只回傳最後 outLen 個位置的平均 */
function patrolRollingAvg_(vals, outLen, span) {
  var out = [];
  for (var i = vals.length - outLen; i < vals.length; i++) {
    var sum = 0, n = 0;
    for (var k = Math.max(0, i - span); k < i; k++) { sum += vals[k]; n++; }
    out.push(n ? Math.round(sum / n * 10) / 10 : 0);
  }
  return out;
}

function patrolChartConstruction_(D) {
  var oldest = patrolAddDays_(D, -(PATROL_CHART_DAYS - 1)), newest = patrolAddDays_(D, 2);
  var rows = patrolFetchAll_('/rest/v1/construction_orders?select=work_date&work_date=gte.' + oldest + '&work_date=lte.' + newest);
  var per = {};
  rows.forEach(function (r) { per[r.work_date] = (per[r.work_date] || 0) + 1; });
  var days = [], vals = [];
  for (var i = PATROL_CHART_DAYS - 1; i >= -2; i--) { var d = patrolAddDays_(D, -i); days.push(d); vals.push(per[d] || 0); }
  return { key: 'construction', label: PATROL_CHECKS.construction.label, unit: '筆', metric: '每日開工筆數（含明後天已排的）',
    days: days, vals: vals, avgs: null, cats: null, todayIndex: PATROL_CHART_DAYS - 1, futureFrom: PATROL_CHART_DAYS };
}

function patrolChartData_(force) {
  var cache = CacheService.getScriptCache();
  if (!force) {
    var hit = cache.get(PATROL_CHART_CACHE_KEY);
    if (hit) { try { var cached = JSON.parse(hit); if (cached.today === patrolTodayStr_()) { cached.cached = true; return cached; } } catch (e) {} }
  }
  var D = patrolTodayStr_();
  var nowMs = Date.now();
  var span = PATROL_BASELINE_DAYS;
  var extDays = [];
  for (var i = PATROL_CHART_DAYS - 1 + span; i >= 0; i--) extDays.push(patrolAddDays_(D, -i));

  // 同一張表只抓一次：涵蓋所有用到這張表的檢查窗口
  var fetched = {};
  PATROL_ORDER.forEach(function (key) {
    var c = PATROL_CHECKS[key];
    if (c.custom) return;
    var from = c.windowFor(extDays[0])[0], to = c.windowFor(D)[1];
    var isLogi = c.table === 'logistics_records';
    var f = fetched[c.table] || (fetched[c.table] = { from: from, to: to, select: isLogi ? 'created_at,category,count' : 'created_at' });
    if (from < f.from) f.from = from;
    if (to > f.to) f.to = to;
  });
  Object.keys(fetched).forEach(function (table) {
    var f = fetched[table];
    f.rows = patrolFetchAll_('/rest/v1/' + table + '?select=' + f.select
      + '&created_at=gte.' + encodeURIComponent(patrolMsToISO_(f.from))
      + '&created_at=lt.' + encodeURIComponent(patrolMsToISO_(f.to)) + '&order=created_at.asc');
  });

  var charts = [];
  PATROL_ORDER.forEach(function (key) {
    var c = PATROL_CHECKS[key];
    if (c.custom) { charts.push(patrolChartConstruction_(D)); return; }
    var isLogi = c.table === 'logistics_records';
    var b = patrolBucketDays_(c, extDays, fetched[c.table].rows, isLogi);
    var cut = extDays.length - PATROL_CHART_DAYS;
    var cats = null;
    if (b.cats) { cats = {}; Object.keys(b.cats).forEach(function (k) { cats[k] = b.cats[k].slice(cut); }); }
    var w = c.windowFor(D);
    charts.push({ key: key, label: c.label, deadline: c.deadline, unit: patrolChartUnit_(key),
      metric: isLogi ? '每日車輛數（登記台數加總，依車型堆疊）' : '每日登記' + patrolChartUnit_(key) + '數',
      days: extDays.slice(cut), vals: b.vals.slice(cut), avgs: patrolRollingAvg_(b.vals, PATROL_CHART_DAYS, span),
      cats: cats, todayIndex: PATROL_CHART_DAYS - 1, partialToday: w[1] > nowMs });
  });
  var out = { status: 'ok', today: D, at: Utilities.formatDate(new Date(), PATROL_TZ, 'HH:mm'), charts: charts, cached: false };
  try { cache.put(PATROL_CHART_CACHE_KEY, JSON.stringify(out), PATROL_CHART_CACHE_SEC); } catch (e) {}
  return out;
}

/** action: runNow：現在立刻檢查全部（不存結果、不寄信、不發通知，純看） */
function patrolRunNow_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return { status: 'error', msg: '正在檢查中，請稍後再按一次' };
  try {
    var D = patrolTodayStr_();
    var cfg = patrolGetConfig_();
    var results = {};
    PATROL_ORDER.forEach(function (k) {
      if (!cfg.enabled[k]) { results[k] = { key: k, label: PATROL_CHECKS[k].label, deadline: PATROL_CHECKS[k].deadline, status: 'OFF', lines: ['已停用'], at: '' }; return; }
      results[k] = patrolRunOne_(k, D);
    });
    return { status: 'ok', today: D, results: results, at: Utilities.formatDate(new Date(), PATROL_TZ, 'HH:mm') };
  } finally { lock.releaseLock(); }
}

/** action: saveConfig */
function patrolSaveConfig_(data) {
  var clean = patrolSanitizeConfig_(data && data.config);
  PropertiesService.getScriptProperties().setProperty('PATROL_CONFIG', JSON.stringify(clean));
  return { status: 'ok', config: clean };
}

/** action: sendTest：寄測試信＋發測試站內通知，回報兩條管道各自成不成功 */
function patrolSendTest_() {
  var out = { status: 'ok', mail: false, notice: false, msg: '' };
  try { patrolSendMail_('【天鷹保全巡檢】測試信', '<div>這是測試信，收到代表 Email 通知管道正常。</div>'); out.mail = true; }
  catch (e) { out.msg = 'Email 失敗：' + e.message; }
  out.notice = patrolPostNotice_('🔔 數據巡檢測試通知', '這是測試通知，收到代表站內通知管道正常。');
  out.noticeMsg = out.notice ? '' : patrolLastNoticeErr_;
  out.noticeCount = patrolLastNoticeCount_;   // 0＝送出了但主 App 找不到任何隊長／副隊長／組長帳號
  return out;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'getCharts') {
      var uc = requirePatrolUser_(p.token, false);
      if (!uc) return authFailRes_();
      return jsonRes_(patrolChartData_(p.refresh === '1'));
    }
    if (p.action === 'getOverview') {
      var user = requirePatrolUser_(p.token, false);
      if (!user) return authFailRes_();
      return jsonRes_(patrolOverview_(user));
    }
    return jsonRes_({ status: 'ok', msg: '天鷹保全 數據巡檢 API 正常 ✓' });
  } catch (err) { return jsonRes_({ status: 'error', msg: err.message }); }
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || '';
    var data = {};
    try { data = JSON.parse(p.data || '{}'); } catch (x) { data = {}; }
    var needEdit = (action === 'saveConfig' || action === 'sendTest');
    var user = requirePatrolUser_(p.token, needEdit);
    if (!user) return authFailRes_();
    if (action === 'runNow') return jsonRes_(patrolRunNow_());
    if (action === 'saveConfig') return jsonRes_(patrolSaveConfig_(data));
    if (action === 'sendTest') return jsonRes_(patrolSendTest_());
    return jsonRes_({ status: 'error', msg: '未知動作: ' + action });
  } catch (err) { return jsonRes_({ status: 'error', msg: err.message }); }
}

// 讓 node 能單獨測純函式（GAS 環境沒有 module，用防禦寫法）
try {
  module.exports = {
    patrolAddDays_: patrolAddDays_, patrolToMs_: patrolToMs_, PATROL_CHECKS: PATROL_CHECKS,
    patrolBaseline_: patrolBaseline_, patrolEvaluate_: patrolEvaluate_, patrolEvaluateConstruction_: patrolEvaluateConstruction_,
    patrolRunOne_: patrolRunOne_, patrolRunKeys_: patrolRunKeys_, patrolSendDailySummary_: patrolSendDailySummary_,
    巡檢_0600: 巡檢_0600, 巡檢_2200: 巡檢_2200, 回測近30天: 回測近30天, 設定每日巡檢觸發器: 設定每日巡檢觸發器,
    patrolSaveResults_: patrolSaveResults_, patrolLoadResults_: patrolLoadResults_,
    patrolNotifyIssues_: patrolNotifyIssues_, patrolResultsHtml_: patrolResultsHtml_,
    patrolGetConfig_: patrolGetConfig_, patrolChartData_: patrolChartData_, patrolBucketDays_: patrolBucketDays_, patrolRollingAvg_: patrolRollingAvg_, patrolSanitizeConfig_: patrolSanitizeConfig_, patrolOverview_: patrolOverview_,
    doGet: doGet, doPost: doPost, patrolRunNow_: patrolRunNow_, PATROL_ORDER: PATROL_ORDER
  };
} catch (e) { /* GAS 環境：忽略 */ }
