# 過夜車輛統計 SQL 遷移規劃

> 2026-08-28 建立。目標：把「過夜車輛登記」（tool_signin.html＋車牌辨識_後端_GAS.gs）的三個登記分頁從 Google Sheets 搬到 Supabase（沿用班表管理/施工單管理/打烊開店管理/物流車輛統計已建立的同一個 Supabase 專案 `narilpgjmjncladkquly`，新增一張表）。
> 跟前面幾個工具同一種效能債模式（每天持續累積、從不清理），特別的地方是**每日 08:00 有一支排程會整表撈出來寄摘要信給主管**，這封信是稽核用途、不能因為 Supabase 短暫故障就寄不出去或內容有誤——所以這支工具的容錯設計跟班表管理比較像（雙軌並存），跟施工單/打烊開店/物流（Supabase 完全取代 Sheets）不一樣。

## 一、現況架構（搬遷前基準）

- 獨立試算表（1K46ZEq...）＋獨立 GAS（`車牌辨識_後端_GAS.gs`，同時處理 AI 車牌辨識與登記寫入，兩者職責不同、遷移只動登記寫入這塊）
- 三個登記分頁「館內機車」「館內汽車」「新莊停車場」，各4欄（A時間|B類型|C車牌|D登記人）——每次登記 `appendRow`，從不清理，這是主要的效能債
- 另有「白名單設定」（人工設定的公司車/月租車名單，量小固定）、「特殊車輛」（白名單命中時多寫一筆）、「長期停放紀錄」（連續停放才新增）兩個小 log，量遠小於主表
- **讀取路徑三處**：
  1. `vehicleReg` 登記時的2分鐘防重複——只抓最近20列比對車牌，O(1)級別，不受歷史資料量影響
  2. `checkAndUpdateLongTermParking_` 長期停放偵測——查當天分頁「昨天有沒有登記過這車牌」，從後往前找到就停，實務上很快
  3. **`sendDailySummary` 每日08:00寄信**——三個分頁**整表**`getDataRange().getValues()`撈出來，字串比對篩「昨天08:00~今天08:00」，這是唯一會隨歷史資料量增長而變慢的地方
- 2026-08-28 新增的「查詢歷史紀錄」功能（`searchVehicleLogs` action，tool_signin.html右上角查詢按鈕）目前也是直接讀 Sheets，這支之後要跟著搬（見第三節的搬遷順序）
- **消費者只有工具自己**：已 grep 全專案確認沒有其他工具直接讀這份試算表

## 二、範圍決策

- **只搬三個登記分頁**，白名單設定維持在 Sheets 不動（人工設定、量小固定，跟其他工具的「快捷設定/專櫃表」同一種判斷）
- 「特殊車輛」「長期停放紀錄」這兩個小 log 這次**先不搬**，量遠小於主表，之後量大了再議，避免範圍一次拉太大
- 新表沒有既有 ID 欄位（原本就是純粹用列位置，appendRow 到底），比其他幾個工具的遷移還單純，不用處理 legacy_id 相容問題

## 三、這支工具的難點：每日寄信的容錯設計（雙寫＋自動退回讀 Sheets）

**2026-08-28 咖哩與AI討論後決定**：跟施工單/打烊開店/物流「Supabase 完全取代 Sheets」不同，這支工具**維持雙軌**：

- **寫入**：登記時 Supabase、Sheets 兩邊都寫一份
- **讀取（寄信、查詢歷史紀錄）**：優先查 Supabase，查詢失敗（斷線/額度/任何原因）自動退回讀 Sheets（整表撈+字串篩選，原本的舊邏輯留著當備援，不刪）
- 兩邊都失敗才會真的寄不出信／查不到資料，機率極低

**為什麼跟其他工具不一樣**：施工單/打烊開店/物流可以完全捨棄 Sheets，是因為「沒有其他系統依賴，遷移完 Sheets 就沒事做了」。過夜車輛的每日寄信是**稽核證明用途、排程自動寄出、寄錯了主管當下不會發現**，比其他工具的「操作失敗使用者馬上看得到」風險更高一層，所以值得多付一點雙寫的成本換取可靠度。

**這代表 Sheets 不會完全停用**，是刻意設計不是妥協。

## 四、目標資料表設計

