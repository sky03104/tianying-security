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
// 指令碼屬性（專案設定 → 指令碼屬性）：
//   SUPABASE_URL / SUPABASE_SECRET_KEY  同其他 GAS（只讀）
//   PATROL_EMAILS   收件人，多人用逗號分隔
//   MAIN_GAS_URL    主 App GAS 的 /exec 網址（寫站內通知用，可不設＝不發站內通知）
//   PATROL_SECRET   與主 App GAS 設同一個值（隨機長字串）
// ═══════════════════════════════════════════════════════════════

var PATROL_TZ = 'Asia/Taipei';
var PATROL_BASELINE_DAYS = 14;   // 近幾天當比較基準
var PATROL_LOW_RATIO = 0.5;      // 低於基準平均的幾成算「偏少」（橘）
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
    lowRatio: 0.25,   // 實測近30天每晚 2~159 台、起伏很大，0.5 會天天橘燈，降到 0.25
    windowFor: function (D) { return [patrolToMs_(patrolAddDays_(D, -1), '20:00'), patrolToMs_(D, '06:00')]; }
  },
  logiNight: {
    label: '物流車輛（晚班）', deadline: '08:00', table: 'logistics_records',
    select: 'created_at,category',
    zeroMinBaseline: 1, // 實測近30天晚班只有 4 天有登記：近14天平均 <1 筆時，0 筆視為平常、不報警
    lowRatio: 0.15,
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
    lowRatio: 0.15,   // 實測每天 5~119 筆、起伏大，0.5 會約 1/4 的天數橘燈，降到 0.15
    windowFor: function (D) { return [patrolToMs_(D, '08:00'), patrolToMs_(D, '20:00')]; }
  },
  // 施工單不走「窗內筆數」判斷（實測近30天約4成的日子當天沒上傳、是整批上傳），
  // 改看「明天有沒有施工單」＋「最近一次上傳是不是太久以前」，見 patrolRunConstruction_
  construction: {
    label: '施工單更新', deadline: '22:00', table: 'construction_orders', custom: true
  }
};

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

  var lowRatio = check.lowRatio || PATROL_LOW_RATIO;
  if (count === 0 && base.avg < (check.zeroMinBaseline || 0)) {
    lines.push('0 筆（這個時段平常就很少登記，近 ' + PATROL_BASELINE_DAYS + ' 天平均 ' + avgTxt + ' 筆，不算異常）');
  } else if (count === 0) {
    status = 'RED';
    lines.push('截止 ' + check.deadline + ' 前「0 筆」登記（近 ' + PATROL_BASELINE_DAYS + ' 天平均 ' + avgTxt + ' 筆）');
  } else if (base.avg >= PATROL_MIN_BASELINE && count < base.avg * lowRatio) {
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
  var sum = 0;
  p.sameWeekdayEq.forEach(function (c) { sum += c; });
  var avg = p.sameWeekdayEq.length ? sum / p.sameWeekdayEq.length : 0;

  if (p.tomorrowCover === 0) {
    status = 'RED';
    lines.push(p.tomorrowStr + '（明天）截止 22:00 前「0 筆」施工單');
  } else if (avg >= PATROL_MIN_BASELINE && p.tomorrowEq < avg * PATROL_LOW_RATIO) {
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
    if (ageH > PATROL_CONSTRUCTION_STALE_HOURS) {
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
  // 清 3 天前的舊紀錄
  var all = props.getProperties();
  Object.keys(all).forEach(function (name) {
    if (name.indexOf('RESULT_') === 0 && name.slice(7) < patrolAddDays_(D, -3)) props.deleteProperty(name);
  });
}

function patrolLoadResults_(D) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('RESULT_' + D) || '{}'); }
  catch (e) { return {}; }
}

// ───────────────────────────────────────────────────────────────
// 七、通知（Email ＋ 站內）
// ───────────────────────────────────────────────────────────────
var PATROL_ICON = { GREEN: '🟢', ORANGE: '🟠', RED: '🔴' };
var PATROL_COLOR = { GREEN: '#16A34A', ORANGE: '#EA580C', RED: '#DC2626' };

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

/** 寫站內通知（隊長／副隊長／組長）；失敗只記 log，不影響 Email */
function patrolPostNotice_(title, body) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('MAIN_GAS_URL');
  var secret = props.getProperty('PATROL_SECRET');
  if (!url || !secret) { console.log('未設定 MAIN_GAS_URL／PATROL_SECRET，略過站內通知'); return false; }
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: { action: 'addPatrolNotices', data: JSON.stringify({ secret: secret, title: title, body: body }) },
      muteHttpExceptions: true
    });
    var j = JSON.parse(resp.getContentText() || '{}');
    if (j.status !== 'ok') console.error('站內通知失敗：' + resp.getContentText());
    return j.status === 'ok';
  } catch (err) {
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
  var order = ['closing', 'overnight', 'logiNight', 'opening', 'logiDay', 'construction'];
  var list = [];
  order.forEach(function (k) {
    if (saved[k]) list.push(saved[k]);
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
  var results = keys.map(function (k) { return patrolRunOne_(k, D); });
  patrolSaveResults_(D, results);
  patrolNotifyIssues_(D, results);
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
    'PATROL_SECRET：' + (props.getProperty('PATROL_SECRET') ? '已設定' : '（未設定＝不發站內通知）')
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

// 讓 node 能單獨測純函式（GAS 環境沒有 module，用防禦寫法）
try {
  module.exports = {
    patrolAddDays_: patrolAddDays_, patrolToMs_: patrolToMs_, PATROL_CHECKS: PATROL_CHECKS,
    patrolBaseline_: patrolBaseline_, patrolEvaluate_: patrolEvaluate_, patrolEvaluateConstruction_: patrolEvaluateConstruction_,
    patrolRunOne_: patrolRunOne_, patrolRunKeys_: patrolRunKeys_, patrolSendDailySummary_: patrolSendDailySummary_,
    巡檢_0600: 巡檢_0600, 巡檢_2200: 巡檢_2200, 回測近30天: 回測近30天, 設定每日巡檢觸發器: 設定每日巡檢觸發器,
    patrolSaveResults_: patrolSaveResults_, patrolLoadResults_: patrolLoadResults_,
    patrolNotifyIssues_: patrolNotifyIssues_, patrolResultsHtml_: patrolResultsHtml_
  };
} catch (e) { /* GAS 環境：忽略 */ }
