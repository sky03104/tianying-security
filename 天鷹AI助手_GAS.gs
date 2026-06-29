/**
 * 天鷹保全 AI 小助手（小天鷹）後端 GAS
 * ─────────────────────────────────────────────
 * 角色：小天鷹（對員工自我介紹用的名字）
 * 功能：Gemini 1.5 Flash Proxy，保護 API Key + 注入人性化 system prompt
 *
 * 【部署前準備】
 * 1. 取得 Gemini API Key：https://aistudio.google.com → Get API key → Create
 * 2. 本專案「專案設定 → 指令碼屬性」新增：
 *      名稱：GEMINI_API_KEY   值：你的 key（AIzaSy...）
 * 3. 「部署 → 新增部署 → 網頁應用程式」
 *      執行身分：我（擁有者）   存取權：任何人
 *    複製 /exec 網址，貼進 tool_ai_chat.html 的 GAS_URL
 *
 * 【動作 action】
 *   chat       一般員工對話（傳 message/history/role/vocabLevel）
 *   getConfig  管理員讀取目前小天鷹設定（需 role===admin）
 *   saveConfig 管理員儲存設定（禁止規則 + 強制表達層級，需 role===admin）
 * ───────────────────────────────────────────── */

// ── 設定常數 ──────────────────────────────────
// 依序嘗試（新金鑰 gemini-1.5 已停用，改用 2.x；前面失敗自動換下一個）
var MODELS      = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
var PROP_KEY    = 'GEMINI_API_KEY';   // API Key 屬性名
var PROP_RULES  = 'AI_ADMIN_RULES';   // 管理員自訂禁止規則
var PROP_LEVEL  = 'AI_FORCE_LEVEL';   // 強制表達層級：auto/simple/normal

// ── 主入口（POST）──────────────────────────────
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action  = payload.action;

    switch (action) {
      case 'chat':       return handleChat(payload);
      case 'getConfig':  return handleGetConfig(payload);
      case 'saveConfig': return handleSaveConfig(payload);
      default:           return err('未知動作：' + action);
    }
  } catch (e2) {
    return err('伺服器錯誤：' + e2.message);
  }
}

// 健康檢查（瀏覽器直接開 /exec 會看到）
function doGet() {
  return out({ status: 'ok', msg: '小天鷹後端運作中 🦅' });
}

// ── 對話 ──────────────────────────────────────
function handleChat(p) {
  var message    = p.message || '';
  var history    = p.history || [];
  var role       = p.role || 'fulltime';
  var vocabLevel = p.vocabLevel || 'simple';

  if (!message) return err('訊息為空');

  var apiKey = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
  if (!apiKey) return err('API Key 未設定，請聯絡管理員');

  // 管理員可覆蓋表達層級
  var forceLevel = PropertiesService.getScriptProperties().getProperty(PROP_LEVEL) || 'auto';
  if (forceLevel !== 'auto') vocabLevel = forceLevel;

  var systemText = buildSystemPrompt(role, vocabLevel);

  // 組多輪對話（最多保留最近 10 輪，避免 token 過大 / 逾時）
  var contents = [];
  var recent = history.slice(-10);
  for (var i = 0; i < recent.length; i++) {
    var h = recent[i];
    if (!h || !h.text) continue;
    contents.push({ role: (h.role === 'model' ? 'model' : 'user'), parts: [{ text: h.text }] });
  }
  contents.push({ role: 'user', parts: [{ text: message }] });

  var reqBody = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: contents,
    generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
  };

  // 依序嘗試模型清單，遇到「模型不存在(404)」就換下一個；其他錯誤直接回報
  var data = null, code = 0, lastErr = '';
  for (var mi = 0; mi < MODELS.length; mi++) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              MODELS[mi] + ':generateContent?key=' + apiKey;
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(reqBody),
      muteHttpExceptions: true
    });
    code = resp.getResponseCode();
    data = JSON.parse(resp.getContentText());
    if (code === 200) break;
    lastErr = (data.error && data.error.message) ? data.error.message : ('HTTP ' + code);
    // 404 = 該模型不存在，換下一個；其他錯誤（如金鑰無效）不必再試
    if (code !== 404) break;
  }

  if (code !== 200) {
    return err('AI 服務暫時無法使用（' + lastErr + '）');
  }

  // 安全過濾被擋 / 無回應
  if (!data.candidates || !data.candidates[0] ||
      !data.candidates[0].content || !data.candidates[0].content.parts) {
    return err('這個問題我沒辦法回答，換個方式問問看？');
  }

  var aiText = data.candidates[0].content.parts[0].text;
  return ok({ reply: aiText });
}

