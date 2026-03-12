## Why

Claude Code Agent SDK 每次 `submitMessage()` 都從 JSONL 重建 `readFileState`（C26 函數），導致已編輯過的檔案每輪都被注入 diff 到 `<system-reminder>` 中。此注入不可見、不可關閉、消耗 15%+ context window。同時，ClaudeCab 的 `AgentLoader` 手動讀取 CLAUDE.md 並 append 到 system prompt，與 SDK 內建的 WL8 memory loader 重複載入，進一步加劇 token 浪費並增加 readFileState 追蹤項目。

## What Changes

- **JSONL 預處理**：每次 resume 前 patch JSONL 檔案，破壞 C26 的收集條件（Read 加 offset、Write 移除 content），阻止 readFileState 從歷史對話重建
- **移除手動 CLAUDE.md 注入**：`loadSystemPrompt()` 不再讀取 CLAUDE.md，改由 SDK 的 WL8 透過 `settingSources: ['project']` 自動載入，消除重複注入
- **移除 TTS 強制觸發**：從 `getGlobalStaticRules()` 移除 TTS tool 描述和強制使用指令，降低 system prompt 大小
- **效能觀測**：sanitizer 記錄 fileSizeKB、durationMs、patchCount，為後續優化提供數據

## Capabilities

### New Capabilities

- `jsonl-sanitizer`: JSONL 預處理機制，在 SDK resume 前清理 readFileState 重建條件，防止 system-reminder diff 注入

### Modified Capabilities

- `system-architecture`: SDKQueryManager 新增 sanitize 步驟；AgentLoader 的 system prompt 組裝邏輯簡化

## Impact

- 受影響程式碼：
  - `src/core/JsonlSanitizer.ts`（新增）
  - `src/core/SDKQueryManager.ts`（import + resume 前呼叫 sanitizer）
  - `src/core/AgentLoader.ts`（loadSystemPrompt 簡化、移除 readSystemPromptFile、移除 TTS 注入）
- 受影響行為：
  - Agent 的 CLAUDE.md 不再由 engine 手動讀取注入（依賴 SDK 內建機制）
  - TTS tool 仍可用但不再由 system prompt 強制每次觸發
- 已知限制：runtime Edit/Write 仍會把檔案加入 readFileState（SDK 內部，無法控制）