```sql
create table vehicle_overnight_logs (
  id bigserial primary key,
  type_label text not null,
  plate text not null,
  operator text not null,
  created_at timestamptz not null default now()
);
create index vehicle_overnight_logs_created_at on vehicle_overnight_logs (created_at);
create index vehicle_overnight_logs_plate on vehicle_overnight_logs (plate);
alter table vehicle_overnight_logs enable row level security;
```

- `id`：Supabase bigserial，取代原本靠列位置定位的 `updatePlate`（改用 `id` 定位，取代原本用試算表列號`row`定位的不穩健設計，跟打烊/開店同一個教訓）
- `plate` 建索引：「查詢歷史紀錄」的依車牌搜尋、寄信之外的日常查詢都會用到
- 不轉存 B/C 欄字串日期時間，統一用 `created_at`（timestamptz）當唯一時間來源，新資料一律伺服器時間寫入

## 五、連線方式

沿用既有 Supabase 連線方式（`UrlFetchApp` 打 REST API，金鑰存指令碼屬性，legacy `service_role` key，`apikey`+`Authorization: Bearer` 兩個標頭都要帶，HTTP 方法字串一律小寫——這些都是前四次遷移踩過的坑，直接套用）。這支 GAS 專案要設定一次連線金鑰。

## 六、分階段執行

| 階段 | 內容 | 完成定義 |
|---|---|---|
| 1. 建置 | Supabase 新增 `vehicle_overnight_logs`；GAS 設定連線金鑰並測試 | 能寫入再讀出測試資料成功 |
| 2. 歷史資料搬遷 | 讀三個登記分頁全部資料，轉存 Supabase | 咖哩確認搬遷筆數與原分頁筆數相符 |
| 3. 換讀＋失敗備援（查詢功能） | `searchVehicleLogs` 改讀 Supabase，失敗自動退回讀 Sheets；實測效能 | 新舊結果比對相符；查詢速度不隨歷史資料量變慢 |
| 4. 換寫（雙寫） | `vehicleReg`/`updatePlate` 改成 Supabase＋Sheets 都寫，`updatePlate` 改用 `id` 定位（Supabase）＋原本列號定位（Sheets）兩邊都要更新到 | 實際登記一筆、修改一筆，Supabase 與 Sheets 兩邊資料一致 |
| 5. 寄信換讀＋失敗備援 | `sendDailySummary` 改用 `created_at` 區間查 Supabase，失敗自動退回原本整表撈 Sheets 篩選當天窗口的舊邏輯 | 手動觸發測試信，內容與改版前一致；模擬 Supabase 查詢失敗（改錯金鑰測試）確認能正確退回 Sheets 且信件內容仍正確 |
| 6. 每日備份防護 | 比照其他工具，新增每日自動備份 Supabase 到 Drive | 咖哩確認 Drive 出現備份檔 |
| 7. Sheets 定期清除 | **只有前面都完成、確認查詢/寄信都改讀 Supabase 且穩定運作後才能做這步**——新增**每日**排程，批次刪除 Sheets 三個登記分頁裡超過30天的舊列（用 LockService 上鎖避免跟寫入衝突），保留30天當寄信失敗時的備援緩衝，不清光。⚠️保留天數異動記錄：2026-08-28一開始定90天→同日縮到3天→同日又改回30天（咖哩口語說「留30天(本月)」，這裡用**滾動30天**實作，不是「當月1號整批清掉上個月」的日曆月語意，理由：滾動窗口不會在月初出現「瞬間清空」的斷點，備援緩衝隨時都是穩定30天）。清除頻率維持**每日**，不會因為天數變多就改回每月——每日執行成本很低，且能讓Sheets實際存量隨時貼近30天，不會因為排程間隔拉長而超出預期 | 咖哩確認排程執行後 Sheets 只留最近30天資料，Supabase 完整歷史不受影響 |

## 七、風險與備援

- Supabase 連不上：階段3、5都有自動退回讀 Sheets 的設計；階段4寫入是雙寫，其中一邊失敗要明確回報給前端，不能其中一邊寫失敗卻顯示登記成功
- 階段7的清除順序很重要：若在查詢功能還沒完全改讀 Supabase 前就清 Sheets，會造成舊紀錄查不到（Sheets 當下是唯一還在用的來源），必須排在最後
- 「特殊車輛」「長期停放紀錄」維持在 Sheets：這兩支功能仍讀寫 Sheets，不受本次遷移影響

## 八、進度追蹤

