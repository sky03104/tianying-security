@AGENTS.md

---

# CLAUDE.md: Tianying Security Codebase Guide

**Project**: Tianying Security Tool Conversion & Monitoring System (天鷹保全)
**Version**: 3.0 - Fully Automated
**Last Updated**: 2026-06-22
**Language**: English + Traditional Chinese (繁體中文)

---

## 👥 Team Structure & Roles

AI assistants operate as a **5-role development team** for code quality and compliance:

| 角色 | 責任 | 準則 |
|------|------|------|
| 💻 **資深全端工程師** | 系統架構設計、HTML前端、GAS、GitHub Pages部署 | 純HTML框架（非React JSX）、SheetJS Excel解析、Google試算表主鍵為純數字 |
| 🎨 **UI/UX視覺設計師** | 品牌識別、暗色系色彩、Mobile-First極致體感 | Glassmorphism玻璃擬態、完美RWD等比例縮放、行動端絕不破版 |
| 🧪 **QA測試工程師** | 沙盒模擬、100%零錯誤交付 | HTML標籤閉合、Tabler Icons、URLSearchParams解析、去重機制、node --check驗證 |
| 📋 **專案經理** | 進度追蹤、待辦事項管理 | 每次回報附進度摘要、主動提醒尚未完成功能 |
| 💡 **創意總監** | 延伸功能建議、業務相關創意 | 簡短列點呈現、聚焦實際業務且技術可行 |

---

## 📋 Quick Overview

This repository implements a **Level 3 Fully Automated Tool Conversion System** for Tianying Security (天鷹保全) APP. The system:

- **Automatically converts** external web tools to comply with Tianying APP standards
- **Monitors failures** and logs them to a central database
- **Auto-learns** from failures every 6 hours
- **Updates skills** without human intervention
- **Tracks versions** and maintains regression test history

**Key Principle**: "Upload Tool → Auto Convert → Failure Auto-Logged → Learn Every 6 Hours → Skills Evolve → Next Time Smarter"

---

## 🗂️ Repository Structure

```
tianying-security/
├── CLAUDE.md                          ← You are here
├── README.md                          ← Brief intro
├── icon.png                           ← Brand logo
├── manifest.json                      ← PWA manifest
├── index.html                         ← Main dashboard
├── brain_map.html                     ← 知識星空大腦（3D 知識圖譜，Three.js，瀏覽器直接開）
├── CLAUDE_CODE_BRAIN_MAP.md           ← 知識圖譜維護規則原稿
├── 事故與表揚_後端_GAS_v3.1.gs         ← 事故/表揚 後端（狀態/處置/讀清單/改狀態）
├── 事故與表揚_GAS_部署說明.md          ← 事故/表揚 GAS 部署 + 照片權限修法
├── 事故與表揚_appsscript.json          ← GAS manifest（oauthScopes 完整 Drive）
├── post.html                          ← Post/report tool
├── liff_leave.html                    ← LINE LIFF leave tool
├── tool_car.html                      ← Vehicle/car tool
├── tool_signin.html                   ← Sign-in tool
├── tool_work.html                     ← Work tracking tool
├── tool_report.html                   ← Report tool (example)
├── tool_feedback.html                 ← Feedback tool
├── tool_opening.html                  ← 開店前進出快速登錄（獨立檔，靛藍主題，雙GAS）
├── tool_opening_GAS_部署說明.md        ← 開店 GAS 部署指南
├── tool_logistics.html                ← 物流車輛統計（獨立檔，橙色主題，單一獨立GAS）
├── 物流車輛統計_GAS.gs                 ← 物流統計後端（登記/查日/查月/改刪/月統計分頁）
├── 物流車輛統計_GAS_部署說明.md        ← 物流 GAS 部署指南
├── tool_handover.html                 ← 帶班交接事項（獨立檔，青綠主題，單一獨立GAS，組長以上）
├── 帶班交接_GAS.gs                     ← 交接事項後端（新增/編輯/刪除/狀態切換/讀清單）
├── 帶班交接_GAS_部署說明.md            ← 帶班交接 GAS 部署指南
│
└── tianying-monitor/                  ← Main automation system
    ├── README.md                      ← System documentation (English)
    ├── README_TW.md                   ← Documentation (繁體中文)
    ├── project-state.md               ← Auto-generated snapshot
    ├── project-snapshots/             ← Version snapshots
    │   └── 2026-06-22_v1.md
    │
    ├── 📜 Configuration & Setup
    ├── setup.bat                      ← Windows one-click setup
    ├── setup.sh                       ← Mac/Linux one-click setup
    ├── monitor-config.yaml            ← Monitoring configuration
    ├── .gitignore                     ← Git ignore rules
    │
    ├── 🔄 Core Automation Scripts
    ├── workflow-monitor.py            ← Main monitoring engine
    ├── auto-update.sh                 ← Scheduled update runner
    ├── skill-version-manager.py       ← Version management
    ├── failure-classifier.py          ← Failure categorization
    ├── regression-tester.py           ← Regression testing
    │
    ├── 📊 Reporting & Analysis
    ├── snapshot-generator-simple.py   ← Project state snapshot
    ├── auto-snapshot-runner-simple.py ← Snapshot scheduler
    ├── delivery-detector-simple.py    ← Delivery detection
    ├── regression-history.json        ← Historical test results
    │
    ├── 📚 Skills (AI Assistant Definitions)
    ├── skills/
    │   ├── tianying-tool-converter.md     ← Tool conversion skill
    │   └── skill-updater.md               ← Auto-learning skill
    ├── SKILL_tianying-tool-converter.md   ← Copy for reference
    ├── SKILL_skill-updater.md             ← Copy for reference
    │
    ├── 📖 Documentation
    ├── LEVEL3_CHECKLIST_ARCHITECTURE.md   ← Deployment checklist + architecture
    ├── DEPLOYMENT_GUIDE_LEVEL3.md         ← Full deployment guide
    ├── GOOGLE_DRIVE_SETUP_GUIDE.md        ← Google Drive integration
    ├── GitHub_Upload_Guide_TW.md          ← GitHub upload guide (Chinese)
    │
    └── 📁 Logs & Data (auto-generated)
        └── logs/                      ← Execution logs
        
```

---

## 🎯 Core Components Explained

### 1. **workflow-monitor.py** - The Monitoring Engine

**Purpose**: Monitors tool conversions and captures failures.

**Key Functions**:
- `_load_failure_log()` - Load failure history from JSON
- `_save_failure_log()` - Persist failures to disk
- `review_failure_log()` - Display summary of failures
- `auto_learn()` - Trigger skill updates when thresholds met
- `convert_tool()` - Monitor a single tool conversion

**Usage**:
```bash
# View failure log
python3 workflow-monitor.py --mode review-log

# Auto-learn and update skills
python3 workflow-monitor.py --mode auto-learn

# Convert a specific tool (with monitoring)
python3 workflow-monitor.py --mode convert --tool tool_report.html
```

**Key Thresholds** (in `monitor-config.yaml`):
- `critical_threshold: 2` - 2 critical errors trigger auto-learn
- `important_threshold: 4` - 4 important errors trigger auto-learn

### 2. **skill-version-manager.py** - Version Control

**Purpose**: Manages skill versions and merges new rules without conflicts.

**Key Features**:
- Semantic versioning (v1.0, v1.1, v1.2, etc.)
- Changelog generation with timestamps
- Conflict detection before updates
- Auto-backup of previous versions
- Regression testing before deployment

**Version Format**: `v{major}.{minor} ({date}，自動迭代第 {iteration} 輪)`
- Example: `v1.2 (2026-06-25，自動迭代第 5 輪)`

### 3. **regression-tester.py** - Quality Assurance

**Purpose**: Validates skill updates don't break existing functionality.

**Required Checks**:
- `frontmatter_exists` - YAML frontmatter present
- `section_structure_valid` - Markdown structure intact
- `file_size_ok` - File not corrupted
- `no_duplicate_rules` - No duplicate conversion rules
- `all_dates_valid` - All timestamps valid ISO format
- `all_priorities_valid` - All priorities are "critical" or "important"

**Behavior**: Fails on error = True (updates blocked if tests fail)

### 4. **failure-classifier.py** - Categorization

**Purpose**: Categorizes failures into sections for targeted learning.

**Priority Levels**:
- **critical** - Blocks tool conversion (≥2 triggers learning)
- **important** - Degrades functionality (≥4 triggers learning)

**Predefined Sections**:
- SOP 驗證 (Process verification)
- 規範檢查清單 (Standards checklist)
- 品牌規範 (Brand standards)
- GAS 設計方案 (Google Apps Script design)
- 工號狀態傳遞修正 (Employee ID status transfer)
- 照片上傳統一方案 (Photo upload standard)
- 權限規劃 (Permission planning)

### 5. **monitor-config.yaml** - Configuration Hub

**Key Sections**:

```yaml
monitoring:
  failure_patterns:
    - pattern: "node --check failed"
      priority: "critical"
      section: "SOP 驗證"
    # ... more patterns

auto_trigger:
  critical_threshold: 2
  important_threshold: 4
  time_based: "0 */6 * * *"  # Cron format
  batch_size: 5

versioning:
  format: "v{major}.{minor} ({date}，自動迭代第 {iteration} 輪)"
  max_iterations_per_day: 3

regression_test:
  enabled: true
  fail_on_error: true
```

---

## 🔄 Development Workflow

### Typical AI Assistant Tasks

#### Task 1: Update Failure Patterns
**When**: New failure type discovered
**How**:
1. Add new pattern to `monitoring.failure_patterns` in `monitor-config.yaml`
2. Update the corresponding skill in `skills/*.md`
3. Add regression test case in `regression-tester.py`
4. Verify with: `python3 workflow-monitor.py --mode review-log`

#### Task 2: Enhance Tool Conversion Skill
**When**: Conversion fails on specific tool
**How**:
1. Review failure in `failure-log.json`
2. Update `skills/tianying-tool-converter.md`
3. Add new rule to checklist or workflow
4. Run regression tests: `python3 regression-tester.py`
5. Manually test on sample tool

#### Task 3: Improve Auto-Learning Algorithm
**When**: Skill not learning from failures effectively
**How**:
1. Analyze recent failures with `failure-classifier.py`
2. Update extraction logic in `skill-version-manager.py`
3. Adjust thresholds in `monitor-config.yaml`
4. Test with: `python3 workflow-monitor.py --mode auto-learn`

#### Task 4: Add New Failure Detection
**When**: System missing detection for new error type
**How**:
1. Identify failure pattern
2. Add to `failure_patterns` in `monitor-config.yaml`
3. Update failure classifier to categorize it
4. Create test case
5. Verify detection with sample input

---

## 🛠️ Development & Output Standards

### 編碼規範
1. **完整可直接貼上程式碼**：絕不省略、截斷或使用「其餘保持不變」
2. **修改前說明**：修改內容、影響範圍、關鍵決策理由
3. **中文註解與變數**：所有註解、變數說明、UI文字均為繁體中文
4. **成功/失敗反饋**：成功用綠色#4ADE80、失敗用紅色#F87171，必須有Toast/Modal提示
5. **程式碼交付格式**：檔名、存放位置、貼上說明，包含完整路徑

### 天鷹保全設計規範

**色彩系統**:
```
背景        #0A0C10 / #0D0F14
主色（金）  #D4A800 / #FFD700 / #F0C040
副色（靛）  #818CF8 / #6366F1
成功綠      #4ADE80 | #22C55E
錯誤紅      #F87171 | #E53E3E
警告橙      #FB923C
文字        #F5F5F5 / #F0EDE6
```