// ── system prompt 組裝（人性化 + 權限 + 表達層級）──
function buildSystemPrompt(role, vocabLevel) {
  // 表達層級
  var levelText = {
    simple:   '用小學生也聽得懂的方式說明，避免任何專業術語，多舉生活化的例子。句子短、講重點。',
    normal:   '用清楚的口語說明，偶爾可用簡單專業詞但要附上白話解釋。',
    advanced: '可用較正式的表達，但仍保持口語、好懂。'
  }[vocabLevel] || levelText_simple();

  // 權限層級
  var isManager = (role === 'leader' || role === 'vicecaptain' || role === 'captain' ||
                   role === 'executive' || role === 'admin');
  var isExec    = (role === 'executive' || role === 'admin');

  var permText;
  if (isExec) {
    permText = '這位使用者是公司主管／管理員，可以回答所有工作相關問題，包含管理、出勤、排班等。' +
               '但仍要遵守保密原則：不可透露個別員工的薪資、私人聯絡資料、個人隱私。';
  } else if (isManager) {
    permText = '這位使用者是帶班幹部（組長／副隊長／隊長），除了一般問題，' +
               '也可協助班組管理、出勤查詢等。不可透露薪資與個人隱私。';
  } else {
    permText = '這位使用者是一般保全員。協助回答自己的班表、請假、工作 SOP、APP 使用問題。' +
               '不要回答別人的個資、薪資、管理層才能看的資料。';
  }

  // 管理員自訂禁止規則
  var rules = PropertiesService.getScriptProperties().getProperty(PROP_RULES) || '';
  var rulesText = rules ? ('\n\n【管理員額外規定，務必遵守】\n' + rules) : '';

  return '你是「小天鷹」，天鷹保全公司的 AI 助手 🦅。\n' +
    '第一次跟人打招呼時可以說「我是小天鷹，天鷹保全的 AI 助手 🦅」。\n\n' +
    '【你的工作】協助保全同事解決工作問題：\n' +
    '- 工作 SOP（巡邏、交接班、緊急事件怎麼處理）\n' +
    '- 事故報告怎麼填、班表怎麼看、請假怎麼申請\n' +
    '- APP 各工具怎麼用（打烊登錄、開店登錄、停車位計算等）\n\n' +
    '【說話方式，超重要】\n' +
    '- 我們同事有些年紀比較大、有些學歷不高，' + levelText + '\n' +
    '- 語氣像隔壁熱心同事，親切、自然，不要官腔。\n' +
    '- 一律用繁體中文。\n\n' +
    '【誠實原則，絕對遵守】\n' +
    '- 如果你不知道、查不到，就直接老實說「這個我不太清楚，建議去問主管」，' +
    '絕對不可以亂掰、不可以編造資料。\n' +
    '- 如果同事的問題不清楚，主動反問引導他，例如「你是說哪一個工具？是打烊登錄還是事故報告？」\n\n' +
    '【權限】' + permText + rulesText;
}

function levelText_simple() {
  return '用小學生也聽得懂的方式說明，避免任何專業術語，多舉生活化的例子。';
}

// ── 管理員：讀設定 ────────────────────────────
function handleGetConfig(p) {
  if (p.role !== 'admin') return err('只有管理員可以開啟設定');
  var props = PropertiesService.getScriptProperties();
  return ok({
    rules: props.getProperty(PROP_RULES) || '',
    forceLevel: props.getProperty(PROP_LEVEL) || 'auto'
  });
}

// ── 管理員：存設定 ────────────────────────────
function handleSaveConfig(p) {
  if (p.role !== 'admin') return err('只有管理員可以修改設定');
  var props = PropertiesService.getScriptProperties();
  if (typeof p.rules === 'string')      props.setProperty(PROP_RULES, p.rules);
  if (typeof p.forceLevel === 'string') props.setProperty(PROP_LEVEL, p.forceLevel);
  return ok({ msg: '小天鷹設定已更新' });
}

// ── 統一回應格式 ──────────────────────────────
function ok(data) {
  var obj = { status: 'ok' };
  for (var k in data) obj[k] = data[k];
  return out(obj);
}
function err(msg) { return out({ status: 'error', msg: msg }); }
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
