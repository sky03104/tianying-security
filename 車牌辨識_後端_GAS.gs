/**
 * 天鷹保全 · 車牌辨識系統 後端 GAS（獨立部署）
 * ─────────────────────────────────────────────
 * 以「已驗證可辨識」的版本為基準，API 請求方式完全相同
 * （gemini-flash-latest、key 放 URL 參數解決 AQ 金鑰 OAuth 報錯）。
 *
 * 【API Key 設定：兩種方式擇一，屬性優先】
 *   方式一（推薦）：GAS「專案設定 → 指令碼屬性」新增
 *     名稱：GEMINI_API_KEYS  值：多把 key 用逗號分隔（不同 Google Cloud 專案的 key 額度才是分開的）
 *     （也相容舊名稱 GEMINI_API_KEY 單把 key，兩個都設時 KEYS 優先）
 *   方式二：直接把 key 貼進下方 API_KEY_FALLBACK 的引號內（多把同樣逗號分隔）
 *     ⚠️ 只能貼在 GAS 編輯器裡，絕對不可 commit 回 GitHub（公開 repo 會外洩）
 *
 * 【自我檢查】瀏覽器直接開 /exec 網址，狀態頁會顯示金鑰是否已設定。
 *
 * 【部署】改完程式 →「部署 → 管理部署作業 → 編輯 → 版本：新版本」
 *   （不要「新增部署」，網址會變，前端全斷）
 * ───────────────────────────────────────────── */

// ── 設定 ──────────────────────────────────────
var SPREADSHEET_ID   = '1K46ZEq2zbh7Jw5yv3X9aPgyjWZF43ZUJfjc-x-xunnQ'; // 車輛登記試算表
var API_KEY_FALLBACK = ''; // ← 不想用指令碼屬性時，把 key 貼進引號內（僅限 GAS 編輯器，勿上傳 GitHub）

// 2026-07-30 新增：特殊車輛白名單／長期停放偵測 用到的分頁名稱
var WHITELIST_SHEET_NAME = '白名單設定';
var SPECIAL_SHEET_NAME   = '特殊車輛';
var LONGTERM_SHEET_NAME  = '長期停放紀錄';
var CONDITION_SHEET_NAME = '車況選項設定'; // 2026-09-20新增：登記畫面車況下拉選單的選項清單
var CONDITION_DEFAULTS_  = ['佈滿灰塵、長蜘蛛網', '輪胎破裂', '車殼破裂']; // 分頁第一次建立時的預設值

// 取分頁，不存在就自動建立＋補表頭樣式（比照 哨表產生_GAS.gs 的 getGuardPostConfig 模式）
function getOrCreateSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#D4A800').setFontColor('#0A0C10').setFontWeight('bold');
  return sh;
}

// 讀白名單設定，回傳 [{plate,type,note}]
function getPlateWhitelist_(ss) {
  var sh = getOrCreateSheet_(ss, WHITELIST_SHEET_NAME, ['車牌', '類型', '備註', '修改人', '修改時間']);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var data = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var plate = String(data[i][0] || '').trim().toUpperCase();
    if (!plate) continue;
    list.push({ plate: plate, type: String(data[i][1] || ''), note: String(data[i][2] || '') });
  }
  return list;
}

// 車牌是否命中白名單，命中回傳該筆設定，沒命中回傳 null
function matchWhitelist_(ss, plate) {
  var list = getPlateWhitelist_(ss);
  for (var i = 0; i < list.length; i++) {
    if (list[i].plate === plate) return list[i];
  }
  return null;
}

// 把 Sheets 讀回來的時間值統一轉成 Date（可能是 Date 物件也可能是純字串，兩種都要能處理）
function toDate_(v) {
  if (v instanceof Date) return v;
  var d = new Date(String(v || '').replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}
function dateOnlyStr_(d) {
  return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
}

// 2026-07-30 新增：連續兩天以上在同一地點登記到同一車牌 → 記進「長期停放紀錄」，含起訖日與天數。
// 三個地點（typeLabel）分開各自算，即時偵測（每次 vehicleReg 成功登記後呼叫）。
// 2026-09-20新增第8欄「停放位置」：長期滯留通常就是要去現場處理，車格號碼比車牌+地點更有用，
// 每次呼叫都覆蓋成最新一次登記的車格（車可能中途換位置），舊分頁沒有這欄就自動補表頭。
// 2026-09-21新增第10欄「車況」：跳過第9欄(I)——那欄現場已經有別的資料在用，不能寫進去，
// 直接接在後面開新欄，比照F欄「此欄勿動」的教訓，這次先確認清楚再動手。
function checkAndUpdateLongTermParking_(ss, sheet, typeLabel, plate, timestamp, parkLocation, condition) {
  var todayStr = dateOnlyStr_(timestamp);
  var yesterdayStr = dateOnlyStr_(new Date(timestamp.getTime() - 86400000));

  var ltSheet = getOrCreateSheet_(ss, LONGTERM_SHEET_NAME,
    ['車牌', '地點', '起始日期', '最後更新日期', '已停放天數', '狀態', '建立時間', '停放位置']);
  if (!ltSheet.getRange(1, 8).getValue()) ltSheet.getRange(1, 8).setValue('停放位置');
  if (!ltSheet.getRange(1, 10).getValue()) ltSheet.getRange(1, 10).setValue('車況');

  var lastRow = ltSheet.getLastRow();
  var openRowIdx = -1; // 1-based 試算表列號
  var openRowData = null;
  if (lastRow >= 2) {
    var data = ltSheet.getRange(2, 1, lastRow - 1, 6).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim().toUpperCase() === plate &&
          String(data[i][1] || '') === typeLabel &&
          String(data[i][5] || '') === '進行中') {
        openRowIdx = i + 2;
        openRowData = data[i];
        break;
      }
    }
  }

  if (openRowIdx > 0) {
    ltSheet.getRange(openRowIdx, 8).setValue(parkLocation || ''); // 每次呼叫都刷新成最新車格，不管今天算不算新的一天
    ltSheet.getRange(openRowIdx, 10).setValue(condition || ''); // 車況同步刷新，跳過第9欄(I)不動它
    var lastUpdateStr = dateOnlyStr_(toDate_(openRowData[3]));
    if (lastUpdateStr === todayStr) return; // 今天已經更新過（同一天重複登記），不重複累加
    if (lastUpdateStr === yesterdayStr) {
      var newDays = Number(openRowData[4] || 1) + 1;
      ltSheet.getRange(openRowIdx, 4).setValue(timestamp);
      ltSheet.getRange(openRowIdx, 5).setValue(newDays);
    } else {
      // 中斷超過一天：舊的連續紀錄結束，天數凍結；今天是重新出現的第一天，還不到門檻，不新建列
      ltSheet.getRange(openRowIdx, 6).setValue('已結束');
    }
    return;
  }

  // 沒有進行中的紀錄 → 查這個地點的分頁，昨天有沒有登記過這個車牌
  var srcLastRow = sheet.getLastRow();
  if (srcLastRow < 2) return;
  var srcData = sheet.getRange(2, 1, srcLastRow - 1, 3).getValues(); // A時間 B類型 C車牌
  var foundYesterday = false;
  for (var j = srcData.length - 1; j >= 0; j--) {
    if (String(srcData[j][2] || '').trim().toUpperCase() !== plate) continue;
    var d = toDate_(srcData[j][0]);
    if (d && dateOnlyStr_(d) === yesterdayStr) { foundYesterday = true; break; }
  }
  if (foundYesterday) {
    // 陣列第9個位置(I欄)刻意留空字串——那欄現場已經有別的資料在用，appendRow是全新一列本來就是空的，
    // 這裡明寫空字串只是避免自己以後看漏、誤以為是要塞值的欄位。
    ltSheet.appendRow([plate, typeLabel, yesterdayStr, timestamp, 2, '進行中', timestamp, parkLocation || '', '', condition || '']);
  }
}