**元件與風格**:
- **字型**: Microsoft JhengHei, Noto Sans TC, sans-serif
- **圖示**: Tabler Icons (npm: @tabler/icons)
- **主按鈕**: 金色漸層 (linear-gradient(135deg, #D4A800 0%, #FFD700 100%))
- **副按鈕**: 靛藍漸層 (linear-gradient(135deg, #818CF8 0%, #6366F1 100%))
- **卡片**: Glassmorphism 低透明白色邊框 (rgba(255,255,255,0.1))
- **品牌**: 天鷹保全 / TIANYING SECURITY · DATA SYSTEM

**RWD要求**:
- LOGO與外框: `max-width:100%, height:auto, object-fit:contain`
- 行動端: 絕不破版溢出
- Splash動畫: 同心圓旋轉金色光環 (ring1順時2.4s, ring2逆時1.8s, ring3順時3s)

### 通訊模式

**穴居人高密度對話**：極度精簡、無客套話、高資訊密度
- 直接切入重點，不寒暄不重述
- 極致優化Token消耗
- 使用繁體中文

---

## 📚 Key Concepts & Conventions

### 1. Skill Format

All skills follow YAML frontmatter + Markdown:

```markdown
---
name: skill-name
description: What this skill does
---

# Skill Title

[Content in Markdown format]
```

**Location**: `skills/*.md` (local) & `/mnt/skills/user/*/SKILL.md` (deployed)

### 2. Failure Log Format

```json
{
  "failures": [
    {
      "id": "unique-id",
      "timestamp": "2026-06-22T10:30:45.123Z",
      "tool": "tool_report.html",
      "type": "critical",
      "section": "品牌規範",
      "pattern": "React version mismatch",
      "error_message": "...",
      "context": {...},
      "learned": false,
      "version": "v1.0"
    }
  ],
  "last_updated": "2026-06-22T10:30:45.123Z"
}
```

**Location**: `/tmp/failure-log.json` (local) & `/mnt/user-data/outputs/failure-log.json` (cloud)

### 3. Version History Format

```yaml
# In SKILL.md under "## 更新歷史"

## 更新歷史

### v1.2 (2026-06-25，自動迭代第 5 輪)
- Fixed React 19 UMD detection (critical)
- Improved GAS action conflict handling (critical)
- Added empId pass-through validation (important)

### v1.1 (2026-06-23，自動迭代第 2 輪)
- Initial learning from first failures

### v1.0 (2026-06-22)
- Initial release with core conversion workflow
```

### 4. Configuration Naming Conventions

```yaml
paths:
  monitor_dir: "/mnt/user-data/outputs"      # Tool outputs to monitor
  failure_log: "/tmp/failure-log.json"       # Failure database
  skill_path: "/mnt/skills/user/*/SKILL.md"  # Skill location
  notify_file: "/tmp/skill-update-notification.txt"  # Notifications

# Note: /tmp on Linux = temporary (cleared on reboot)
# /mnt/user-data = persistent cloud storage
```

### 5. Tool Format Standards

所有HTML工具必須遵守以下結構與檢查清單：

**基礎框架**：
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>天鷹保全 · [工具名稱]</title>
  
  <!-- React 18.3.1 (絕對禁止 19.x) -->
  <script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
  
  <!-- Tabler Icons -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons@latest/tabler-icons.css">
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: #0A0C10; 
      color: #F5F5F5; 
      font-family: 'Microsoft JhengHei', 'Noto Sans TC', sans-serif;
    }
  </style>
</head>
<body id="root">
  <!-- App content -->
</body>
</html>
```

**QA檢查清單**：
- ✅ HTML標籤完整閉合（不能有 `<div>` 未配 `</div>`）
- ✅ Tabler Icons 正確引入
- ✅ URLSearchParams 解析 `?empId=` 工號狀態傳遞
- ✅ 返回主選單按鈕（保留工號狀態，不遺失）
- ✅ 大量複製貼上防重去重機制 (Deduplication)
- ✅ `node --check` 語法驗證通過
- ✅ React 版本必須 18.3.1（非19.x）
- ✅ 行動端RWD無破版溢出
- ✅ Glassmorphism卡片實作完整
- ✅ 成功/失敗用色精確（綠#4ADE80/紅#F87171）

**驗證命令**：
```bash
# React版本驗證
grep -c "react/18.3.1" tool_*.html  # 應 ≥1
grep -c "19.0.0\|19.1" tool_*.html  # 應 0（任何19版本都是bug）

# 語法驗證
node --check tool_report.html

# 標籤閉合檢查
grep -o '<[^/>]*>' tool_report.html | grep -v '/>' | sort | uniq -c
```

---

## 🔧 Google Apps Script (GAS) 標準

所有GAS後端均需遵守以下規範：

### doPost 函數簽名
```javascript
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, empId, data } = payload;
    
    // 驗證empId（工號必傳）
    if (!empId) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', msg: '工號遺失' })
      ).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 動作路由
    switch(action) {
      case 'submit':
        return handleSubmit(empId, data);
      case 'update':
        return handleUpdate(empId, data);
      default:
        throw new Error(`未知動作: ${action}`);
    }
  } catch(err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', msg: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

### 試算表主鍵規範
- **主鍵型態**：純數字流水號 (1, 2, 3, ...)
- **禁止**：UUID (e.g. "a1b2c3d4-e5f6..."), 隨機英數字串
- **生成方式**：`lastRow() + 1` 或自增欄位

### 前後端通訊格式
```javascript
// 前端送出
const payload = {
  action: 'submit',
  empId: '12345',  // 必傳
  data: {
    title: '事故報告',
    description: '...',
    timestamp: new Date().toISOString()
  }
};

// GAS回應（統一JSON格式）
{
  status: 'ok' | 'error',
  msg: '訊息文字',
  data: {...}  // 可選，返回新資料
}
```

### 工號狀態傳遞檢查
- ✅ 前端URLSearchParams解析 `?empId=12345`
- ✅ GAS接收empId並驗證（非空、非null）
- ✅ 後續操作均記錄empId
- ✅ 返回前端時保留empId在返回URL中
- ✅ 返回按鈕不遺失工號狀態

### 照片/檔案上傳規範
- **統一資料夾**：Google Drive 公告資料夾 (1K_RR…)
- **存放命名**：`[日期]_[工號]_[功能名稱].png`
- **驗證**：上傳前檢查檔案大小、格式
- **錯誤回應**：上傳失敗時返回明確錯誤訊息

---

## 🚀 Deployment & Scheduling

### One-Click Setup (Recommended)

**Windows**:
```bash
# Double-click setup.bat
# Creates Task Scheduler job
# Runs every 6 hours automatically
```

**Mac/Linux**:
```bash
chmod +x setup.sh
./setup.sh
# Sets up crontab entry: 0 */6 * * * /path/to/auto-update.sh
```

### Manual Cron Setup

```bash
crontab -e

# Add this line:
# 0 */6 * * * cd /path/to/tianying-monitor && python3 workflow-monitor.py --mode auto-learn

# Verify:
crontab -l | grep workflow-monitor
```

### Verify Deployment

```bash
# Test monitoring
python3 workflow-monitor.py --mode review-log

# Should show:
# ✅ No failure records (System running well)
# OR
# Found X failures (Y critical, Z important)

# Test learning
python3 workflow-monitor.py --mode auto-learn

# Check cron/Task Scheduler
crontab -l          # Linux/Mac
schtasks /query     # Windows
```

---

## 🎯 Team Operational Workflows

### 📋 專案經理職責流程

**每次工作完成後**：
1. 附上進度摘要 (已完成 / 進行中 / 待辦)
2. 列舉已完成項目
3. 主動提醒尚未完成功能
4. 標註下一步行動

**範例回報格式**：
```
## 進度摘要
✅ 已完成：
- HTML框架建立 + React18.3.1整合
- Tabler Icons引入與測試
- 工號解析實作

🔄 進行中：
- GAS後端編寫（50%）
- 照片上傳流程

⏳ 待辦：
- 完整QA測試
- 部署到GitHub Pages
```

### 💡 創意總監延伸建議

**何時提出建議**：
- 完成功能後，延伸相關可行功能
- 聚焦對天鷹保全業務有幫助方向
- 技術上可實現（HTML+GAS範圍內）

**建議呈現格式**：簡短列點，不超過3項
```
💡 建議延伸功能：
• [功能1]：[簡述用途] → 預計工時X小時
• [功能2]：[簡述用途] → 預計工時X小時
• [功能3]：[簡述用途] → 預計工時X小時
```

---

## 📖 Common AI Assistant Tasks & Workflows

### When a User Says...

#### "A tool conversion is failing"

**Steps**:
1. Run: `python3 workflow-monitor.py --mode review-log`
2. Look for recent failures with `"learned": false`
3. Examine the failure's `error_message` and `context`
4. Check if error matches known pattern in `monitor-config.yaml`
5. If new pattern: Add to `failure_patterns` and update skill
6. If known pattern: Check skill version, may need to manually trigger update

#### "Update the tool conversion skill with new rules"

**Steps**:
1. Review existing rules in `skills/tianying-tool-converter.md`
2. Add new section or enhance existing workflow
3. Test changes locally if possible
4. Update version in frontmatter
5. Add changelog entry under "## 更新歷史"
6. Run regression tests: `python3 regression-tester.py`
7. Push to branch (not main yet)

#### "Create a new failure pattern"

**Steps**:
1. Define pattern name (e.g., "React version mismatch")
2. Add to `monitor-config.yaml` under `failure_patterns`
3. Update `failure-classifier.py` if categorization is complex
4. Add detection logic to relevant skill
5. Create test case in regression test suite
6. Verify with: `python3 failure-classifier.py --pattern "new pattern" --input test.html`

#### "Deploy system to new computer"

**Steps**:
1. Clone repository: `git clone https://github.com/sky03104/tianying-security.git`
2. Navigate: `cd tianying-security/tianying-monitor`
3. Run setup: `bash setup.sh` (Mac/Linux) or `setup.bat` (Windows)
4. Verify: `python3 workflow-monitor.py --mode review-log`
5. Check schedule: `crontab -l` (Mac/Linux) or Task Scheduler (Windows)

#### "Fix a merge conflict in SKILL.md"

**Steps**:
1. Open conflicted file
2. Review both versions using version manager: `python3 skill-version-manager.py --analyze-conflict`
3. Manually merge preserving both:
   - Frontmatter (metadata)
   - All sections and rules
   - Changelog (newer version wins)
4. Run regression tests: `python3 regression-tester.py`
5. Commit with message: "fix: resolve SKILL.md version conflict (manual merge)"

---

## 🔍 Troubleshooting Guide

### Python Not Found

```bash
# Check installation
python3 --version  # Should be 3.8+

# If not found, install:
# Ubuntu/Debian: sudo apt-get install python3
# Mac: brew install python3
# Windows: Download from python.org
```

### Schedule Not Running

**Linux/Mac**:
```bash
# Check crontab
crontab -l | grep workflow-monitor

# Check logs
cat /tmp/auto-update-summary.txt
tail -50 /tmp/tianying-auto-update.log

# Re-run setup
bash setup.sh
```

**Windows**:
```cmd
# Check Task Scheduler
schtasks /query /tn "tianying-auto-update" /v

# Check summary
type %temp%\auto-update-summary.txt

# Re-run setup
setup.bat
```

### Failures Not Being Captured

```bash
# Check failure log
python3 workflow-monitor.py --mode review-log

# Check thresholds in config
grep -A2 "auto_trigger:" monitor-config.yaml

# Manually test capture
python3 workflow-monitor.py --mode convert --tool test.html

# Check monitoring directory
ls -la /mnt/user-data/outputs/
```

### Regression Tests Failing

```bash
# Run tests with verbose output
python3 regression-tester.py --verbose

# Check specific test
python3 regression-tester.py --test frontmatter_exists --file skills/skill.md

# View test results
cat regression-history.json
```

---

## 📊 Key Directories & Their Purpose

| Directory | Purpose | Notes |
|-----------|---------|-------|
| `/mnt/user-data/outputs` | Tool conversion outputs | Cloud storage, monitored |
| `/tmp/failure-log.json` | Failure database (temporary) | Cleared on reboot |
| `/mnt/skills/user/*/SKILL.md` | Deployed skills | Live in production |
| `skills/` | Local skill copies | For version control |
| `logs/` | Execution logs | Auto-generated |
| `project-snapshots/` | State snapshots | Auto-generated, versioned |

---

## 🔐 Security & Best Practices

### When Modifying Configuration

- **Never hardcode secrets** in YAML or Python files
- **Use environment variables** for API keys, webhooks
- **Validate all file paths** before reading/writing
- **Check permissions** before deploying to `/mnt/` paths

### When Updating Skills

- **Always run regression tests** before committing
- **Maintain backward compatibility** in failure detection
- **Document breaking changes** in changelog
- **Test on sample tools** before wide deployment

### When Handling Failures

- **Never delete failure records** automatically
- **Archive old failures** quarterly
- **Preserve error messages** for analysis
- **Keep timestamps** for audit trail

---

## 🎓 Learning Resources

### Documentation Files (In Order of Importance)

1. **README.md** - Quick start guide
2. **LEVEL3_CHECKLIST_ARCHITECTURE.md** - System architecture & deployment checklist
3. **DEPLOYMENT_GUIDE_LEVEL3.md** - Detailed deployment instructions
4. **SKILL_tianying-tool-converter.md** - Tool conversion reference
5. **SKILL_skill-updater.md** - Auto-learning process reference

### Key Skills to Understand

```
SKILL_tianying-tool-converter.md
  ├─ Brand Standards (React 18.3.1, Splash, Colors)
  ├─ Conversion Workflow (7 steps)
  └─ Checklist & Validation

SKILL_skill-updater.md
  ├─ Learning Algorithm
  ├─ Version Management
  └─ Regression Testing
```

---

## 📝 Common Git Workflows

### Before Starting Work

```bash
# Check current branch
git branch

# Update from remote
git fetch origin claude/claude-md-docs-4bz58p
git pull origin claude/claude-md-docs-4bz58p

# Verify you're on the right branch
git status
```

### Making Changes

```bash
# Make your changes to files
# Then stage them
git add tianying-monitor/workflow-monitor.py

# Commit with clear message
git commit -m "fix: improve failure detection for React version mismatch"

# Push to your branch
git push -u origin claude/claude-md-docs-4bz58p
```

### Commit Message Conventions

```
feat:  New feature (e.g., "feat: add Slack notification support")
fix:   Bug fix (e.g., "fix: resolve SKILL.md merge conflict")
chore: Maintenance (e.g., "chore: update regression test cases")
docs:  Documentation (e.g., "docs: update deployment guide")
refactor: Code cleanup (e.g., "refactor: simplify failure classifier")
test:  Test updates (e.g., "test: add case for React 19 detection")
```

---

## ✅ QA檢查清單 (Pre-Push Validation)

**程式碼品質**：
- [ ] 程式碼遵循現有模式（無創意破格）
- [ ] Python語法有效：`python3 -m py_compile file.py`
- [ ] YAML有效：`python3 -c "import yaml; yaml.safe_load(open('file.yaml'))"`
- [ ] Markdown正確frontmatter
- [ ] 回歸測試通過：`python3 regression-tester.py`
- [ ] 失敗日誌仍可讀：`python3 workflow-monitor.py --mode review-log`

**HTML/前端工具**：
- [ ] HTML標籤完整閉合，無遺漏
- [ ] React版本確認為18.3.1（非19.x）
- [ ] Tabler Icons正確引入
- [ ] URLSearchParams正確解析 `?empId=`
- [ ] 返回按鈕保留工號狀態
- [ ] 色彩精確（#4ADE80成功/紅#F87171失敗）
- [ ] Toast/Modal提示完整
- [ ] 行動端RWD無破版
- [ ] 去重機制(Deduplication)實作

**GAS後端**：
- [ ] doPost/doGet函數簽名正確
- [ ] JSON解析/序列化無誤
- [ ] 試算表主鍵為純數字（非UUID）
- [ ] 工號狀態正確傳遞回前端
- [ ] 錯誤處理完整（不返回null）

**文件與通訊**：
- [ ] 提交訊息遵循約定（feat/fix/chore/docs）
- [ ] 變更說明清晰（修改內容+影響範圍）
- [ ] 所有註解均為繁體中文
- [ ] 完整可直接貼上程式碼（無省略）
- [ ] 功能不破壞既有運作
- [ ] **有結構性變動 → 已同步 `brain_map.html`（節點/關聯）並通過完整性檢查**（見「知識星空大腦」自動同步規則）

---

## 🔗 Quick Reference

### File Paths (Most Common)

```
Project Root:
  /home/user/tianying-security/

Main System:
  /home/user/tianying-security/tianying-monitor/

Configuration:
  ./monitor-config.yaml

Python Scripts:
  ./workflow-monitor.py
  ./skill-version-manager.py
  ./regression-tester.py
  ./failure-classifier.py

Skills:
  ./skills/tianying-tool-converter.md
  ./skills/skill-updater.md

Documentation:
  ./README.md
  ./LEVEL3_CHECKLIST_ARCHITECTURE.md
  ./DEPLOYMENT_GUIDE_LEVEL3.md

Logs (generated):
  /tmp/failure-log.json
  /tmp/auto-update-summary.txt
  /tmp/tianying-auto-update.log
```

### Common Commands

```bash
# Monitoring
python3 workflow-monitor.py --mode review-log

# Learning
python3 workflow-monitor.py --mode auto-learn

# Testing
python3 regression-tester.py

# Version Management
python3 skill-version-manager.py --list-versions

# Classification
python3 failure-classifier.py --analyze

# Snapshots
python3 snapshot-generator-simple.py
```

---

## 🎯 Next Steps for AI Assistants

1. **First Read**: Review `README.md` for quick overview
2. **Then Read**: Study `LEVEL3_CHECKLIST_ARCHITECTURE.md` for system design
3. **Deep Dive**: Review both skills in `skills/` directory
4. **Practice**: Try running monitoring commands locally
5. **Contribute**: Make improvements to scripts or documentation

---

## 📞 Support & Issues

### When You're Stuck

1. Check the **Troubleshooting Guide** above
2. Review relevant **skill documentation** (SKILL_*.md)
3. Check **failure log**: `python3 workflow-monitor.py --mode review-log`
4. Review recent **git history**: `git log --oneline -10`
5. Check **regression test results**: `cat regression-history.json`

### Before Creating an Issue

- [ ] Reproduced the problem locally
- [ ] Checked existing issues/documentation
- [ ] Gathered error message and context
- [ ] Identified which component is affected

---

## 🧠 知識星空大腦 / brain_map.html

專案含一個互動式 3D 知識圖譜 `brain_map.html`（Three.js r128，單一 HTML，瀏覽器直接開、免伺服器），把模組/功能/關聯視覺化。節點＝功能，連線＝關聯，點節點看說明。

### 維護指令（對 AI）

當使用者說「**請更新知識圖譜**」時：
1. **掃描專案**：讀主要程式檔（.html/.gs/.py/.js…），識別功能模組、頁面、GAS endpoint、資料表。
2. **決定主題 TOPICS**：3～6 個，繁中名＋色碼，更新 `TOPICS`。目前用 6 主題：`core` 主控台核心(金 #D4A800)、`tools` 前端工具(綠 #4ADE80)、`backend` 後端 GAS(靛 #818CF8)、`data` 資料儲存(橙 #FB923C)、`infra` 部署/監控(藍 #38BDF8)、`todo` 待辦/規劃(紅 #F87171)。
3. **節點 NODES**：每個功能一個節點。`id` 純整數接續最大值；`title` 繁中 ≤15 字；`topic` 對應 key；`pos` [x,y,z] 範圍 ±1.4；`note` 一句話（可放規則/TODO/注意）。
4. **關聯 EDGES**：函式呼叫、資料讀寫、頁面連結、功能依賴、流程相鄰 → 各建一條 `[idA, idB]`。
5. **只改** `=== BRAIN_MAP_DATA_START ===` 與 `=== BRAIN_MAP_DATA_END ===` 之間（`BRAIN_CONFIG`/`TOPICS`/`NODES`/`EDGES`），**不得動標記外的 Three.js 程式**。改完跑資料完整性檢查（edges 不指向缺失節點、id 不重複、topic 有對應）。
6. **回報摘要**：新增/修改節點（列標題）、新增關聯數、主題清單。

座標分區參考：core 中央(z 正)、tools 右(x 0.5~1.4)、backend 左(x -1.4~-0.5)、data 下(y -1.4~-0.7)、infra 後(z -1.4~-0.7)、todo 頂(y 0.8~1.4)。同主題節點間距 ±0.25~0.45 避免重疊。

**增量指令**也支援：「新增節點：X，屬於 Y 主題」「把節點 X 的說明改成…」「在 X 和 Y 之間新增關聯」「刪除節點 X」「把主題 X 顏色改成 #…」。

> 詳細規則原稿見 `CLAUDE_CODE_BRAIN_MAP.md`。

### 📋 角色地點對應表（咖哩說「角色地點對應表」就是指這個）

海賊王人物進駐工具節點的固定對應，資料來源是 `brain_map.html` 的 `NODE_CHAR`（節點→角色）與 `NODE_IMG_MAP`（節點→地點場景圖）。改動角色分配/新增地點圖時，**這裡也要同步更新**，並跑一次 `node --check` + id/edge 完整性檢查。

| 節點id | 工具 | 角色 | 地點圖 |
|---|---|---|---|
| 0 | 主控台 index.html | 路飛 | 黃金梅利號 ✅（1.4倍放大） |
| 1 | 登入與角色系統 | 艾斯 | 待補（白鬍子海賊團莫比迪克號） |
| 2 | 首頁待審卡片 | 薩波 | 待補（革命軍本部） |
| 3 | 事故報告工具 | 羅賓 | 圖書室 ✅ |
| 4 | 匿名表揚/反應 | 喬巴 | 醫務室 ✅ |
| 5 | 開店前進出登錄 | 香克斯 | 日出羊頭甲板 ✅ |
| 6 | 打烊後快速登錄 | 羅 | 夜晚羊頭甲板 ✅ |
| 7 | 今/明日哨表 | 甚平 | 舵輪室 ✅ |
| 8 | 班表查詢 | 娜美 | 柑橘園 ✅ |
| 9 | 緊急聯絡清單 | 烏索普 | 瞭望台 ✅ |
| 10 | 資料上傳工具 | 弗蘭奇 | Franky House 工房 ✅ |
| 11 | 簽到/車輛/工作 | 索隆 | 待補（道場） |
| 12 | 請假申請 | 山治 | 待補（廚房） |
| 29 | 天鷹 AI 小助手 | 布魯克 | 待補（鋼琴） |
| 37 | 物流車輛統計 | 佩羅娜 | 待補（恐怖三詭帆船） |
| 135 | 帶班交接事項 | 克比 | 待補（海軍本部） |

**角色圖檔**：香克斯/羅/佩羅娜/克比/艾斯/薩波已上傳並壓縮（`shanks.png`/`law.png`/`perona.png`/`coby.png`/`ace.png`/`sabo.png`），皆為透明底、380~480px高，跟其他角色圖同規格。

**路飛跑步動畫**：`RUN_IMG_MAP['路飛']` 目前只有單張去背裁切的靜態跑步姿勢（`run_luffy_f1.png`），不像羅賓有 F1~F6 六張連續動畫幀，之後有更多姿勢素材可直接擴充陣列。

**地點圖放大機制**：`NODE_IMG_SCALE`（node0=1.4倍）可覆寫個別節點地點圖顯示尺寸；放大某節點時記得同步檢查 `drawLiveUsers()` 的使用者圍站半徑是否也要套用同倍率（已處理 node0 這個案例，邏輯是自動比對最近的放大節點）。

### ⛔ 自動同步規則（強制，使用者已要求每次改動自動同步）

**只要本次工作有「結構性變動」，AI 必須在結束回合前同步更新 `brain_map.html` 的資料區，並在進度摘要回報，不需使用者另外開口。** 結構性變動定義：

- 新增／刪除／改名 任一工具（`tool_*.html`、`index.html` 內嵌 tpl-*、獨立頁）
- 新增／刪除 GAS endpoint（`action` 路由）或 GAS 檔
- 新增／刪除 資料表分頁、localStorage 資料庫、Drive 資料夾用途
- 模組間關聯改變（新呼叫、新資料流、新頁面連結）
- 待辦狀態重大變化（TODO 完成/新增，對應 `todo` 主題節點）

**做法**：依上方「維護指令」更新 `TOPICS/NODES/EDGES`（只動資料標記區）→ 跑完整性檢查（無斷邊／無重複 id／topic 有對應）→ 與該次變更**同一個 commit** 一起提交。純文案／樣式微調、不改結構者可略過。

---

## 📝 待辦事項追蹤 (Backlog)

### 🔴 高優先 - UI優化

#### [TODO-01] 打烊後快速登錄工具 → 登錄介面明顯化
- 整體字型放大
- 欄位標題文字換色（專櫃/廠商 批次登記、進場時間、退場時間 等）
- 重點欄位（專櫃/廠商 批次登記、進場時間、退場時間）底色換色
- **位置**：`index.html` → `tpl-closing` (base64 解碼後)
- **狀態**：✅ 完成（2026-06-22）

#### [TODO-02] 打烊後快速登錄工具 → 今日介面明顯化
- 整體字型放大（參考標準：登錄介面右下角放大鏡施工單查詢的資料字大小）
- **位置**：`index.html` → `tpl-closing` 今日 tab
- **狀態**：✅ 完成（2026-06-22）

### 🟡 中優先 - 新工具開發

#### [TODO-03] 開店前快速登錄工具 → 獨立檔 + 雙GAS共用資料庫
- **狀態**：✅ 完成（2026-06-27）

**實作結果（2026-06-27）**：

| 項目 | 值 |
|------|-----|
| 工具檔案 | `tool_opening.html`（獨立檔，非內嵌 base64） |
| index.html 串接 | `OPENING_PAGE_URL` + TOOLS 卡片 `toolId:"opening"` + 標題 + iframe `src`（仿 `post.html` 模式） |
| 主題色 | 靛藍（`#6366F1` / `#A5B4FC` / `rgba(99,102,241,*)`），與打烊金色區隔 |
| 進出記錄分頁 | `開店進出資料表` |
| 記錄試算表 | `1mxCRUxbuPBuReP1gWK3unFbjtOkAuSkBakQeaH9Rdyc`（開店） |
| 記錄 GAS | `BUILT_IN_GAS_URL`（新部署開店 GAS，待使用者部署後填入） |
| 資料庫 GAS | `DB_GAS_URL` = 打烊 GAS URL（共用 `_SharedDB`，廠商/監工/檢查者即時同步） |
| 主鍵 | 純數字流水號（`nextRow-1`），符合主鍵規範（非隨機英數） |
| GAS 部署說明 | `tool_opening_GAS_部署說明.md` |

**架構決策**：採方案A（雙 GAS URL）。GAS 用 `getActiveSpreadsheet()` 只能讀寫綁定試算表，故資料庫走打烊 GAS、記錄走開店 GAS，各司其職。開店試算表無現成 GAS，已撰寫並附部署說明。

**待使用者動作**：依 `tool_opening_GAS_部署說明.md` 部署開店 GAS → 取得 `/exec` 網址 → 填入 `BUILT_IN_GAS_URL`（或貼工具設定頁）。

---

**原評估結果（2026-06-22）**：

打烊後快速登錄工具的三個資料庫：

| 資料庫 | localStorage key | 雲端同步 | Google Sheet |
|--------|-----------------|---------|-------------|
| 廠商／專櫃資料庫 | `hsh_shops` | ✅ 手動同步 | ID: `1TnN3iJb1w9XTuw0-QuNrtXEOa71KCCy7y8Q3_1b1FmI` |
| 監工人員資料庫 | `hsh_persons` | ✅ 手動同步 | 同上 |
| 檢查者資料庫 | `hsh_ins` | ✅ 手動同步 | 同上 |
| 施工類型 | `hsh_wt` | ✅ 手動同步 | 同上 |

**同步機制**：
- GAS URL: `AKfycbwZ5f7h_Lv_MOCxPrqPpBPKA917-JKmEz5DDekYixLDsGf1QAKCTOuVxwo18OYKX7a4ng/exec`
- 雲端同步為**手動觸發**（拉取/推送按鈕），不是即時自動
- 進出記錄自動寫入 Google Sheets（不需手動）
- 分頁名稱：`進出資料表`

**建議共用方案（確認後再動工）**：
- 方案A（推薦）：開店前工具使用**相同 GAS URL** → 共用廠商/監工/檢查者三個資料庫，只寫入不同分頁（`開店進出資料表`）
- 方案B：開店前工具讀取同一 localStorage，直接共享本地端資料，不需新增GAS
- 關鍵差異：進出記錄分頁名稱需區分（打烊用「進出資料表」，開店用「開店進出資料表」）

**→ 已於 2026-06-27 採方案A 變體（雙 GAS URL）完成，見上方實作結果。**

#### [TODO-04] 班表查詢工具 → 移除上傳功能
- 班表上傳 tab 目前僅 `canE`（管理員）角色可見（`k: "upload", l: "⬆ 上傳"`）
- 統一由「資料上傳工具」(`tpl-upload`) 上傳班表
- 做法：移除 `upload` tab 條件判斷，讓所有角色都不顯示上傳頁籤
- **位置**：`index.html` 班表功能 tabs 陣列（第18664行）
- **狀態**：✅ 完成（2026-06-22）

#### [TODO-05] 班表查詢工具 → 介面優化（字體、排版）
- 問題：字太小、排版雜亂，同事年紀大眼睛不好
- 需求：放大整體字型，簡化排版，增加行距與對比
- **位置**：`index.html` 班表功能 CSS + JSX
- **狀態**：✅ 完成（2026-06-30）

### 🟠 需設計確認後再動工

#### [TODO-06] 主管帳號首頁 → 待審報告卡片（設計稿待確認）

**規格**：
- 條件：登入帳號為公司主管時，首頁四格卡片下面兩個改為：
  - 「待審報告」：讀取**事故報告**試算表，顯示未處理筆數
  - 「待審匿名回報」：讀取**匿名表揚/舉報**試算表，顯示未處理筆數
- 試算表需新增「狀態」欄位：`未讀` / `已讀` / `處理中` / `已處理`
- 首頁卡片顯示狀態 ≠ `已處理` 的筆數
- 主管可點進去查看列表 → 點單筆查看詳情 → 有按鈕可修改狀態

**需產出設計稿（等確認後才做 GAS 串接）**：
- [ ] 主管首頁卡片 UI
- [ ] 案件列表頁 UI
- [ ] 案件詳情頁 UI（含狀態修改按鈕）

**同步需修改**：
- `tool_report.html` GAS 試算表新增「狀態」欄位
- `tool_feedback.html` GAS 試算表新增「狀態」欄位
- **狀態**：✅ 完成（2026-06-30）

### 🟣 新增待辦（2026-06-27 規劃）

#### [TODO-11] 團隊角色 → 生成各 AI Agents
- 把 CLAUDE.md 既有 5 角色落地成 `.claude/agents/*.md` 子代理，並擴充成三層團隊：
  - **Tier 1 主協調者**（化身咖哩、第一人稱、最終把關）
  - **Tier 2 執行團隊** 5 個（資深全端／UIUX／QA／專案經理／創意總監）
  - **Tier 3 檢視團隊** 5 個批判型（代碼／安全／規範守門員／簡潔重構／行動體驗審查官）
- 流程：執行→檢視（依觸發矩陣）→退回優化→全 PASS→主協調者 GO/NO-GO→交咖哩
- 編排手冊：`.claude/agents/_工作流程.md`（含檢視觸發矩陣 + 統一輸出契約 VERDICT + 觸發語）
- 檢視角色取法 `system_prompts_leaks`（Cursor/Claude Code 的代碼品質模式）
- **狀態**：✅ 完成（2026-06-28，共 11 Agent + 1 工作流程檔）

#### [TODO-12] 哨表自動化工作流
- 班表／哨表排班自動化：自動產表、輪值規則、衝突檢查
- **狀態**：🟡 規劃中（待規格）

#### [TODO-13] APP AI 對話助手工具 → 天鷹 AI 小助手（小天鷹）
- APP 內可「用說的」對話的 AI 助手工具（查詢工具、回報、引導操作）
- **狀態**：✅ 完成（2026-06-29，已上線 main）

**實作結果（2026-06-29）**：

| 項目 | 值 |
|------|-----|
| 工具檔 | `tool_ai_chat.html`（獨立檔，iframe 串接，J.A.R.V.I.S. 風格）|
| 後端 | `天鷹AI助手_GAS.gs`（Gemini Proxy，藏 API Key）|
| 部署說明 | `天鷹AI助手_GAS_部署說明.md` |
| AI 角色名 | 小天鷹（對員工自稱）；工具名「天鷹 AI 小助手」|
| AI 模型 | Gemini `2.0-flash` → `2.0-flash-lite`（容錯換手，免費）|
| index 串接 | `AI_CHAT_URL` + TOOLS `toolId:"aichat"`（id 17）+ iframe(allow microphone) |
| 權限 | 先限 `admin`（DEFAULT_PERMS 僅 admin），日後再開放 |
| 視覺 | LOGO 置中 + 三層金色光環，4 狀態動畫（待機/聆聽/思考/回應）|
| 輸入 | 文字 + 語音（Web Speech API）；語音回應 TTS，可調語速/聲音 |
| 回應 | 底部 sheet 由下往上彈出，右上角關閉 |
| 查資料 | 問班表/誰上班/施工單 → AI 回一句 + **自動彈出真實 APP 畫面**（明日哨表/班表/施工單）|
| 管理員控制台 | ⚙️ 浮動鈕（admin）：禁止話題、強制表達層級（存 GAS Script Properties）|
| 人性化 | 口語化大字體、查不到不掰、問題不清楚反問、個人化習慣記憶（localStorage `hsh_ai_profile_{empId}`）|

**待使用者動作**：之後要開放給其他角色 → 改 `DEFAULT_PERMS` 加 id 17。

#### [TODO-14] 事故報告／匿名表揚 → 主管專用畫面
- 兩支工具各加 `?mode=admin` 主管模式（限 `executive`/`admin`）：手機閱讀清單＋查看詳情＋修改狀態（未讀/已讀/處理中/已處理）
- 後端：`事故與表揚_後端_GAS_v3.1.gs`（兩分頁加「狀態」欄、新增 `getReports`/`getFeedback` 讀清單、`updateStatus` 改狀態）
- 搭配 TODO-06 首頁待審卡片
- **位置**：`tool_report.html`、`tool_feedback.html`、`index.html`(renderHome)、`事故與表揚_後端_GAS_v3.1.gs`
- **狀態**：🔄 進行中（2026-06-27）

#### [TODO-15] cec-up 上傳工具 ↔ app 內資料上傳工具 版本核對
- **背景**：施工單資料來源是咖哩每天用獨立部署的上傳工具 `https://sky03104.github.io/cec-up/`（repo `sky03104/cec-up`）把 Excel 寫進試算表；`tool_work.html` 只是讀那張表顯示
- **疑慮**：cec-up 與 app 內的「天鷹保全資料上傳工具」（`index.html` 內嵌 `tpl-upload`，base64）是同一支工具的兩份，需核對 cec-up 有無落後（少了某次修正）
- **已確認（app 側）**：兩者同名同功能；app 版無版本號字串；施工單解析欄位（申請單位／廠商專櫃名稱／施工地點／施工項目／進場時間／退場時間／監工／人數）與 `tool_work.html` 讀取欄位一致 → 資料管線通
- **卡點**：cec-up 在另一 repo（不在授權範圍）＋代理層擋 `*.github.io`，本 session 無法抓取比對
- **下一步**：將 `sky03104/cec-up` 加入 Claude Code 授權 repo → 拉原始碼與 `tpl-upload` 解碼版做 diff（app 版已暫存比對基準）→ 列差異、必要時同步修正
- **狀態**：✅ 完成（2026-06-30）— 比對發現早班切換功能未同步，已補入 cec-up 並推上線

#### [TODO-16] 物流車輛統計工具 → 獨立檔 + 獨立 GAS + 新試算表
- **需求**：每天統計物流區貨車數量；三分類（1.9噸/3.5噸/8噸以上）選完輸入幾輛送出，登記時間＝送出當下；選日期查當天各分類數量；「查看整月」每日×分類統計；每月產出月統計表
- **狀態**：✅ 完成（2026-07-02），GAS 已部署、實測通過、上線 main

**實作結果（2026-07-02）**：

| 項目 | 值 |
|------|-----|
| 工具檔案 | `tool_logistics.html`（獨立檔，vanilla JS 非 React，橙色 #FB923C 主題） |
| index.html 串接 | `LOGISTICS_PAGE_URL` + TOOLS 卡片 `id:18, toolId:"logistics"` + 標題 + iframe `src`（仿 opening 模式） |
| 權限 | 全員開放（DEFAULT_PERMS 七角色皆加 18）；「設定」分頁限 admin |
| 分頁 | `物流車輛紀錄`（主資料，A~H 8 欄）＋`快捷設定`（A~C 3 欄），GAS 自動建立 |
| 主鍵 | 純數字流水號 `max(既有ID)+1`（支援刪除列，不可用列號否則重號） |
| GAS 端點 | add / update / delete / getDay / getMonth / exportMonth ＋ getShortcuts / addShortcut / updateShortcut / deleteShortcut |
| 快捷登記 | 管理員在設定頁維護快捷組合（如 1.9噸×2，可增改刪，雲端同步「快捷設定」分頁）→ 全員登記頁一鍵送出 |
| 月統計 | 工具內表格（每日×三分類＋合計）＋ `exportMonth` 產「YYYY-MM 月統計」試算表分頁 |
| 防呆 | 分類白名單、數量 1~999、送出中鎖按鈕防重、LockService 防併發、工號欄純文字保開頭 0、伺服器端蓋時間戳 |
| GAS 部署說明 | `物流車輛統計_GAS_部署說明.md` |

**部署狀態（2026-07-02）**：試算表已建、GAS 已部署（`BUILT_IN_GAS_URL` 已回填，全員自動連線）、登記/查詢/快捷實測通過。之後改 GAS 記得「管理部署→編輯→新版本」。

### 🟢 2026-07-02 ~ 07-03 已上線 main（補登）

#### 功能／修復
- **施工單監工姓名顯示遮蔽**：`tool_work.html` 監工姓名改顯示「陳X明」格式，保護個資（PR #29）
- **車牌辨識每日摘要 email**：新增 `sendDailySummary`，每天 08:00 統計昨天08:00~今天08:00（整個晚班）登記紀錄，寄 HTML 摘要信給主管/公司（分類統計＋明細＋試算表連結），`setupDailyTrigger` 一鍵建排程（PR #31）
- **公告欄連環修正**：未讀數計算、自動刷新、置頂公告重複顯示 bug；請假紀錄排序＋摺疊；工具分類調整（PR #28）
- **LINE 明日哨表群組推播**：修正 Flex Message 顏色格式錯誤導致推播失敗（PR #26）
- **過夜車輛登記人恆為「未登入」修正**：根因是簽到工具用 iframe `srcDoc` 內嵌，網址為 `about:srcdoc` 抓不到 `?empId`；修法加 `localStorage hsh_session_user` 作第二層 fallback（PR #34）
- **首頁公告排序修正**：根因是舊資料曾把公告 id 存成空字串，數學排序時被當 0 導致舊公告排到新公告前；改為「置頂優先＋id 統一轉數字比較」，並修正儲存時「更新 vs 新增」的判斷邏輯（原本用 truthy 判斷會誤判空字串 id）（PR #35）

#### brain_map.html 大改版（非結構性但工程量大，一併記錄）
- 黃金梅利號角色進駐主控台節點；索隆過載的物流工具重新分配給甚平
- 新增「動作跑者」機制：使用者送出資料時由地點角色代跑 地點→GAS→資料表→地點，取代原本使用者球體自己來回跑
- 工具節點接上實景地點圖（圖書室/醫務室已生效）
- 節點分區改「海域」式大幅分散（各主題中心拉開到距原點 2.5）+ 相機縮放範圍加大，解決節點/名字重疊問題
- 同節點多人在線時名字改圍繞節點排列，不再直向堆疊

**技術筆記（可複用）**：GAS 判斷儲存格是否為 Date 型別時 `instanceof Date` 在部署環境會誤判 `false`（跨 realm 問題），改用 `Object.prototype.toString.call(v) === '[object Date]'`；此坑於 2026-07-02 物流統計除錯中發現，已寫入下方技術經驗筆記區。

### 🟢 2026-07-04 ~ 07-05 已上線 main（效能體檢 + 帳號安全修復）

#### 效能體檢報告（`效能體檢報告_2026-07-04.md`）P0～P2 全部完成並部署
- **P0（PR #71）LOGO 圖片瘦身 + SheetJS defer**：同一張老鷹 LOGO 以 1120x980／617x554 兩種解析度全站重複內嵌 15+ 次（index.html 兩份 EAGLE_SRC、3 個 base64 內嵌模板、6 支獨立工具檔各 1~2 份），畫面實際只顯示 60~90px。用 Pillow resize 至 300x262 + 32 色量化壓到 4.2KB，同一份小圖回填所有位置。index.html：3345KB→1306KB（省60%，gzip 1825KB→325KB）；6 支獨立工具檔省 88~96%。SheetJS（900KB，僅班表匯入用）加 `defer` 不再阻塞首屏。
- **P1（PR #72）啟動誤跳錯誤 Toast + 錯誤提示補紅色**：`loadLeaveFromCloud(true)` 靜默模式兩個錯誤分支沒判斷 `silent`，網路稍慢就對所有人跳錯誤；`showToast(msg,'err')` 第二參數一直被丟棄，錯誤提示從沒紅過。修法比照 `ScheduleApp` scope 內已正確實作的 `T(msg,type)` 模式，`toast` 狀態改存 `{msg,type}` + CSS 補 `.toast-err`。
- **P2（PR #74）公告輪詢背景暫停／內嵌模板惰性解碼／施工單快取秒開／登入GAS呼叫合併**：公告輪詢加 `visibilityState` 判斷背景不打；5 個 base64 內嵌工具模板改成第一次點開才 decode（原本開機當下全解碼 1.5MB）；`tool_work.html` 加 stale-while-revalidate 本機快取，開工具先秒開上次資料、背景悄悄重新整理；登入時 `getApplications`/`getLeaveRequests`/`getSettings` 三支呼叫合併成一支 `action=bootstrap`（GAS 端直接複用既有三支函式輸出重組，前端抽出 `applyCloudSettings()` 共用）。**帶部署順序安全網**：`loadLoginBootstrap` 拿不到 `status:'ok'` 時（GAS 還沒重新部署，`doGet` 對未知 action 回錯誤）自動退回原本三支個別呼叫，前端可先上線不必等 GAS 同步部署，不會有「舊功能整個消失」的空窗期。GAS 已由咖哩手動部署完成。

#### 帳號安全／權限修復（同一輪效能體檢中順帶抓到的真 bug）
- **PR #67**：施工單個別授權每次重開就消失——GAS `setSettings`/`getSettings` 根本沒存沒回 `workAllowedIds`，前端送出的資料直接蒸發；帳號密碼換裝置就變回預設 123——重設/改密碼三處都只寫本機 `localStorage` 從未同步雲端。兩者皆補上雲端讀寫。另外 LINE 明日哨表個人版逐人推播沒清乾淨，新增「一鍵重建哨表觸發器()」清舊觸發器重建正確的群組版。**關鍵觀念**：GAS 時間觸發器執行的是「編輯器目前儲存的程式碼」而非部署版本，光改 repo 沒用。
- **PR #68**：管理員停用帳號後，該帳號手機仍可正常登入——三層破口：①登入只驗工號+密碼從未查 `status`；②自動登入(記住我/session)也不查；③雲端同步走 `getApprovedUsers`，GAS 端直接把 inactive 帳號過濾掉，手機端永遠拿不到「已停用」狀態。改用既有 `getUserDB` 端點（含停用帳號）同步，狀態比照班別「永遠以雲端為準」，並加停用即時登出。
- **PR #69**：帳號編輯（停用/改角色/重設密碼）原本 `leader`/`vicecaptain` 也能操作，依咖哩指示收緊為僅 `captain`/`executive`/`admin`，組長/副隊長只能瀏覽名單。

**這輪的方法論教訓**：效能體檢不只是量指標，實測（沙盒 Chromium + Playwright 跑真實登入流程）順手就抓到 3 個影響資安/資料正確性的真 bug（停用帳號能登入、密碼不同步、白名單存不進去）——**跑效能測試時把眼睛張大，不要只看數字**。

#### [TODO-17] 明日哨表 → 今/明日哨表雙分頁切換
- **需求**：原本只有「明日哨表」單一畫面，改成今日／明日雙分頁切換；每天 08:00 自動把當時的明日哨表內容搬到今日哨表；明日哨表若還沒更新要顯示「尚未更新」而非舊資料；同步處理試算表與 LINE 機器人
- **狀態**：✅ 完成（2026-07-03）

**實作結果（2026-07-03）**：

| 項目 | 值 |
|------|-----|
| 資料來源 | `POST_SHEET_ID` 試算表既有的 `今日哨表` 分頁（gid=466253701，原為預留空白）；不新建/不刪分頁，gid 永久不變 |
| 快照機制 | 新增 `snapshotTodayPostScheduled_`：每日 08:00（Asia/Taipei）`dst.clear()` + `Range.copyTo()` 原地覆寫 `今日哨表`（含格式/合併儲存格），`明日哨表` 分頁不受影響；完全靜默無推播無通知 |
| 觸發器 | `setupTodaySnapshotTrigger_`（08:00 daily），部署後需手動執行一次 `runSetupTodaySnapshotTrigger` + `runSnapshotTodayPostNow`（後者立即產生首份今日哨表，否則要等隔天才有資料） |
| 後端 API | `parsePostSheet_`/`parsePostFullList_` 改吃 `sheetName` 參數（預設明日哨表）；新增 `getTodayPost`；`getTomorrowPost`/`getTodayPost` 皆用新增的 `checkDateMatch_` 比對日期，不符回傳 `status:'notyet'`（不是 err），前端顯示「尚未更新/尚未產生」而非舊資料或紅色錯誤 |
| 前端 | `post.html` 新增今日/明日切換鈕（金色=今日、靛色=明日，沿用天鷹色系）；預設顯示今日；新增 `#state-empty` 中性提示狀態（🕒 圖示，非驚嘆號錯誤語氣）；切換時忽略舊分頁的過期回應（防競態） |
| LINE 機器人 | 新增「今日哨點」文字指令 → `handleMyTodayPost_`（複用 `parsePostSheet_(POST_TODAY_SHEET_NAME)`）；`今日哨點` 判斷順序放在既有 `哨點` 判斷之前，避免字串包含誤判；既有 21:00 群組推播與「哨點」單人查詢完全不動 |
| App 殼層 | `index.html` 工具名稱「明日哨表」→「今/明日哨表」（`toolId` 維持 `post` 不變，不影響權限與 AI 助手路由）；`tool_ai_chat.html` TOOL_MAP 名稱同步 |
| brain_map | 節點 7 改名「今/明日哨表」+ 更新說明；新增節點 42「哨表試算表」（data 主題）；新增關聯 `[7,14]`（工具→帳號/請假GAS，原本漏連）、`[14,42]`（GAS→哨表試算表） |

**待咖哩手動操作**：GAS 編輯器「管理部署→編輯→新版本」發布（沿用既有 `/exec` 網址）→ 執行一次 `runSetupTodaySnapshotTrigger` 建立觸發器 → 執行一次 `runSnapshotTodayPostNow` 立即產生今日哨表測試資料。

#### [TODO-18] 帶班幹部交接事項工具 → 獨立檔 + 獨立 GAS + 新試算表
- **需求**：帶班幹部換班交接用清單；新增/編輯/刪除交接事項；狀態三種（未完成/進行中/已完成，預設未完成）；權限開放組長以上（leader/vicecaptain/captain/executive/admin）
- **狀態**：✅ 完成（2026-07-03，GAS 已部署、網址已回填 `BUILT_IN_GAS_URL`）

**實作結果（2026-07-03）**：

| 項目 | 值 |
|------|-----|
| 工具檔案 | `tool_handover.html`（獨立檔，vanilla JS 非 React，青綠 `#2DD4BF` 主題） |
| index.html 串接 | `HANDOVER_PAGE_URL` + TOOLS 卡片 `id:19, toolId:"handover"` + 標題 + iframe `src`（仿 opening/logistics 模式） |
| 權限（雙層） | ① `DEFAULT_PERMS` 只加進 leader/vicecaptain/captain/executive/admin（id19），一般保全員選單看不到卡片；② 工具內 `checkRole()` 讀 `hsh_session_user.role`，非組長以上且非獨立開啟則顯示「權限不足」畫面，防繞過 App 直接開網址 |
| 分頁 | `交接事項`（A~I 欄），GAS 自動建立 |
| 主鍵 | 純數字流水號 `max(既有ID)+1`（支援刪除列，不可用列號否則重號） |
| GAS 端點 | add（新增，狀態預設未完成）／update（編輯內容 and/or 狀態，寫最後修改人/時間）／delete／getAll（讀清單，新的在前） |
| 稽核欄位 | 建立人工號/姓名/時間（新增當下寫死不再變）＋最後修改人工號/姓名/時間（內容編輯或狀態切換皆更新） |
| 前端 UI | 頂部新增表單 + 狀態分頁籤（全部/未完成/進行中/已完成）+ 事項卡片（左框色區分狀態：紅/橙/綠）+ 點狀態徽章或編輯鈕開 modal 切換狀態 |
| GAS 部署說明 | `帶班交接_GAS_部署說明.md` |

**部署狀態（2026-07-03）**：GAS 已部署、`/exec` 網址已回填 `tool_handover.html` 的 `BUILT_IN_GAS_URL`，全員（組長以上）自動連線，無需再手動設定 localStorage。之後改 GAS 記得「管理部署→編輯→新版本」。

#### [TODO-19] 事故報告／匿名表揚新資料 → LINE 推播主管與管理員
- **需求**：`tool_report.html`（事故報告）／`tool_feedback.html`（匿名表揚/反應）送出當下就主動推播 LINE 給 `executive`/`admin`，不用等主管自己點進首頁待審卡片
- **狀態**：✅ 完成（2026-07-03）

**實作結果（2026-07-03）**：

| 項目 | 值 |
|------|-----|
| 架構 | `事故與表揚_後端_GAS_v3.1.gs`（獨立部署，無 LINE Token）→ `UrlFetchApp.fetch(NOTIFY_GAS_URL,...)` 轉發 → `天鷹保全APP_後端_GAS.gs`（有 LINE Channel Access Token）實際推播，仿既有 `notifyScheduleChangeToLine_` 模式 |
| 送出端新增 | `notifyReportToLine_`/`notifyFeedbackToLine_`：`handleReport_`/`handleFeedback_` 的 `appendRow` 之後、`return` 之前呼叫，try/catch 非致命，LINE 失敗不影響資料寫入成功 |
| 接收端新增 | `doPost` 路由 `notifyNewReport`/`notifyNewFeedback` → `notifyNewReportAction_`/`notifyNewFeedbackAction_`；`getExecutivesAndAdmins_()`（不分部門，只篩 `role==='admin'||'executive'` 且 `status==='active'`）；`buildNotifyCardFlex_()` 共用 Flex 卡片版型 |
| 推播對象 | 全公司 `admin`+`executive`（不分部門，跟請假通知的部門篩選邏輯不同——事故/表揚是全公司層級） |
| 卡片按鈕 | 連去 `tool_report.html?mode=admin` / `tool_feedback.html?mode=admin`（純連結，依賴瀏覽器既有登入 session，同既有哨表通知按鈕慣例） |
| 測試輔助 | `事故與表揚_後端_GAS_v3.1.gs` 的 `testNotifyReportToLine()`；`天鷹保全APP_後端_GAS.gs` 的 `測試事故表揚推播()` |

**待咖哩手動操作**：兩支 GAS 都要「管理部署→編輯→新版本」（`/exec` 網址不變）；部署後在天鷹保全APP GAS 專案執行一次 `測試事故表揚推播()` 驗證。

### 🟢 本次（2026-06-27）額外完成

#### [TODO-07] 開店/打烊工具「設定」分頁限管理員
- 原 `['leader','vicecaptain','captain','executive','admin']` → 改 `['admin']`
- **位置**：`tool_opening.html` 與 `index.html`(tpl-closing) 的 `checkRole()`
- **狀態**：✅ 完成（2026-06-27）

#### [TODO-08] 開店工具「預覽」分頁指向開店試算表 + 三分頁切換鈕
- 預覽 iframe/開啟連結改指 `1mxCRUxbuPBuReP1gWK3unFbjtOkAuSkBakQeaH9Rdyc`
- 新增切換鈕：開店前(`921725644`)/B1F餐廳區(`1114763531`)/4F餐廳區(`1195313632`)
- **狀態**：✅ 完成（2026-06-27）

#### [TODO-09] 緊急聯絡清單手機開頭 0 消失
- 根因：Google Sheet 把 `09…` 當數字存，回傳掉開頭 0
- 修正：`normalizePhone()`，9 碼且開頭 9 的台灣手機補回 0（前端拉取/還原時）
- **位置**：`index.html`(tpl-emergency)
- **狀態**：✅ 完成（2026-06-27）

#### [TODO-10] 班表早班班別不顯示／不能修改
- 根因：`SHIFT_TYPES` 只定義晚班代號（B/海/N），早班代號未定義 → 格子顯示「·」、編輯視窗選不到
- 修正：補早班班別 `A/S/L/H/H2/LN` + `國例`，更新 `WORK_SHIFT`/`OFF_TYPES`
- **位置**：`index.html` ScheduleApp `SHIFT_TYPES`
- **待辦尾巴**：黃底「停休加班」與休假同字，無法以代號區分（等使用者提供獨立代號）
- **狀態**：✅ 完成（2026-06-27），停休加班待補

---

## 🧠 技術經驗筆記 / Lessons Learned

> 此區累積實作中踩過的坑與解法，供未來 AI 與工程師快速避雷。每次大更新後補充。

### 📅 2026-07-05：brain_map 跑步序列幀動畫機制（路飛/咖哩要補完整跑步循環時查這篇）

> 派 Explore agent 查證 `brain_map.html` 既有的「跑步序列幀動畫」怎麼做的，順便確認路飛（代表咖哩本人）目前的動畫缺口。

- **三個零件**：`CHAR_IMG_MAP`（第719行，站崗靜態圖，`'路飛':'luffy.png'`）／`RUN_IMG_MAP`（第739行，跑步序列幀，只有「動作跑者」在跑路線時才查）／`getRunFrame(role)`（第750行，`Math.floor(performance.now()/RUN_FRAME_MS) % frames.length` 算目前第幾幀，圖沒載完會回 null 退回靜態圖）。兩張表**互不干涉**，各自有自己的 preload 迴圈。
- **確認现狀**：`RUN_IMG_MAP` 裡羅賓有 6 張（`run_robin_f1~f6.png`），**路飛目前只有 1 張**（`run_luffy_f1.png`）——陣列長度1，`%1` 恆為0，所以路飛用「動作跑者」送資料時只會定格在一個跑步姿勢，不會有真正的循環動畫。
- **`animated` 開關**：`drawCharacter(ctx,x,y,role,count,alpha,extraScale,animated)` 第855行 `(animated && getRunFrame(role)) || CHAR_IMAGES[role]`——`animated=true` 才查跑步幀。待機站崗的 `drawAllCharacters()` 呼叫時沒傳這參數（恆靜態圖）；只有 `drawActionRunners()`（第1236行）會傳 `true`。主控台節點的角色固定是路飛（`NODE_CHAR[0]='路飛'`），所以**只要有人在主控台送資料，就是路飛在跑，此時最容易看到動畫斷幀感**。
- **素材規格**：命名 `run_{英文角色名}_f{序號}.png`，放 `brain_map_img/`。羅賓 6 張實測都是 260×450（完全一致）；路飛現有那張是 85×300（比例不同）。繪圖不強制寫死尺寸（逐張讀 `naturalWidth/Height` 算比例縮放進同一顯示框），任意尺寸技術上都能跑，**但強烈建議新增的幀跟現有那張同尺寸同比例**——不然循環播放時角色會忽大忽小閃爍（羅賓能跑得順就是因為 6 張完全等尺寸）。
- **補完路飛跑步循環只需改一行**：把裁好的 `run_luffy_f2.png`～`f6.png`（幾張都行，同尺寸）丟進 `brain_map_img/`，然後 `RUN_IMG_MAP` 裡路飛那行陣列加上檔名即可；`getRunFrame`/`RUN_FRAME_MS`/`drawCharacter`/`drawActionRunners` 全是通用邏輯，陣列變長會自動跑循環，**不用動其他任何程式碼**。
- **跟已知 clearRect 地雷（見下一篇）無關**：每幀畫布只在 `charCtx.clearRect(...)` 清一次，之後依序疊加畫 `drawNodeLocations→drawAllCharacters→drawLiveUsers→drawActionRunners`；新增跑步幀只是換 `drawActionRunners()` 內部畫哪張圖，不涉及清畫布時機，不會踩到下面那個舊坑。

### 📅 2026-07-03：brain_map 地點圖被每幀清畫布蓋掉 + 新增地點圖的標準流程

- **症狀**：`brain_map.html` 幫工具節點（事故報告=圖書室、表揚反應=醫務室）接上場景圖後，咖哩回報「還是舊的發光球體，看不到場景圖」。換兩台不同瀏覽器、強制重新整理（含 `?v=` cache-buster）都一樣 → **先排除快取，鎖定是程式碼問題**。
- **根因**：`drawNodeLocations()`（畫地點圖）跟 `drawAllCharacters()`（畫角色）依序在 animate loop 呼叫，但 `drawAllCharacters()` 開頭就 `charCtx.clearRect(...)` 清整張畫布——把剛畫好的地點圖立刻清掉，只留角色跟底下 Three.js 發光球體。地點圖**從未真正顯示過**，不是部署或快取延遲。
- **修法**：`clearRect` 只能在 animate loop 每幀呼叫「一次」，放在所有 2D 疊層繪製函數（`drawNodeLocations`、`drawAllCharacters`、之後任何新的 draw 函數）**之前**，不要讓個別繪製函數各自清畫布。
- **除錯技巧**：使用者回報「圖沒更新」時，若「不同瀏覽器 + 強制重新整理都重現同樣結果」，可直接排除快取／部署延遲，轉向查程式邏輯（尤其是共用畫布/共用狀態的清除時機）。

**給未來 AI／自己的提醒（咖哩接下來幾天會陸續上傳其他工具的地點圖）**：新增一張地點圖的標準流程——
1. 咖哩傳圖 → 用 Python Pillow 壓縮：`resize` 寬 400~500px（`Image.LANCZOS`）+ `quantize(colors=~200, method=Image.FASTOCTREE)` 降色，壓到 60~100KB 上下（跟角色圖檔案大小一致）
2. 存進 `brain_map_img/`，檔名延續 `loc_*.png` 慣例（如 `loc_kitchen.png`）
3. 在 `brain_map.html` 的 `NODE_IMG_MAP` 加一行 `節點id: '檔名.png'`（該常數在 `IMG_DIR`/`CHAR_IMG_MAP` 附近，不在 `BRAIN_MAP_DATA_START/END` 資料區內，是渲染層設定，可直接改）
4. **不要動 `drawNodeLocations`/`drawAllCharacters`/`clearRect` 的呼叫順序**（本篇教訓的根因），新增地點圖只需要改 `NODE_IMG_MAP` 一行
5. `node --check` 驗證 → commit → PR → 咖哩確認再合併

### 📅 2026-07-03：GitHub Pages 部署卡死佇列 — 取消失敗的正確應對

- **症狀**：GitHub Pages 部署（`pages build and deployment`）累積 **9 筆卡在 `queued`**，最舊一筆卡了超過 12 小時；網頁上的 Cancel 按鈕、API 呼叫全部失敗。
- **根因**：GitHub 平台端問題（runner 沒被分配到這批 run），**不是 repo 或程式碼壞掉**。可先查 [githubstatus.com](https://www.githubstatus.com/) 確認有無事故公告。
- **關鍵發現：卡住的 queued run 無法取消**。呼叫 cancel API 一律回 `409 Cannot cancel a workflow re-run that has not yet queued.`，網頁按鈕也是同一個內部錯誤，**不用再重試**。
- **正確做法（不是取消，是蓋過去）**：
  1. GitHub Pages 只認**最新一次成功部署**，不需要把佇列裡的殭屍逐筆清掉。
  2. 直接推一個新 commit（哪怕是空 commit：`git commit-tree <tree> -p <parent> -m "..."`）觸發全新的部署 run。
  3. 新 run 若卡在最後一步報錯 `##[error]Deployment failed, try again later.`（GitHub 服務端暫時性問題，日誌可用 `mcp__github__get_job_logs` 查），**用 `actions_run_trigger` 的 `rerun_failed_jobs` 重跑該次 run 即可成功**，不必再開新 commit。
  4. 舊的殭屍 `queued` run 放著不用管，GitHub 會在逾時（最長 72 小時）後自動標記失敗並清掉，不影響網站也不影響新部署。
- **教訓**：遇到「取消/刪除卡住的雲端資源」一直失敗時，先想「有沒有辦法繞過去（用新資源蓋過舊的）」，不要在明知會 409 的操作上重試消耗時間。

### 📅 2026-07-02：GAS `instanceof Date` 會誤判 false（物流統計除錯實錄）

- **症狀**：寫入成功、getShortcuts 正常，唯獨按日期查詢永遠空的（今日累計 0、查紀錄「這一天沒有登記紀錄」），試算表裡資料明明都在。
- **根因**：GAS 部署環境中 `getValues()` 回來的日期物件，`v instanceof Date` 判斷**回傳 false**（跨 realm 問題）→ 程式走到字串分支 → `String(date)` 變成 `"Thu Jul 02 2026 00:00:00 GMT+0800 (台北標準時間)"`，永遠比不到 `"2026/7/2"`。
- **修法**：GAS 內判斷日期一律用 `Object.prototype.toString.call(v) === '[object Date]'`，**禁用 `instanceof Date`**。
- **除錯手法（值得複用）**：
  1. 給 GAS 回應加 `ver` 版本標記 → 一眼確認部署的是不是新版（使用者常忘記「管理部署→編輯→新版本」）。
  2. 查詢空結果時回傳 `debug`（請求鍵 vs 第一列算出的鍵）→ 使用者貼回應 JSON 就能遠端鎖定根因（沙盒代理擋 script.google.com，AI 無法直接打 GAS 測試）。
  3. 分辨「寫入路徑」與「讀取路徑」：試算表有資料＋綠色成功提示＝寫入通；只有查詢空＝比對邏輯問題。
- **另一教訓**：改 GAS 後只重開網頁沒用，**必須重新部署**（管理部署→編輯→新版本）後端才會換版本。

### 📅 2026-06-30：cec-up 版本核對 + 早班上傳同步

> 發現 `cec-up`（獨立部署上傳工具）缺少早/晚班切換功能，已同步補上。

#### A. 跨 repo 比對方法
- `cec-up` 在另一 repo，**先 `git clone` 到本機**，Claude Code 就能直接用 `Read`/`Grep` 讀檔，不需要任何額外授權設定。
- tpl-upload 是 base64 內嵌在 `index.html`，比對前先用 Python `base64.b64decode` 解碼存暫存檔，再做 diff。

#### B. 找到的差異
| 項目 | cec-up | APP 版 |
|------|--------|--------|
| 早/晚班切換按鈕 | ❌ 無 | ✅ 有 |
| 施工單欄位邏輯 | ✅ 相同 | ✅ 相同 |
| 施工單預設 GAS URL | ✅ 有硬編 fallback | ❌ 需手動設定 |

- cec-up 固定讀「晚班班表」分頁 → 上傳早班 Excel 時找不到分頁直接報錯。

#### C. 同步方式（HTML 工具加功能的標準做法）
1. 新增班別切換卡片 HTML（兩個按鈕 + 提示文字，加在 drop zone 前）
2. 把 `SCH_SHEET_NAME` 常數改成 `SCH_SHIFTS` 物件（晚班/早班各自含 label/sheetName/url）
3. 加 `schSetShift()` 函數（切換按鈕樣式 + 提示文字 + 重新解析已選檔案）
4. 更新 `schResolveSheet` 邏輯（精確名稱 → 包含班別關鍵字 → fallback）
5. 更新成功段落改用 `SCH_SHIFTS[schShift].url`

#### D. 驗證
- `node --check` 不支援 `.html`，改抽出 `<script>` 內容存 `.js` 再跑 `node --check`
- cec-up 是個人工具 repo，直接推 main（不走 PR）

### 📅 2026-06-29：天鷹 AI 小助手（小天鷹）從 0 到上線 + 多輪迭代

> 本日成果：APP 內 J.A.R.V.I.S. 風格 AI 對話助手，全程 0 成本（Gemini 免費 + GAS + Pages）。共 7 個 PR 迭代上線（#3,5,6,7,9 合併；#4 因衝突關閉）。

#### A. 架構：Gemini 經 GAS Proxy（藏金鑰）
- 前端 `tool_ai_chat.html`（純 vanilla JS，非 React）→ GAS Proxy → Gemini API。**API Key 存 GAS Script Properties**，絕不進前端原始碼。
- 前端打 GAS 用 `Content-Type: text/plain;charset=utf-8` 送 JSON 字串 → **避開 CORS preflight**（GAS 端照常 `JSON.parse(e.postData.contents)`）。讀清單可走 doGet，寫走 doPost。

#### B. Gemini 模型陷阱（踩很久）
- **新版 API 金鑰開頭是 `AQ.`**（不是舊的 `AIzaSy`），兩種都能用 `?key=` 呼叫，免改碼。
- **`gemini-1.5-flash` 已停用**：新金鑰呼叫回 `models/gemini-1.5-flash is not found`。改用 `2.0-flash`。
- **`gemini-2.5-flash` 會「思考」吃掉 maxOutputTokens** → 回答只吐前幾個字就被切斷。**解法：避用 2.5（或設 thinkingBudget），改 2.0-flash/2.0-flash-lite（不思考），且 maxOutputTokens 給足（我用 2048）**。
- **免費額度 429**：2.5-flash 每分鐘上限小（限 20）。**解法：模型清單依序 fallback，遇 404 或 429 自動換下一個（各模型額度分開算）**；全爆才回友善中文，不丟英文。2.0-flash/2.0-flash-lite 免費每日額度較高，排前面。

#### C. 行動端 UX 坑
- **雙重返回鈕**：工具自帶 header 的返回 + APP 外框 iframe 的返回會疊兩個，工具那個在 iframe 內 postMessage 沒人收→按了沒反應。**解法：偵測 `window.self !== window.top`（在 iframe 內）就 `body.embedded` 隱藏工具自身 header**；管理員齒輪改浮動鈕。
- **麥克風每次都要授權**：聲波視覺化我額外開了 `getUserMedia`，跟 SpeechRecognition 是**兩個獨立授權**→一直跳。**解法：聲波改純 CSS/canvas 假動畫，不抓真麥克風**，只留語音辨識一個授權，瀏覽器記住後不再問。
- **語音可調**：`SpeechSynthesisUtterance` 的 `rate`（語速）、`voice`（`speechSynthesis.getVoices()` 過濾 `zh*`）；getVoices 可能延遲→監聽 `onvoiceschanged` 重填。設定存 localStorage。iPhone 內建中文語音少、Android 多。

#### D. AI「查真實資料」的兩種做法 + 抉擇
- **做法一（RAG-lite，先做後棄）**：GAS 依關鍵字去抓班表 GAS(`getSchedule`)、施工單試算表(gviz)，把資料塞進 prompt 讓 AI 回答。
  - 缺點實測：① 塞大量資料→**請求變大易撞額度(429)**；② AI **解析施工單欄位易出錯**；③ 配 2.5-flash 思考→**回答被切斷**。
- **做法二（最終採用，咖哩提議）**：**不讓 AI 讀資料，改自動彈出 APP 真實畫面**。AI 判斷是資料類問題 → 回一句話 + 在結尾夾隱藏指令 `<<OPEN:post|schedule|work>>` → 前端正則抽出指令（使用者看不到）→ `postMessage({type:'openTool'})` 給父層 index → `setActiveToolId` 切換到明日哨表/班表/施工單。
  - **教訓：資料正確性要求高時，與其讓 LLM 解析易錯，不如直接導去既有可信 UI**。LLM 負責「意圖辨識 + 導航」，不負責「當資料庫」。
- 父子頁通訊：iframe 工具 `window.parent.postMessage`，index 端 `window.addEventListener('message')` 統一處理（沿用既有 `tianying_scheduleUpdate` handler 擴充 `openTool`）。施工單原是 `externalUrl`(開新分頁)，為了「彈畫面」改加內嵌 `activeToolId==='aiwork'` iframe。

#### E. 個人化 + 權限 + 管理員控制台
- 個人化：每個工號存 `hsh_ai_profile_{empId}`（msgCount/vocabLevel），前 10 則用最簡單講法，之後依輸入長度/用詞升級；傳 vocabLevel 給 GAS 調 system prompt。
- 權限：role 從 `hsh_session_user` 帶給 GAS，分一般/幹部/主管三層寫進 prompt；工具本身先用 `DEFAULT_PERMS` 限 admin（只加 id 17 到 admin，靠既有「新工具僅補 DEFAULT_PERMS 有列角色」的遷移邏輯自動生效）。
- 管理員控制台：⚙️ 限 admin，可設「禁止話題」+「強制表達層級」，存 GAS Script Properties，所有人下次請求自動套用。

#### F. 流程/Git 教訓（自己踩的）
- **`git checkout <branch> -- .` 會覆蓋工作樹未提交的修改**——我犯兩次，把剛寫好的功能洗掉重做。**教訓：要從別分支取單檔用明確路徑且確認；要換基底用 PR 流程，別在有未提交變更時亂 checkout**。
- **squash 合併後，原功能分支與 main 歷史分歧**，再開 PR 會「merge conflict」。**解法：從最新 `origin/main` 開新分支、只重貼改動檔，再 PR**（別想 merge 舊分支）。
- GAS 改任何東西 → **務必「管理部署 → 編輯 → 版本：新版本」**，不可「新增部署」(換網址前端全斷)。前端走 Pages 自動更新。

### 📅 2026-06-28（施工單）：報到/行動體驗/時間防呆/備註雜訊 + 班別定義

> **班別定義（領域常識，務必記住）**：早班 08:00~20:00、晚班 20:00~隔天 08:00（跨夜）。凡施工單今晚/明早、班表、哨表等涉及早/晚班時段一律以此為準。

- **報到換證「假成功」**：`tool_work.html` 用 `fetch no-cors` 寫回，回應 opaque 讀不到 → 原本一律當成功（即使沒寫進去也顯示綠勾）。修法：送出後**重讀試算表驗證 O 欄**真有寫入才顯示成功，否則誠實報「未生效」；gviz 讀取加 `&_=timestamp` 防快取避免讀到舊值。
- **時間爛資料防呆**：來源 Excel 進場/退場欄偶有爛值（如把名字打成「宇晴#6731」、或「4000」）。`fmtT` 放寬跨夜 24:00~29:59 為合法，HH≥30/夾中文 → 標紅 ⚠「時間待確認」。**防呆原則：不在上傳擋下員工（他改不了來源），照收但自動標紅給看得懂的人（主管）。**
- **備註(N)欄是「分頁名稱」不是真備註**：上傳工具把 Excel 分頁名（如「05早」）寫進 N，與實際施工日對不上、又當卡片備註顯示成雜訊。處置：上傳 GAS 不再寫 N（留空）、施工單卡片不顯示備註、`getOrders` 改用 月/日+進場時間 判今晚/明早（依上方班別定義），不再依賴分頁名。
- **`removeDuplicateBM` 去重 bug（已修）**：舊版只讀寫 A~M(13欄)，去重後 A~M 上移、N/O 留原位 → **備註/報到狀態整欄錯位**，且底部留下「只有 N/O、前面全空」的孤兒列。修法：改讀寫 A~O(15欄)整列一起搬，並在去重時**丟棄空殼列**（申請單位+廠商皆空）清除既有災情。教訓：**清列務必涵蓋所有有資料的欄（含無標題的狀態欄 O）**。

### 📅 2026-06-28（手冊）：操作手冊 PDF + 工具實機自動截圖

> 產出員工/主管/LINE 三份手冊 PDF，並自動擷取 APP 實機畫面（全用假資料）。

#### A. HTML → PDF（沙箱內）
- 用預載的 Chromium：`/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless --no-sandbox --no-pdf-header-footer --print-to-pdf=out.pdf file://…/x.html`。
- 中文字型靠 `WenQuanYi Zen Hei`（沙箱已裝）、emoji 靠 `Noto Color Emoji`；CSS `font-family` 指定即可，免額外安裝。
- 列印友善：白底深字＋金色標題、`@page{size:A4}`、`page-break-inside:avoid` 防卡頁。

#### B. 自動擷取各工具畫面（playwright-core）
- 沙箱**連不到 CDN**（unpkg/cdnjs/jsdelivr 全 403），但 **npm registry 可用**。
- 關鍵手法：`npm i playwright-core react@18.3.1 react-dom@18.3.1` → 用 `chromium.launch({executablePath:既有chrome})` → **`page.route` 把 CDN 的 React 請求改 fulfill 本地 UMD 檔**，否則獨立工具頁（`tool_*.html` 從 cdnjs 載 React）會卡在 splash 永不 mount。`index.html` 因 React 內嵌故不受影響。
- Tabler 圖示 CSS 也走 CDN → route 成 `.ti{display:none}` 避免 tofu 方框。
- **造假資料免真實**：`context.addInitScript` 先 `localStorage.setItem('hsh_session_user', 假主管)`、覆寫 `window.fetch` 依 `action` 回假清單（getReports/getFeedback/getLeaveRequests）、並 stub `window.liff`（給 `liff_leave.html` 顯示請假表單）。全部用「（範例）」前綴，零真實資料。
- 詳情頁截圖：`page.getByText('A棟大廳').click()` 觸發卡片 onClick 進詳情（事件冒泡）。
- 判讀：截圖檔案大小**全部一樣**＝多半是同一張 splash（JS 沒 mount），就是 CDN 沒載到。

#### C. 維護
- 原始檔與截圖存 `操作手冊/src/`，PDF 存 `操作手冊/`。功能有變動且影響畫面/流程時，主動問使用者要不要「更新手冊」重擷圖重產。

### 📅 2026-06-28：事故/表揚主管審閱畫面 + GAS 授權/Drive 連環坑

> 本輪重點不是前端，而是 **GAS 部署授權與 Drive 寫檔**踩了一長串坑。前端反而單純。

#### A. 同一支 GAS、多前端共用，以 `action` 分流
- `tool_report.html`(report) / `tool_feedback.html`(feedback) / `index.html`(讀清單) 全打**同一支** `…AKfycbwHX…/exec`，用 `action` 路由（report/feedback/updateStatus/getReports/getFeedback）。
- **讀清單走 `doGet`、寫入走 `doPost`（form-urlencoded）** → 都是簡單請求、無 CORS 預檢。
- 改 GAS 後**一定要「編輯既有部署 → 版本：新版本」**，不可「建立新部署」（會換網址，前端全斷）。

#### B. OAuth「未完成驗證／403 access_denied」
- 同意畫面是「測試中」且當前帳號不在測試名單 → 被擋。修法：OAuth 同意畫面加 **測試使用者**，或發布應用程式，或改用**擁有者帳號**授權。
- **多帳號陷阱**：授權彈窗預設帳號可能不是腳本擁有者（本案 `sky0310427` vs `sky03104`），用無痕只登一個帳號最乾淨。

#### C. 照片上傳「存取遭拒：DriveApp」連環坑（最耗時）
逐層剝洋蔥，**錯誤訊息會變、要逐一對症**：
1. 「沒有呼叫 `createFile` 的權限」= OAuth scope 不足 → 在 `appsscript.json` 明確宣告 `oauthScopes` 含 `https://www.googleapis.com/auth/drive`（受限的 `drive.file` 寫不進既有資料夾）。
2. 「存取遭拒：DriveApp」但**檔案其實已建到 Drive** = 真兇是**下一行 `file.setSharing(ANYONE_WITH_LINK, VIEW)`** 被帳號共用政策擋 → 整筆被 catch 成失敗。**修法：setSharing 包 try/catch 非致命**，檔案已建就照樣回傳連結。
3. 判讀技巧：**試算表有寫進去、只有照片欄報錯** → 純 Drive 問題，不是腳本沒跑。**Drive 裡檔案在不在**是關鍵線索（在＝createFile 成功，問題在 setSharing/sharing）。
- 耐用化：`getUploadFolder_()` 公告資料夾打不開時退回執行帳號自己的「天鷹_上傳照片」資料夾，確保必成。

#### D. 「編輯器能跑、網頁卻失敗」怎麼判
- `forceAuth()` 在**編輯器**以登入帳號跑會成功；**網頁應用程式**以「執行身分」設定的帳號跑。兩者帳號/權限可能不同 → 同一段 Drive 操作一邊成功一邊存取遭拒。
- 先確認部署「執行身分＝我(擁有者)」、「存取權＝任何人」。試算表能寫但 Drive 全拒，常是執行帳號對該資料夾只有檢視權（資料夾屬另一帳號）。

#### E. 狀態機設計（主管審閱）
- 事故報告：未讀 →(開啟自動)待處理 → 待處理/已知悉再觀察/持續追蹤/已處理；分頁「待處理」=所有處理中群組（≠未讀且≠已處理）。
- 表揚/反應：未讀 →(開啟自動)已讀 →(裁決)已處理＋寫「處置」欄（同意/不同意 表揚｜懲處）。
- **上一篇/下一篇**：進詳情當下**凍結篩選順序**（存 row 陣列），自動轉狀態不改變瀏覽序 → 在「未讀」分頁開了仍沿未讀清單翻。
- 改狀態端點以**表頭名稱定位欄位**（`headers.indexOf('狀態')`），不要假設「狀態固定末欄」——加了「處置」欄就會錯位。

#### F. 上線前清理
- 預覽用 `?demo=1` 假資料模式合併前**務必移除**，避免正式環境殘留假資料入口。

### 📅 2026-06-27：開店前工具 + 多工具修正

#### A. 工具嵌入有兩種模式（決定新工具怎麼放）
1. **base64 內嵌**：`<script id="tpl-X" type="application/octet-stream">…</script>`，用 `b64decode()` → iframe `srcDoc`（closing/car/signin/emergency/upload）。
2. **獨立檔 + iframe `src`**：獨立 HTML 放 repo 根，常數存 GitHub Pages URL（`POST_PAGE_URL`、`OPENING_PAGE_URL`），render 用 `src` 不用 `srcDoc`（post.html / tool_opening.html）。
- **決策準則**：要獨立維護、檔案分離、好單獨預覽 → 選獨立檔模式。要單檔打包 → 選 base64。
- **改 base64 內嵌工具 SOP**：Python regex 抓 `<script id="tpl-X"[^>]*>(.*?)</script>` → `base64.b64decode` → 編輯字串 → `base64.b64encode` → 取代回 index.html。改完一定 `node --check`。

#### B. GAS `getActiveSpreadsheet()` 只能讀寫綁定的那份試算表
- 跨試算表共用資料時必須**多個 GAS URL**。開店工具範例：`DB_GAS_URL`（打烊 GAS，共用 `_SharedDB` 廠商/監工/檢查者）+ `BUILT_IN_GAS_URL`（開店 GAS，寫各自記錄）。
- 想單一 GAS 跨表寫入要改用 `openById()`，且 GAS 帳號需有目標表存取權。

#### C. 常見錯誤 → 修法
| 症狀 | 根因 | 修法 |
|------|------|------|
| 送出失敗「找不到分頁」 | 前端 `BUILT_IN_SHEET` 與實際分頁名不符 | 對齊實際分頁名；GAS `getSheetByName` 區分大小寫/全形 |
| 「今日」讀不到剛送的資料 | 繼承的 `getTodayRows` 用夜班時段(20:00~隔日00:00)，早班資料落窗外 | 改日曆日(今天00:00~隔日00:00)；**GAS 改了要重新部署**（管理部署→編輯→新版本，網址不變） |
| 手機/工號開頭 0 消失 | Google Sheet 把純數字字串當 number 存，回傳掉前導 0 | 前端 `normalizePhone()` 補回；或試算表欄位設「純文字」格式；或 GAS 寫入時加 `'` 前綴 |
| 班別/代號不顯示、編輯選不到 | 代號未在 `SHIFT_TYPES` 定義（render 成「·」，編輯視窗 iterate `SHIFT_TYPES`） | 補定義（代號/label/time/color/bg/hours）+ 同步 `WORK_SHIFT`/`OFF_TYPES` |

#### D. 權限控制（工具內角色判定）
- 工具讀 `localStorage.hsh_session_user` 的 `role`。限管理員：`['admin'].includes(u.role)`。
- `window.self===window.top` 旁路：獨立開啟（部署設定/githack 預覽）時放行；App 內嵌 iframe 則依角色。

#### E. 分支預覽方法
- 用 **raw.githack.com + commit SHA**（不要用分支名——分支名含斜線 `claude/...` 會造成路徑歧義）：
  `https://raw.githack.com/<user>/<repo>/<full-SHA>/<path>`
- base64 內嵌工具無法單獨預覽 → 解碼成獨立檔暫放 `preview/`，合併前刪。
- Google Sheets 嵌入 `/preview?gid=X` 可切分頁；手機底部分頁列易被擠掉 → 自製按鈕改 iframe `src` 的 gid。

#### F. 合併 main：base64 內嵌工具的衝突處理
- base64 是「一行超長字串」→ git 視為單行衝突，**無法逐行 merge**。
- 處理流程：解碼衝突雙方（HEAD vs 分支）→ `diff` 找真實差異 → 確認某方是 superset → 取較完整版重貼。
- **教訓**：base64 內嵌讓 git diff/merge 失效，是內嵌模式最大缺點；高頻修改的工具建議改獨立檔。

#### G. 驗證手法
- HTML 內嵌 JS 驗證：Python 抽出 `<script>`（排除 `src=` 與 `octet-stream` 模板）合併 → `node --check`。
- GAS 在 template literal 內：抽出 `const GAS_CODE=\`…\`` → 存 `.js` → `node --check`（`.gs` 副檔名 node 不認）。
- 主鍵規範：純數字流水號 `nextRow-1`，**禁止** `genId()` 隨機英數。

---

## 📄 Document Versions

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-22 | Initial CLAUDE.md creation |
| 1.1 | 2026-06-22 | 新增團隊架構、設計規範、GAS標準、TODO-01~06 |
| 1.2 | 2026-06-27 | TODO-03 完成（開店前工具 `tool_opening.html` + 雙GAS + 部署說明），更新檔案結構 |
| 1.3 | 2026-06-27 | TODO-07~10 完成（設定限管理員、開店預覽切換、緊急手機0、班表早班班別）；新增「技術經驗筆記」；合併上線 main |
| 1.4 | 2026-06-28 | TODO-06/14 完成（事故/表揚主管審閱畫面 ?mode=admin、首頁待審兩格卡片、後端 GAS v3.1）；補登 TODO-11~13；新增 2026-06-28 技術經驗筆記（GAS 授權/Drive 連環坑）；合併上線 main |
| 1.5 | 2026-06-28 | 整合「知識星空大腦」brain_map.html（填入天鷹專案真實節點 6 主題/29 節點/36 關聯）+ 維護規則寫進 CLAUDE.md |
| 1.6 | 2026-06-28 | TODO-11 完成：建立三層 AI Agents 團隊（`.claude/agents/`，1 主協調者 + 5 執行 + 5 檢視 + 工作流程檔）；檢視角色取法 system_prompts_leaks |
| 1.8 | 2026-06-30 | TODO-05/06/15 完成；cec-up 早班切換同步；brain_map 新增 cec-up 節點(id32)；補 2026-06-30 技術筆記 |
| 1.9 | 2026-07-02 | TODO-16 完成：物流車輛統計工具（`tool_logistics.html` + 獨立 GAS + 部署說明，三分類登記/日查/月統計/月分頁匯出，全員開放 id18）；brain_map 同步節點 37~39 |
| 1.7 | 2026-06-29 | TODO-13 完成：天鷹 AI 小助手（小天鷹）上線（`tool_ai_chat.html` + `天鷹AI助手_GAS.gs`，Gemini Proxy、語音、個人化、管理員控制台、資料問題自動彈真實畫面）；brain_map 同步 AI 節點；新增 2026-06-29 技術經驗筆記（Gemini 模型/額度坑、麥克風授權、LLM 導航不當資料庫、git checkout 覆蓋教訓）；7 PR 迭代上線 main |
| 2.0 | 2026-07-03 | TODO-17 完成：明日哨表 → 今/明日哨表雙分頁（`post.html` 今日/明日切換＋尚未更新提示、`天鷹保全APP_後端_GAS.gs` 每日08:00原地快照今日哨表＋`getTodayPost`＋LINE「今日哨點」指令）；brain_map 新增節點42「哨表試算表」+ 補連結 `[7,14]`/`[14,42]` |
| 2.1 | 2026-07-03 | 新增 2026-07-03 技術經驗筆記：GitHub Pages 部署卡死佇列處理（cancel API 一律 409、正確做法是推新 commit 蓋過去 + rerun_failed_jobs，殭屍 queued run 免管會自動過期） |
| 2.2 | 2026-07-03 | brain_map 即時航跡系統：動作跑者（送出資料由地點角色代跑）、黃金梅利號主控台、海域式節點分散、工具節點地點圖機制（圖書室/醫務室已生效，後續陸續補其他工具）；修正地點圖被每幀清畫布蓋掉的 bug（clearRect 呼叫時機）；新增技術經驗筆記記錄新增地點圖的標準流程 |
| 2.3 | 2026-07-03 | TODO-18 完成：帶班幹部交接事項工具（`tool_handover.html` + `帶班交接_GAS.gs` + 部署說明，新增/編輯/刪除/狀態切換三態，青綠主題，組長以上雙層權限），GAS 已部署並回填 `BUILT_IN_GAS_URL`；brain_map 新增節點 43~45（工具/GAS/試算表）+ 對應關聯 |
| 2.4 | 2026-07-03 | TODO-19 完成：事故報告/匿名表揚新資料自動轉發 LINE 推播給主管(executive)/管理員(admin)（`事故與表揚_後端_GAS_v3.1.gs` 新增 `notifyReportToLine_`/`notifyFeedbackToLine_` 轉發、`天鷹保全APP_後端_GAS.gs` 新增 `notifyNewReportAction_`/`notifyNewFeedbackAction_` + `getExecutivesAndAdmins_`/`buildNotifyCardFlex_` 實際推播）；brain_map 新增關聯 `[13,14]`（事故/表揚 GAS 跨 GAS 轉發） |
| 2.5 | 2026-07-03 | 補登 2026-07-02~07-03 已上線 main 但未記錄的完成項目：施工單監工姓名遮蔽、車牌辨識每日摘要 email、公告欄未讀/置頂/排序連環修正、LINE 明日哨表推播顏色修正、簽到/公告/車輛三筆資料完整性修正 |
| 2.6 | 2026-07-05 | 效能體檢報告 P0~P2 全部完成並部署（PR #71/#72/#74）：LOGO 全站瘦身+SheetJS defer、啟動誤跳錯誤toast+紅色樣式修正、公告輪詢背景暫停+內嵌模板惰性解碼+施工單快取秒開+登入GAS呼叫合併bootstrap（帶部署順序安全網）；同輪順帶抓到並修復 3 個帳號安全真bug（PR #67/#68/#69）：施工單白名單/密碼雲端同步失效、停用帳號仍可登入、帳號編輯權限收緊至隊長以上 |
| 2.7 | 2026-07-05 | 操作手冊更新至 v1.1（`操作手冊/` 三份 PDF 重產）：員工版補「今/明日哨表」「物流車輛統計」；主管版新增「帶班交接事項」「新案件 LINE 即時通知」「天鷹 AI 小助手（管理員限定）」三章；LINE 機器人手冊補「查詢班表與哨點」章節（本月/本週/今日/明日班表、今日哨點、哨點指令，先前未文件化）；新增 4 張實機截圖（logistics_form/handover_list/post_today/ai_chat，皆假資料） |

---

**Last Updated**: 2026-07-05  
**For Questions**: Refer to project documentation or contact the project owner  
**Branch**: `claude/app-manual-pdf-d8ep58`
