#!/usr/bin/env node
// PostToolUse hook：Edit/Write 命中 tool_*.html 或 index.html 時強制檢查
// 1) React 版本必須 18.3.1（禁止 19.x）
// 2) <script> 內容 node --check 語法必須通過
// 任一檢查失敗 → exit 2 擋下，逼 Claude 修正後才能繼續。

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // 讀不到就放行，不擋非預期呼叫
  }

  const filePath =
    (input.tool_input && input.tool_input.file_path) ||
    (input.tool_response && input.tool_response.filePath) ||
    '';

  if (!filePath) process.exit(0);

  const base = path.basename(filePath);
  const isTarget = base === 'index.html' || /^tool_.*\.html$/.test(base);
  if (!isTarget) process.exit(0);

  if (!fs.existsSync(filePath)) process.exit(0);

  const content = fs.readFileSync(filePath, 'utf8');
  const errors = [];

  // 檢查1：React 版本禁止 19.x
  const react19Pattern = /react(?:-dom)?[@/]19(?:\.\d+)*(?:\.\d+)?/gi;
  const react19Matches = content.match(react19Pattern);
  if (react19Matches) {
    errors.push(
      `❌ 偵測到 React 19.x 版本字串（${[...new Set(react19Matches)].join(', ')}）\n` +
        `   規範要求 React 必須為 18.3.1，禁止使用 19.x（見 CLAUDE.md / AGENTS.md）。`
    );
  }

  // 檢查2：<script> 內容語法驗證（排除 src= 外部引入與 octet-stream 模板）
  const scriptBlocks = [];
  const scriptTagPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptTagPattern.exec(content)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // 外部引入的 <script src=...> 跳過
    if (/type\s*=\s*["']application\/octet-stream["']/i.test(attrs)) continue; // base64 內嵌模板跳過
    if (/type\s*=\s*["']application\/json["']/i.test(attrs)) continue;
    if (body.trim()) scriptBlocks.push(body);
  }

  if (scriptBlocks.length > 0) {
    const combined = scriptBlocks.join('\n;\n');
    const tmpFile = path.join(os.tmpdir(), `claude-hook-check-${Date.now()}.js`);
    try {
      fs.writeFileSync(tmpFile, combined, 'utf8');
      execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : err.message;
      errors.push(
        `❌ <script> 內容語法驗證失敗（node --check）\n` +
          stderr
            .split('\n')
            .slice(0, 10)
            .map((l) => `   ${l}`)
            .join('\n')
      );
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  }

  if (errors.length > 0) {
    const message =
      `🚫 天鷹保全 QA 檢查未通過（${base}）\n\n` +
      errors.join('\n\n') +
      `\n\n請修正後再繼續。此檢查對應 CLAUDE.md / AGENTS.md 的硬性規範。`;
    console.error(message);
    process.exit(2);
  }

  process.exit(0);
}

main();
