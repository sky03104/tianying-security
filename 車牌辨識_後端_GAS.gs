/**
 * 天鷹保全 · 車牌辨識系統 後端 GAS（獨立部署）
 * ─────────────────────────────────────────────
 * 以「已驗證可辨識」的版本為基準，API 請求方式完全相同
 * （gemini-flash-latest、key 放 URL 參數解決 AQ 金鑰 OAuth 報錯）。
 *
 * 【API Key 設定：兩種方式擇一，屬性優先】
 *   方式一（推薦）：GAS「專案設定 → 指令碼屬性」新增
 *     名稱：GEMINI_API_KEY   值：你的 key（AQ. 或 AIzaSy 開頭皆可）
 *   方式二：直接把 key 貼進下方 API_KEY_FALLBACK 的引號內
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

// 取金鑰：指令碼屬性 GEMINI_API_KEY 優先，沒有就用上面的備用常數
function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || API_KEY_FALLBACK || '';
}

// ── 狀態頁（直接點開網址時顯示，並自我檢查金鑰）──
function doGet() {
  var key = getApiKey_();
  var keyStatus = key
    ? '✅ API Key 已設定（' + key.slice(0, 4) + '…，來源：' +
      (PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') ? '指令碼屬性' : '程式碼備用欄') + '）'
    : '❌ API Key 未設定！請到「專案設定 → 指令碼屬性」新增 GEMINI_API_KEY，或貼進程式碼 API_KEY_FALLBACK';
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
      var apiKey = getApiKey_();
      if (!apiKey) return jsonOut({ success: false, error: 'API Key 未設定：請開 /exec 網址查看設定說明' });

      // 解決 AQ 金鑰 OAuth 報錯：將 key 放在 URL 參數（與已驗證版本相同）
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;

      // 清洗 Base64 資料
      var cleanBase64 = payload.imageBase64.split(',')[1] || payload.imageBase64;

      var apiPayload = {
        "contents": [{
          "parts": [
            { "text": "你是一個專業車牌辨識員。請辨識圖中的車牌號碼，只回傳號碼文字（如 ABC-1234）。其餘文字都不填。若看不清回 NONE。" },
            { "inline_data": { "mime_type": "image/jpeg", "data": cleanBase64 }}
          ]
        }],
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

      var res = UrlFetchApp.fetch(url, options);
      var resText = res.getContentText();
      var result = JSON.parse(resText);

      if (result.error) {
        return jsonOut({ success: false, error: "API 報錯: " + result.error.message });
      }

      if (result.candidates && result.candidates[0] && result.candidates[0].content) {
        var raw = result.candidates[0].content.parts[0].text.trim().toUpperCase();
        if (raw !== "" && !raw.includes("NONE")) {
          // 先嘗試套台灣車牌格式正規化（補連字號、O→0、I→1）；
          // 套不出格式就照原樣回傳（與已驗證版本行為一致，絕不比它更嚴格）
          var plate = extractPlate_(raw) || raw.replace(/[^A-Z0-9\-]/g, '');
          if (plate) return jsonOut({ success: true, plate: plate, raw: raw });
        }
      }
      return jsonOut({ success: false, error: "辨識失敗：請確保照片清晰且包含車牌" });
    }

    // --- 功能 B: 資料登記到試算表 ---
    if (payload.action === 'vehicleReg') {
      var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      var sheet = ss.getSheets()[0];
      var timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
      sheet.appendRow([
        timestamp,
        payload.typeLabel,
        payload.plate,
        "'" + (payload.operator || '未登入')  // ' 前綴：工號純數字，防試算表吃掉開頭 0
      ]);
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

// 輔助函式：回傳 JSON 格式
function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
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

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  var rows = sheet.getDataRange().getValues();

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
