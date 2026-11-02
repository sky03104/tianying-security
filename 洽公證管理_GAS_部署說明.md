# 洽公證管理 GAS 部署說明

工具：`tool_visitor.html`（前端）＋ `洽公證管理_GAS.gs`（後端，獨立部署／獨立試算表）
主選單：id 26「洽公證管理」，門禁管理分類，預設所有角色可見（現場保全櫃檯用；可在主控台工具權限面板調整）。

流程：固定 QR（桌上海報或首頁大按鈕全螢幕顯示）→ 廠商免登入掃碼填資料 → 送出當下配號（300~600）→ 完成畫面 → 保全核對後「確認發證」→ 還證時按「已繳回」（需登入）。

---

## 一、建立試算表
1. Google Drive → 新增 → Google 試算表，取名「洽公證管理」，複製網址中的試算表 ID
2. 分頁（`洽公證紀錄`、`卡片例外`）不用自己建，程式第一次執行會自動建好

## 二、建立 GAS 專案
1. 該試算表 → 擴充功能 → Apps Script
2. 把 `洽公證管理_GAS.gs` 全部貼進 `程式碼.gs`，把 `SPREADSHEET_ID` 換成步驟一的 ID，儲存

## 三、指令碼屬性（專案設定 → 指令碼屬性）
| 名稱 | 值 |
|---|---|
| `SESSION_SECRET` | 與主 App 同一個值（讓登入驗證走本機，快） |
| `SUPABASE_URL` | 天鷹正式 Supabase 專案網址（專案 `narilpgjmjncladkquly`，同施工單 GAS 設的那個） |
| `SUPABASE_SECRET_KEY` | 同上專案的 secret key（**只放這裡，不要貼進程式碼**） |

編輯器函式選單選 **`forceAuth`** → 執行（授權後看紀錄確認三項設定都已填）。

## 四、Supabase 建表（先做，否則 30 天後的搬遷會失敗）
在 Supabase SQL Editor 執行（只准用專案 `narilpgjmjncladkquly`）：
```sql
create table public.visitor_pass_logs (
  id bigint primary key,
  pass_no int not null,
  status text not null,
  floor text, shop text, person_name text, phone text,
  apply_date date not null,
  applied_at timestamptz, issued_at timestamptz, issued_by text,
  returned_at timestamptz, returned_by text, note text,
  archived_at timestamptz not null default now()
);
create index on public.visitor_pass_logs (apply_date);
create index on public.visitor_pass_logs (pass_no);
alter table public.visitor_pass_logs enable row level security; -- 不設 policy：只有 GAS 的 secret key 能讀寫（含姓名電話個資）
```

## 五、部署
1. 部署 → 新增部署 → 類型「網路應用程式」，執行身分「我」，存取權限「所有人」
2. 複製網址，填到 `tool_visitor.html` 的 `VISITOR_GAS_URL`（取代「請填入部署網址」）
3. **之後改程式**：部署 → 管理部署作業 → 編輯 → 版本「新版本」（不要新增部署，網址會變）

## 六、設定每日搬遷
編輯器執行一次 **`設定每日搬遷觸發器`**：每天凌晨 4 點，把「已繳回／已取消／已逾時且超過 30 天」的列搬進 Supabase，回查筆數相符才刪 Sheets 的列；失敗不刪、隔天重試。仍未繳回的舊單永遠留在 Sheets。

## 七、印海報
首頁按「申請換證」→「列印海報」，A4 印出貼桌上（QR 內容是固定網址，不會過期）。

## 八、參數（`洽公證管理_GAS.gs` 開頭，前端 `tool_visitor.html` 同值）
`NO_MIN/NO_MAX` 編號範圍 300~600；`HOLD_MIN` 待領證 30 分鐘自動釋放；`PENDING_MAX` 待領證上限 15；`OVERDUE_HOURS` 逾期門檻 12 小時；`FLOORS` 樓層選項（前後端要一起改）。

## 九、資料怎麼存／防濫用
- 一次申請一列；狀態：已申請 → 已借出 → 已繳回（另有已取消、已逾時）。「逾期未還」不存，由發證時間算出。
- 申請端（免登入）：欄位驗證、同電話有效單去重、待領證上限、30 分鐘未確認自動釋放、公式注入清理。完成畫面每 5 秒對後端查即時狀態，已繳回/取消/逾時會整面變灰（防舊截圖冒用）。
- 管理動作（確認發證、已繳回、取消、停用、查詢）每個都驗 token＋工具權限。
