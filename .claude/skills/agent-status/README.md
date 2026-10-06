# agent-status：Claude Code 工作狀態面板（海賊團動畫）

這是給 **Claude Code 開發時**用的 MOD（function hooks 外掛），不是天鷹 APP 的功能，現場同事看不到也不受影響。

## 會顯示什麼
- **打 `/agent-status`**：終端機全螢幕版開**側邊面板**；手機／網頁不支援側邊面板（手機 App 回報不停靠面板），改成在**對話裡印一張會即時更新的狀態卡**，內容相同：動畫舞台＋現在這一步＋經過時間＋任務清單進度＋最近 6 步 ✅/❌
- **輸入框上方狀態條**：小角色＋一行「誰在做什麼｜跑多久｜任務 N/M」，手機也看得到

| agent 在做什麼 | 出場角色 |
|---|---|
| 執行指令（Bash 等） | 🏃 路飛衝刺 |
| 讀檔／搜尋／查網路 | 📖 羅賓＋🔍 |
| 改檔 | 🔨 弗蘭奇 |
| 子代理／子代理的動作 | ⚔️ 索隆＋小喬巴 |
| 某一步失敗（顯示 5 秒） | 💥 喬巴急救＋紅框閃爍 |
| 模型思考中 | 🧭 娜美＋💭 |
| 等你回覆 | ❓ 烏索普（停格） |
| 本輪完成 | 🎉 路飛＋彩帶 |
| 待命 | 💤 娜美（停格） |

動畫是 SVG＋SMIL（`isInteractive`），終端機沒有 Svg 元素，只顯示文字。

## 怎麼載入（⚠️ 放在 repo 裡不會自己載入）
2026-10-05 實測：雲端 session 開場**沒有**載入這個 MOD，打 `/agent-status` 會顯示「沒有這個指令」。
官方文件說專案的 `.claude/skills/<name>` 會自動載入外掛，但除錯紀錄顯示：雲端 workspace 是「未受信任」狀態
（同一份 `.claude/settings.json` 的 `permissions.allow` 也被略過），專案層的這個資料夾根本沒被掃描。
所以要用下面兩種方式之一：

1. **每個新 session 自動載入（建議）**：雲端環境設定（session 標題列的環境選單 → Edit）加一個環境變數
   `CLAUDE_CODE_PLUGIN_DIRS=/home/user/tianying-security/.claude/skills/agent-status`
   Claude Code 啟動時會把這個路徑當成外掛資料夾載入，改完要**開新 session** 才生效。
   ⚠️ 這個變數只認「行程環境變數」或使用者層 `~/.claude/settings.json`，**不讀專案的 `.claude/settings.json`**，所以不能寫進 repo 解決。
2. **只救目前這個 session**：叫 Claude 載入 `plugin-authoring` 技能，把本資料夾複製到它指定的 dev-mods 資料夾，
   畫面跳出「Enable hot reloading for this session?」選 **Enable for this session**，該輪結束後就能用。關掉 session 就沒了。

本機終端機則可直接 `claude --plugin-dir .claude/skills/agent-status`。

## 限制
- MOD 只看得到**自己所在的 session**，看不到別的 session；每個 session 要各自載入（見上一節）。
- 每張 SVG 上限約 13 萬字元；角色是 48 格高、16 色的純向量格子（`<path>`），最大一張（索隆＋喬巴同台）約 8.6 萬字元。
- ⚠️ **角色不能用 `<image href="data:...">` 內嵌 PNG**：桌面版面板會把 SVG 裡的 `<image>` 洗掉，只剩地板和速度線、角色整個不見（2026-10-06 實測）。`tools/mk_sprites.py` 已改成輸出純向量。

## 檔案
- `hooks/register.tsx`：事件掛鉤（tool.call / turn.start / turn.complete）與畫面
- `hooks/logic.ts`：純邏輯（工具→角色、標籤、SVG 舞台），可單獨測試
- `hooks/sprites.ts`：角色跑步幀（**自動產生，勿手改**）
- `tools/mk_sprites.py`：從 `brain_map_img/run_*_f*.png` 重新產生 `sprites.ts`（需 Pillow）
- `types/index.d.ts`：`$.state` 狀態契約

## 驗證
```bash
claude plugin validate .claude/skills/agent-status
claude plugin test .claude/skills/agent-status
```
