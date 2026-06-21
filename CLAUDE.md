# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**天鷹保全 · 內部系統** (Tianying Security Internal System) is a single-page web application for a Taiwan-based security company. The entire application — React runtime, all component logic, and all styles — is delivered as a single compiled HTML file: `index.html` (~1.1MB, ~19,773 lines).

This repository contains a **build artifact**, not a development source tree. There is no `package.json`, no build tooling, and no separate source files. All changes are made directly to `index.html`.

## Architecture

### Single-File SPA Pattern

The `index.html` file embeds:
- A bundled React library (runtime included inline)
- All component definitions as inline JavaScript
- All styles as inline CSS using CSS variables

Because everything is in one file, edits to components, styles, and logic all happen in `index.html`. There is no hot-reload or build step — open the file in a browser directly to test changes.

### Application Sections

| Section (Chinese) | Purpose |
|---|---|
| 首頁 (Home) | Landing/welcome page |
| 休假申請 (Leave Management) | Calendar-based leave request submission and history |
| 管理後台 (Admin Backend) | User accounts, roles, permissions, and approval queue |
| 緊急事件 (Emergency/Incidents) | Incident reporting and tracking |
| 上傳 (File Upload) | Base64-encoded file upload templates |

### State & Persistence

- **React local state** (`useState`, `useEffect`) manages UI and in-memory data.
- **`localStorage`** is the persistence layer. Key: `tianying_perms` stores permission settings; user data and application state are also persisted there.
- There are **no API calls** — this is a fully client-side application.

### Role-Based Access Control

Three roles: `admin`, `manager`, `employee`. The admin backend sub-tabs (Permissions, Tools, Users, Approval) are gated by role. Permission configuration is stored under `tianying_perms` in localStorage.

### Leave Request Data Shape

```js
{ id, empId, name, dept, type, dates, startDate, endDate, days, reason, status, appliedAt }
```

Leave types: `特休` (annual), `病假` (sick), `事假` (personal), `婚假` (marriage), `喪假` (bereavement), `公假` (official).

### Design Tokens

| Token | Value | Usage |
|---|---|---|
| Background | `#0A0C10` | Page/card backgrounds |
| Gold accent | `#D4A800` | Borders, highlights, brand color |
| Primary text | `#F5F5F5` | Body text |
| Success | `#4ADE80` | Approved status |
| Danger | `#F87171` | Rejected / error states |

UI effects: glassmorphism (`backdrop-filter: blur`), flex/grid layouts, smooth CSS transitions. Emoji prefixes (✅ ❌ ⏳ 📋) appear in status feedback strings.

## Working in This Repo

Since there is no build system, the workflow for any change is:

1. Edit `index.html` directly.
2. Open `index.html` in a browser to verify the change.
3. Commit and push.

When searching for a component or feature to edit, use `Grep` with Chinese keywords (e.g., `休假`, `管理後台`) or React patterns (`useState`, function names) to locate the relevant section within `index.html`.
