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
// 依序嘗試（前面額度爆/不存在自動換下一個）。免費額度大的排前面：
//   2.0-flash 與 2.0-flash-lite 每日額度較高，2.5-flash 額度小放後面備援
var MODELS      = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];
var PROP_KEY    = 'GEMINI_API_KEY';   // API Key 屬性名
var PROP_RULES  = 'AI_ADMIN_RULES';   // 管理員自訂禁止規則
var PROP_LEVEL  = 'AI_FORCE_LEVEL';   // 強制表達層級：auto/simple/normal

// ── 即時資料來源（小天鷹查資料用）──
var SCHEDULE_GAS_URL = 'https://script.google.com/macros/s/AKfycbzs56InZLeaHiRJhy1alNfQwDyH0mXEV9t_WJxzfjTjIhf68DHgMiWVQvVG6vKrRZ2x1w/exec'; // 班表 GAS（?action=getSchedule&shift=）
var WORK_SHEET_ID    = '1QuNkwu9zgPidUfSgWpqyT1M9X683IU-0LhXTc23hw-A'; // 施工單試算表
var WORK_SHEET_NAME  = '施工單查詢';   // 施工單分頁名

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

  // ── 即時查資料：依關鍵字抓班表／施工單真實資料，塞進參考資料 ──
  var dataCtx = buildDataContext(message);
  if (dataCtx) {
    systemText += '\n\n【以下是系統剛剛查到的「真實即時資料」，回答相關問題時務必根據這些資料，' +
                  '不可以自己編造。資料裡沒有的就照誠實原則說查不到】\n' + dataCtx;
  }

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

  // 依序嘗試模型清單：模型不存在(404) 或 額度爆掉(429) 就換下一個（每個模型額度分開算）
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
    // 404=模型不存在、429=額度上限 → 換下一個模型試；其他錯誤（如金鑰無效）不必再試
    if (code !== 404 && code !== 429) break;
  }

  if (code !== 200) {
    // 全部模型都額度爆 → 給友善訊息，不丟英文
    if (code === 429) return err('小天鷹現在比較忙（免費額度用量較高），休息一下下再問我一次喔 🦅');
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
    '- 查今天誰上班、班表、班別時間（系統會把即時班表資料給你）\n' +
    '- 查今天/明天的施工單（哪些廠商進場、施工項目、進退場時間、監工）\n' +
    '- 工作 SOP（巡邏、交接班、緊急事件怎麼處理）\n' +
    '- 事故報告怎麼填、請假怎麼申請\n' +
    '- APP 各工具怎麼用（打烊登錄、開店登錄、停車位計算等）\n' +
    '※ 當有人問班表或施工單，下方「真實即時資料」區會附上查到的資料，' +
    '你要根據那些資料回答；若該區沒有對應資料，就老實說查不到、請他直接看對應工具。\n\n' +
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

/* ════════════════════════════════════════════════
   即時查資料（班表 / 施工單）
   依使用者問題的關鍵字決定要抓哪種資料，回傳純文字塞進 prompt
   ════════════════════════════════════════════════ */
function buildDataContext(msg) {
  var m = String(msg || '');
  var parts = [];
  // 班表 / 誰上班 / 值班 / 班別 / 休假
  if (/班表|上班|值班|班別|當班|誰.*班|今天.*班|早班|晚班|排班|休假|放假|誰在|有誰/.test(m)) {
    try { var sc = getScheduleContext(); if (sc) parts.push(sc); } catch (e) {}
  }
  // 施工單 / 廠商進出 / 動火
  if (/施工|廠商|進場|退場|施工單|動火|工程|維修|裝潢|進出/.test(m)) {
    try { var wc = getWorkContext(); if (wc) parts.push(wc); } catch (e) {}
  }
  return parts.join('\n\n');
}

// ── 班表：抓早晚班，算今天誰上班 + 附完整月班表 ──
function getScheduleContext() {
  var today = new Date();
  var d = today.getDate();
  var WORK = { B:'20:00-08:00', 海:'22:00-10:00', 見:'20:00-08:00', N:'20:00-24:00',
               A:'08:00-20:00', S:'08:00-16:00', L:'12:00-20:00', H:'11:00-22:00',
               H2:'11:00-22:30', LN:'12:00-24:00' };
  var week = '日一二三四五六'.charAt(today.getDay());
  var lines = ['【今天日期】' + (today.getMonth()+1) + '/' + d + '（星期' + week + '）'];
  var got = false;

  ['morning','night'].forEach(function(shift){
    var rows = fetchSchedule(shift);
    if (!rows || !rows.length) return;
    got = true;
    var label = (shift === 'morning') ? '早班' : '晚班';
    var onduty = [], grid = [];
    rows.forEach(function(r){
      var name = String(r.name||'').trim();
      if (!name || name.length < 2 || /^\d/.test(name)) return;
      var shifts = r.shifts || [];
      var code = String(shifts[d-1]==null?'':shifts[d-1]).trim();
      if (WORK[code]) onduty.push(name + '(' + code + '班 ' + WORK[code] + ')');
      var seq = shifts.map(function(v){ var t=String(v==null?'':v).trim(); return t||'-'; }).join(' ');
      grid.push(name + (r.roleStr ? ('['+r.roleStr+']') : '') + '：' + seq);
    });
    lines.push('【今天'+label+'有上班的人】' + (onduty.length ? onduty.join('、') : '（查無人上班）'));
    lines.push('【本月'+label+'完整班表｜每人從1號排到月底，- = 空白】\n' + grid.join('\n'));
  });

  if (!got) return '【班表】目前連不到班表資料，請稍後再試或直接看班表查詢工具。';
  lines.push('【班別代號】A=08:00-20:00, S=08:00-16:00, L=12:00-20:00, H=11:00-22:00, H2=11:00-22:30, LN=12:00-24:00, B=20:00-08:00(晚班), 海=22:00-10:00, N=20:00-24:00, 見=見習; 休/排休/事/病/補/國例/離 = 沒上班(休假/請假/離職)');
  return lines.join('\n');
}
function fetchSchedule(shift) {
  try {
    var resp = UrlFetchApp.fetch(SCHEDULE_GAS_URL + '?action=getSchedule&shift=' + shift,
                                 { muteHttpExceptions: true });
    var d = JSON.parse(resp.getContentText());
    return (d && d.success && d.rows) ? d.rows : null;
  } catch (e) { return null; }
}

// ── 施工單：抓今天、明天的施工列 ──
function getWorkContext() {
  var data = fetchGviz(WORK_SHEET_ID, WORK_SHEET_NAME);
  if (!data || !data.rows) return '【施工單】目前連不到施工單資料，請稍後再試。';
  var today = new Date(), tm = today.getMonth()+1, td = today.getDate();
  var tmr = new Date(today.getTime() + 86400000), nm = tmr.getMonth()+1, nd = tmr.getDate();
  var dateIdx = data.labels.indexOf('施工日期');
  var picked = [];
  data.rows.forEach(function(row){
    var md = (dateIdx >= 0) ? parseGvizDate(row[dateIdx]) : null;
    if (!md) return;
    var tag = (md.m===tm && md.d===td) ? '今天' : ((md.m===nm && md.d===nd) ? '明天' : '');
    if (!tag) return;
    var fields = [];
    data.labels.forEach(function(lb, i){
      var v = fmtCell(row[i]);
      if (lb && v) fields.push(lb + '=' + v);
    });
    picked.push('[' + tag + '] ' + fields.join('，'));
  });
  if (!picked.length) return '【今明兩天的施工單】今天和明天目前查不到施工資料。';
  return '【今明兩天的施工單（真實資料）】\n' + picked.join('\n');
}
function fetchGviz(id, sheet) {
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + id +
              '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(sheet);
    var txt = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
    var s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    var obj = JSON.parse(txt.substring(s, e+1));
    var table = obj.table || {};
    var labels = (table.cols||[]).map(function(c,i){ return c.label || c.id || ('col'+i); });
    var rows = (table.rows||[]).map(function(r){
      return (r.c||[]).map(function(c){ return c ? c.v : null; });
    });
    return { labels: labels, rows: rows };
  } catch (e) { return null; }
}
// gviz 日期值常為字串 "Date(2026,5,29)"（月份從0起算）
function parseGvizDate(v) {
  if (v == null) return null;
  var s = String(v);
  var mm = s.match(/Date\((\d+),(\d+),(\d+)/);
  if (mm) return { m: parseInt(mm[2],10)+1, d: parseInt(mm[3],10) };
  var m2 = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return { m: parseInt(m2[1],10), d: parseInt(m2[2],10) };
  return null;
}
function fmtCell(v) {
  if (v == null) return '';
  var s = String(v);
  var mm = s.match(/Date\((\d+),(\d+),(\d+)/);
  if (mm) return (parseInt(mm[2],10)+1) + '/' + parseInt(mm[3],10);
  return s;
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
