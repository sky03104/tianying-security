# 天鷹保全 操作手冊

三份操作手冊 PDF 與原始檔。

## 檔案

| PDF | 對象 |
|-----|------|
| `天鷹保全_APP操作手冊_員工版.pdf` | 第一線保全人員 |
| `天鷹保全_APP操作手冊_主管版.pdf` | 公司主管 / 管理員（審閱、審核功能） |
| `天鷹保全_LINE機器人操作手冊.pdf` | 全員（LINE 線上請假 + 通知） |

## 原始檔（`src/`）

- `emp.html` / `sup.html` / `line.html`：三份手冊內容（HTML）
- `style.css`：共用印刷樣式（A4、白底金字、品牌色）
- `img/`：手冊內嵌的 APP 螢幕截圖（**全部為示範資料「範例」，無真實人員／紀錄**）

## 如何重新產生 PDF

改完 `src/*.html` 後，用 Chromium 列印成 PDF：

```bash
CHROME=/path/to/chrome   # 例如 chromium 或 Google Chrome
"$CHROME" --headless --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="天鷹保全_APP操作手冊_員工版.pdf" "file://$PWD/src/emp.html"
# sup.html、line.html 同理
```

> 截圖以無頭瀏覽器載入各工具頁、注入「假登入態＋假資料」後擷取產生，因此不含任何真實資料。
> 功能有更新時，請 AI「更新手冊」即可重新擷圖並重產 PDF。

**最後更新**：2026-07-05（v1.1）

### v1.1 更新內容（2026-07-05）

- 員工版：新增「今/明日哨表」（原「明日哨表」擴充為今日／明日切換）、新增「物流車輛統計」工具章節
- 主管版：新增「帶班交接事項」（組長以上）、「新案件 LINE 即時通知」、「天鷹 AI 小助手（管理員限定）」三章
- LINE 機器人手冊：新增「查詢班表與哨點」章節（本月/本週/今日/明日班表、今日哨點、哨點指令，原本未文件化）
- 新增截圖：`logistics_form.png`、`handover_list.png`、`post_today.png`、`ai_chat.png`
