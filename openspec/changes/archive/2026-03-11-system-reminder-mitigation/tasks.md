## 1. JSONL Sanitizer 核心模組

- [x] 1.1 建立 `src/core/JsonlSanitizer.ts`，實作 project hash 計算（Project hash computation）與 JSONL file path 解析
- [x] 1.2 實作 JSONL sanitization before resume 邏輯：Read 加 offset、Write 移除 content、Edit 不處理
- [x] 1.3 實作 backup before modification（備份策略：單一 .pre-sanitize 覆寫模式）
- [x] 1.4 實作 performance observability 指標記錄（readsPatched、writesPatched、fileSizeKB、durationMs）
- [x] 1.5 實作 non-blocking error handling（malformed JSONL line 保留、file read failure 靜默跳過）

## 2. SDKQueryManager 整合

- [x] 2.1 在 SDKQueryManager 隔離層中 import `sanitizeBeforeResume`，於 `executeQuery()` 的 `query()` 呼叫前加入 JSONL sanitization before resume 步驟（JSONL 預處理策略：破壞 C26 收集條件）
- [x] 2.2 確認注入時機在 `options.resume` 有值時才執行（注入時機：SDKQueryManager.executeQuery() 內）

## 3. AgentLoader System Prompt 簡化

- [x] [P] 3.1 修改 `loadSystemPrompt()` 移除手動 CLAUDE.md 讀取，僅回傳 `getGlobalStaticRules()`（移除手動 CLAUDE.md 讀取 / No manual CLAUDE.md injection / AgentLoader 動態系統提示）
- [x] [P] 3.2 從 `getGlobalStaticRules()` 移除 TTS tool 描述與強制觸發指令（No TTS forced invocation in global rules）
- [x] [P] 3.3 移除不再使用的 `readSystemPromptFile()` 方法與 `DEFAULT_SYSTEM_PROMPT_FILE` 常量

## 4. 驗證

- [x] 4.1 重啟系統並測試 resume 流程，確認 sanitizer log 正常輸出（Metrics logging on patch / Metrics logging on clean file）
- [x] 4.2 確認 CLAUDE.md 不再在 system prompt 中重複出現
- [x] 4.3 確認 TTS tool 仍可透過 MCP 使用但不再被 system prompt 強制觸發