// 2026-09-21新增：查指定類型裡一批車牌「最近一次真的被登記到」的完整資訊（日期/停放位置/車況），
// 供長期滯留複檢判斷用。不能只看「長期停放紀錄」自己的進行中/已結束狀態——那個欄位只有在
// 同一台車「再次出現」時才會更新，若車子直接永久離開、再也沒被拍到，會一直卡在進行中誤報
// 「還在」；「長期停放紀錄」自己存的停放位置(H欄)也可能是很久以前的舊值，不夠即時。改成直接
// 查主資料的最新一筆，車格/車況跟著這筆一起帶出來才會準。優先查Supabase（TODO-42已雙寫），
// 失敗才退回掃Sheets。
// ⚠️這裡設計成一次查一批（不是一支一支查）：名單有幾台車，逐筆查詢就是幾次序列化的
// 網路請求（或幾次整表掃描），咖哩實測反應「讀取很慢」正是這個N+1問題。改成一次Supabase
// 查詢用plate=in.(...)撈回這幾台車的全部歷史（車牌數量固定是長期停放名單那幾筆，in.()
// 對Supabase是索引查詢，不會因主表資料量變大而變慢），Sheets備援也只整表掃描一次。
function getLatestSightingBatch_(typeLabel, plates) {
  var map = {}; // plate -> {date, parkLocation, condition}
  if (!plates.length) return map;
  if (typeof supabaseRequest_ === 'function') {
    try {
      var inList = plates.map(function (p) { return encodeURIComponent(p); }).join(',');
      var rows = supabaseRequest_('get', '/rest/v1/vehicle_overnight_logs?type_label=eq.' +
        encodeURIComponent(typeLabel) + '&plate=in.(' + inList + ')&select=plate,created_at,park_location,car_condition&order=created_at.desc');
      rows.forEach(function (r) {
        var ds = Utilities.formatDate(new Date(r.created_at), 'Asia/Taipei', 'yyyy-MM-dd');
        if (!map[r.plate] || ds > map[r.plate].date) {
          map[r.plate] = { date: ds, parkLocation: r.park_location || '', condition: r.car_condition || '' };
        }
      });
      return map;
    } catch (err) {
      console.error('批次查最新登記資訊失敗（Supabase），退回掃Sheets：' + err.toString());
      map = {};
    }
  }
  var wanted = {};
  plates.forEach(function (p) { wanted[p] = true; });
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(typeLabel);
  if (!sheet) return map;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;
  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues(); // A時間/B類型/C車牌/D登記人/E停放位置/(F此欄勿動不使用)/G車況
  for (var i = 0; i < data.length; i++) {
    var plate = String(data[i][2] || '').trim().toUpperCase();
    if (!wanted[plate]) continue;
    var d = toDate_(data[i][0]);
    if (!d) continue;
    var ds2 = dateOnlyStr_(d);
    if (!map[plate] || ds2 > map[plate].date) {
      map[plate] = { date: ds2, parkLocation: String(data[i][4] || ''), condition: String(data[i][6] || '') };
    }
  }
  return map;
}

// 2026-09-20新增：長期滯留車輛複檢名單——只列指定類型裡「進行中」的長期停放紀錄
// （已結束的代表系統已經確認過離開了，不用複檢），批次比對最新出現日期算出「還在/已離開」。
// 停放位置／車況一律改用這批查到的最新一筆，不用「長期停放紀錄」自己存的舊值（可能是很久以前的）。
// 排序：還在的排最前面（現場複檢優先看還沒走的），同組內再照天數大到小排。
function getLongTermList_(typeLabel) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ltSheet = ss.getSheetByName(LONGTERM_SHEET_NAME);
  var rows = [];
  if (ltSheet) {
    var lastRow = ltSheet.getLastRow();
    if (lastRow >= 2) {
      var data = ltSheet.getRange(2, 1, lastRow - 1, 10).getValues(); // 讀到J欄(車況)，跳過的I欄一起讀出來但不使用
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1] || '') !== typeLabel) continue;
        if (String(data[i][5] || '') !== '進行中') continue;
        rows.push({
          plate: String(data[i][0] || ''),
          parkLocation: String(data[i][7] || ''), // 先用長期停放紀錄自己存的當備援，下面有更新的最新資料會覆蓋
          condition: String(data[i][9] || ''), // 同上，J欄(index9)當備援
          days: Number(data[i][4] || 0)
        });
      }
    }
  }
  var todayStr = dateOnlyStr_(new Date());
  var latestMap = getLatestSightingBatch_(typeLabel, rows.map(function (r) { return r.plate; }));
  rows.forEach(function (r) {
    var latest = latestMap[r.plate];
    if (!latest) {
      r.status = '找不到登記紀錄';
      r.stillHere = null;
    } else {
      r.stillHere = (latest.date === todayStr);
      r.status = r.stillHere ? '車輛還在' : ('車輛已於 ' + latest.date.replace(/-/g, '/') + ' 離開');
      if (latest.parkLocation) r.parkLocation = latest.parkLocation; // 用最新一筆覆蓋，比長期停放紀錄自己存的舊值準
      if (latest.condition) r.condition = latest.condition;
    }
  });
  var rank = { 'true': 0, 'false': 1, 'null': 2 };
  rows.sort(function (a, b) {
    var r = rank[String(a.stillHere)] - rank[String(b.stillHere)];
    return r !== 0 ? r : (b.days - a.days);
  });
  return rows;
}

// 2026-09-20新增：車況下拉選單選項（CRUD模式比照getPlateWhitelist_/savePlateWhitelist）。
// 分頁第一次建立時直接塞入預設值，達成「先加入幾個常用選項」的需求。
function getConditionOptions_(ss) {
  var sh = ss.getSheetByName(CONDITION_SHEET_NAME);
  var isNew = !sh;
  sh = getOrCreateSheet_(ss, CONDITION_SHEET_NAME, ['選項內容', '修改人', '修改時間']);
  if (isNew) {
    var nowSeed = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
    sh.getRange(2, 1, CONDITION_DEFAULTS_.length, 3).setValues(
      CONDITION_DEFAULTS_.map(function (c) { return [c, '系統預設', nowSeed]; })
    );
  }
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var data = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var v = String(data[i][0] || '').trim();
    if (v) list.push(v);
  }
  return list;
}

function saveConditionOptions_(ss, empId, list) {
  var sh = getOrCreateSheet_(ss, CONDITION_SHEET_NAME, ['選項內容', '修改人', '修改時間']);
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 3).clearContent();
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  var seen = {};
  var rows = [];
  for (var i = 0; i < list.length; i++) {
    var v = String(list[i] || '').trim();
    if (!v || seen[v]) continue;
    seen[v] = true;
    rows.push([v, "'" + empId, now]);
  }
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

