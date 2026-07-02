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
