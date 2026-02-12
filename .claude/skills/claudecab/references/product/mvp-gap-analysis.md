# MVP 就緒度落差分析

> 2026-02-12 分析，基於全面代碼審查

**MVP 就緒度評估：65-70%**

---

## 🔴 P0 — 安全問題（必須立即處理）

### 1. Telegram Bot Token 暴露在 git 中
- **檔案**：`agents/general/agent.json`, `agents/coder/agent.json`, `agents/admin/agent.json`
- **問題**：生產 Telegram Bot Token 直接提交到版本控制
- **影響**：公開 repo 後任何人都能控制這些 bot
- **方案**：Token 改為環境變數引用（`telegramBotTokenEnvVar: "GENERAL_BOT_TOKEN"`），從 agent.json 移除實際 token

### 2. JWT 密鑰硬編碼默認值
- **檔案**：`src/webui/middleware/auth.ts:7`
- **問題**：`'claudecab-default-secret-change-me'` 作為 fallback
- **影響**：未設定環境變數時任何人可偽造 JWT
- **方案**：未設定 `WEBUI_JWT_SECRET` 時拒絕啟動 WebUI

### 3. WebUI 密碼無強制要求
- **檔案**：`src/webui/middleware/auth.ts:68`
- **問題**：`WEBUI_PASSWORD` 未設定時行為不明確
- **方案**：啟動時檢查，未設定且 `WEBUI_ENABLED=true` 則拒絕啟動

---

## 🟠 P1 — 新用戶體驗（阻礙快速開始）

### 4. 配置複雜度高
- **問題**：新用戶需要編輯 5+ 個檔案（.env, 每個 agent.json, settings.local.json）
- **方案**：`npm run setup` 交互式配置精靈

### 5. README 設定說明不完整
- **檔案**：`README.md`
- **缺漏**：Telegram Token 獲取步驟、WebUI 認證、故障排除、設定檢查清單
- **方案**：新增 Quick Start Checklist + Troubleshooting 章節

### 6. _example Agent 模板品質差
- **檔案**：`agents/_example/`
- **問題**：佔位符 `{{AGENT_NAME}}` 不直觀，缺少 MEMORY.md/USER.md 模板
- **方案**：完善模板，加上 display 欄位範例和清晰註解

---

## 🟡 P2 — 代碼品質與維護性

### 7. public/images/generated/ 雜亂
- **問題**：80+ 個檔案含大量舊版本（v1/v2/v3 變體）和 test-* 測試圖
- **方案**：清理舊版本，保留需要的，加 README 說明

### 8. 魔術數字分散
- **檔案**：`src/config.ts`, `src/utils/retry.ts`, `src/webui/middleware/auth.ts`
- **問題**：timeout、重試次數等硬編碼，無集中常數定義
- **方案**：提取到 `src/constants/defaults.ts`

### 9. 未完成功能佔位符
- `src/webui/api/system.api.ts:111` — "Phase 2 placeholder"
- `src/core/MessageProcessor.ts:535` — noise filter placeholder
- **方案**：轉為 GitHub issues 追蹤，或移除佔位符

### 10. Agent 啟動缺少驗證
- **檔案**：`src/core/AgentLoader.ts`
- **問題**：不驗證 CLAUDE.md 存在，錯誤訊息不夠引導
- **方案**：添加 `validateAgentConfig()` 並提供修復提示

---

## 📋 修復優先順序

### 立即
- [ ] P0-1: Bot Token 外部化（環境變數引用）
- [ ] P0-2: JWT 密鑰強制設定
- [ ] P0-3: WebUI 密碼強制檢查

### 短期
- [ ] P1-4: 簡化配置流程
- [ ] P1-5: 完善 README Quick Start
- [ ] P1-6: 完善 _example 模板
- [ ] P2-7: 清理 images/generated/

### 中期
- [ ] P2-8: 提取魔術數字
- [ ] P2-9: 清理佔位符
- [ ] P2-10: Agent 啟動驗證

---

## 配置複雜性評估

| 組件 | 需編輯檔案 | 配置項 | 難度 |
|------|-----------|-------|------|
| 基礎環境 | 1 (.env) | 1 (API key) | 低 |
| Telegram Bot | 1 (.env) + N (agent.json) | N (token) | 中 |
| WebUI | 1 (.env) | 3 (password, secret, port) | 低 |
| Agent 創建 | 2 (agent.json, CLAUDE.md) | 5+ | 高 |
| **總計** | **5+ 檔案** | **~15 項** | |
