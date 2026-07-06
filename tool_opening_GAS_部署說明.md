# 開店前進出快速登錄工具 — GAS 部署說明

**工具**：開店前進出快速登錄（`tool_opening.html`）
**目標試算表**：`1mxCRUxbuPBuReP1gWK3unFbjtOkAuSkBakQeaH9Rdyc`
**分頁名稱**：`進出資料表`（已存在）

---

## 架構：兩個 GAS URL（資料庫共用、記錄分流）

開店前工具刻意拆成兩條連線：

| 連線 | 變數 | 指向 | 負責 |
|------|------|------|------|
| 資料庫 | `DB_GAS_URL` | **打烊 GAS URL**（既有，已內建） | 廠商／監工／檢查者資料庫 `getDB`／`setDB`（與打烊後工具共用同一份 `_SharedDB`） |
| 進出記錄 | `BUILT_IN_GAS_URL` | **開店 GAS URL**（本說明要新部署） | 寫入「進出資料表」、今日清單、補退場 |

> 為什麼要兩個？GAS 用 `getActiveSpreadsheet()` 只能讀寫它所綁定的那份試算表。資料庫在打烊試算表、開店記錄在開店試算表，是兩份不同的 spreadsheet，所以記錄寫入需要開店試算表自己的 GAS。資料庫則直接共用打烊 GAS，不需重複維護。

---

## 部署步驟（約 3 分鐘）

### 1. 開啟 Apps Script
開店試算表 → 上方選單 **擴充功能 → Apps Script**

### 2. 貼上程式碼
刪掉預設的 `function myFunction(){}`，貼上下方完整 GAS 程式碼（也可從工具內 **設定 → GAS 程式碼** 直接複製）。

### 3. 部署為網頁應用程式
- 右上 **部署 → 新增部署**
- 類型選 **網頁應用程式（Web app）**
- 「執行身分」：**我（你的帳號）**
- 「誰可以存取」：**任何人（Anyone）**
- 按 **部署**，第一次會要求授權 → 允許

### 4. 複製網址貼回工具
- 複製產生的 **`/exec` 結尾網址**
- 開啟開店前工具 → **設定** 頁 → 貼到「GAS 連線網址」→ 按儲存測試
- （或把網址給我，我直接寫進 `tool_opening.html` 的 `BUILT_IN_GAS_URL`，所有員工開啟即自動連線）

### 5. 確認試算表分頁
開店試算表需有以下分頁（沒有請手動建立，欄位標題照下表）：

**`進出資料表`**（主記錄，A~L 欄）

| A 紀錄ID | B 專櫃ID | C 樓層 | D 專櫃名稱 | E 人數 | F 監工 | G 進場時間 | H 施工地點 | I 施工項目 | J 退場時間 | K 檢查者 | L 建立時間 |
|---|---|---|---|---|---|---|---|---|---|---|---|

> 紀錄ID 為**純數字流水號**（1、2、3…），由 GAS 依列號自動產生，符合天鷹保全主鍵規範。

`_SharedDB` 與 `專櫃表` 分頁可不必在開店試算表建立（資料庫走打烊 GAS）。GAS 內 `exportDailyExcel` 為選用的每日匯出，需要時再建「開店前」分頁即可。

---

## 完整 GAS 程式碼

> 此程式碼與工具內 **設定 → GAS 程式碼** 一致。寫入分頁由前端傳入（固定為 `進出資料表`），紀錄主鍵為純數字流水號。

