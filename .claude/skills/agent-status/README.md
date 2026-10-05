# agent-status：Claude Code 工作狀態面板（海賊團動畫）

這是給 **Claude Code 開發時**用的 MOD（function hooks 外掛），不是天鷹 APP 的功能，現場同事看不到也不受影響。

## 會顯示什麼
- **側邊面板**（打 `/agent-status` 開啟）：動畫舞台＋現在這一步＋經過時間＋任務清單進度＋最近 6 步 ✅/❌
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

## 限制
- MOD 只看得到**自己所在的 session**，看不到別的 session；所以放進 repo，讓每個 session 各自載入、各自顯示。
- 每張 SVG 上限約 13 萬字元；角色圖已壓到每位 8～15KB。

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
