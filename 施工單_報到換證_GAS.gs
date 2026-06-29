/* ================================================================
   施工單「報到換證」後端 GAS
   ----------------------------------------------------------------
   用途：tool_work.html 施工單查詢工具，按下「報到換證」時呼叫此 Web App，
         在試算表 O 欄（第 15 欄）寫入「報到時間戳」。
   注意：這支與「上傳工具後端」（getOrders / 上傳 rows・fireRows 那支 v2.0）
         是不同的兩支 Script，請勿混淆。本支只負責報到換證的寫入。

   ── 每天制（2026-06-29 改）──────────────────────────────────────
   O 欄不再寫死「已報到換證」字面值，改寫「報到的日期時間」(yyyy-MM-dd HH:mm)。
   前端 tool_work.html 的 isCheckinActive() 會據此判斷：
     現在仍在這次施工時段內 → 顯示「已報到換證」；
     過了該筆退場時間 / 隔天   → 自動回「報到換證」（可再按）。
   讓綠十字這種「整月每天來」的常態單，每天都能各自報到。

   ── 比對邏輯 ────────────────────────────────────────────────────
   優先用 ID(A欄) 比對；否則用 廠商(C)+月(D)+日(E)+進場時間(F) 組合比對。
   （與前端 checkinMatchKey 一致）

   ── 試算表欄位 A~O ──────────────────────────────────────────────
   A=流水號 B=申請單位 C=廠商 D=月 E=日 F=進場時間 G=退場時間
   H=人數 I=監工 J=施工地點 K=施工項目 L=施工日期 M=退場日期
   N=備註 O=報到時間戳

   ── 部署 ────────────────────────────────────────────────────────
   改動後務必：部署 → 管理部署 → 編輯(鉛筆) → 版本「新版本」→ 部署
   （走「編輯既有部署」，網址不變；勿「新增部署」以免換網址導致前端斷線）
   ================================================================ */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheetName = data.sheet;
    var ss = SpreadsheetApp.openById('1QuNkwu9zgPidUfSgWpqyT1M9X683IU-0LhXTc23hw-A');
    var sheet = ss.getSheetByName(sheetName);
    if(!sheet) throw new Error('找不到分頁：' + sheetName);
    var values = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < values.length; i++) {
      var rowId = String(values[i][0]).trim();
      var dataId = String(data.id || '').trim();
      // 主要用ID比對，次要用廠商+月+日+進場時間
      var byId = dataId && dataId !== 'null' && rowId === dataId;
      var byCombo = !byId && (String(values[i][2]).trim() === String(data.vendor || '').trim())
                    && (String(values[i][3]).trim() === String(data.month || '').trim())
                    && (String(values[i][4]).trim() === String(data.day || '').trim())
                    && (String(values[i][5]).trim() === String(data.inTime || '').trim());
      if(byId || byCombo) {
        // O 欄 = 第15欄。每天制：寫「報到時間戳」而非永久字面值，前端據此判定是否過退場時間
        sheet.getRange(i + 1, 15).setValue(Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm'));
        found = true;
        break;
      }
    }
    return ContentService
      .createTextOutput(JSON.stringify({ success: found, msg: found ? 'OK' : '找不到對應資料列' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, msg: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
