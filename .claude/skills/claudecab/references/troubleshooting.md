# ClaudeCab 已知問題與解決方案

## 目錄

1. [Agent 載入問題](#agent-載入問題)
2. [SDK 整合問題](#sdk-整合問題)
3. [Telegram 問題](#telegram-問題)
4. [持久化問題](#持久化問題)
5. [WebUI 問題](#webui-問題)
6. [開發注意事項](#開發注意事項)

---

## Agent 載入問題

### Agent 載入了錯誤的 CLAUDE.md

**症狀**：Agent 的行為不符合預期，似乎使用了其他 CLAUDE.md

**原因**：SDK 會遞迴向上搜尋父目錄的 CLAUDE.md，即使遇到 `.git` 也不會停止

**解決方案**：
1. 使用 `settingSources: ['local']` 而非 `['project']`
2. 透過 `systemPrompt` 參數明確傳遞 agent 的 CLAUDE.md 內容

**相關檔案**：`src/core/SDKQueryManager.ts`

---

### hooks.ts 動態載入失敗（Windows）

**症狀**：`Error: Cannot find module 'c:\path\to\hooks.ts'`

**原因**：Windows 路徑需要轉換為 file:// URL

**解決方案**：使用 `pathToFileURL()` 轉換路徑

```typescript
import { pathToFileURL } from 'node:url';
const hooksModule = await import(pathToFileURL(hooksPath).href);
```

**相關檔案**：`src/core/AgentLoader.ts`

---

### 循環繼承

**症狀**：`Error: Circular inheritance detected: a -> b -> a`

**原因**：Agent A extends B，B extends A

**解決方案**：檢查 agent.json 的 `extends` 欄位，確保沒有循環

---

## SDK 整合問題

### SDK query() 沒有使用 agent 的權限設定

**症狀**：Agent 應該有的工具權限沒有生效

**原因**：沒有正確載入 `.claude/settings.local.json`

**解決方案**：
1. 確保 agent 目錄有 `.claude/settings.local.json`（不是 `settings.json`）
2. 確保 `settingSources` 包含 `'local'`
3. 不要在 SDK options 中覆蓋 `tools` 選項

**相關檔案**：`src/core/SDKQueryManager.ts`

---

### resume 失敗，對話歷史遺失

**症狀**：多輪對話時，AI 不記得之前的對話

**原因**：
1. `sdkSessionId` 沒有正確存儲
2. 沒有傳遞 `resume` 選項

**解決方案**：
1. 檢查 SessionManager 是否正確存儲 `sdkSessionId`
2. 檢查 SDKQueryManager 是否正確傳遞 `resume`

**相關檔案**：
- `src/core/SessionManager.ts`
- `src/core/SDKQueryManager.ts`

---

### 重啟伺服器後對話從零開始（v1.4.1 已修復）

**症狀**：伺服器重啟後，日誌顯示 `resume: "(new session)"`，對話沒有繼續

**原因**（v1.4.0 及之前）：
1. Session 過期（1 小時）時，`cleanupExpired()` 從 DB 刪除 session 行
2. `restoreSessions()` 啟動時也刪除過期 session
3. DB schema 使用 `ON DELETE CASCADE`，session 刪除後對話歷史也被刪除
4. 新建 session 取得全新 UUID，無 `sdkSessionId` → SDK 開啟全新對話

**修復**（v1.4.1）：
1. **保留 DB 行**：`cleanupExpired()` 只從記憶體移除，不刪 DB。`restoreSessions()` 僅清理超過 `dbRetentionMs`（預設 30 天）的古老 session
2. **繼承 sdkSessionId**：`createSession()` 建立前查 DB 取回先前的 `session_id` + `sdk_session_id`，重用舊 session ID（保持 FK 關聯）
3. **Resume 失敗自動重試**：`executeQueryWithSDK()` 帶 resume 呼叫失敗時，清除 sdkSessionId 並不帶 resume 重試一次

**相關檔案**：
- `src/core/SessionManager.ts` — cleanupExpired、restoreSessions、createSession
- `src/core/MessageProcessor.ts` — executeQueryWithSDK resume 重試
- `src/types/session.ts` — dbRetentionMs 配置

---

### SDK init 時 model 不正確

**症狀**：日誌顯示 SDK 使用了非預期的 model

**原因**：`.claude/settings.local.json` 的 `model` 設定沒有生效

**解決方案**：確保 `settings.local.json` 格式正確：

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": ["*"],
    "deny": []
  }
}
```

---

## Telegram 問題

### 訊息被截斷

**症狀**：長回應只顯示部分內容

**原因**：Telegram 訊息上限 4096 字元

**解決方案**：TelegramAdapter 已實作自動分割，檢查 `splitMessage()` 函數

**相關檔案**：`src/adapters/TelegramAdapter.ts`

---

### 速率限制錯誤

**症狀**：`Error: 429 Too Many Requests`

**原因**：發送訊息太快，超過 Telegram API 限制（約 30 msg/sec）

**解決方案**：TelegramAdapter 已實作 35ms 最小間隔，檢查速率限制器設定

---

### Bot 無回應

**症狀**：發送訊息後沒有任何回應

**檢查項目**：
1. Agent 的 `agent.json` 中 `telegramBotToken` 是否正確設定
2. Bot 是否已啟動（檢查日誌，PlatformOrchestrator 會輸出各 Bot 啟動狀態）
3. 是否在白名單中（如啟用 ALLOWED_USERS）
4. Session 是否卡在 `processing` 狀態
5. WebUI Agents 頁面查看 Bot Status 是否為 `running`

---

## 持久化問題

### WAL 檔案過大

**症狀**：`claudecab.db-wal` 檔案持續增長

**原因**：WAL checkpoint 沒有執行

**解決方案**：
1. 正常關閉應用程式會自動 checkpoint
2. 手動執行：`PRAGMA wal_checkpoint(TRUNCATE);`

---

### Session 恢復失敗

**症狀**：重啟後 Session 沒有恢復

**檢查項目**：
1. `ENABLE_PERSISTENCE=true` 是否設定
2. 資料庫檔案是否存在
3. 檢查 SessionRepository 日誌

---

## WebUI 問題

### 樣式沒有套用（跑版）

**症狀**：頁面完全沒有樣式，HTML 結構混亂

**原因**：EJS 不原生支援 layout 系統，使用 `layouts/main.ejs` 的方式無效

**解決方案**：使用 `partials/start.ejs` + `partials/end.ejs` 包裹模式

```ejs
<%- include('../partials/start', { title }) %>

<!-- 頁面內容 -->

<%- include('../partials/end') %>
```

**相關檔案**：
- `src/webui/views/partials/start.ejs`
- `src/webui/views/partials/end.ejs`

---

### TailwindCSS 樣式未載入

**症狀**：TailwindCSS 類別沒有效果

**原因**：CDN 腳本沒有正確載入

**解決方案**：確保 `partials/start.ejs` 包含：

```html
<script src="https://cdn.tailwindcss.com"></script>
```

---

### Agents 列表不完整

**症狀**：WebUI 只顯示部分 Agents

**原因**：`agentLoader.list()` 只回傳已載入（快取）的 Agents

**解決方案**：在 `src/index.ts` 啟動時呼叫 `loadAllAgents()`：

```typescript
await agentLoader.loadAllAgents();
logger.info({ loadedCount: agentLoader.list().length }, 'Agents loaded');
```

**相關檔案**：`src/index.ts`

---

### 登入失敗

**症狀**：輸入正確密碼仍無法登入

**檢查項目**：
1. `WEBUI_PASSWORD` 環境變數是否設定
2. `WEBUI_JWT_SECRET` 環境變數是否設定（若未設定會使用預設值）
3. 檢查瀏覽器 Cookie 是否被阻擋

---

### 靜態資源 404

**症狀**：`/static/js/app.js` 或 CSS 檔案載入失敗

**原因**：Express 靜態檔案路徑設定錯誤

**解決方案**：確保 `WebUIServer.ts` 正確設定：

```typescript
this.app.use('/static', express.static(path.join(process.cwd(), 'public')));
```

---

## 開發注意事項

### TypeScript 嚴格模式

- 禁止使用 `any` 類型
- 使用 `unknown` + 類型守衛代替
- 開啟 `strict: true` 和 `noUncheckedIndexedAccess: true`

### 測試

- 目標覆蓋率 > 80%
- 使用 Vitest
- Mock SDK 和 Telegram API

```typescript
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } };
      yield { type: 'result', subtype: 'success', session_id: 'test-session' };
    }
  })
}));
```

### 日誌

使用 pino 結構化日誌：

```typescript
logger.info({
  event: 'session_created',
  sessionId: session.sessionId,
  agentId: session.agentId,
}, 'Session created');
```

### 錯誤處理

使用自訂錯誤類別：
- `AgentLoadError` - Agent 載入失敗
- `SessionError` - Session 操作失敗
- `ProcessingError` - 訊息處理失敗
- `RateLimitError` - 速率限制

### 並發控制

使用 `async-mutex` 防止同一用戶的並發請求：

```typescript
import { Mutex } from 'async-mutex';
const mutex = new Mutex();
await mutex.runExclusive(async () => {
  // 處理訊息
});
```