- [x] 程式碼撰寫（2026-08-28）：`過夜車輛SQL建表.sql`（階段1 DDL）、`過夜車輛_SQL遷移腳本.gs`（階段2）、`過夜車輛_SQL讀取層.gs`（階段3查詢＋階段5寄信，各附比對/效能測試工具）、`車牌辨識_後端_GAS.gs` 加上雙寫與備援呼叫（階段4，用 `typeof` 防呆，沒貼進讀取層/遷移腳本前完全不影響原本行為）、`過夜車輛_SQL每日備份.gs`（階段6）、`tool_signin.html` 補 `supabaseId` 傳遞供修正車牌時雙邊同步。node --check 與 HTML 標籤閉合皆已驗證通過。
- [x] 階段1：建置（2026-08-28）
- [x] 階段2：歷史資料搬遷（2026-08-28）。館內機車1667筆、館內汽車576筆、新莊停車場241筆，實際寫入Supabase共2484筆，`核對過夜車輛遷移結果()`確認一致。
  - ⚠️ 踩坑記錄：遷移腳本一開始誤用 `SpreadsheetApp.getActiveSpreadsheet()`，但這支GAS專案是獨立腳本不是容器繫結腳本（跟施工單/物流不同），咖哩實測噴出 `Cannot read properties of null (reading 'getSheetByName')`。改用主檔案原本就在用的 `SpreadsheetApp.openById(SPREADSHEET_ID)` 後重跑成功。
- [x] 階段3：換讀＋失敗備援（查詢功能）（2026-08-28）。`比對searchVehicleLogs()` 完全一致 ✅（共66筆）；`測試searchVehicleLogs效能()` 讀Sheets 3315ms → 讀Supabase 496ms，快約6.7倍。
- [x] 階段4：換寫（雙寫）（2026-08-28）。新增登記（`id=2485｜新莊停車場｜ADD9285｜謝志遠`）與修正車牌（9285→9999）皆確認 Supabase 與 Sheets 兩邊一致。
  - ⚠️ 踩坑記錄①：一開始測試沒看到新增的資料，原因是「存檔」跟「部署新版本」是兩件事——咖哩在Apps Script編輯器貼上新版主檔並存檔，但`/exec`網址背後跑的還是舊部署版本，執行「部署→管理部署作業→編輯→新版本」後才生效。跟git merge與否無關（GAS部署跟GitHub是完全獨立的兩條路）。
  - ⚠️ 踩坑記錄②：修正車牌一開始只有Sheets改到、Supabase沒動，原因是前端`tool_signin.html`的`supabaseId`追蹤程式碼當時還在未合併的分支上，GitHub Pages對外服務的仍是main分支的舊版前端，送出的請求沒帶supabaseId，後端`_syncUpdatePlateToSupabase_`的防呆判斷（沒id就跳過不亂改）因此沒有動作。合併分支到main、GitHub Pages換版後重測即正常。
- [x] 階段5：寄信換讀＋失敗備援（2026-08-28）。`比對每日寄信統計資料()` 完全一致 ✅（共66筆）；`testDailySummary()` 實際收信，咖哩確認信件內容正常。
- [x] 階段6：每日備份防護（2026-08-28）。觸發器已建立，每日凌晨3:00~4:00執行，待隔天確認 Drive「天鷹保全_過夜車輛SQL備份」資料夾出現備份檔。
- [x] 程式碼撰寫（2026-08-28）：`過夜車輛_SQL定期清除.gs`（階段7），滾動保留30天，每日凌晨4:00~5:00執行（接在每日備份之後）。node --check與跨檔重複宣告檢查皆已通過。
- [ ] 階段7：Sheets 定期清除（**待咖哩執行**：確認前六階段已穩定運作後，貼上`過夜車輛_SQL定期清除.gs`並執行 `設定過夜車輛Sheets清除觸發器()`，隔天確認 Sheets 三個登記分頁只留最近30天資料、Supabase查詢/寄信仍正常）
- [x] 階段7 改版 v2（2026-11-25）：`過夜車輛_SQL定期清除.gs` 改成逐列判斷（超過30天／整列空白才刪；時間看不懂但有內容的保留），支援「2026/7/2 下午 10:55:54」中文格式，刪舊列前跟 Supabase 核對筆數，新增 `預覽過夜車輛Sheets清除_不刪除()`。起因：v1 遇到看不懂的列就停，館內汽車／新莊從沒被清到，且試算表中間出現空白列後會卡住。**待咖哩貼新版＋先跑預覽確認各分頁要刪幾列**。
