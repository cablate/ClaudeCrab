# Moltbot 機制差距分析

> **類型**：差距分析
> **時間範圍**：2026-01-28
> **狀態**：✅ 已完成歸檔（歷史文件，不再更新）
> **後續影響**：確立了 ClaudeCab agent 層的記憶架構——BOOTSTRAP.md 首次啟動儀式、Auto-flush 對話保護規則、教訓寫入路由修正。所有改動均為 agent 層面（CLAUDE.md + BOOTSTRAP.md），零引擎程式碼變更。

---

## 背景：為什麼做這件事

ClaudeCab 的 agent 記憶系統（agents/general/）參考了 Moltbot 框架設計，但未曾系統性地與 Moltbot 官方文件（docs.molt.bot）做逐項對照。此分析旨在找出已實作、需修正、應新增、以及不適用的機制，確保 ClaudeCab 在 agent 層面不遺漏關鍵設計。

---

## 核心發現 / 決策

### 已正確實作的機制

| 機制 | 說明 |
|------|------|
| AGENTS.md → CLAUDE.md | 行為手冊、記憶協議、安全邊界 |
| SOUL.md / USER.md / IDENTITY.md / MEMORY.md | 人格基底、使用者檔案、AI 身份、長期記憶（模板已建立） |
| memory/ 每日日誌 | 目錄結構已建立 |
| Startup Protocol | session 啟動讀取順序已完成 |
| 記憶寫入規則 | 依內容類型寫入不同檔案 |
| Safety 邊界 | 讀自由、外部行動先問 |
| 動態 SystemPrompt | Agent 自主更新 CLAUDE.md 即時生效（v1.5.1 引擎層） |

### 需修正：教訓寫入位置

- **原本**：教訓寫入 SOUL.md
- **修正為**：寫入 CLAUDE.md（行為手冊）
- **理由**：SOUL.md 是人格定義（穩定、緩慢演化），教訓本質是「操作手冊的修正」，應隨經驗累積在行為手冊中

### 新增：BOOTSTRAP.md — 首次啟動儀式

- Moltbot 官方設計為一次性 onboarding，僅在全新 workspace 中存在
- 流程：自我發現（決定名字、本質、溝通風格）→ 記錄結果（寫入 IDENTITY.md / USER.md / SOUL.md）→ 完成後刪除 BOOTSTRAP.md
- 設計理念：「genuine becoming」而非「mere configuration」
- ClaudeCab 適配：Startup Protocol 加入檢查，檔案存在 = 新 workspace

### 新增：Auto-flush — 長對話記憶保護

- Moltbot 官方透過 token 估算觸發 silent agentic turn，compaction 前自動保存記憶
- ClaudeCab 無法偵測 context window 剩餘量，改以 CLAUDE.md 行為規則模擬：主動寫入 memory/、不等提醒、對話接近尾聲時回顧

### 決定不做的機制

| 機制 | 不做原因 |
|------|----------|
| HEARTBEAT.md（定期巡邏） | 需要 Gateway 排程器配套，純 CLAUDE.md 指令無法實現 |
| BOOT.md（重啟指令） | ClaudeCab 無長駐 daemon |
| 向量語義搜尋 | Phase 0 不啟用外部依賴，MEMORY.md 手動策展替代 |
| Cron 排程 | ClaudeCab 無 cron 機制 |
| TOOLS.md（環境備註） | general agent 不需要，未來 coder agent 可加入 |

---

## 執行結果

| 項目 | 改動 |
|------|------|
| 教訓寫入位置修正 | CLAUDE.md：教訓路由 SOUL.md → CLAUDE.md Lessons Learned 區段 |
| BOOTSTRAP.md | 新增首次啟動儀式 + Startup Protocol 加檢查 |
| Auto-flush 對話保護 | CLAUDE.md 新增「對話保護」行為規則區段 |
| Lessons Learned 區段 | CLAUDE.md 尾部新增空區段，供 agent 自行寫入教訓 |

所有改動限於 `agents/general/CLAUDE.md` 和新增的 `agents/general/BOOTSTRAP.md`，未觸及 `src/` 任何程式碼。

---

## 回顧：學到了什麼

1. **不是所有框架機制都適合搬**：HEARTBEAT / BOOT / Cron 等需要基礎設施配套的機制，硬用 prompt 指令模擬只會語義偏離，不如明確決定不做。
2. **Agent 層的改動成本極低**：所有新增機制都是 Markdown 文件層面的調整，零引擎改動，維持了引擎的可獨立抽離性。
3. **官方設計的「為什麼」比「怎麼做」更有價值**：例如 BOOTSTRAP.md 的 "genuine becoming" 理念、教訓與人格的分離原則，這些設計理由比具體實作模板更能指導後續架構決策。

---

## 關聯文件

- Moltbot 官方文件：[docs.molt.bot](https://docs.molt.bot)（Memory、Agent Workspace、Bootstrap、Heartbeat 等頁面）
- 影響的檔案：`agents/general/CLAUDE.md`、`agents/general/BOOTSTRAP.md`
