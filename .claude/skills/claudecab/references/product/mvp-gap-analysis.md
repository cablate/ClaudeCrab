> **⚠️ 歷史文件 — 已策展歸檔**：策展版本請見 [`_archive/planning/mvp-gap-analysis.md`](../_archive/planning/mvp-gap-analysis.md)
> 本檔案為原始開發紀錄，保留供完整追溯。

# MVP 就緒度落差分析

> 2026-02-13 更新

**MVP 就緒度評估：95%**（僅剩 P0-1 token 外部化待公開前處理）

---

## 🔴 P0 — 安全問題

### 1. Telegram Bot Token 暴露在 git 中
- **檔案**：`agents/general/agent.json`, `agents/coder/agent.json`, `agents/admin/agent.json`
- **問題**：生產 Telegram Bot Token 直接提交到版本控制
- **影響**：公開 repo 後任何人都能控制這些 bot
- **方案**：Token 改為環境變數引用，從 agent.json 移除實際 token
- **狀態**：⏭️ 延後（公開前處理，目前私有 repo）

### 2. ~~JWT 密鑰硬編碼默認值~~ ✅ 已修復
- `getJWTSecret()` 移除 hardcoded fallback，未設定時拒絕啟動

### 3. ~~WebUI 密碼無強制要求~~ ✅ 已修復
- `initializeWebUI()` 啟動時檢查 `WEBUI_PASSWORD` 和 `WEBUI_JWT_SECRET`

---

## 🟠 P1 — 新用戶體驗

### 4. ~~配置複雜度高~~ ✅ 已修復
- `npm run setup` 交互式精靈：.env 設定 + 第一個 Agent 建立

### 5. ~~README 設定說明不完整~~ ✅ 已修復
- Quick Start Checklist、Environment Variables 表、Troubleshooting 章節

### 6. ~~_example Agent 模板品質差~~ ✅ 已修復
- 移除佔位符，加入 display 欄位範例，完善 .env.example

---

## 🟡 P2 — 代碼品質與維護性

### 7. ~~public/images/generated/ 雜亂~~ ✅ 已修復
- 刪除 generated/ 目錄，原圖保留在 agents/{id}/originals/，背景圖搬到 images/

### 8. ~~魔術數字分散~~ ✅ 已修復
- 7 個檔案的 inline 數字提取為命名常數（timing、limits、buffer sizes）

### 9. ~~未完成功能佔位符~~ ✅ 已修復
- 移除 system.api.ts 和 audit.ejs 中的 Phase 2/3 placeholder 文字

### 10. ~~Agent 啟動缺少驗證~~ ✅ 已修復
- `validateAgentSetup()` 檢查 CLAUDE.md、name、telegramBotToken

---

## 📋 修復優先順序

### 已完成 ✅
- [x] P0-2: JWT 密鑰強制設定
- [x] P0-3: WebUI 密碼強制檢查
- [x] P1-5: 完善 README Quick Start
- [x] P1-6: 完善 _example 模板
- [x] P2-8: 提取魔術數字
- [x] P2-9: 清理佔位符
- [x] P2-10: Agent 啟動驗證

### 待做
- [ ] P0-1: Bot Token 外部化（公開前處理）

### 新完成 ✅
- [x] P1-4: 簡化配置流程（`npm run setup`）
- [x] P2-7: 清理 images/generated/

---

## 配置複雜性評估

| 組件 | 需編輯檔案 | 配置項 | 難度 |
|------|-----------|-------|------|
| 基礎環境 | 1 (.env) | 1 (API key) | 低 |
| Telegram Bot | 1 (.env) + N (agent.json) | N (token) | 中 |
| WebUI | 1 (.env) | 3 (password, secret, port) | 低 |
| Agent 創建 | 2 (agent.json, CLAUDE.md) | 5+ | 高 |
| **總計** | **5+ 檔案** | **~15 項** | |