// 2026-09-20新增：車況輸入框改成可直接打字（跟tool_closing.html監工姓名同概念），
// 打的內容如果不在既有選項清單裡，登記送出時背景呼叫這支自動收進清單，不用特地去設定畫面加。
// 用鎖＋比對是否已存在才appendRow，避免兩支手機同時打同一個新車況變成兩筆重複選項。
function addConditionOption_(ss, empId, value) {
  var list = getConditionOptions_(ss); // 沿用同一支：分頁不存在時會自動建立+塞預設值
  var exists = list.some(function (v) { return v.toLowerCase() === value.toLowerCase(); });
  if (exists) return;
  var sh = ss.getSheetByName(CONDITION_SHEET_NAME);
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  sh.appendRow([value, "'" + empId, now]);
}

// 取金鑰清單：GEMINI_API_KEYS（多把逗號分隔）> GEMINI_API_KEY（單把舊名）> 備用常數
// 注意：免費額度是算「Google Cloud 專案」不是算金鑰，多把 key 要來自不同專案才有加乘效果
function getApiKeys_() {
  var props = PropertiesService.getScriptProperties();
  var rawKeys = props.getProperty('GEMINI_API_KEYS') || props.getProperty('GEMINI_API_KEY') || API_KEY_FALLBACK || '';
  var keys = [];
  var parts = rawKeys.split(',');
  for (var i = 0; i < parts.length; i++) {
    var k = parts[i].trim();
    if (k) keys.push(k);
  }
  return keys;
}

// ── 狀態頁（直接點開網址時顯示，並自我檢查金鑰）──
function doGet() {
  var keys = getApiKeys_();
  var props = PropertiesService.getScriptProperties();
  var keyStatus = keys.length
    ? '✅ API Key 已設定 ' + keys.length + ' 把（' + keys[0].slice(0, 4) + '…，來源：' +
      (props.getProperty('GEMINI_API_KEYS') || props.getProperty('GEMINI_API_KEY') ? '指令碼屬性' : '程式碼備用欄') + '）'
    : '❌ API Key 未設定！請到「專案設定 → 指令碼屬性」新增 GEMINI_API_KEYS（多把逗號分隔），或貼進程式碼 API_KEY_FALLBACK';
  return HtmlService.createHtmlOutput(
    '<h1>🚗 車牌辨識系統後端運行中</h1>' +
    '<p>請從 GitHub 前端頁面進行操作。若看到此頁面，代表後端部署成功。</p>' +
    '<p>' + keyStatus + '</p>'
  );
}

