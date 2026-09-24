// ════════════════════════════════════════════════════════════
// 天鷹保全 · 施工單管理 SQL遷移【tool_work.html 搜尋/歷史查詢】
// ────────────────────────────────────────────────────────────
// 用途：取代 tool_work.html 目前「整表gviz下載回瀏覽器自己篩選」的
// 做法，改成把篩選條件送給GAS，GAS查Supabase只回需要的列。
//
// 設計重點：回傳格式**刻意組成跟gviz table一模一樣的JSON結構**
// （{cols:[...], rows:[{c:[{v:...}]}]}），front-end既有的
// parseGvizTable()/dedupeRows()/filterRows()/cardHtml() 完全不用改，
// 只需要換「資料從哪裡來」這一步，把前端改動風險降到最低。
//
// 三種查詢模式：
//   mode='active'：初次載入用，抓「近期會用到」的範圍：退場日期或施工日期
//     在今天往前7天之後的（含進行中的長期單與全部未來申請），
//     涵蓋今天/明天/已申請三個分頁需求，不用整表下載。
//   mode='date'：歷史分頁指定日期，精確比對 work_date。
//   mode='search'：歷史分頁輸入關鍵字，對主要文字欄位做ILIKE搜尋
//     （不限日期範圍，搜全部歷史）。
// ════════════════════════════════════════════════════════════

// 往前抓多少天。2026-09-24 由 35 天改 7 天：進行中的長期單靠 exit_date 抓得到，
// 「歷史」分頁預設只看近三日，其餘靠 date/search 模式另查。
// 實測正式庫（narilpgjmjncladkquly）：施工單 35天=1631筆→7天=574筆，
// 低於 Supabase 單次上限 1000 筆，一趟就抓完不用分頁；並用 SQL 驗證過
// 「今天/明天/已申請/近三日」會用到的列，改 7 天後漏掉 0 筆。
var 搜尋回溯天數_ = 7;

// 只抓畫面用得到的欄位（不抓 dedupe_key／created_at，dedupe_key 是整串長文字，回傳量差很多）
var 施工單欄位_ = 'id,apply_unit,vendor,work_date,entry_time,exit_time,headcount,supervisor,location,item,exit_date,note,checked_in_at';

function 施工單日期字串_(d) {
  return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
}

// 把Supabase查到的列，轉成跟gviz table一樣的JSON結構
function 轉為gviz表_(rows, isHot) {
  var cols = [
    { label: 'ID', type: 'number' },
    { label: '申請單位', type: 'string' },
    { label: '廠商專櫃名稱', type: 'string' },
    { label: '月', type: 'number' },
    { label: '日', type: 'number' },
    { label: '進場時間輸入', type: 'string' },
    { label: '退場時間輸入', type: 'string' },
    { label: '人數', type: 'number' },
    { label: '監工', type: 'string' },
    { label: '施工地點', type: 'string' },
    { label: '施工項目', type: 'string' },
    { label: '施工日期', type: 'date' },
    { label: '退場日期', type: 'date' },
    { label: '備註', type: 'string' }
  ];

  var outRows = rows.map(function (r) {
    var wd = r.work_date ? r.work_date.split('-').map(Number) : null;
    var xdStr = r.exit_date || r.work_date;
    var xd = xdStr ? xdStr.split('-').map(Number) : null;
    // 動火申請沒有獨立的備註欄，前端把「動火器具」放在備註欄位置顯示
    // （見cardHtml的isHot&&note邏輯），這裡對應同一套約定
    var noteVal = isHot ? (r.equipment || '') : (r.note || '');
    var checkinStr = r.checked_in_at
      ? Utilities.formatDate(new Date(r.checked_in_at), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')
      : '';

    var cells = [
      { v: r.id },
      { v: r.apply_unit || '' },
      { v: r.vendor || '' },
      { v: wd ? wd[1] : null },
      { v: wd ? wd[2] : null },
      { v: r.entry_time || '' },
      { v: r.exit_time || '' },
      { v: r.headcount },
      { v: r.supervisor || '' },
      { v: r.location || '' },
      { v: r.item || '' },
      { v: wd ? ('Date(' + wd[0] + ',' + (wd[1] - 1) + ',' + wd[2] + ')') : null },
      { v: xd ? ('Date(' + xd[0] + ',' + (xd[1] - 1) + ',' + xd[2] + ')') : null },
      { v: noteVal },
      // 第15格（索引14）＝O欄報到時間戳，前端直接讀row.c[14]不看標題名稱
      { v: checkinStr }
    ];
    return { c: cells };
  });

  return { cols: cols, rows: outRows };
}

function getWorkOrders_SQL(sheetName, mode, search, histDate) {
  var isHot = (sheetName === '動火申請查詢');
  var table = isHot ? 'fire_permits' : 'construction_orders';
  var path;

  if (mode === 'date' && histDate) {
    path = '/rest/v1/' + table + '?work_date=eq.' + histDate;
  } else if (mode === 'search' && search) {
    var q = '*' + search.trim() + '*';
    var fields = ['apply_unit', 'vendor', 'supervisor', 'location', 'item'];
    if (isHot) fields.push('equipment'); else fields.push('note');
    var orClause = fields.map(function (f) { return f + '.ilike.' + encodeURIComponent(q); }).join(',');
    path = '/rest/v1/' + table + '?or=(' + orClause + ')&limit=500';
  } else {
    // active：近期會用到的範圍
    // 2026-09-24 修正：原本只看「施工日期(work_date)」落在 今天-35天～今天+120天，
    //   長期施工單（例如 4/23～12/31 的每週進貨）開始日期早就超過 35 天，
    //   明明今天還在施工區間內，卻會從「今天／明天」分頁消失。
    //   改成：退場日期還沒超過回溯範圍（進行中的長期單）或 施工日期在回溯範圍內（近期＋所有未來申請）。
    //   不再設未來上限——「已申請」分頁要看全部未來申請，未來的筆數本來就不多。
    var today = new Date();
    var lower = new Date(today.getTime()); lower.setDate(lower.getDate() - 搜尋回溯天數_);
    var lowerStr = 施工單日期字串_(lower);
    path = '/rest/v1/' + table
      + '?or=(exit_date.gte.' + lowerStr + ',work_date.gte.' + lowerStr + ')';
  }

  path += '&select=' + 施工單欄位_ + (isHot ? ',equipment' : '');
  var rows = supabase分頁抓全部_(path);
  return 轉為gviz表_(rows, isHot);
}
