/**
 * 天鷹保全 · 車牌辨識系統 後端 GAS（獨立部署）
 * ─────────────────────────────────────────────
 * 功能：
 *   recognizePlate  Gemini Vision 車牌辨識（回 {success, plate, raw}）
 *   vehicleReg      登記寫入本 GAS 綁定的車輛登記試算表
 *
 * 【重要：API Key 不可硬編在程式碼裡】
 *   本 repo 是公開的 GitHub Pages，金鑰寫在這裡等於直接外洩。
 *   請在 GAS「專案設定 → 指令碼屬性」新增：
 *     名稱：GEMINI_API_KEY   值：你的 key（AQ. 或 AIzaSy 開頭皆可）
 *   貼上本檔後，把舊版硬編的 API_KEY 那行刪掉。
 *
 * 【部署】
 *   改完程式 →「部署 → 管理部署作業 → 編輯 → 版本：新版本」
 *   （不要「新增部署」，網址會變，前端全斷）
 *   執行身分：我（擁有者）／存取權：任何人
 *
 * 【前端對接】（tool_signin.html 與 index.html 內嵌 tpl-signin）
 *   PLATE_GAS_URL = 本部署的 /exec 網址
 * ───────────────────────────────────────────── */

// ── 設定 ──────────────────────────────────────
var SPREADSHEET_ID = '1K46ZEq2zbh7Jw5yv3X9aPgyjWZF43ZUJfjc-x-xunnQ'; // 車輛登記試算表
var PROP_KEY       = 'GEMINI_API_KEY';                               // 金鑰放指令碼屬性
// 依序嘗試：2.5-flash-lite 最快且免費額度最大(1000 RPD)，額度爆/不存在自動換下一個
var MODELS         = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];

// ── 狀態頁（直接點開網址時顯示，避免報錯）──────
function doGet() {
  return HtmlService.createHtmlOutput(
    '<h1>🚗 車牌辨識系統後端運行中</h1>' +
    '<p>請從 GitHub 前端頁面進行操作。若看到此頁面，代表後端部署成功。</p>'
  );
}

// ── 主入口（POST）──────────────────────────────
function doPost(e) {
  try {
    var body = e.postData ? e.postData.contents : null;
    if (!body) return jsonOut({ success: false, error: '未收到資料' });
    var payload = JSON.parse(body);

    if (payload.action === 'recognizePlate') return recognizePlate_(payload);
    if (payload.action === 'vehicleReg')     return vehicleReg_(payload);

    return jsonOut({ success: false, error: '未知動作：' + payload.action });
  } catch (err) {
    return jsonOut({ success: false, error: '後端發生錯誤: ' + err.toString() });
  }
}

// ── 功能 A：車牌辨識（Gemini Vision）────────────
function recognizePlate_(payload) {
  var apiKey = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
  if (!apiKey) return jsonOut({ success: false, error: 'API Key 未設定：請在「專案設定 → 指令碼屬性」新增 GEMINI_API_KEY' });

  if (!payload.imageBase64) return jsonOut({ success: false, error: '沒有收到照片，請重新拍攝' });
  // 清洗 Base64 資料（容忍前端帶 data:image/jpeg;base64, 前綴）
  var cleanBase64 = payload.imageBase64.split(',')[1] || payload.imageBase64;

  var apiPayload = {
    contents: [{
      parts: [
        { text: '你是一個專業車牌辨識員。請辨識圖中的台灣車牌號碼，只回傳號碼文字（如 ABC-1234），其餘文字都不填。' +
                '注意：台灣車牌沒有字母 O（一律是數字 0）、也沒有字母 I（一律是數字 1）。若看不清回 NONE。' },
        { inline_data: { mime_type: payload.mimeType || 'image/jpeg', data: cleanBase64 } }
      ]
    }],
    // 溫度 0 + 小 token 上限 + 關閉思考：結果穩定且回應最快
    generationConfig: { maxOutputTokens: 64, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',      threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  // 依序嘗試模型：400/404/429 換下一個（各模型免費額度分開算），其他錯誤（如金鑰無效）直接停
  var result = null, code = 0, lastErr = '';
  for (var mi = 0; mi < MODELS.length; mi++) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              MODELS[mi] + ':generateContent?key=' + apiKey;
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(apiPayload),
      muteHttpExceptions: true
    });
    code = res.getResponseCode();
    result = JSON.parse(res.getContentText());
    if (code === 200) break;
    lastErr = (result.error && result.error.message) ? result.error.message : ('HTTP ' + code);
    if (code !== 400 && code !== 404 && code !== 429) break;
  }

  if (code !== 200) {
    if (code === 429) return jsonOut({ success: false, error: '辨識服務目前用量較高，請稍等幾秒再拍一次' });
    return jsonOut({ success: false, error: 'API 報錯: ' + lastErr });
  }

  var raw = '';
  if (result.candidates && result.candidates[0] && result.candidates[0].content &&
      result.candidates[0].content.parts && result.candidates[0].content.parts[0]) {
    raw = String(result.candidates[0].content.parts[0].text || '').trim();
  }

  var plate = extractPlate_(raw);
  if (plate) return jsonOut({ success: true, plate: plate, raw: raw });
  return jsonOut({ success: false, error: '辨識失敗：請確保照片清晰且包含車牌', raw: raw });
}

// ── 台灣車牌格式提取＋正規化（AI 回應 → 標準車牌）──
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

// ── 功能 B：資料登記到試算表 ────────────────────
function vehicleReg_(payload) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  var timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    timestamp,
    payload.typeLabel || '',
    String(payload.plate || '').toUpperCase(),
    "'" + (payload.operator || '未登入')  // ' 前綴：工號純數字，防試算表吃掉開頭 0
  ]);
  return jsonOut({ success: true });
}

// ── 輔助：回傳 JSON 格式 ────────────────────────
function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