// ── 主入口（POST）──────────────────────────────
function doPost(e) {
  try {
    var body = e.postData ? e.postData.contents : null;
    if (!body) return jsonOut({ success: false, error: '未收到資料' });
    var payload = JSON.parse(body);

    // --- 功能 A: 車牌辨識 ---
    if (payload.action === 'recognizePlate') {
      var apiKeys = getApiKeys_();
      if (!apiKeys.length) return jsonOut({ success: false, error: 'API Key 未設定：請開 /exec 網址查看設定說明' });
      // 2026-08-28新增：每次辨識隨機打亂金鑰嘗試順序，避免固定順序時排第一個的金鑰
      // 永遠最先被打、額度最快用完，其他金鑰卻還很閒置（咖哩實測發現過這個狀況）。
      apiKeys = shuffleArray_(apiKeys.slice());

      // 清洗 Base64 資料
      var cleanBase64 = payload.imageBase64.split(',')[1] || payload.imageBase64;

      var apiPayload = {
        "contents": [{
          "parts": [
            { "text": "你是一個專業車牌辨識員，專門辨識台灣車牌。請仔細辨識圖中的車牌號碼，只回傳號碼文字（如 ABC-1234），其餘文字都不填。" +
              "台灣車牌不使用字母 O 與 I，若看到圓形字元請判斷為數字 0、看到直線字元請判斷為數字 1，其餘容易混淆的字元（如 B/8、S/5、Z/2、D/0）請依上下文與台灣車牌常見格式判斷最合理的結果。" +
              "若照片模糊、角度太斜、或完全看不到車牌，回 NONE，不要用猜的填答案。" },
            { "inline_data": { "mime_type": "image/jpeg", "data": cleanBase64 }}
          ]
        }],
        "generationConfig": {
          "temperature": 0,
          "maxOutputTokens": 200
        },
        "safetySettings": [
          { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
      };

      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(apiPayload),
        "muteHttpExceptions": true
      };

      // 雙層備援：外層模型、內層金鑰——先用最準的模型把所有金鑰額度用完，
      // 才降到備援模型（每個模型/每把金鑰的免費額度都是分開計算的）。
      // 2026-07-12 起因：-latest 被 Google 指到 gemini-3.5-flash，免費層限 20 次/日，
      // 快速連拍很快撞頂（實機截圖確認）。
      // 注意：2026-07-11 曾發現金鑰對 gemini-2.0-flash 配額為 0（打不通），
      // 所以備援鏈不放 2.0 系列；鏈上模型若配額為 0 也會自然跳下一個。
      // 2026-07-14 移除 gemini-2.5-flash：Google 已下架此模型（"no longer available to
      // new users"），回應是 HTTP 200 包一個文字錯誤、沒有標準 429/500/503 碼，舊版重試判斷
      // 判不出來會直接中止整個請求，導致鏈上排在它後面的健康模型完全沒機會被試到——金鑰越多，
      // 越容易先耗光主模型額度後撞上這個死模型，反而讓成功率變差，這才是
      // 「多把金鑰額度不升反降」的真正原因。
      // 2026-07-14 同日再移除 gemini-2.5-flash-lite：查證到 Google 開發者論壇回報同一天
      // 開始對這個型號回傳一樣的「no longer available」404，比官方公告的10月關閉日提前
      // 快3個月——寫死版本號的模型隨時可能被提前收回。鏈上只留兩個帶 -latest 的別名
      // （Google 保證這類別名永遠指向目前還活著的最新版本，不會有這個問題）。
      // 2026-07-22：兩個 -latest 別名同時回「Request contains an invalid argument」，
      // 代表問題不是特定模型，而是兩者都吃的共同參數壞掉——已移除 generationConfig 裡的
      // thinkingConfig（那是給支援「思考」的模型用的欄位，-latest 別名現在指到的版本
      // 顯然不吃這個欄位）。
      // 2026-08-28新增：依登記類型分散主力模型——RPD免費額度是「每個模型各自算」
      // （AI Studio實測：3.6/3.7 Flash各20次/日，3.5 Flash Lite有500次/日），三種
      // 類型固定用同一個主力模型時，額度是三種類型共用同一份20次，很快就撞頂；
      // 改成各類型指定不同主力，等於把20+20+500的額度分開用，總量大幅拉高。
      // ⚠️寫死版本號的風險：這幾支模型未來仍可能被Google下架（車牌辨識已經因為
      // 這樣壞過3次，見上面歷史記錄），所以指定版本只當「優先」，鏈尾一定留
      // -latest別名當安全網——就算指定的版本某天真的收掉，還能自動退到當時還活著
      // 的版本，不會讓某個類型直接壞掉。
      var TYPE_PRIMARY_MODEL_ = {
        car: 'gemini-3.6-flash',        // 館內汽車
        park: 'gemini-3.7-flash',       // 新莊停車場
        moto: 'gemini-3.5-flash-lite'   // 館內機車（額度最寬鬆，機車連拍量通常最大）
      };
      var ALL_PINNED_MODELS_ = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];
      // 2026-08-28補：payload.type沒送到（例如前端頁面還沒更新到最新版、GitHub Pages
      // 快取還沒換過來）時，寧可預設優先選額度最寬鬆的3.5-flash-lite，也不要照陣列
      // 原始順序先去踩3.6/3.7 Flash的地雷——類型資訊缺失時的預設值選錯，代價比其他
      // 情況都嚴重（等於完全沒有分流效果，三種類型全部擠回原本共用20次額度的老路）。
      var preferredModel = TYPE_PRIMARY_MODEL_[payload.type] || 'gemini-3.5-flash-lite';
      var MODELS = [];
      if (preferredModel) MODELS.push(preferredModel);
      ALL_PINNED_MODELS_.forEach(function (m) { if (MODELS.indexOf(m) === -1) MODELS.push(m); });
      MODELS.push('gemini-flash-latest');      // 安全網：目前最新穩定版
      MODELS.push('gemini-flash-lite-latest'); // 安全網：額度較高的版本
      var lastError = '';
      var deadKeys = {}; // 金鑰無效/沒權限 → 之後的模型也不用再試這把
      for (var mi = 0; mi < MODELS.length; mi++) {
        for (var ki = 0; ki < apiKeys.length; ki++) {
          if (deadKeys[ki]) continue;
          var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELS[mi] + ':generateContent?key=' + apiKeys[ki];
          var res = UrlFetchApp.fetch(url, options); // key 放 URL 參數：解決 AQ 金鑰 OAuth 報錯（已驗證版本作法）
          var result = JSON.parse(res.getContentText());

          if (result.error) {
            var msg = String(result.error.message || '');
            var code = result.error.code || res.getResponseCode();
            lastError = 'API 報錯(' + MODELS[mi] + '/金鑰' + (ki + 1) + '): ' + msg;
            // 額度爆掉(429)/伺服器忙(500,503) → 換下一把金鑰或下一個模型
            if (code === 429 || code === 500 || code === 503 || /quota|exhausted|overloaded/i.test(msg)) continue;
            // 金鑰本身壞掉（無效/沒權限）→ 這把作廢，換下一把；不是最後一把就繼續
            if (code === 400 && /api key/i.test(msg) || code === 403) { deadKeys[ki] = true; continue; }
            // 模型被下架/找不到（Google 常包成 HTTP 200 + 文字訊息，沒有標準錯誤碼）
            // → 這個模型對所有金鑰都沒用，直接跳下一個模型，不要整組中止
            if (/no longer available|not found|not supported/i.test(msg)) break;
            // 2026-07-22：其他未分類的 400（例如 invalid argument）曾發生在單一模型上，
            // 但備援模型用同一組請求格式卻能正常辨識——代表問題常常是「這個模型版本」
            // 的問題，不是請求本身壞掉。改成跳下一個模型再試，撞到才是真的沒救；
            // 不要一遇到沒分類的錯誤就整個放棄，浪費掉備援模型的機會。
            break;
          }

          if (result.candidates && result.candidates[0] && result.candidates[0].content) {
            var raw = result.candidates[0].content.parts[0].text.trim().toUpperCase();
            if (raw !== "" && !raw.includes("NONE")) {
              // 只接受套得出合法台灣車牌格式的結果；套不出格式（代表AI看到的
              // 是ETC貼紙、停車證等雜訊，或只看到半截車牌）一律當辨識失敗，
              // 不要把原始文字硬塞進去——寧可手動輸入，不要塞錯資料進登記紀錄。
              // 2026-07-23：拿掉「套不出格式就照原樣回傳」的舊 fallback後才發現，
              // 之前ETC/OR8/AHX-這類明顯不是車牌的文字全被當成功登記進試算表。
              var plate = extractPlate_(raw);
              if (plate) return jsonOut({ success: true, plate: plate, raw: raw, model: MODELS[mi] });
              // 套不出格式：把AI原始看到的文字一起附上，讓保全知道AI誤判了什麼
              // （例如ETC貼紙、半截車牌），方便判斷要重拍還是直接手動輸入。
              return jsonOut({ success: false, error: "辨識失敗：AI看到的文字對不上車牌格式（AI回應：" + raw.slice(0, 50) + "），請重拍或手動輸入", raw: raw });
            }
            // 模型判定完全沒看到車牌（回NONE或空白）＝照片問題，換模型/金鑰也認不出來，直接回報
            return jsonOut({ success: false, error: "辨識失敗：請確保照片清晰且包含車牌" });
          }
          // 沒有 candidates 也沒有 error（罕見），當暫時性問題繼續換
          lastError = '模型無回應(' + MODELS[mi] + '/金鑰' + (ki + 1) + ')';
        }
      }
      return jsonOut({ success: false, error: '所有模型×金鑰的額度都已用完，請稍等 1 分鐘再拍，或手動輸入車牌。' + (lastError ? '（' + lastError + '）' : '') });
    }

    // --- 功能 B: 資料登記到試算表 ---
    if (payload.action === 'vehicleReg') {
      // 2026-07-30 健檢補：operator 完全沒驗證空值，未登入/session遺失時會直接寫入
      // 「未登入」，造成查不到是誰登記的孤兒資料。工號必傳，比照 CLAUDE.md GAS 標準擋下。
      var operator = String(payload.operator || '').trim();
      if (!operator || operator === '未登入') {
        return jsonOut({ success: false, error: '工號遺失，請重新整理頁面確認登入狀態後再登記' });
      }

      var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      // 依類型名稱找對應分頁（原本寫死 getSheets()[0]永遠抓最左邊分頁，
      // 若有人在Sheets手動調過分頁順序，所有類型都會被寫到同一頁——
      // 2026-07-11踩過這坑）。找不到對應分頁時明確報錯，不要沉默寫錯地方。
      var sheet = ss.getSheetByName(payload.typeLabel);
      if (!sheet) return jsonOut({ success: false, error: '找不到「' + payload.typeLabel + '」分頁，請確認試算表分頁名稱是否與類型名稱一致' });
      var plate = String(payload.plate || '').trim().toUpperCase();
      var parkLocation = String(payload.parkLocation || '').trim();
      var condition = String(payload.condition || '').trim();
      var now2 = new Date();
      var timestamp = Utilities.formatDate(now2, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
      // 2026-09-19新增「停放位置」E欄：手動輸入，選填。既有分頁只有A~D欄表頭，
      // 這裡確保E1有標題，appendRow照樣能寫到E欄（不需要表頭就能寫值，這只是方便肉眼看）。
      if (!sheet.getRange(1, 5).getValue()) sheet.getRange(1, 5).setValue('停放位置');
      // 2026-09-20新增「車況」欄，原本放F欄，但咖哩發現「館內汽車」「新莊停車場」F欄
      // 早就有別的用途（疑似鏡射公式），已手動標示「此欄勿動」，改放G欄避免撞到既有資料。
      // F欄完全不讀不寫，appendRow時特意留一個空字串佔位，不去動它。
      if (!sheet.getRange(1, 7).getValue()) sheet.getRange(1, 7).setValue('車況');
      // 上鎖：append+抓行號要當成一個原子操作，避免多支手機同時登記時，
      // 兩個請求的 getLastRow() 讀到彼此交錯後的行號，回傳給前端的 row 對不上實際寫入的那一列。
      // 2026-07-30 新增的白名單比對／長期停放偵測也包在同一個鎖裡，維持單一原子操作。
      var lock = LockService.getScriptLock();
      lock.waitLock(10000);
      var newRow;
      var specialVehicle = null;
      try {
        // 2026-07-30 健檢補：連拍/網路重試/前端重入都可能讓同一台車在極短時間內送出兩次
        // vehicleReg，原本完全沒有去重、永遠 appendRow。只查最近 20 筆（避免資料量大時整表
        // 掃描太慢），同車牌在 2 分鐘內已存在就視為重複、不寫入，並明確告知（不是靜默略過）。
        var lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          var checkFrom = Math.max(2, lastRow - 19);
          var recent = sheet.getRange(checkFrom, 1, lastRow - checkFrom + 1, 3).getValues(); // A時間 B類型 C車牌
          var now = new Date();
          for (var ri = recent.length - 1; ri >= 0; ri--) {
            if (String(recent[ri][2] || '').trim().toUpperCase() !== plate) continue;
            var rTime = recent[ri][0];
            var tDate = (rTime instanceof Date) ? rTime : new Date(String(rTime).replace(' ', 'T'));
            if (isNaN(tDate.getTime())) continue;
            if (now.getTime() - tDate.getTime() < 2 * 60 * 1000) {
              return jsonOut({ success: false, duplicate: true, error: '⚠️ ' + plate + ' 2分鐘內已登記過，已略過避免重複寫入' });
            }
            break; // 同車牌最近一筆時間已在窗口外，不用再往前查更舊的
          }
        }
        sheet.appendRow([
          timestamp,
          payload.typeLabel,
          plate,
          "'" + operator,  // ' 前綴：工號純數字，防試算表吃掉開頭 0
          parkLocation,
          '', // F欄刻意留空——此欄勿動，不是我們的資料
          condition
        ]);
        newRow = sheet.getLastRow();

        // 2026-07-30 新增①：白名單比對——命中就額外多寫一份到「特殊車輛」，原本的分頁照樣寫，不受影響
        var wl = matchWhitelist_(ss, plate);
        if (wl) {
          specialVehicle = wl;
          var specialSheet = getOrCreateSheet_(ss, SPECIAL_SHEET_NAME,
            ['時間', '地點', '車牌', '登記人', '白名單類型', '備註']);
          specialSheet.appendRow([timestamp, payload.typeLabel, plate, "'" + operator, wl.type, wl.note]);
        }

        // 2026-07-30 新增②：連續兩天以上在同一地點登記到同一車牌 → 記進「長期停放紀錄」
        checkAndUpdateLongTermParking_(ss, sheet, payload.typeLabel, plate, now2, parkLocation, condition);
      } finally {
        lock.releaseLock();
      }
      // 2026-08-28 SQL遷移：雙寫Supabase（見docs/SQL遷移規劃_過夜車輛統計.md第三節，
      // 這支工具的寄信是稽核用途，Sheets不停用，Supabase只是多一份供查詢/寄信優先讀）。
      // 用typeof防呆：SQL遷移的腳本檔還沒貼進這個專案時，跳過同步，不影響原本Sheets登記功能。
      var supabaseId = null;
      if (typeof supabaseRequest_ === 'function') {
        supabaseId = _syncVehicleRegToSupabase_(payload.typeLabel, plate, operator, now2, parkLocation, condition);
      }
      // row/supabaseId 回傳給前端：辨識錯誤時前端可用這兩個值呼叫 updatePlate 就地修正，不用手動開試算表改。
      return jsonOut({ success: true, row: newRow, supabaseId: supabaseId, specialVehicle: specialVehicle });
    }

    // --- 功能 D: 白名單設定（公司車/月租車）讀取／儲存 ---
    // 2026-07-30 補：讀取也包進同一把鎖再讀，避免「白名單設定」分頁還沒建立時，
    // 讀取跟寫入（或跟 vehicleReg 的白名單比對）幾乎同時觸發 getOrCreateSheet_，
    // Sheets 對重名分頁會自動改名成「白名單設定 2」而非報錯，資料因此分裂成兩份。
    if (payload.action === 'getPlateWhitelist') {
      var ssW = SpreadsheetApp.openById(SPREADSHEET_ID);
      var lockR = LockService.getScriptLock();
      lockR.waitLock(10000);
      var listR;
      try {
        listR = getPlateWhitelist_(ssW);
      } finally {
        lockR.releaseLock();
      }
      return jsonOut({ success: true, list: listR });
    }
    if (payload.action === 'savePlateWhitelist') {
      var empIdW = String(payload.empId || '').trim();
      if (!empIdW) return jsonOut({ success: false, error: '工號遺失，請重新整理頁面確認登入狀態' });
      var listW = Array.isArray(payload.list) ? payload.list : [];

      var ssW2 = SpreadsheetApp.openById(SPREADSHEET_ID);
      var lockW = LockService.getScriptLock();
      lockW.waitLock(10000);
      try {
        var whSheet = getOrCreateSheet_(ssW2, WHITELIST_SHEET_NAME, ['車牌', '類型', '備註', '修改人', '修改時間']);
        var lastRowW = whSheet.getLastRow();
        if (lastRowW >= 2) whSheet.getRange(2, 1, lastRowW - 1, 5).clearContent();
        var nowW = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
        // 車牌去重（保留清單中最後一筆），避免前端沒防到／多人同時編輯造成同車牌存成兩筆，
        // matchWhitelist_ 之後永遠只認得到第一筆，重複的那筆形同垃圾資料。
        var seenPlates = {};
        var rowsW = [];
        for (var wi = listW.length - 1; wi >= 0; wi--) {
          var plate = String(listW[wi].plate || '').trim().toUpperCase();
          if (!plate || seenPlates[plate]) continue;
          seenPlates[plate] = true;
          rowsW.unshift([plate, String(listW[wi].type || ''), String(listW[wi].note || ''), "'" + empIdW, nowW]);
        }
        if (rowsW.length) whSheet.getRange(2, 1, rowsW.length, 5).setValues(rowsW);
      } finally {
        lockW.releaseLock();
      }
      return jsonOut({ success: true });
    }

    // --- 功能 G: 車況下拉選單選項讀取／儲存（2026-09-20新增，CRUD模式比照白名單設定）---
    if (payload.action === 'getConditionOptions') {
      var ssC = SpreadsheetApp.openById(SPREADSHEET_ID);
      var lockC = LockService.getScriptLock();
      lockC.waitLock(10000);
      var listC;
      try {
        listC = getConditionOptions_(ssC);
      } finally {
        lockC.releaseLock();
      }
      return jsonOut({ success: true, list: listC });
    }
    if (payload.action === 'saveConditionOptions') {
      var empIdC = String(payload.empId || '').trim();
      if (!empIdC) return jsonOut({ success: false, error: '工號遺失，請重新整理頁面確認登入狀態' });
      var listSaveC = Array.isArray(payload.list) ? payload.list : [];
      var ssC2 = SpreadsheetApp.openById(SPREADSHEET_ID);
      var lockC2 = LockService.getScriptLock();
      lockC2.waitLock(10000);
      try {
        saveConditionOptions_(ssC2, empIdC, listSaveC);
      } finally {
        lockC2.releaseLock();
      }
      return jsonOut({ success: true });
    }
    // 2026-09-20新增：車況輸入框改可打字，登記時打了選項清單裡沒有的內容就自動收進去
    if (payload.action === 'addConditionOption') {
      var empIdC3 = String(payload.empId || '').trim();
      if (!empIdC3) return jsonOut({ success: false, error: '工號遺失，請重新整理頁面確認登入狀態' });
      var valueC3 = String(payload.value || '').trim();
      if (!valueC3) return jsonOut({ success: false, error: '車況內容不可為空' });
      var ssC3 = SpreadsheetApp.openById(SPREADSHEET_ID);
      var lockC3 = LockService.getScriptLock();
      lockC3.waitLock(10000);
      try {
        addConditionOption_(ssC3, empIdC3, valueC3);
      } finally {
        lockC3.releaseLock();
      }
      return jsonOut({ success: true });
    }

    // --- 功能 H: 長期滯留車輛複檢（2026-09-20新增，只列指定類型，比對最新出現日期判斷還在/已離開）---
    if (payload.action === 'getLongTermList') {
      var typeLabelLT = String(payload.typeLabel || '').trim();
      if (!typeLabelLT) return jsonOut({ success: false, error: '缺少類型參數' });
      return jsonOut({ success: true, rows: getLongTermList_(typeLabelLT) });
    }

    // --- 功能 E: 查詢歷史登記紀錄（依日期或依車牌關鍵字）---
    // 2026-08-28 SQL遷移：優先查Supabase，失敗自動退回讀Sheets（searchVehicleLogs_含備援
    // 定義在 過夜車輛_SQL讀取層.gs，還沒貼進這個專案時用typeof防呆退回原本讀Sheets的版本）。
    if (payload.action === 'searchVehicleLogs') {
      var searchHandler = (typeof searchVehicleLogs_含備援 === 'function') ? searchVehicleLogs_含備援 : searchVehicleLogs_;
      return jsonOut(searchHandler(payload));
    }

    // --- 功能 F: 刪除一筆歷史登記紀錄（查詢歷史紀錄畫面的刪除按鈕）---
    // 2026-08-28新增：Sheets、Supabase兩邊都刪，維持雙寫架構下兩邊一致。
    if (payload.action === 'deleteVehicleLog') {
      return jsonOut(deleteVehicleLog_(payload));
    }

    // --- 功能 C: 修正已登記的車牌（辨識錯誤但已送出時，前端「最近登記」列表可就地編輯）---
    if (payload.action === 'updatePlate') {
      var ss2 = SpreadsheetApp.openById(SPREADSHEET_ID);
      var sheet2 = ss2.getSheetByName(payload.typeLabel);
      if (!sheet2) return jsonOut({ success: false, error: '找不到「' + payload.typeLabel + '」分頁' });
      var row2 = parseInt(payload.row, 10);
      if (!row2 || row2 < 2) return jsonOut({ success: false, error: '列號無效' });
      var newPlate = String(payload.plate || '').trim().toUpperCase();
      if (!newPlate) return jsonOut({ success: false, error: '車牌不可為空' });
      var newParkLocation = String(payload.parkLocation || '').trim();
      sheet2.getRange(row2, 3).setValue(newPlate); // C欄＝車牌（欄位順序見 vehicleReg：時間/類型/車牌/登記人/停放位置）
      sheet2.getRange(row2, 5).setValue(newParkLocation); // E欄＝停放位置，2026-09-20新增：辨識完的就地編輯一併支援改車格
      // 2026-08-28 SQL遷移：Supabase那份也一併更新（雙寫維持一致），失敗不影響Sheets已成功的修正。
      if (typeof supabaseRequest_ === 'function' && payload.supabaseId) {
        _syncUpdatePlateToSupabase_(payload.supabaseId, newPlate, newParkLocation);
      }
      return jsonOut({ success: true });
    }

    return jsonOut({ success: false, error: '未知動作：' + payload.action });

  } catch (err) {
    return jsonOut({ success: false, error: '後端發生錯誤: ' + err.toString() });
  }
}