```javascript
// ============================
// 開店前進出快速登錄 — 開店試算表 GAS
// 部署於：1mxCRUxbuPBuReP1gWK3unFbjtOkAuSkBakQeaH9Rdyc
// ============================

// 選用：每日匯出Excel（需要時再建「開店前」彙整分頁）
function exportDailyExcel() {
  var folderId = "1JaWrMWQQBGGt1BGGaUKqnwTVKQ9De8Na";
  var folder = DriveApp.getFolderById(folderId);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("開店前");
  if (!sheet) throw new Error("找不到工作表：開店前");
  var reportDate = new Date();
  reportDate.setDate(reportDate.getDate() - 1);
  var fileName = (reportDate.getMonth()+1)+"月"+reportDate.getDate()+"日漢神巨蛋營業前 開店前 進出管制表.xlsx";
  var oldFiles = folder.getFilesByName(fileName);
  while (oldFiles.hasNext()) oldFiles.next().setTrashed(true);
  var exportUrl = "https://docs.google.com/spreadsheets/d/"+ss.getId()+"/export?format=xlsx";
  var response = UrlFetchApp.fetch(exportUrl, {
    headers: {Authorization: "Bearer "+ScriptApp.getOAuthToken()},
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("Excel匯出失敗");
  folder.createFile(response.getBlob().setName(fileName));
  var today = new Date();
  sheet.getRange("G1").setValue((today.getFullYear()-1911)+"年"+(today.getMonth()+1)+"月"+today.getDate()+"日");
  SpreadsheetApp.flush();
}

// ============================
// 快速登錄工具 API
// 欄位：A紀錄ID | B專櫃ID | C樓層 | D專櫃名稱 | E人數 | F監工
//       G進場時間 | H施工地點 | I施工項目 | J退場時間 | K檢查者 | L建立時間
// ============================
function doPost(e) {
  try {
    var action = e.parameter.action || '';

    if (action === 'setDB') {
      return setDB(e.parameter.db);
    }
    if (action === 'updateExit') {
      return updateExitTime(e);
    }
    if (action === 'updateRow') {
      return updateRow(e);
    }
    if (action === 'deleteRow') {
      return deleteRow(e);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetNm = e.parameter.sheetName || '進出資料表';
    var sheet = ss.getSheetByName(sheetNm);
    if (!sheet) return jsonRes({status:'error', msg:'找不到分頁: '+sheetNm});

    var rows = JSON.parse(e.parameter.rows);
    var now = new Date();
    var added = 0;

    rows.forEach(function(r) {
      var shopCode = getOrCreateShopCode(ss, r.shop, r.floor);
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, 1, 12).setValues([[
        (nextRow - 1),            // 純數字流水號主鍵（1,2,3...）
        shopCode,
        r.floor || '',
        r.shop || '',
        parseInt(r.count) || 1,
        r.supervisor || '',
        r.entryTime || '',
        r.location || '',
        r.workType || '',
        r.exitTime || '',
        r.inspector || '',
        now
      ]]);
      sheet.getRange(nextRow, 12).setNumberFormat('yyyy/M/d HH:mm:ss');
      added++;
    });

    return jsonRes({status:'ok', added:added});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';
  if (action === 'getTodayRows') return getTodayRows(e);
  if (action === 'getDB') return getDB();
  return jsonRes({status:'ok', msg:'天鷹保全 API 正常 ✓'});
}

// 今日紀錄：開店前為早上作業，撈「今天整天」（00:00 ~ 隔日 00:00）
function getTodayRows(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetNm = (e && e.parameter && e.parameter.sheet) ? e.parameter.sheet : '進出資料表';
    var sheet = ss.getSheetByName(sheetNm);
    if (!sheet) return jsonRes({status:'error', msg:'找不到分頁: '+sheetNm});

    var now = new Date();
    var shiftStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    var shiftEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 0);

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonRes({status:'ok', rows:[]});

    var data = sheet.getRange(2, 1, lastRow-1, 12).getValues();
    var result = [];
    for (var i = 0; i < data.length; i++) {
      var createdAt = data[i][11];
      if (!(createdAt instanceof Date)) continue;
      if (createdAt < shiftStart || createdAt > shiftEnd) continue;
      result.push({
        rowNum:  i + 2,
        id:      data[i][0],
        floor:   data[i][2],
        shop:    data[i][3],
        count:   data[i][4],
        sup:     data[i][5],
        entry:   fmtTimeVal(data[i][6]),
        loc:     data[i][7],
        wtype:   data[i][8],
        exit:    fmtTimeVal(data[i][9]),
        ins:     data[i][10],
        created: Utilities.formatDate(createdAt, 'Asia/Taipei', 'HH:mm:ss')
      });
    }
    result.reverse();
    return jsonRes({status:'ok', rows:result});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

// 編輯今日紀錄（覆寫 C樓層~K檢查者，共9欄）
function updateRow(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetNm = e.parameter.sheet || '進出資料表';
    var sheet = ss.getSheetByName(sheetNm);
    if (!sheet) return jsonRes({status:'error', msg:'找不到分頁: '+sheetNm});

    var rowNum = parseInt(e.parameter.rowNum);
    if (isNaN(rowNum) || rowNum < 2) return jsonRes({status:'error', msg:'列號無效'});

    sheet.getRange(rowNum, 3, 1, 9).setValues([[
      e.parameter.floor || '',
      e.parameter.shop || '',
      parseInt(e.parameter.count) || 1,
      e.parameter.supervisor || '',
      e.parameter.entryTime || '',
      e.parameter.location || '',
      e.parameter.workType || '',
      e.parameter.exitTime || '',
      e.parameter.inspector || ''
    ]]);

    return jsonRes({status:'ok'});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

// 刪除今日紀錄（整列刪除）
function deleteRow(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetNm = e.parameter.sheet || '進出資料表';
    var sheet = ss.getSheetByName(sheetNm);
    if (!sheet) return jsonRes({status:'error', msg:'找不到分頁: '+sheetNm});

    var rowNum = parseInt(e.parameter.rowNum);
    if (isNaN(rowNum) || rowNum < 2) return jsonRes({status:'error', msg:'列號無效'});

    sheet.deleteRow(rowNum);

    return jsonRes({status:'ok'});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

// 補填退場時間
function updateExitTime(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetNm = e.parameter.sheet || '進出資料表';
    var sheet = ss.getSheetByName(sheetNm);
    if (!sheet) return jsonRes({status:'error', msg:'找不到分頁: '+sheetNm});

    var rowNum   = parseInt(e.parameter.rowNum);
    var exitTime = e.parameter.exitTime || '';
    var inspector = e.parameter.inspector || '';
    if (isNaN(rowNum) || rowNum < 2) return jsonRes({status:'error', msg:'列號無效'});

    if (exitTime) sheet.getRange(rowNum, 10).setValue(exitTime);
    if (inspector) sheet.getRange(rowNum, 11).setValue(inspector);
    return jsonRes({status:'ok'});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

function fmtTimeVal(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.substring(0,5);
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'HH:mm');
  return String(val).substring(0,5);
}

// 共用資料庫（開店試算表本機備援；實際走打烊 GAS）
function getDB() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dbSheet = ss.getSheetByName('_SharedDB');
    if (!dbSheet) return jsonRes({status:'ok', db:null});
    var val = dbSheet.getRange(1, 1).getValue();
    if (!val) return jsonRes({status:'ok', db:null});
    return jsonRes({status:'ok', db:JSON.parse(val)});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

function setDB(dbJson) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dbSheet = ss.getSheetByName('_SharedDB');
    if (!dbSheet) dbSheet = ss.insertSheet('_SharedDB');
    dbSheet.getRange(1, 1).setValue(dbJson);
    return jsonRes({status:'ok'});
  } catch(err) {
    return jsonRes({status:'error', msg:err.toString()});
  }
}

// 查詢或新增專櫃代號
function getOrCreateShopCode(ss, name, floor) {
  try {
    var st = ss.getSheetByName('專櫃表');
    if (!st) return name;
    var data = st.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === String(name).trim() &&
          String(data[i][2]).trim() === String(floor).trim()) {
        return data[i][0];
      }
    }
    var prefix = floor + '-';
    var maxNum = 0;
    for (var j = 1; j < data.length; j++) {
      var code = String(data[j][0]);
      if (code.indexOf(prefix) === 0) {
        var num = parseInt(code.replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
    var newNum = maxNum + 1;
    var newCode = prefix + (newNum < 10 ? '0' + newNum : String(newNum));
    st.appendRow([newCode, name, floor]);
    return newCode;
  } catch(err) {
    return name;
  }
}

function jsonRes(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 驗證清單

- [ ] GAS 部署成功，`/exec` 網址可開啟並回 `天鷹保全 API 正常 ✓`
- [ ] 工具設定頁貼上網址後顯示「✓ 連線成功」
- [ ] 送出一筆進出 → 「進出資料表」新增一列，A 欄為純數字（1、2、3…）
- [ ] 今日頁可載入剛送出的紀錄
- [ ] 今日頁點✏️編輯、修改後儲存 → 顯示「已儲存」，試算表該列內容確實更新
- [ ] 今日頁點🗑刪除 → 顯示「已刪除」，試算表該列確實移除
- [ ] 廠商／監工／檢查者清單與打烊後工具一致（共用 `_SharedDB`）
- [ ] 打烊後工具不受影響

> **2026-07-06 修復**：原本 GAS 沒有處理 `updateRow`／`deleteRow` 兩個 action，今日頁編輯/刪除一律回「失敗」。若你在此之前已部署過開店 GAS，**務必重新貼上最新程式碼並「管理部署 → 編輯 → 新版本」**（URL 不變），否則編輯/刪除仍會失敗。