// ── 台灣車牌格式提取＋正規化（套不出格式回空字串，由呼叫端 fallback）──
function extractPlate_(text) {
  var clean = String(text || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  if (!clean || clean.indexOf('NONE') >= 0) return '';
  // 台灣車牌沒有 O / I：AI 若誤判成字母，修正為數字
  clean = clean.replace(/O/g, '0').replace(/I/g, '1');
  // 由長到短比對，避免長車牌被短格式截斷
  var patterns = [
    /[A-Z]{3}-?[0-9]{4}/,      // 新式汽車 ABC-1234
    /[0-9]{4}-?[A-Z]{2,3}/,    // 4321-AB / 4321-ABC
    /[A-Z]{3}-?[0-9]{3}/,      // 新式機車 ABC-123
    /[A-Z]{2}-?[0-9]{3,4}/,    // 舊式 AB-1234 / AB-123
    /[0-9]{3}-?[A-Z]{3}/,      // 321-ABC
    /[A-Z][0-9]{2}-?[0-9]{3}/, // 電動車 E12-345
    /[0-9]{2,3}-?[A-Z]{2}/     // 舊式輕機 12-AB
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = clean.match(patterns[i]);
    if (m && m[0].replace(/-/g, '').length >= 4) {
      var p = m[0];
      // 沒有連字號時，在字母／數字交界補上（台灣車牌標準格式）
      if (p.indexOf('-') < 0) {
        for (var j = 1; j < p.length; j++) {
          var prevIsDigit = p.charCodeAt(j - 1) <= 57;
          var curIsDigit  = p.charCodeAt(j) <= 57;
          if (prevIsDigit !== curIsDigit) { p = p.slice(0, j) + '-' + p.slice(j); break; }
        }
      }
      return p;
    }
  }
  return '';
}

// ── 查詢歷史登記紀錄 ──────────────────────────
// mode='date'：查指定日期(yyyy-MM-dd)一整天；mode='plate'：查車牌關鍵字，不限日期查全部歷史。
// typeLabel 可選，不填就查三個分頁全部。結果依時間新到舊排序，最多回傳300筆避免資料量大時卡住。
var VEHICLE_TYPE_LABELS_ = ['館內機車', '館內汽車', '新莊停車場'];
var VEHICLE_SEARCH_MAX_ROWS_ = 300;

function searchVehicleLogs_(payload) {
  var mode = payload.mode;
  var typeLabel = String(payload.typeLabel || '').trim();
  var targetTypes = typeLabel ? [typeLabel] : VEHICLE_TYPE_LABELS_;

  var dateStr = String(payload.date || '').trim();
  var keyword = String(payload.keyword || '').trim().toUpperCase();
  if (mode === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { success: false, error: '請選擇有效日期' };
  }
  if (mode === 'plate' && !keyword) {
    return { success: false, error: '請輸入車牌關鍵字' };
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var rows = [];
  for (var t = 0; t < targetTypes.length; t++) {
    var sheet = ss.getSheetByName(targetTypes[t]);
    if (!sheet) continue;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues(); // 時間/類型/車牌/登記人/停放位置/(F此欄勿動不使用)/車況
    for (var i = 0; i < data.length; i++) {
      var ts = data[i][0];
      var tsStr = (ts instanceof Date) ? Utilities.formatDate(ts, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss') : String(ts || '');
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(tsStr)) continue; // 跳過表頭/空列/爛值

      if (mode === 'date') {
        if (tsStr.slice(0, 10) !== dateStr) continue;
      } else {
        var plateVal = String(data[i][2] || '').trim().toUpperCase();
        if (plateVal.indexOf(keyword) === -1) continue;
      }

      rows.push({
        time: tsStr,
        type: String(data[i][1] || targetTypes[t]),
        plate: String(data[i][2] || ''),
        operator: String(data[i][3] || ''),
        parkLocation: String(data[i][4] || ''),
        condition: String(data[i][6] || '') // index5(F欄)是此欄勿動的既有資料，跳過不讀
      });
    }
  }

  rows.sort(function (a, b) { return a.time < b.time ? 1 : (a.time > b.time ? -1 : 0); }); // 新到舊
  var truncated = rows.length > VEHICLE_SEARCH_MAX_ROWS_;
  if (truncated) rows = rows.slice(0, VEHICLE_SEARCH_MAX_ROWS_);

  return { success: true, rows: rows, truncated: truncated };
}

// 2026-08-28新增：Fisher-Yates洗牌，回傳新陣列（不動原陣列），供每次辨識隨機打亂
// 金鑰嘗試順序用，讓多把金鑰的額度消耗量比較平均，不會固定某一把先被打爆。
function shuffleArray_(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

// 輔助函式：回傳 JSON 格式
function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 2026-08-28 SQL遷移：登記時同步寫一份到Supabase（雙寫，Sheets不停用）。
// 失敗只記log、回傳null，不讓Supabase的問題影響到Sheets那邊已經成功的登記。
function _syncVehicleRegToSupabase_(typeLabel, plate, operator, timestamp, parkLocation, condition) {
  try {
    var iso = Utilities.formatDate(timestamp, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX");
    // 2026-09-19新增park_location欄、2026-09-20新增car_condition欄：Supabase那張表要先手動在
    // SQL Editor執行 alter table vehicle_overnight_logs add column if not exists xxx text;
    // 否則這裡insert會失敗（欄位不存在），失敗只記log不影響Sheets那份已經成功的登記。
    var result = supabaseRequest_('post', '/rest/v1/vehicle_overnight_logs',
      [{ type_label: typeLabel, plate: plate, operator: operator, created_at: iso, park_location: parkLocation || null, car_condition: condition || null }],
      { Prefer: 'return=representation' });
    return (result && result[0] && result[0].id) || null;
  } catch (err) {
    console.error('過夜車輛登記同步Supabase失敗：' + err.toString());
    return null;
  }
}

// 2026-08-28 SQL遷移：修正車牌時，Supabase那份（若有id）也一併更新，維持兩邊一致。
// 2026-09-20：就地編輯也支援改停放位置，一併帶進同一個patch。
// 失敗只記log，不影響Sheets那邊已經成功的修正（Sheets才是這支功能目前的主要回應依據）。
function _syncUpdatePlateToSupabase_(supabaseId, newPlate, newParkLocation) {
  if (!supabaseId) return;
  try {
    supabaseRequest_('patch', '/rest/v1/vehicle_overnight_logs?id=eq.' + encodeURIComponent(supabaseId),
      { plate: newPlate, park_location: newParkLocation || null });
  } catch (err) {
    console.error('過夜車輛修正車牌同步Supabase失敗：' + err.toString());
  }
}

// 2026-08-28新增：刪除一筆過夜車輛登記，Sheets、Supabase兩邊都刪。
// payload需要：type（分頁/type_label名稱）、time（'yyyy-MM-dd HH:mm:ss'）、plate、
// operator，以及id（若這筆是從Supabase查到的，有id定位最準；沒有id時退回用
// 時間+車牌比對找列，這種情況只會發生在Supabase查詢失敗、退回讀Sheets查到的筆）。
function deleteVehicleLog_(payload) {
  var typeLabel = String(payload.type || '').trim();
  var timeStr = String(payload.time || '').trim();
  var plate = String(payload.plate || '').trim().toUpperCase();
  var supabaseId = payload.id || null;

  var sheetDeleted = false;
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(typeLabel);
    if (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
        for (var i = data.length - 1; i >= 0; i--) {
          var rowTs = data[i][0];
          var rowTimeStr = (rowTs instanceof Date)
            ? Utilities.formatDate(rowTs, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss')
            : String(rowTs || '');
          var rowPlate = String(data[i][2] || '').trim().toUpperCase();
          if (rowTimeStr === timeStr && rowPlate === plate) {
            sheet.deleteRow(i + 2);
            sheetDeleted = true;
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('刪除過夜車輛登記(Sheets)失敗：' + err.toString());
  }

  var supabaseDeleted = false;
  if (typeof supabaseRequest_ === 'function') {
    try {
      if (supabaseId) {
        supabaseRequest_('delete', '/rest/v1/vehicle_overnight_logs?id=eq.' + encodeURIComponent(supabaseId));
      } else if (timeStr && plate && typeLabel) {
        // 沒有id（罕見：這筆是Supabase查詢失敗時退回讀Sheets查到的），用時間+車牌+
        // 類型比對刪除，三者同時吻合的機率極低會誤刪別筆。
        var iso = 轉為ISO時間戳_過夜車輛_ ? 轉為ISO時間戳_過夜車輛_(timeStr) : null;
        if (iso) {
          supabaseRequest_('delete', '/rest/v1/vehicle_overnight_logs?created_at=eq.' + encodeURIComponent(iso)
            + '&plate=eq.' + encodeURIComponent(plate) + '&type_label=eq.' + encodeURIComponent(typeLabel));
        }
      }
      supabaseDeleted = true;
    } catch (err) {
      console.error('刪除過夜車輛登記(Supabase)失敗：' + err.toString());
      supabaseDeleted = false;
    }
  }

  if (!sheetDeleted && !supabaseDeleted) {
    return { success: false, error: '兩邊都找不到這筆資料，可能已經被刪過了' };
  }
  return { success: true, sheetDeleted: sheetDeleted, supabaseDeleted: supabaseDeleted };
}

/* ═════════════════════════════════════════════
 * 每日登記摘要 Email（主管/公司看得到登記資料）
 * ─────────────────────────────────────────────
 * 統計窗：昨天 08:00 ～ 今天 08:00（涵蓋整個晚班，班別定義：晚班 20:00～隔天 08:00）
 *
 * 【啟用步驟（只要做一次）】
 * 1. 「專案設定 → 指令碼屬性」新增：
 *      名稱：SUMMARY_EMAILS   值：收件人 email（多人用逗號分隔）
 * 2. 編輯器上方函數選 setupDailyTrigger → 執行 →（首次會跳授權，全部允許）
 *    → 之後每天早上 08:00~09:00 自動寄出，不用再管
 * 3. 想馬上看效果：函數選 testDailySummary → 執行 → 收信箱
 *
 * 注意：排程吃「最新存檔」的程式，貼上存檔即可，這部分不用重新部署。
 *       專案時區務必為 Asia/Taipei（專案設定可查）。
 * ═════════════════════════════════════════════ */

var SUMMARY_EMAILS_FALLBACK = ''; // ← 不想用指令碼屬性時，把收件人貼進引號內（僅限 GAS 編輯器，勿上傳 GitHub）

function getSummaryEmails_() {
  return (PropertiesService.getScriptProperties().getProperty('SUMMARY_EMAILS') || SUMMARY_EMAILS_FALLBACK || '').trim();
}

// 建立每日 08:00 排程（重跑會先清掉舊排程，不會重複寄）
function setupDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailySummary') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('sendDailySummary').timeBased().everyDays(1).atHour(8).create();
  Logger.log('✅ 排程已建立：每天 08:00~09:00 寄出登記摘要');
}

// 立即寄一封測試（統計窗與正式版相同）
function testDailySummary() {
  sendDailySummary();
  Logger.log('✅ 測試信已寄出，請收信箱（含垃圾郵件夾）');
}

// 原本 sendDailySummary 內建的Sheets統計邏輯，2026-08-28 SQL遷移時抽成獨立函式，
// 供優先讀Supabase失敗時當備援使用（不刪，永久保留——這支工具的Sheets不停用，
// 見docs/SQL遷移規劃_過夜車輛統計.md第三節）。
function 取得過夜車輛統計資料_Sheets_(startKey, endKey) {
  var tz = 'Asia/Taipei';
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // 原本只讀 getSheets()[0]（最左邊分頁），三種類型分開存在不同分頁時
  // 只會統計到其中一頁，其他分頁的登記全部漏掉（2026-07-11發現連帶修正）。
  // 改成三種類型分頁都讀，合併統計。
  var TYPE_LABELS = ['館內機車', '館內汽車', '新莊停車場'];
  var rows = [];
  for (var s = 0; s < TYPE_LABELS.length; s++) {
    var typeSheet = ss.getSheetByName(TYPE_LABELS[s]);
    if (!typeSheet) continue;
    rows = rows.concat(typeSheet.getDataRange().getValues());
  }

  var hits = [];        // [時間, 類型, 車牌, 登記人]
  var byType = {};      // 類型 → 台數
  for (var i = 0; i < rows.length; i++) {
    var ts = rows[i][0];
    // 儲存格可能是字串或已被試算表轉成 Date，統一格式化後比對
    var key = (ts instanceof Date)
      ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd HH:mm:ss')
      : String(ts || '');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(key)) continue; // 跳過表頭/空列/爛值
    if (key < startKey || key >= endKey) continue;
    var type = String(rows[i][1] || '未分類');
    hits.push([key, type, String(rows[i][2] || ''), String(rows[i][3] || '')]);
    byType[type] = (byType[type] || 0) + 1;
  }
  hits.sort(); // 依時間排序
  return { hits: hits, byType: byType };
}

function sendDailySummary() {
  var emails = getSummaryEmails_();
  if (!emails) throw new Error('收件人未設定：請在「專案設定 → 指令碼屬性」新增 SUMMARY_EMAILS（多人用逗號分隔）');

  var tz  = 'Asia/Taipei';
  var now = new Date();
  // 時間戳存的是 'yyyy-MM-dd HH:mm:ss' 台北時間字串 → 直接用字串比大小，避開時區換算陷阱
  var todayStr     = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var yesterdayStr = Utilities.formatDate(new Date(now.getTime() - 86400000), tz, 'yyyy-MM-dd');
  var startKey = yesterdayStr + ' 08:00:00';
  var endKey   = todayStr     + ' 08:00:00';

  // 2026-08-28 SQL遷移：優先查Supabase（區間查詢，不受歷史資料量影響），失敗
  // 自動退回原本整表撈Sheets篩選當天窗口的舊邏輯（見docs/SQL遷移規劃_過夜車輛統計.md
  // 第三節——這封信是稽核用途，兩邊都失敗才會真的寄不出去，機率極低）。
  var stat;
  if (typeof 取得過夜車輛統計資料_SQL_ === 'function') {
    try {
      var startISO = Utilities.formatDate(toDate_(startKey), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
      var endISO = Utilities.formatDate(toDate_(endKey), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
      stat = 取得過夜車輛統計資料_SQL_(startISO, endISO);
    } catch (err) {
      console.error('每日摘要查Supabase失敗，退回讀Sheets：' + err.toString());
      stat = 取得過夜車輛統計資料_Sheets_(startKey, endKey);
    }
  } else {
    stat = 取得過夜車輛統計資料_Sheets_(startKey, endKey);
  }
  var hits = stat.hits;      // [時間, 類型, 車牌, 登記人]
  var byType = stat.byType;  // 類型 → 台數

  var dateLabel = yesterdayStr.slice(5).replace('-', '/') + ' 08:00 ～ ' + todayStr.slice(5).replace('-', '/') + ' 08:00';
  var subject = '【天鷹保全】過夜車輛登記摘要 ' + dateLabel + '（共 ' + hits.length + ' 台）';
  var sheetUrl = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID;

  // 統計列
  var statHtml = '';
  for (var t in byType) {
    statHtml += '<span style="display:inline-block;margin:0 12px 6px 0;padding:4px 12px;background:#FFF7DB;border:1px solid #E5C84A;border-radius:14px;font-size:13px;color:#7A6200;">' +
                t + '：<b>' + byType[t] + '</b> 台</span>';
  }
  if (!statHtml) statHtml = '<span style="font-size:13px;color:#888;">本時段無登記紀錄</span>';

  // 明細表
  var trHtml = '';
  for (var j = 0; j < hits.length; j++) {
    trHtml += '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #EEE;font-size:13px;">' + hits[j][0].slice(11, 16) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #EEE;font-size:13px;">' + hits[j][1] + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #EEE;font-size:14px;font-weight:bold;letter-spacing:1px;">' + hits[j][2] + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #EEE;font-size:13px;color:#666;">' + hits[j][3] + '</td>' +
      '</tr>';
  }
  var tableHtml = hits.length
    ? '<table style="border-collapse:collapse;width:100%;max-width:520px;margin-top:14px;">' +
      '<tr style="background:#1A1C22;color:#FFD700;">' +
      '<th style="padding:8px 10px;font-size:12px;text-align:left;">時間</th>' +
      '<th style="padding:8px 10px;font-size:12px;text-align:left;">類型</th>' +
      '<th style="padding:8px 10px;font-size:12px;text-align:left;">車牌</th>' +
      '<th style="padding:8px 10px;font-size:12px;text-align:left;">登記人</th>' +
      '</tr>' + trHtml + '</table>'
    : '';

  var htmlBody =
    '<div style="font-family:\'Microsoft JhengHei\',sans-serif;max-width:560px;">' +
    '<div style="padding:14px 18px;background:#0A0C10;border-radius:10px 10px 0 0;">' +
    '<div style="color:#D4A800;font-size:17px;font-weight:bold;letter-spacing:2px;">🦅 天鷹保全 · 過夜車輛登記摘要</div>' +
    '<div style="color:#8A95A8;font-size:12px;margin-top:4px;">' + dateLabel + '（晚班全時段）</div>' +
    '</div>' +
    '<div style="padding:16px 18px;border:1px solid #E5E5E5;border-top:none;border-radius:0 0 10px 10px;">' +
    '<div style="font-size:14px;margin-bottom:10px;">合計 <b style="font-size:18px;color:#B8860B;">' + hits.length + '</b> 台</div>' +
    statHtml + tableHtml +
    '<div style="margin-top:16px;"><a href="' + sheetUrl + '" style="font-size:13px;color:#1A73E8;">📊 開啟完整登記試算表</a></div>' +
    '<div style="margin-top:10px;font-size:11px;color:#AAA;">此信由系統每日 08:00 自動寄出 · TIANYING SECURITY</div>' +
    '</div></div>';

  MailApp.sendEmail({ to: emails, subject: subject, htmlBody: htmlBody });
}
